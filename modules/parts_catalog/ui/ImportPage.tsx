import { useMemo, useState } from 'react';
import { Download, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { rpc } from '@core/data/api';
import { useModels, modelLabel } from '@core/data/shared';
import { useToast } from '@core/ui/Toast';
import { Badge, Button, Card, PageHeader, Section } from '@core/ui/primitives';
import { Field, FormGrid, Select } from '@core/ui/form';
import { keys, useManuals } from './data';
import { useQueryClient } from '@tanstack/react-query';

/** Campos que entiende catalog_import_rows (los demás se ignoran) */
const FIELDS: { key: string; label: string; required?: boolean; aliases: string[] }[] = [
  { key: 'manufacturer', label: 'Fabricante', required: true, aliases: ['fabricante', 'manufacturer', 'marca', 'brand'] },
  { key: 'oem_number', label: 'Número OEM', required: true, aliases: ['oem', 'oem_number', 'part number', 'part_number', 'numero', 'número', 'pn', 'no. pieza'] },
  { key: 'name', label: 'Nombre', required: true, aliases: ['nombre', 'name', 'description short', 'descripcion corta', 'pieza'] },
  { key: 'description', label: 'Descripción', aliases: ['descripcion', 'descripción', 'description'] },
  { key: 'system', label: 'Sistema', aliases: ['sistema', 'system', 'grupo', 'group'] },
  { key: 'category', label: 'Categoría', aliases: ['categoria', 'categoría', 'category'] },
  { key: 'subcategory', label: 'Subcategoría', aliases: ['subcategoria', 'subcategoría', 'subcategory'] },
  { key: 'model_manufacturer', label: 'Marca del vehículo', aliases: ['marca vehiculo', 'vehicle make', 'make'] },
  { key: 'model', label: 'Modelo del vehículo', aliases: ['modelo', 'model'] },
  { key: 'year', label: 'Año', aliases: ['año', 'ano', 'year'] },
  { key: 'diagram_title', label: 'Diagrama (título)', aliases: ['diagrama', 'diagram', 'figura', 'figure'] },
  { key: 'diagram_ref', label: 'Diagrama (código)', aliases: ['ref diagrama', 'diagram_ref', 'fig', 'figure code'] },
  { key: 'page', label: 'Página del manual', aliases: ['pagina', 'página', 'page', 'pag'] },
  { key: 'callout', label: 'Nº en diagrama', aliases: ['callout', 'ref', 'item', 'posicion', 'posición', 'key'] },
  { key: 'qty', label: 'Cantidad por unidad', aliases: ['qty', 'cantidad', 'quantity'] },
  { key: 'supersedes', label: 'Sustituye a (separar con |)', aliases: ['supersedes', 'sustituye', 'reemplaza'] },
  { key: 'alternatives', label: 'Alternos (separar con |)', aliases: ['alternatives', 'alternos', 'alternativos'] },
];
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[_-]+/g, ' ');

async function parseFile(file: File): Promise<Record<string, string>[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'json') {
    const data = JSON.parse(await file.text());
    return (Array.isArray(data) ? data : data.parts ?? data.rows ?? []).map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
  }
  if (ext === 'csv' || ext === 'txt') {
    const Papa = (await import('papaparse')).default;
    return new Promise((res, rej) => Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: (r) => res(r.data), error: rej }));
  }
  if (ext === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    const header: string[] = [];
    ws.getRow(1).eachCell((c, i) => { header[i] = String(c.text ?? ''); });
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const o: Record<string, string> = {};
      row.eachCell((c, i) => { if (header[i]) o[header[i]] = String(c.text ?? ''); });
      if (Object.values(o).some((x) => x.trim())) rows.push(o);
    });
    return rows;
  }
  throw new Error('Formato no soportado. Use CSV, XLSX o JSON. (Para PDF: suba el manual en “Manuales” y extraiga la tabla de piezas a Excel/CSV.)');
}

export default function ImportPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const manuals = useManuals();
  const models = useModels();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [manual, setManual] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; ok: number; errors: { row: number; oem: string; error: string }[] } | null>(null);
  const headers = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r)))], [rows]);

  const load = async (f: File) => {
    try {
      const data = await parseFile(f);
      setFile(f); setRows(data); setProgress(null);
      const hs = [...new Set(data.flatMap((r) => Object.keys(r)))];
      setMap(Object.fromEntries(FIELDS.map((fd) => [fd.key, hs.find((h) => norm(h) === fd.key.replace(/_/g, ' ') || fd.aliases.includes(norm(h))) ?? ''])));
    } catch (e) { toast.error((e as Error).message); }
  };

  const missing = FIELDS.filter((f) => f.required && !map[f.key]);
  const mapped = (r: Record<string, string>) => {
    const o: Record<string, string> = Object.fromEntries(FIELDS.filter((f) => map[f.key]).map((f) => [f.key, (r[map[f.key]] ?? '').trim()]));
    if (defaultModel && !o.model) o.model_id = defaultModel;
    return o;
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const batch = await rpc<string>('catalog_start_import', { p_source: file.name.split('.').pop()!.toLowerCase().replace('txt', 'csv'), p_file: file.name, p_manual: manual || null });
      const state = { done: 0, ok: 0, errors: [] as { row: number; oem: string; error: string }[] };
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map(mapped);
        const res = await rpc<{ ok: number; errors: { row: number; oem: string; error: string }[] }>('catalog_import_rows', { p_batch: batch, p_manual: manual || null, p_rows: chunk });
        state.done += chunk.length; state.ok += res.ok;
        state.errors.push(...res.errors.map((e) => ({ ...e, row: e.row + i + 1 })));
        setProgress({ ...state });
      }
      qc.invalidateQueries({ queryKey: keys.all });
      toast.success(`Importadas ${state.ok} de ${rows.length} filas`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const template = () => {
    const csv = FIELDS.map((f) => f.key).join(',') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'plantilla-catalogo-oem.csv';
    a.click();
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back="/catalogo" title="Importar catálogo de piezas" subtitle="Cargue la tabla de piezas extraída del manual o catálogo OFICIAL. No se inventan números ni compatibilidades: cada fila conserva su manual y página." actions={<Button icon={Download} onClick={template}>Plantilla CSV</Button>} />
      <div className="space-y-4">
        <Section title="1 · Archivo y fuente">
          <FormGrid cols={3}>
            <Field label="Archivo (CSV, XLSX o JSON)"><input type="file" accept=".csv,.txt,.xlsx,.json" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} className="text-sm" /></Field>
            <Field label="Manual de origen" hint="Para trazabilidad (manual + página)"><Select value={manual} onChange={(e) => setManual(e.target.value)} placeholder="—" options={(manuals.data ?? []).map((m) => ({ value: m.id, label: m.title }))} /></Field>
            <Field label="Modelo (si el archivo no lo indica)"><Select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="—" options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></Field>
          </FormGrid>
          {file && <p className="mt-3 text-sm text-muted">{file.name}: <b>{rows.length}</b> filas, {headers.length} columnas.</p>}
        </Section>
        {rows.length > 0 && (
          <Section title="2 · Columnas" description="Se detectaron automáticamente por el nombre. Ajuste si hace falta.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })} placeholder="— no importar —" options={headers.map((h) => ({ value: h, label: h }))} />
                </Field>
              ))}
            </div>
          </Section>
        )}
        {rows.length > 0 && (
          <Section title="3 · Vista previa">
            <div className="scroll-x">
              <table className="w-full text-[13px]"><thead><tr className="border-b border-line text-left text-muted">{FIELDS.filter((f) => map[f.key]).map((f) => <th key={f.key} className="px-2 py-1 font-medium">{f.label}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i} className="border-b border-line/60">{FIELDS.filter((f) => map[f.key]).map((f) => <td key={f.key} className="px-2 py-1">{r[map[f.key]]}</td>)}</tr>)}</tbody></table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={FileUp} loading={busy} disabled={missing.length > 0} onClick={run}>Importar {rows.length} filas</Button>
              {missing.length > 0 && <span className="text-sm text-bad">Falta asignar: {missing.map((m) => m.label).join(', ')}</span>}
            </div>
          </Section>
        )}
        {progress && (
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              {progress.done < rows.length ? <span className="text-sm">Importando… {progress.done}/{rows.length}</span>
                : <span className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-5 text-ok" />Terminado</span>}
              <Badge tone="ok">{progress.ok} correctas</Badge>{progress.errors.length > 0 && <Badge tone="bad">{progress.errors.length} con error</Badge>}
            </div>
            {progress.errors.length > 0 && (
              <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-[13px]">
                {progress.errors.map((e, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-bad" />Fila {e.row} {e.oem && <span className="num">({e.oem})</span>}: {e.error}</li>)}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
