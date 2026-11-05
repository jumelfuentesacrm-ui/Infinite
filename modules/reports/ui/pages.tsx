import { Suspense, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, ChevronRight } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useData } from '@core/data/api';
import { useAuth } from '@core/auth/AuthProvider';
import { useModules } from '@core/modules/registry';
import { useModels, useVehicles, modelLabel, VEHICLE_STATUS } from '@core/data/shared';
import { fmtDateTime, fmtHours, fmtMoney, today } from '@core/lib/format';
import { Card, EmptyState, PageHeader, Spinner, StatusBadge, UnitTag } from '@core/ui/primitives';
import { Field, Input, Select } from '@core/ui/form';
import { DataTable } from '@core/ui/DataTable';
import type { ReportDef } from '@core/modules/types';

const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const toTs = (d: string, end = false) => new Date(d + (end ? 'T23:59:59' : 'T00:00:00')).toISOString();

function DateRange({ from, to, setFrom, setTo, children }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <Field label="Desde"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9" /></Field>
      <Field label="Hasta"><Input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} className="h-9" /></Field>
      {children}
    </div>
  );
}

function FleetStatusReport() {
  const q = useVehicles();
  const [model, setModel] = useState('');
  const models = useModels();
  return <DataTable rows={q.data?.filter((v) => !model || v.model_id === model)} loading={q.isLoading} error={q.error} exportName="Disponibilidad-flota"
    toolbar={<Select value={model} onChange={(e) => setModel(e.target.value)} placeholder="Todos los modelos" className="h-9 w-56" options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} />}
    columns={[
      { key: 'unit_number', header: 'Unidad', mobile: 'title', render: (v) => <UnitTag>{v.unit_number}</UnitTag> },
      { key: 'model', header: 'Modelo', value: (v) => modelLabel(v.vehicle_models) },
      { key: 'status', header: 'Estado', value: (v) => VEHICLE_STATUS[v.status]?.label, render: (v) => <StatusBadge map={VEHICLE_STATUS} value={v.status} /> },
      { key: 'status_reason', header: 'Motivo' },
      { key: 'engine_hours', header: 'Horas', align: 'right' },
    ]} />;
}

function DowntimeReport() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const q = useData(['reports', 'downtime', from, to], () => rpc<any[]>('report_downtime', { p_from: toTs(from), p_to: toTs(to, true) }));
  const labels: Record<string, string> = { maintenance: 'Mantenimiento', repair: 'Reparación', out_of_service: 'Fuera de servicio' };
  return <>
    <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
    <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Tiempo-fuera-de-servicio" rowKey={(r) => r.vehicle_id + r.status} columns={[
      { key: 'unit_number', header: 'Unidad', mobile: 'title', render: (r) => <UnitTag>{r.unit_number}</UnitTag> },
      { key: 'model', header: 'Modelo' },
      { key: 'status', header: 'Motivo', value: (r) => labels[r.status] },
      { key: 'hours', header: 'Horas', align: 'right', render: (r) => <span className="num font-medium">{fmtHours(r.hours)}</span> },
      { key: 'days', header: 'Días', align: 'right', value: (r) => +(r.hours / 24).toFixed(1) },
    ]} />
  </>;
}

function CostsReport() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const { modules } = useModules();
  const q = useData(['reports', 'costs', from, to], () => rpc<any[]>('report_costs', { p_from: toTs(from), p_to: toTs(to, true) }));
  const name = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.cost), 0);
  return <>
    <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}><Card className="ml-auto py-2"><span className="text-xs text-muted">Total </span><span className="num text-lg font-semibold">{fmtMoney(total)}</span></Card></DateRange>
    <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Costos-operacionales" rowKey={(r) => r.vehicle_id + r.module_id} columns={[
      { key: 'unit_number', header: 'Unidad', mobile: 'title', render: (r) => <UnitTag>{r.unit_number}</UnitTag> },
      { key: 'module_id', header: 'Concepto', value: (r) => name(r.module_id) },
      { key: 'events', header: 'Eventos', align: 'right' },
      { key: 'labor_hours', header: 'Horas de trabajo', align: 'right', render: (r) => <span className="num">{fmtHours(r.labor_hours)}</span> },
      { key: 'cost', header: 'Costo', align: 'right', render: (r) => <span className="num font-medium">{fmtMoney(r.cost)}</span> },
    ]} />
    <p className="mt-2 text-xs text-muted">Incluye reparaciones, mantenimientos y combustible registrados. No es contabilidad ni nómina.</p>
  </>;
}

function HistoryReport() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [vehicle, setVehicle] = useState('');
  const [mod, setMod] = useState('');
  const vehicles = useVehicles();
  const { modules } = useModules();
  const q = useData(['reports', 'history', from, to, vehicle, mod], () => {
    let x = supabase.from('vehicle_timeline').select('*, vehicles(unit_number), employees(full_name)').gte('occurred_at', toTs(from)).lte('occurred_at', toTs(to, true)).order('occurred_at', { ascending: false }).limit(2000);
    if (vehicle) x = x.eq('vehicle_id', vehicle);
    if (mod) x = x.eq('module_id', mod);
    return run(x) as Promise<any[]>;
  });
  const name = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  return <>
    <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}>
      <Field label="Vehículo"><Select value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Todos" className="h-9" options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: v.unit_number }))} /></Field>
      <Field label="Categoría"><Select value={mod} onChange={(e) => setMod(e.target.value)} placeholder="Todas" className="h-9" options={modules.filter((m) => !m.core).map((m) => ({ value: m.id, label: m.name }))} /></Field>
    </DateRange>
    <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Historial-operacional" columns={[
      { key: 'occurred_at', header: 'Fecha', mobile: 'title', render: (r) => <span className="num text-[13px]">{fmtDateTime(r.occurred_at)}</span> },
      { key: 'unit', header: 'Unidad', value: (r) => r.vehicles?.unit_number, render: (r) => <UnitTag>{r.vehicles?.unit_number}</UnitTag> },
      { key: 'module_id', header: 'Categoría', value: (r) => name(r.module_id) },
      { key: 'title', header: 'Evento' },
      { key: 'employee', header: 'Empleado', mobile: 'hide', value: (r) => r.employees?.full_name },
      { key: 'cost', header: 'Costo', align: 'right', mobile: 'hide', render: (r) => (r.cost != null ? <span className="num">{fmtMoney(r.cost)}</span> : '') },
    ]} />
  </>;
}

const CORE_REPORTS: ReportDef[] = [
  { id: 'availability', title: 'Disponibilidad de vehículos', description: 'Estado actual de cada unidad, filtrable por modelo', perm: 'fleet.view', component: FleetStatusReport },
  { id: 'downtime', title: 'Tiempo fuera de servicio', description: 'Horas en mantenimiento, reparación o fuera de servicio por vehículo', perm: 'fleet.view', component: DowntimeReport },
  { id: 'costs', title: 'Costos de mantenimiento y operación', description: 'Costos por vehículo y concepto en un periodo', perm: 'fleet.view', component: CostsReport },
  { id: 'history', title: 'Historial operacional', description: 'Todo lo ocurrido con la flota, filtrable por fecha, vehículo y categoría', perm: 'fleet.view', component: HistoryReport },
];

function useReports() {
  const { modules } = useModules();
  const { can } = useAuth();
  return useMemo(() => [...CORE_REPORTS, ...modules.flatMap((m) => m.reports ?? [])].filter((r) => can(r.perm)), [modules, can]);
}

export function ReportsPage() {
  const reports = useReports();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Reportes" subtitle="Cada reporte se puede filtrar y exportar a Excel o PDF" />
      {!reports.length ? <EmptyState icon={BarChart3} title="No tiene reportes disponibles" /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <button key={r.id} onClick={() => nav(`/reportes/${r.id}`)} className="group flex items-start gap-3 rounded-card border border-line bg-panel p-4 text-left shadow-card hover:border-line-strong">
              <BarChart3 className="mt-0.5 size-5 shrink-0 text-brand" />
              <span className="flex-1"><span className="block font-medium">{r.title}</span><span className="mt-0.5 block text-sm text-muted">{r.description}</span></span>
              <ChevronRight className="size-4 text-faint group-hover:text-ink" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function ReportView() {
  const { id } = useParams();
  const r = useReports().find((x) => x.id === id);
  if (!r) return <EmptyState title="Reporte no disponible" />;
  const C = r.component;
  return (
    <>
      <PageHeader back="/reportes" title={r.title} subtitle={r.description} />
      <Suspense fallback={<Spinner />}><C /></Suspense>
    </>
  );
}
