import { useMemo, useState, type ReactNode } from 'react';
import { Search, ArrowUpDown, FileSpreadsheet, FileText, ChevronRight } from 'lucide-react';
import { cx, Spinner, ErrorState, EmptyState, Button } from './primitives';
import { exportExcel, exportPdf, type ExportColumn } from '@core/lib/export';
import { useAuth } from '@core/auth/AuthProvider';
import { useModules } from '@core/modules/registry';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** Valor para ordenar / exportar / buscar (por defecto row[key]) */
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** En teléfono: 'title' = encabezado de la tarjeta, 'hide' = oculto */
  mobile?: 'title' | 'hide';
  sortable?: boolean;
  /** Solo visible para el administrador (autoría, costos) */
  admin?: boolean;
}

export function DataTable<T extends object>({
  rows, columns: allColumns, loading, error, onRowClick, search = true, toolbar, empty, exportName, pageSize = 50, rowKey,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  loading?: boolean;
  error?: { message: string } | null;
  onRowClick?: (row: T) => void;
  search?: boolean;
  toolbar?: ReactNode;
  empty?: ReactNode;
  /** Si se indica, muestra exportar a Excel/PDF con este nombre */
  exportName?: string;
  pageSize?: number;
  rowKey?: (row: T) => string;
}) {
  const { can, isAdmin } = useAuth();
  const columns = useMemo(() => allColumns.filter((c) => !c.admin || isAdmin), [allColumns, isAdmin]);
  const { isActive } = useModules();
  // Con el módulo de Reportes instalado, exportar requiere el permiso reports.export
  const canExport = !!exportName && (!isActive('reports') || can('reports.export'));
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(pageSize);

  const valueOf = (c: Column<T>, r: T) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) as string | number | null | undefined;

  const filtered = useMemo(() => {
    let out = rows ?? [];
    if (q.trim()) {
      const needle = q.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      out = out.filter((r) => columns.some((c) => String(valueOf(c, r) ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(needle)));
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)!;
      out = [...out].sort((a, b) => {
        const va = valueOf(c, a), vb = valueOf(c, b);
        if (va == null) return 1; if (vb == null) return -1;
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, columns]);

  const exportCols: ExportColumn[] = columns.map((c) => ({ header: c.header, value: (r: unknown) => valueOf(c, r as T) }));
  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const keyOf = (r: T, i: number) => rowKey?.(r) ?? String((r as { id?: string | number }).id ?? i);

  return (
    <div className="rounded-card border border-line bg-panel shadow-card">
      {(search || toolbar || canExport) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          {search && (
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
                className="h-9 w-full rounded-md border border-line bg-paper pr-3 pl-8 text-sm focus:border-brand focus:outline-none" />
            </div>
          )}
          {toolbar}
          {canExport && filtered.length > 0 && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={FileSpreadsheet} onClick={() => exportExcel(exportName!, exportCols, filtered)}>Excel</Button>
              <Button size="sm" variant="ghost" icon={FileText} onClick={() => exportPdf(exportName!, exportCols, filtered)}>PDF</Button>
            </div>
          )}
        </div>
      )}

      {loading ? <Spinner /> : error ? <div className="p-3"><ErrorState error={error} /></div>
        : filtered.length === 0 ? (empty ?? <EmptyState title={q ? 'Sin resultados' : 'No hay registros'} />)
        : (
          <>
            {/* Escritorio */}
            <div className="scroll-x hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-left text-[12px] text-muted">
                    {columns.map((c) => (
                      <th key={c.key} className={cx('px-3 py-2 font-medium whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                        {c.sortable !== false ? (
                          <button className="inline-flex items-center gap-1 hover:text-ink"
                            onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                            {c.header}<ArrowUpDown className={cx('size-3', sort?.key === c.key ? 'text-ink' : 'opacity-30')} />
                          </button>
                        ) : c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((r, i) => (
                    <tr key={keyOf(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                      className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-paper')}>
                      {columns.map((c) => (
                        <td key={c.key} className={cx('px-3 py-2.5 align-middle', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                          {c.render ? c.render(r) : String(valueOf(c, r) ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Teléfono */}
            <ul className="divide-y divide-line md:hidden">
              {filtered.slice(0, limit).map((r, i) => (
                <li key={keyOf(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx('flex items-center gap-3 px-3.5 py-3', onRowClick && 'active:bg-paper')}>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[15px] font-medium">{titleCol.render ? titleCol.render(r) : String(valueOf(titleCol, r) ?? '')}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                      {columns.filter((c) => c !== titleCol && c.mobile !== 'hide').map((c) => (
                        <span key={c.key} className="inline-flex items-center gap-1">{c.render ? c.render(r) : String(valueOf(c, r) ?? '—')}</span>
                      ))}
                    </div>
                  </div>
                  {onRowClick && <ChevronRight className="size-4 shrink-0 text-faint" />}
                </li>
              ))}
            </ul>
            {filtered.length > limit && (
              <div className="border-t border-line p-2 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + pageSize)}>
                  Mostrar más ({filtered.length - limit} restantes)
                </Button>
              </div>
            )}
          </>
        )}
    </div>
  );
}
