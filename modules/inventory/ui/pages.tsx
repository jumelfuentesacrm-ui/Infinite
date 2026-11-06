import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, PackagePlus, PackageSearch, Pencil, Plus, ShoppingCart, Truck, Search } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useModels, modelLabel, partCategoryOptions } from '@core/data/shared';
import { Can, useAuth, useWho } from '@core/auth/AuthProvider';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { fmtDateTime, fmtMoney, fmtNum } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, KeyValue, LinkButton, PageHeader, QueryView, Section, Segmented, StatCard, StatusBadge, Tabs, cx } from '@core/ui/primitives';
import { CheckList, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { DataTable, type Column } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { available, keys, MOVE, PR_STATUS, stockTone, useCanSeeCosts, useItem, useItems, useMovements, useSuppliers, type Item } from './data';

const itemColumns: Column<Item>[] = [
  { key: 'name', header: 'Pieza', mobile: 'title', render: (i) => <span className="font-medium">{i.name}</span> },
  { key: 'sku', header: 'Código', render: (i) => <span className="tag-unit">{i.sku}</span> },
  { key: 'part_number', header: 'Nº fabricante', mobile: 'hide', render: (i) => <span className="num text-[13px]">{i.part_number ?? '—'}</span> },
  { key: 'category', header: 'Categoría', mobile: 'hide' },
  { key: 'quantity_on_hand', header: 'Existencia', align: 'right', value: (i) => Number(i.quantity_on_hand),
    render: (i) => <span className="inline-flex items-center gap-1.5"><span className={cx('size-2 rounded-full', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[stockTone(i)])} /><span className="num font-medium">{fmtNum(i.quantity_on_hand)}</span></span> },
  { key: 'available', header: 'Disponible', align: 'right', value: (i) => available(i), render: (i) => <span className="num">{fmtNum(available(i))}</span> },
  { key: 'min_quantity', header: 'Mínimo', align: 'right', mobile: 'hide', render: (i) => <span className="num text-muted">{fmtNum(i.min_quantity)}</span> },
  { key: 'location', header: 'Ubicación', mobile: 'hide' },
];

export function InventoryPage() {
  const q = useItems();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [creating, setCreating] = useState(false);
  const [cat, setCat] = useState('');
  const rows = (q.data ?? []).filter((i) => (filter === 'all' || (filter === 'out' ? Number(i.quantity_on_hand) <= 0 : stockTone(i) !== 'ok'))
    && (!cat || (cat === '—' ? !i.category : i.category === cat)));
  const cats = useMemo(() => [...new Set((q.data ?? []).map((i) => i.category || '—'))].sort((a, b) => a.localeCompare(b, 'es')), [q.data]);
  const canCosts = useCanSeeCosts();
  const value = (q.data ?? []).reduce((s, i) => s + Number(i.quantity_on_hand) * Number(i.unit_cost ?? 0), 0);
  return (
    <>
      <PageHeader title="Inventario" actions={<>
        <LinkButton to="/inventario/compras" icon={ShoppingCart}>Compras</LinkButton>
        <LinkButton to="/inventario/proveedores" icon={Truck}>Proveedores</LinkButton>
        <Can perm="inventory.create"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nueva pieza</Button></Can>
      </>} />
      <div className={cx('mb-4 grid grid-cols-2 gap-3', canCosts ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
        <StatCard label="Artículos" value={q.data?.length ?? '—'} icon={Boxes} />
        <StatCard label="Inventario bajo" value={(q.data ?? []).filter((i) => stockTone(i) === 'warn').length} tone="warn" />
        <StatCard label="Agotados" value={(q.data ?? []).filter((i) => stockTone(i) === 'bad').length} tone="bad" />
        {canCosts && <StatCard label="Valor en existencia" value={fmtMoney(value)} />}
      </div>
      <DataTable rows={rows} loading={q.isLoading} error={q.error} columns={itemColumns} onRowClick={(i) => nav(`/inventario/${i.id}`)} exportName="Inventario"
        toolbar={<div className="flex flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={[{ id: 'all', label: 'Todas' }, { id: 'low', label: 'Bajo mínimo' }, { id: 'out', label: 'Agotadas' }]} />
          {cats.length > 1 && <Select aria-label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Todas las categorías" className="w-auto min-w-44"
            options={cats.map((c) => ({ value: c, label: c === '—' ? 'Sin categoría' : c }))} />}
        </div>}
        empty={<EmptyState icon={Boxes} title="Sin piezas" />} />
      {creating && <ItemForm onClose={() => setCreating(false)} />}
    </>
  );
}

export function ItemForm({ item, onClose, prefill }: { item?: Item; onClose: () => void; prefill?: Partial<Item> }) {
  const nav = useNavigate();
  const models = useModels();
  const suppliers = useSuppliers();
  const base = item ?? prefill;
  const canCosts = useCanSeeCosts();
  const { save: saveOrRequest, isAdmin } = useSaveOrRequest();
  const [v, setV] = useState({
    sku: base?.sku ?? '', name: base?.name ?? '', part_number: base?.part_number ?? '', manufacturer: base?.manufacturer ?? '', category: base?.category ?? '',
    description: base?.description ?? '', unit: base?.unit ?? 'unidad', min_quantity: String(base?.min_quantity ?? 0), location: base?.location ?? '',
    supplier_id: base?.supplier_id ?? '', unit_cost: base?.unit_cost?.toString() ?? '', notes: base?.notes ?? '', initial_quantity: '0',
    model_ids: item?.inventory_item_models?.map((m) => m.model_id) ?? [],
  });
  const save = useAction(async () => {
    if (!v.sku.trim() || !v.name.trim()) throw new Error('Código interno y nombre son requeridos');
    const data = { sku: v.sku.trim().toUpperCase(), name: v.name.trim(), part_number: v.part_number || null, manufacturer: v.manufacturer || null, category: v.category || null,
      description: v.description || null, unit: v.unit || 'unidad', min_quantity: Number(v.min_quantity) || 0, location: v.location || null,
      supplier_id: v.supplier_id || null, notes: v.notes || null } as Record<string, unknown>;
    if (canCosts) data.unit_cost = v.unit_cost === '' ? null : Number(v.unit_cost);
    if (item) {
      const r = await saveOrRequest('inventory_items', item.id, data, item as unknown as Record<string, unknown>);
      if (isAdmin) await rpc('inventory_set_models', { p_item: item.id, p_models: v.model_ids });
      return r;
    }
    return rpc<string>('inventory_create_item', { p: { ...data, initial_quantity: Number(v.initial_quantity) || 0, model_ids: v.model_ids } });
  }, { invalidate: [keys.all], success: savedMsg('Pieza guardada'), onSuccess: (id) => { onClose(); if (!item) nav(`/inventario/${id}`); } });
  const set = (k: keyof typeof v) => ({ value: v[k] as string, onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Modal open onClose={onClose} title={item ? 'Editar pieza' : 'Nueva pieza'} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={3}>
          <Field label="Código interno" required><Input className="h-10 font-mono uppercase" {...set('sku')} /></Field>
          <Field label="Nombre" required className="sm:col-span-2"><Input {...set('name')} /></Field>
          <Field label="Nº de pieza del fabricante"><Input className="h-10 font-mono" {...set('part_number')} /></Field>
          <Field label="Fabricante"><Input {...set('manufacturer')} /></Field>
          <Field label="Categoría"><Select {...set('category')} placeholder="Escoja…" options={partCategoryOptions(base?.category)} /></Field>
          <Field label="Ubicación física"><Input {...set('location')} placeholder="Estante A2" /></Field>
          <Field label="Unidad"><Input {...set('unit')} /></Field>
          <Field label="Cantidad mínima"><Input type="number" min="0" {...set('min_quantity')} /></Field>
          <Field label="Proveedor"><Select {...set('supplier_id')} placeholder="—" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
          {canCosts && <Field label="Precio de compra (c/u)"><Input type="number" step="0.01" {...set('unit_cost')} /></Field>}
          {!item && <Field label="Existencia inicial" hint="Queda registrada como movimiento"><Input type="number" min="0" {...set('initial_quantity')} /></Field>}
        </FormGrid>
        {item && !isAdmin && <p className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">Los cambios a una pieza ya guardada se envían al administrador para aprobación.</p>}
        <Field label="Compatible con" hint={item && !isAdmin ? 'Solo el administrador cambia la compatibilidad' : undefined}><CheckList value={v.model_ids} onChange={(ids) => setV({ ...v, model_ids: ids })} height={140} options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></Field>
        <Field label="Descripción"><Textarea rows={2} {...set('description')} /></Field>
        <Field label="Observaciones"><Textarea rows={2} {...set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function ItemDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const who = useWho();
  const canCosts = useCanSeeCosts();
  const models = useModels();
  const q = useItem(id);
  const moves = useMovements(id);
  const res = useData([...keys.all, 'res', id], () => run(supabase.from('inventory_reservations').select('*').eq('item_id', id).eq('status', 'active')) as Promise<any[]>);
  const [modal, setModal] = useState<null | 'edit' | 'receive' | 'issue' | 'count' | 'request'>(null);
  return (
    <QueryView q={q}>
      {(i) => (
        <div className="mx-auto max-w-5xl">
          <PageHeader back="/inventario" eyebrow={<span className="tag-unit">{i.sku}</span>} title={i.name} subtitle={[i.manufacturer, i.part_number].filter(Boolean).join(' · ')}
            actions={<>
              <Can perm="inventory.receive"><Button variant="primary" icon={ArrowDownToLine} onClick={() => setModal('receive')}>Entrada</Button></Can>
              <Can perm="inventory.issue"><Button icon={ArrowUpFromLine} onClick={() => setModal('issue')}>Salida</Button></Can>
              <Can perm="inventory.adjust"><Button icon={ClipboardCheck} onClick={() => setModal('count')}>Conteo</Button></Can>
              <Can perm="inventory.request"><Button icon={ShoppingCart} onClick={() => setModal('request')}>Solicitar compra</Button></Can>
              <Can perm="inventory.view"><Button variant="ghost" icon={Pencil} onClick={() => setModal('edit')}>Editar</Button></Can>
            </>} />
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Existencia" value={`${fmtNum(i.quantity_on_hand)}`} tone={stockTone(i)} hint={i.unit} />
            <StatCard label="Reservada para órdenes" value={fmtNum(i.quantity_reserved)} tone="info" />
            <StatCard label="Disponible" value={fmtNum(available(i))} />
            <StatCard label="Mínimo" value={fmtNum(i.min_quantity)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Datos" className="lg:col-span-1">
              <KeyValue cols={1} items={[['Ubicación', i.location], ['Categoría', i.category], ['Proveedor', i.suppliers?.name], ...(canCosts ? [['Precio de compra', fmtMoney(i.unit_cost)] as [string, string]] : []),
                ['Compatible con', i.inventory_item_models?.length ? i.inventory_item_models.map((m) => modelLabel(models.data?.find((x) => x.id === m.model_id))).join(', ') : 'Sin especificar']]} />
              {i.description && <p className="mt-3 border-t border-line pt-3 text-sm">{i.description}</p>}
              {!!res.data?.length && <div className="mt-3 border-t border-line pt-3 text-sm"><div className="mb-1 text-xs text-muted">Reservas activas</div>
                {res.data.map((r) => <div key={r.id} className="flex justify-between"><span>{r.reference_type === 'work_order_part' ? 'Orden de trabajo' : r.reference_type}</span><span className="num">{fmtNum(r.quantity)}</span></div>)}</div>}
            </Section>
            <div className="lg:col-span-2">
              <DataTable rows={moves.data} loading={moves.isLoading} error={moves.error} exportName={`Movimientos-${i.sku}`} search={false} columns={[
                { key: 'performed_at', header: 'Fecha', mobile: 'title', render: (m) => <span className="num text-[13px]">{fmtDateTime(m.performed_at)}</span> },
                { key: 'type', header: 'Movimiento', value: (m) => MOVE[m.movement_type] },
                { key: 'quantity', header: 'Cantidad', align: 'right', render: (m) => <span className={cx('num font-medium', m.quantity > 0 ? 'text-ok' : 'text-bad')}>{m.quantity > 0 ? '+' : ''}{fmtNum(m.quantity)}</span> },
                { key: 'balance_after', header: 'Saldo', align: 'right', render: (m) => <span className="num">{fmtNum(m.balance_after)}</span> },
                ...(can('settings.manage') ? [{ key: 'who', header: 'Por', mobile: 'hide' as const, value: (m: any) => who(m.employees?.full_name, m.performed_by) }] : []),
                ...(canCosts ? [{ key: 'cost', header: 'Costo c/u', align: 'right' as const, mobile: 'hide' as const, render: (m: any) => <span className="num">{fmtMoney(m.unit_cost)}</span> }] : []),
                { key: 'notes', header: 'Notas', mobile: 'hide', value: (m) => m.notes ?? m.suppliers?.name },
              ]} />
            </div>
          </div>
          {modal === 'edit' && <ItemForm item={i} onClose={() => setModal(null)} />}
          {(modal === 'receive' || modal === 'issue' || modal === 'count') && <MoveModal item={i} kind={modal} onClose={() => setModal(null)} />}
          {modal === 'request' && <RequestModal item={i} onClose={() => setModal(null)} />}
          {!can('inventory.view') && null}
        </div>
      )}
    </QueryView>
  );
}

function MoveModal({ item, kind, onClose }: { item: Item; kind: 'receive' | 'issue' | 'count'; onClose: () => void }) {
  const suppliers = useSuppliers();
  const [qty, setQty] = useState(kind === 'count' ? String(item.quantity_on_hand) : '');
  const canCosts = useCanSeeCosts();
  const [cost, setCost] = useState(item.unit_cost?.toString() ?? '');
  const [supplier, setSupplier] = useState(item.supplier_id ?? '');
  const [notes, setNotes] = useState('');
  const save = useAction(() => {
    const n = Number(qty);
    if (kind === 'receive') return rpc('inventory_receive', { p_item: item.id, p_qty: n, p_unit_cost: cost === '' ? null : Number(cost), p_supplier: supplier || null, p_notes: notes || null });
    if (kind === 'issue') return rpc('inventory_issue', { p_item: item.id, p_qty: n, p_notes: notes || null });
    return rpc('inventory_count', { p_item: item.id, p_counted: n, p_notes: notes });
  }, { invalidate: [keys.all], success: 'Movimiento registrado', onSuccess: onClose });
  const title = { receive: 'Registrar entrada / compra', issue: 'Registrar salida', count: 'Ajuste por conteo físico' }[kind];
  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{item.name} · existencia actual <span className="num">{fmtNum(item.quantity_on_hand)}</span></p>
        <Field label={kind === 'count' ? 'Cantidad contada' : 'Cantidad'}><Input type="number" min="0" step="0.01" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {kind === 'receive' && <FormGrid>
          {canCosts && <Field label="Costo c/u"><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
          <Field label="Proveedor"><Select value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="—" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
        </FormGrid>}
        <Field label={kind === 'count' ? 'Motivo del ajuste' : 'Notas'} required={kind !== 'receive'}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'issue' ? 'Destino / uso' : undefined} /></Field>
      </div>
    </Modal>
  );
}

function RequestModal({ item, onClose }: { item?: Item; onClose: () => void }) {
  const [v, setV] = useState({ description: item?.name ?? '', part_number: item?.part_number ?? '', quantity: '1', reason: '' });
  const save = useAction(() => rpc('request_purchase', { p: { item_id: item?.id ?? null, ...v, quantity: Number(v.quantity) || 1 } }), { invalidate: [keys.all], success: 'Solicitud de compra enviada', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Solicitar compra" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.description.trim()} loading={save.isPending} onClick={() => save.mutate()}>Solicitar</Button></>}>
      <div className="space-y-3">
        <Field label="Pieza"><Input value={v.description} disabled={!!item} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <FormGrid>
          <Field label="Nº de pieza"><Input className="h-10 font-mono" value={v.part_number} onChange={(e) => setV({ ...v, part_number: e.target.value })} /></Field>
          <Field label="Cantidad"><Input type="number" min="1" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Field>
        </FormGrid>
        <Field label="Motivo"><Textarea rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function PurchasesPage() {
  const { can } = useAuth();
  const who = useWho();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<any>(null);
  const q = useData([...keys.all, 'purchases', scope], () => {
    let x = supabase.from('purchase_requests').select('*, inventory_items(name, sku), employees!purchase_requests_requested_by_fkey(full_name)').order('requested_at', { ascending: false }).limit(500);
    if (scope === 'open') x = x.in('status', ['pending', 'approved', 'ordered']);
    return run(x) as Promise<any[]>;
  });
  const set = useAction((a: { id: string; s: string }) => rpc('set_purchase_request_status', { p_id: a.id, p_status: a.s }), { invalidate: [keys.all], success: 'Solicitud actualizada' });
  return (
    <>
      <PageHeader back="/inventario" title="Compras pendientes" actions={<Can perm="inventory.request"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Solicitar</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Compras" toolbar={<Segmented value={scope} onChange={setScope} options={[{ id: 'open', label: 'Abiertas' }, { id: 'all', label: 'Todas' }]} />}
        empty={<EmptyState icon={ShoppingCart} title="Sin solicitudes" />} columns={[
          { key: 'description', header: 'Pieza', mobile: 'title', render: (r) => <span className="font-medium">{r.description}{r.part_number && <span className="num ml-2 text-xs text-muted">{r.part_number}</span>}</span> },
          { key: 'quantity', header: 'Cant.', align: 'right', render: (r) => <span className="num">{fmtNum(r.quantity)}</span> },
          { key: 'reason', header: 'Motivo', mobile: 'hide' },
          { key: 'who', header: 'Solicitó', mobile: 'hide', value: (r) => who(r.employees?.full_name, r.requested_by) ?? '—' },
          { key: 'requested_at', header: 'Fecha', mobile: 'hide', render: (r) => fmtDateTime(r.requested_at) },
          { key: 'status', header: 'Estado', render: (r) => <StatusBadge map={PR_STATUS} value={r.status} /> },
          { key: 'act', header: '', sortable: false, render: (r) => (
            <span className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
              {can('inventory.approve') && r.status === 'pending' && <><Button size="sm" onClick={() => set.mutate({ id: r.id, s: 'approved' })}>Aprobar</Button><Button size="sm" variant="ghost" onClick={() => set.mutate({ id: r.id, s: 'rejected' })}>Rechazar</Button></>}
              {can('inventory.approve') && r.status === 'approved' && <Button size="sm" onClick={() => set.mutate({ id: r.id, s: 'ordered' })}>Marcar pedida</Button>}
              {can('inventory.receive') && ['approved', 'ordered'].includes(r.status) && <Button size="sm" variant="primary" onClick={() => setReceiving(r)}>Recibir</Button>}
            </span>) },
        ]} />
      {creating && <RequestModal onClose={() => setCreating(false)} />}
      {receiving && <ReceiveRequest req={receiving} onClose={() => setReceiving(null)} />}
    </>
  );
}

function ReceiveRequest({ req, onClose }: { req: any; onClose: () => void }) {
  const items = useItems();
  const [itemId, setItemId] = useState(req.item_id ?? '');
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState(String(req.quantity));
  const [cost, setCost] = useState('');
  const canCosts = useCanSeeCosts();
  const save = useAction(() => rpc('inventory_receive', { p_item: itemId, p_qty: Number(qty), p_unit_cost: cost === '' ? null : Number(cost), p_supplier: req.supplier_id, p_notes: 'Solicitud de compra', p_purchase_request: req.id }),
    { invalidate: [keys.all], success: 'Recibido y añadido al inventario', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Recibir compra" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!itemId} loading={save.isPending} onClick={() => save.mutate()}>Recibir</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">{req.description}</p>
        <Field label="Artículo de inventario" hint={!req.item_id ? 'Esta pieza aún no existe en inventario' : undefined}>
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Seleccione" options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }))} />
        </Field>
        {!req.item_id && <Button size="sm" icon={PackagePlus} onClick={() => setCreating(true)}>Crear artículo nuevo</Button>}
        <FormGrid>
          <Field label="Cantidad"><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          {canCosts && <Field label="Costo c/u"><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
        </FormGrid>
      </div>
      {creating && <ItemForm onClose={() => { setCreating(false); items.refetch(); }} prefill={{ name: req.description, part_number: req.part_number }} />}
    </Modal>
  );
}

export function SuppliersPage() {
  const q = useSuppliers();
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <PageHeader back="/inventario" title="Proveedores" actions={<Can perm="inventory.edit"><Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Nuevo</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={can('inventory.view') ? setEdit : undefined} exportName="Proveedores" columns={[
        { key: 'name', header: 'Nombre', mobile: 'title' }, { key: 'contact', header: 'Contacto' }, { key: 'phone', header: 'Teléfono' }, { key: 'email', header: 'Correo', mobile: 'hide' },
      ]} />
      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SupplierForm({ s, onClose }: { s: any; onClose: () => void }) {
  const [v, setV] = useState({ name: s.name ?? '', contact: s.contact ?? '', phone: s.phone ?? '', email: s.email ?? '', address: s.address ?? '', notes: s.notes ?? '' });
  const { save: saveOrRequest } = useSaveOrRequest();
  const save = useAction(() => s.id ? saveOrRequest('suppliers', s.id, v, s) : run(supabase.from('suppliers').insert(v)), { invalidate: [keys.all], success: savedMsg('Proveedor guardado'), onSuccess: onClose });
  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Modal open onClose={onClose} title={s.id ? 'Editar proveedor' : 'Nuevo proveedor'} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3"><Field label="Nombre" required><Input {...f('name')} /></Field>
        <FormGrid><Field label="Contacto"><Input {...f('contact')} /></Field><Field label="Teléfono"><Input type="tel" {...f('phone')} /></Field>
          <Field label="Correo"><Input type="email" {...f('email')} /></Field><Field label="Dirección"><Input {...f('address')} /></Field></FormGrid>
        <Field label="Notas"><Textarea {...f('notes')} /></Field></div>
    </Modal>
  );
}

// ---- Selector de piezas del inventario para órdenes de trabajo (slot) ----
export function InventoryPartPicker({ workOrderId, modelId, onAdded }: { workOrderId: string; vehicleId: string; modelId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button icon={PackageSearch} onClick={() => setOpen(true)}>Del inventario</Button>
    {open && <PickerModal workOrderId={workOrderId} modelId={modelId} onClose={() => setOpen(false)} onAdded={onAdded} />}
  </>;
}

function PickerModal({ workOrderId, modelId, onClose, onAdded }: { workOrderId: string; modelId: string; onClose: () => void; onAdded: () => void }) {
  const items = useItems();
  const [q, setQ] = useState('');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [sel, setSel] = useState<Item | null>(null);
  const [qty, setQty] = useState('1');
  const list = useMemo(() => (items.data ?? []).filter((i) => (!onlyCompat || !i.inventory_item_models?.length || i.inventory_item_models.some((m) => m.model_id === modelId))
    && (!q || `${i.name} ${i.sku} ${i.part_number ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [items.data, q, onlyCompat, modelId]);
  const add = useAction((reserve: boolean) => rpc('add_work_order_part', { p_wo: workOrderId, p: { inventory_item_id: sel!.id, quantity: Number(qty) || 1, reserve, to_purchase: !reserve } }),
    { invalidate: [keys.all, ['work_orders']], success: (r: any) => r.status === 'reserved' ? 'Pieza reservada para la orden' : 'Pieza añadida', onSuccess: () => { onAdded(); onClose(); } });
  const short = sel && available(sel) < (Number(qty) || 1);
  return (
    <Modal open onClose={onClose} title="Piezas del inventario" size="lg"
      footer={sel && <>
        <Button onClick={() => setSel(null)}>Volver</Button>
        {short ? <Button variant="primary" icon={ShoppingCart} loading={add.isPending} onClick={() => add.mutate(false)}>Sin existencia: marcar para comprar</Button>
          : <Button variant="primary" loading={add.isPending} onClick={() => add.mutate(true)}>Reservar para la orden</Button>}
      </>}>
      {!sel ? (
        <div className="space-y-3">
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o número de pieza" className="h-10 pl-9" /></div>
          <Segmented value={onlyCompat ? 'c' : 'a'} onChange={(x) => setOnlyCompat(x === 'c')} options={[{ id: 'c', label: 'Compatibles con este modelo' }, { id: 'a', label: 'Todas' }]} />
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
            {list.map((i) => (
              <li key={i.id}><button onClick={() => setSel(i)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-paper">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{i.name}</div><div className="text-xs text-muted"><span className="num">{i.sku}</span>{i.part_number && <> · <span className="num">{i.part_number}</span></>}{i.location && ` · ${i.location}`}</div></div>
                <Badge tone={available(i) > 0 ? 'ok' : 'bad'}>{fmtNum(available(i))} disp.</Badge>
              </button></li>
            ))}
            {!list.length && <li className="p-4 text-center text-sm text-muted">Sin coincidencias</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <Card><div className="font-medium">{sel.name}</div><div className="text-sm text-muted"><span className="num">{sel.sku}</span> · {sel.location ?? 'Sin ubicación'}</div>
            <div className="mt-2 flex gap-4 text-sm"><span>Existencia <b className="num">{fmtNum(sel.quantity_on_hand)}</b></span><span>Disponible <b className="num">{fmtNum(available(sel))}</b></span></div></Card>
          <Field label="Cantidad"><Input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          {short && <p className="text-sm text-warn">No hay suficiente disponible. Se añadirá como “por comprar” y se creará la solicitud de compra.</p>}
        </div>
      )}
    </Modal>
  );
}

// ---- Dashboard y reportes ----
export function LowStockKpi() {
  const q = useItems();
  const low = (q.data ?? []).filter((i) => stockTone(i) !== 'ok').length;
  return <StatCard label="Inventario bajo / agotado" value={q.data ? low : '—'} tone={low ? 'warn' : 'ok'} icon={Boxes} to="/inventario" />;
}

export function StockReport() {
  const q = useItems();
  const canCosts = useCanSeeCosts();
  const [tab, setTab] = useState<'all' | 'out'>('all');
  return <>
    <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'Inventario actual' }, { id: 'out', label: 'Agotadas / bajo mínimo' }]} />
    <DataTable rows={(q.data ?? []).filter((i) => tab === 'all' || stockTone(i) !== 'ok')} loading={q.isLoading} error={q.error} exportName={tab === 'all' ? 'Inventario-actual' : 'Piezas-agotadas'}
      columns={canCosts ? [...itemColumns, { key: 'value', header: 'Valor', align: 'right', value: (i) => Number(i.quantity_on_hand) * Number(i.unit_cost ?? 0), render: (i) => <span className="num">{fmtMoney(Number(i.quantity_on_hand) * Number(i.unit_cost ?? 0))}</span> }] : itemColumns} />
  </>;
}

export function TopPartsReport() {
  const canCosts = useCanSeeCosts();
  const q = useData([...keys.all, 'consumption'], () => run(supabase.from('inventory_consumption').select('*').order('month', { ascending: false })) as Promise<any[]>);
  const totals = useMemo(() => {
    const m = new Map<string, any>();
    (q.data ?? []).forEach((r) => { const t = m.get(r.item_id) ?? { ...r, quantity: 0, cost: 0 }; t.quantity += Number(r.quantity); t.cost += Number(r.cost); m.set(r.item_id, t); });
    return [...m.values()].sort((a, b) => b.quantity - a.quantity);
  }, [q.data]);
  return <DataTable rows={totals} loading={q.isLoading} error={q.error} exportName="Piezas-mas-utilizadas" rowKey={(r) => r.item_id} columns={[
    { key: 'name', header: 'Pieza', mobile: 'title', render: (r) => <Link to={`/inventario/${r.item_id}`} className="font-medium hover:underline">{r.name}</Link> },
    { key: 'sku', header: 'Código', render: (r) => <span className="tag-unit">{r.sku}</span> },
    { key: 'category', header: 'Categoría', mobile: 'hide' },
    { key: 'quantity', header: 'Utilizadas', align: 'right', render: (r) => <span className="num font-medium">{fmtNum(r.quantity)}</span> },
    ...(canCosts ? [{ key: 'cost', header: 'Costo', align: 'right' as const, render: (r: any) => <span className="num">{fmtMoney(r.cost)}</span> }] : []),
  ]} />;
}

/* ---------- Uso y desgaste de piezas (solo administración) ---------- */
type UsageRow = {
  item_id: string; sku: string; name: string; part_number: string | null; category: string | null; unit: string | null;
  uses: number; quantity: number; vehicles: number; uses_ytd: number; quantity_ytd: number; vehicles_ytd: number; last_used: string | null;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PERIODS = [
  { id: 'month', label: 'Este mes' }, { id: 'last-month', label: 'Mes pasado' }, { id: '30d', label: '30 días' },
  { id: 'quarter', label: 'Trimestre' }, { id: 'year', label: 'Este año' }, { id: 'custom', label: 'Fechas' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];
function periodRange(id: PeriodId): [string, string] {
  const t = new Date(); const y = t.getFullYear(); const m = t.getMonth();
  switch (id) {
    case 'month': return [iso(new Date(y, m, 1)), iso(t)];
    case 'last-month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case '30d': return [iso(new Date(y, m, t.getDate() - 29)), iso(t)];
    case 'quarter': return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), iso(t)];
    default: return [iso(new Date(y, 0, 1)), iso(t)];
  }
}

export function UsageReport() {
  const [period, setPeriod] = useState<PeriodId>('month');
  const [custom, setCustom] = useState<[string, string]>(periodRange('month'));
  const [from, to] = period === 'custom' ? custom : periodRange(period);
  const [cat, setCat] = useState('');
  const q = useData([...keys.all, 'usage', from, to], () => rpc<UsageRow[]>('parts_usage_report', { p_from: from, p_to: to }), { enabled: !!from && !!to && from <= to });
  const all = q.data ?? [];
  const cats = useMemo(() => [...new Set(all.map((r) => r.category || '—'))].sort((a, b) => a.localeCompare(b, 'es')), [all]);
  const rows = all.filter((r) => !cat || (cat === '—' ? !r.category : r.category === cat));
  const inPeriod = rows.filter((r) => r.uses > 0);
  const year = to.slice(0, 4);
  const sum = (k: 'uses' | 'uses_ytd') => rows.reduce((s, r) => s + Number(r[k]), 0);

  return <>
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="scroll-x -mx-1 px-1"><Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} /></div>
      <div className="flex flex-wrap items-end gap-2">
        {period === 'custom' && <>
          <Field label="Desde"><Input type="date" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></Field>
          <Field label="Hasta"><Input type="date" value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} /></Field>
        </>}
        {cats.length > 1 && <Field label="Categoría"><Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Todas"
          options={cats.map((c) => ({ value: c, label: c === '—' ? 'Sin categoría' : c }))} /></Field>}
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Usos en el periodo" value={fmtNum(sum('uses'))} />
      <StatCard label="Piezas distintas usadas" value={fmtNum(inPeriod.length)} />
      <StatCard label={`Usos en ${year} (YTD)`} value={fmtNum(sum('uses_ytd'))} />
      <StatCard label="Pieza más usada" value={<span className="line-clamp-2 block font-sans text-[17px] leading-snug font-semibold">{inPeriod[0]?.name ?? '—'}</span>} hint={inPeriod[0] ? `${fmtNum(inPeriod[0].uses)} usos` : undefined} />
    </div>
    <p className="mb-3 text-[13px] text-muted">
      Solo piezas gastadas (órdenes de trabajo, mantenimientos y salidas). Las compras no cuentan. Ordenado de más a menos usos en el periodo; YTD es del 1 de enero de {year} hasta el fin del periodo.
    </p>
    <DataTable rows={rows} loading={q.isLoading} error={q.error} rowKey={(r) => r.item_id} exportName={`Uso-de-piezas_${from}_${to}`}
      empty={<EmptyState icon={PackageSearch} title="No se usaron piezas en este periodo">Las piezas aparecen aquí cuando salen del inventario por una orden, un mantenimiento o una salida.</EmptyState>}
      columns={[
        { key: 'rank', header: '#', value: (r) => rows.indexOf(r) + 1, render: (r) => <span className="num text-muted">{rows.indexOf(r) + 1}</span>, mobile: 'hide' },
        { key: 'name', header: 'Pieza', mobile: 'title', render: (r) => <span className="min-w-0"><Link to={`/inventario/${r.item_id}`} className="font-medium hover:underline">{r.name}</Link>
          {r.part_number && <span className="ml-2 font-mono text-xs text-muted">{r.part_number}</span>}</span> },
        { key: 'category', header: 'Categoría', value: (r) => r.category ?? '' },
        { key: 'uses', header: 'Usos', align: 'right', render: (r) => <span className={cx('num font-semibold', !r.uses && 'text-faint')}>{fmtNum(r.uses)}</span> },
        { key: 'quantity', header: 'Cantidad', align: 'right', render: (r) => <span className="num">{fmtNum(r.quantity)}{r.unit && r.unit !== 'unidad' ? ` ${r.unit}` : ''}</span> },
        { key: 'vehicles', header: 'Vehículos', align: 'right', render: (r) => <span className="num">{fmtNum(r.vehicles)}</span>, mobile: 'hide' },
        { key: 'uses_ytd', header: `Usos YTD ${year}`, align: 'right', render: (r) => <span className="num font-medium">{fmtNum(r.uses_ytd)}</span> },
        { key: 'quantity_ytd', header: 'Cantidad YTD', align: 'right', render: (r) => <span className="num">{fmtNum(r.quantity_ytd)}</span> },
        { key: 'last_used', header: 'Último uso', value: (r) => r.last_used ?? '', render: (r) => <span className="text-muted">{r.last_used ? fmtDateTime(r.last_used) : '—'}</span>, mobile: 'hide' },
      ]} />
  </>;
}
