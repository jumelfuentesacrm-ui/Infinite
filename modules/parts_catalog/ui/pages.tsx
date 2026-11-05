import { useMemo, useState } from 'react';
import { BookOpen, FileUp, Layers, Link2, PackagePlus, Plus, Search, ShoppingCart, Sparkles } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { uploadFile, signedUrl } from '@core/data/storage';
import { useModels, modelLabel } from '@core/data/shared';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { fmtNum } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, QueryView, Section, cx } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { keys, MANUAL_TYPES, MODULE, useCatalogSearch, useDiagrams, useManuals, type CatalogRow } from './data';

async function openManual(path: string, page?: number | null) {
  const url = await signedUrl(path);
  window.open(page ? `${url}#page=${page}` : url, '_blank', 'noopener');
}

/** Navegación del catálogo: modelo → sistema → diagrama → pieza */
export function CatalogPage() {
  const models = useModels();
  const [model, setModel] = useState('');
  const [system, setSystem] = useState<string | null>(null);
  const [diagram, setDiagram] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [part, setPart] = useState<CatalogRow | null>(null);
  const sel = model || models.data?.[0]?.id || '';
  const diagrams = useDiagrams(sel || null);
  const q = useCatalogSearch({ modelId: sel, system, diagramId: diagram, query }, !!sel);
  const systems = useMemo(() => [...new Set((diagrams.data ?? []).map((d) => d.system))], [diagrams.data]);
  const diag = diagrams.data?.find((d) => d.id === diagram);

  return (
    <>
      <PageHeader title="Catálogo de piezas OEM" subtitle="Información tomada de manuales y catálogos oficiales del fabricante"
        actions={<>
          <LinkButton to="/catalogo/manuales" icon={BookOpen}>Manuales</LinkButton>
          <Can perm="parts_catalog.import"><LinkButton to="/catalogo/importar" icon={FileUp} variant="primary">Importar catálogo</LinkButton></Can>
        </>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card><Field label="Modelo"><Select value={sel} onChange={(e) => { setModel(e.target.value); setSystem(null); setDiagram(null); }} options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></Field></Card>
          <Section title="Sistemas y diagramas">
            {!diagrams.data?.length ? <p className="text-sm text-muted">Sin diagramas importados para este modelo.</p> : (
              <ul className="-mx-2 space-y-0.5 text-sm">
                <li><button onClick={() => { setSystem(null); setDiagram(null); }} className={cx('w-full rounded px-2 py-1.5 text-left', !system && 'bg-sunken font-medium')}>Todas las piezas</button></li>
                {systems.map((s) => (
                  <li key={s}>
                    <button onClick={() => { setSystem(s); setDiagram(null); }} className={cx('flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left', system === s && !diagram && 'bg-sunken font-medium')}><Layers className="size-3.5 text-faint" />{s}</button>
                    {system === s && (
                      <ul className="ml-5 border-l border-line">
                        {(diagrams.data ?? []).filter((d) => d.system === s).map((d) => (
                          <li key={d.id}><button onClick={() => setDiagram(d.id)} className={cx('w-full px-2 py-1 text-left text-[13px]', diagram === d.id ? 'font-medium text-brand' : 'text-ink-2')}>
                            {d.reference_code && <span className="num mr-1 text-faint">{d.reference_code}</span>}{d.title}</button></li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-3">
          {diag && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-medium">{diag.title}</div><div className="text-xs text-muted">{diag.manuals?.title}{diag.page_number && ` · página ${diag.page_number}`}</div></div>
              {diag.manuals?.storage_path && <Button icon={BookOpen} onClick={() => openManual(diag.manuals.storage_path, diag.page_number)}>Ver diagrama en el manual</Button>}
            </Card>
          )}
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por número OEM, nombre o número alterno" className="h-10 pl-9" /></div>
          <PartsTable q={q} onPick={setPart} />
        </div>
      </div>
      {part && <PartModal part={part} modelId={sel} onClose={() => setPart(null)} />}
    </>
  );
}

function PartsTable({ q, onPick }: { q: ReturnType<typeof useCatalogSearch>; onPick: (p: CatalogRow) => void }) {
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} search={false} onRowClick={onPick} exportName="Catalogo-OEM" rowKey={(r) => r.part_id + (r.diagram_id ?? '') + (r.callout ?? '')}
    empty={<EmptyState icon={BookOpen} title="Sin piezas en el catálogo">Importe el catálogo oficial del fabricante (CSV, Excel o JSON) desde “Importar catálogo”.</EmptyState>}
    columns={[
      { key: 'callout', header: 'Ref.', render: (r) => <span className="num text-muted">{r.callout ?? '—'}</span> },
      { key: 'oem_number', header: 'Nº OEM', mobile: 'title', render: (r) => <span className="num font-semibold">{r.oem_number}</span> },
      { key: 'name', header: 'Pieza' },
      { key: 'system', header: 'Sistema', mobile: 'hide' },
      { key: 'available', header: 'Inventario', render: (r) => r.inventory_item_id
        ? <Badge tone={Number(r.available) > 0 ? 'ok' : 'bad'}>{fmtNum(r.available)} disp.{r.location && ` · ${r.location}`}</Badge>
        : <Badge tone="idle" dot={false}>Sin vincular</Badge> },
    ]} />;
}

function PartModal({ part, modelId, onClose, workOrderId, onAdded }: { part: CatalogRow; modelId: string; onClose: () => void; workOrderId?: string; onAdded?: () => void }) {
  const { can } = useAuth();
  const detail = useData([...keys.all, 'part', part.part_id], async () => {
    const [p, sup, fit, links] = await Promise.all([
      run(supabase.from('catalog_parts').select('*, manuals(title, storage_path)').eq('id', part.part_id).single()) as Promise<any>,
      run(supabase.from('catalog_supersessions').select('*').eq('part_id', part.part_id)) as Promise<any[]>,
      run(supabase.from('catalog_fitments').select('*, vehicle_models(manufacturer, model, year)').eq('part_id', part.part_id)) as Promise<any[]>,
      run(supabase.from('catalog_inventory_links').select('*, inventory_items(id, sku, name, quantity_on_hand, quantity_reserved, location)').eq('catalog_part_id', part.part_id)) as Promise<any[]>,
    ]);
    return { p, sup, fit, links };
  });
  const [linking, setLinking] = useState(false);
  const [qty, setQty] = useState('1');
  const linked = detail.data?.links.map((l) => l.inventory_items).filter(Boolean) ?? [];
  const best = linked.sort((a, b) => (b.quantity_on_hand - b.quantity_reserved) - (a.quantity_on_hand - a.quantity_reserved))[0];
  const avail = best ? best.quantity_on_hand - best.quantity_reserved : 0;
  const addToWo = useAction((mode: 'reserve' | 'purchase') => rpc('add_work_order_part', { p_wo: workOrderId, p: {
    inventory_item_id: mode === 'reserve' ? best?.id : best?.id ?? null, catalog_part_id: part.part_id, description: part.name, part_number: part.oem_number,
    quantity: Number(qty) || 1, reserve: mode === 'reserve', to_purchase: mode === 'purchase' } }),
  { invalidate: [['work_orders'], ['inventory']], success: (r: any) => r.status === 'reserved' ? 'Pieza reservada para la orden' : 'Pieza añadida y enviada a compras', onSuccess: () => { onAdded?.(); onClose(); } });
  const request = useAction(() => rpc('request_purchase', { p: { catalog_part_id: part.part_id, item_id: best?.id ?? null, description: part.name, part_number: part.oem_number, quantity: Number(qty) || 1, reason: 'Desde catálogo OEM' } }),
    { invalidate: [['inventory']], success: 'Solicitud de compra enviada' });

  return (
    <Modal open onClose={onClose} title={<span className="num">{part.oem_number}</span>} size="lg"
      footer={workOrderId ? <>
        <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="h-10 w-20" aria-label="Cantidad" />
        {best && avail >= (Number(qty) || 1)
          ? <Button variant="primary" loading={addToWo.isPending} onClick={() => addToWo.mutate('reserve')}>Reservar para la orden</Button>
          : <Button variant="primary" icon={ShoppingCart} loading={addToWo.isPending} onClick={() => addToWo.mutate('purchase')}>Marcar necesaria y solicitar compra</Button>}
      </> : <Button onClick={onClose}>Cerrar</Button>}>
      <QueryView q={detail}>
        {({ p, sup, fit }) => (
          <div className="space-y-4">
            <div><div className="text-lg font-semibold">{p.name}</div><div className="text-sm text-muted">{p.manufacturer} · {[p.system, p.category, p.subcategory].filter(Boolean).join(' › ')}</div>
              {p.description && <p className="mt-2 text-sm">{p.description}</p>}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card><div className="mb-1 text-xs font-medium text-muted">Fuente</div>
                <div className="text-sm">{p.manuals?.title ?? 'Sin manual asociado'}{p.source_page && ` · pág. ${p.source_page}`}</div>
                {p.manuals?.storage_path && <Button size="sm" className="mt-2" icon={BookOpen} onClick={() => openManual(p.manuals.storage_path, p.source_page)}>Abrir manual</Button>}</Card>
              <Card><div className="mb-1 text-xs font-medium text-muted">Compatibilidad documentada</div>
                <ul className="text-sm">{fit.map((f) => <li key={f.id}>{modelLabel(f.vehicle_models)}{f.callout && <span className="text-muted"> · ref. {f.callout}</span>}{f.qty_per_unit && <span className="text-muted"> · {fmtNum(f.qty_per_unit)} por unidad</span>}</li>)}</ul></Card>
            </div>
            {sup.length > 0 && <Card><div className="mb-1 text-xs font-medium text-muted">Números alternos / sustituciones</div>
              <div className="flex flex-wrap gap-2">{sup.map((s) => <Badge key={s.id} dot={false}>{({ supersedes: 'Sustituye a', superseded_by: 'Sustituido por', alternative: 'Alterno' } as Record<string, string>)[s.relation]} <span className="num ml-1">{s.related_oem}</span></Badge>)}</div></Card>}
            <Card>
              <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-muted">Inventario interno</span>
                {can('parts_catalog.link') && <Button size="sm" variant="ghost" icon={Link2} onClick={() => setLinking(true)}>Vincular</Button>}</div>
              {!linked.length ? <p className="text-sm text-muted">Esta pieza no está vinculada a ningún artículo del inventario.</p> : (
                <ul className="space-y-1 text-sm">{linked.map((i: any) => (
                  <li key={i.id} className="flex justify-between"><span><span className="tag-unit mr-2">{i.sku}</span>{i.name}</span><span className="num">{fmtNum(i.quantity_on_hand - i.quantity_reserved)} disp. · {i.location ?? '—'}</span></li>
                ))}</ul>
              )}
              {!workOrderId && can('inventory.request') && <Button size="sm" className="mt-3" icon={ShoppingCart} loading={request.isPending} onClick={() => request.mutate()}>Solicitar compra</Button>}
            </Card>
          </div>
        )}
      </QueryView>
      {linking && <LinkModal part={part} modelId={modelId} onClose={() => { setLinking(false); detail.refetch(); }} />}
    </Modal>
  );
}

function LinkModal({ part, onClose }: { part: CatalogRow; modelId: string; onClose: () => void }) {
  const { can } = useAuth();
  const items = useData(['inventory', 'items', 'link'], () => run(supabase.from('inventory_items').select('id, sku, name, part_number').is('archived_at', null).order('name')) as Promise<any[]>);
  const [itemId, setItemId] = useState('');
  const [sku, setSku] = useState(part.oem_number);
  const [location, setLocation] = useState('');
  const link = useAction(() => rpc('catalog_link_inventory', { p_part: part.part_id, p_item: itemId, p_link: true }), { invalidate: [keys.all], success: 'Vinculado', onSuccess: onClose });
  const create = useAction(() => rpc('catalog_create_inventory_item', { p_part: part.part_id, p_sku: sku, p_location: location || null, p_min: 0 }), { invalidate: [keys.all, ['inventory']], success: 'Artículo creado y vinculado', onSuccess: onClose });
  const suggested = (items.data ?? []).filter((i) => i.part_number && i.part_number.replace(/-/g, '').toLowerCase() === part.oem_number.replace(/-/g, '').toLowerCase());
  return (
    <Modal open onClose={onClose} title="Vincular con inventario" size="sm" footer={<Button onClick={onClose}>Cerrar</Button>}>
      <div className="space-y-4">
        {suggested.length > 0 && <p className="flex items-center gap-1.5 text-sm text-ok"><Sparkles className="size-4" />Coincidencia por número: {suggested.map((s) => s.sku).join(', ')}</p>}
        <Field label="Artículo existente"><Select value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Seleccione" options={[...suggested, ...(items.data ?? []).filter((i) => !suggested.includes(i))].map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }))} /></Field>
        <Button variant="primary" disabled={!itemId} loading={link.isPending} onClick={() => link.mutate()}>Vincular</Button>
        {can('inventory.create') && (
          <div className="border-t border-line pt-4">
            <div className="mb-2 text-sm font-medium">o crear artículo nuevo desde esta pieza</div>
            <FormGrid><Field label="Código interno"><Input className="h-10 font-mono" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
              <Field label="Ubicación"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field></FormGrid>
            <Button className="mt-2" icon={PackagePlus} loading={create.isPending} onClick={() => create.mutate()}>Crear y vincular</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Manuales
export function ManualsPage() {
  const q = useManuals();
  const models = useModels();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader back="/catalogo" title="Manuales y catálogos" actions={<Can perm="parts_catalog.import"><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Subir manual</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={(m) => m.storage_path && openManual(m.storage_path)} empty={<EmptyState icon={BookOpen} title="Sin manuales">Suba los manuales oficiales en PDF para consultarlos desde la aplicación.</EmptyState>} columns={[
        { key: 'title', header: 'Título', mobile: 'title', render: (m) => <span className="font-medium">{m.title}</span> },
        { key: 'manufacturer', header: 'Fabricante' },
        { key: 'manual_type', header: 'Tipo', value: (m) => MANUAL_TYPES[m.manual_type] },
        { key: 'model', header: 'Modelo', value: (m) => (m.model_id ? modelLabel(models.data?.find((x) => x.id === m.model_id)) : 'Varios') },
        { key: 'years', header: 'Años', value: (m) => [m.year_from, m.year_to].filter(Boolean).join('–') },
        { key: 'file', header: 'PDF', render: (m) => (m.storage_path ? <Badge tone="ok">Disponible</Badge> : <Badge>Sin archivo</Badge>) },
      ]} />
      {adding && <ManualForm onClose={() => setAdding(false)} />}
    </>
  );
}

function ManualForm({ onClose }: { onClose: () => void }) {
  const models = useModels();
  const [v, setV] = useState({ title: '', manufacturer: '', manual_type: 'service', model_id: '', year_from: '', year_to: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const save = useAction(async () => {
    if (!v.title.trim() || !v.manufacturer.trim()) throw new Error('Título y fabricante son requeridos');
    const up = file ? await uploadFile(MODULE, 'manuals', file) : null;
    return run(supabase.from('manuals').insert({ ...v, model_id: v.model_id || null, year_from: v.year_from ? Number(v.year_from) : null, year_to: v.year_to ? Number(v.year_to) : null,
      notes: v.notes || null, storage_path: up?.path ?? null }));
  }, { invalidate: [keys.all], success: 'Manual guardado', onSuccess: onClose });
  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Modal open onClose={onClose} title="Subir manual" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Título" required><Input {...f('title')} placeholder="Manual de servicio Outlander 2024" /></Field>
        <FormGrid>
          <Field label="Fabricante" required><Input {...f('manufacturer')} /></Field>
          <Field label="Tipo"><Select {...f('manual_type')} options={Object.entries(MANUAL_TYPES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Modelo"><Select {...f('model_id')} placeholder="Varios / general" options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Año desde"><Input type="number" {...f('year_from')} /></Field><Field label="Año hasta"><Input type="number" {...f('year_to')} /></Field></div>
        </FormGrid>
        <Field label="Archivo PDF"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
        <Field label="Notas"><Textarea rows={2} {...f('notes')} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Slot: elegir pieza OEM para una orden
export function CatalogPartPicker({ workOrderId, modelId, onAdded }: { workOrderId: string; vehicleId: string; modelId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [part, setPart] = useState<CatalogRow | null>(null);
  const q = useCatalogSearch({ modelId, query }, open);
  return <>
    <Button icon={BookOpen} onClick={() => setOpen(true)}>Del catálogo OEM</Button>
    {open && (
      <Modal open onClose={() => setOpen(false)} title="Catálogo OEM del modelo" size="lg">
        <div className="space-y-3">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Número OEM o nombre de la pieza" className="h-10" />
          <PartsTable q={q} onPick={setPart} />
        </div>
        {part && <PartModal part={part} modelId={modelId} workOrderId={workOrderId} onAdded={() => { onAdded(); setOpen(false); }} onClose={() => setPart(null)} />}
      </Modal>
    )}
  </>;
}

/** Configuración › sugerencias de vínculo automático (número de pieza = número OEM) */
export function LinkSuggestionsPanel() {
  const q = useData([...keys.all, 'suggestions'], () => run(supabase.from('catalog_link_suggestions').select('*').limit(300)) as Promise<any[]>);
  const link = useAction((r: any) => rpc('catalog_link_inventory', { p_part: r.catalog_part_id, p_item: r.inventory_item_id, p_link: true }), { invalidate: [keys.all], success: 'Vinculado' });
  return (
    <Section title="Vínculos sugeridos catálogo ↔ inventario" description="Artículos del inventario cuyo número de fabricante coincide con un número OEM del catálogo.">
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} search={false} rowKey={(r) => r.catalog_part_id + r.inventory_item_id} empty={<EmptyState title="Sin sugerencias pendientes" />} columns={[
        { key: 'oem_number', header: 'OEM', mobile: 'title', render: (r) => <span className="num font-semibold">{r.oem_number}</span> },
        { key: 'catalog_name', header: 'Catálogo' },
        { key: 'item', header: 'Inventario', value: (r) => `${r.sku} · ${r.item_name}` },
        { key: 'act', header: '', sortable: false, render: (r) => <Button size="sm" icon={Link2} onClick={() => link.mutate(r)}>Vincular</Button> },
      ]} />
    </Section>
  );
}
