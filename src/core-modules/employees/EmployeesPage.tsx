import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { z } from 'zod';
import { rpc, useAction } from '@core/data/api';
import { fleetKeys, ROLE_LABELS, useEmployees, usePinLength } from '@core/data/shared';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '@core/ui/primitives';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { Field, FormGrid, Input, Select, Textarea, useForm } from '@core/ui/form';
import { fmtAgo } from '@core/lib/format';

export const EMPLOYEE_STATUS = {
  active: { label: 'Activo', tone: 'ok' as const }, inactive: { label: 'Inactivo', tone: 'idle' as const }, suspended: { label: 'Suspendido', tone: 'bad' as const },
};

export default function EmployeesPage() {
  const [show, setShow] = useState<'active' | 'all'>('active');
  const q = useEmployees({ activeOnly: show === 'active' });
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Empleados" actions={<Can perm="employees.create"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nuevo empleado</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={(e) => nav(`/empleados/${e.id}`)} exportName="Empleados"
        toolbar={<Segmented value={show} onChange={setShow} options={[{ id: 'active', label: 'Activos' }, { id: 'all', label: 'Todos' }]} />}
        empty={<EmptyState icon={Users} title="Sin empleados" />}
        columns={[
          { key: 'full_name', header: 'Nombre', mobile: 'title', render: (e) => <span className="font-medium">{e.full_name}</span> },
          { key: 'employee_code', header: 'Código', render: (e) => <span className="tag-unit">{e.employee_code}</span> },
          { key: 'role_id', header: 'Rol', value: (e) => ROLE_LABELS[e.role_id] ?? e.role_id },
          { key: 'job_title', header: 'Puesto', mobile: 'hide' },
          { key: 'phone', header: 'Teléfono', mobile: 'hide' },
          { key: 'status', header: 'Estado', value: (e) => EMPLOYEE_STATUS[e.status as keyof typeof EMPLOYEE_STATUS]?.label,
            render: (e) => <Badge tone={EMPLOYEE_STATUS[e.status as keyof typeof EMPLOYEE_STATUS]?.tone}>{EMPLOYEE_STATUS[e.status as keyof typeof EMPLOYEE_STATUS]?.label}</Badge> },
          { key: 'last_login_at', header: 'Último acceso', mobile: 'hide', render: (e) => <span className="text-muted">{e.last_login_at ? fmtAgo(e.last_login_at) : 'Nunca'}</span> },
        ]} />
      {creating && <EmployeeCreate onClose={() => setCreating(false)} />}
    </>
  );
}

const createSchema = z.object({
  code: z.string({ required_error: 'Requerido' }).trim().regex(/^[A-Za-z0-9_-]{2,20}$/, '2–20 letras, números o guiones'),
  name: z.string({ required_error: 'Requerido' }).trim().min(2, 'Requerido'),
  role: z.string().min(1),
  pin: z.string({ required_error: 'Requerido' }).regex(/^\d{4,8}$/, 'Solo números'),
  phone: z.string().nullable(), job_title: z.string().nullable(), hired_at: z.string().nullable(), notes: z.string().nullable(),
});

function EmployeeCreate({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const f = useForm({ code: '', name: '', role: 'driver', pin: '', phone: '', job_title: '', hired_at: '', notes: '' }, createSchema);
  const pinLen = usePinLength(f.values.role);
  const save = useAction(() => {
    const v = f.validate(); if (!v) throw new Error('Revise los campos');
    if (v.pin.length !== pinLen) throw new Error(`El PIN de este rol lleva ${pinLen} dígitos`);
    return rpc<string>('create_employee', { p_code: v.code, p_name: v.name, p_role: v.role, p_pin: v.pin, p_phone: v.phone,
      p_job_title: v.job_title, p_hired_at: v.hired_at, p_notes: v.notes });
  }, { invalidate: [fleetKeys.employees], success: 'Empleado creado. Entréguele su PIN: con él entra a la app.', onSuccess: (id) => { onClose(); nav(`/empleados/${id}`); } });

  const roles = Object.entries(ROLE_LABELS).filter(([r]) => r !== 'admin' || can('employees.manage'));
  return (
    <Modal open onClose={onClose} title="Nuevo empleado"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Crear</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Nombre completo" required error={f.errors.name}><Input {...f.bind('name')} /></Field>
          <Field label="Número de empleado" required error={f.errors.code} hint="Para identificarlo en la app, ej. CH01"><Input {...f.bind('code')} className="h-10 font-mono uppercase" /></Field>
          <Field label="Rol" required><Select {...f.bind('role')} options={roles.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="PIN" required error={f.errors.pin} hint={`${pinLen} dígitos para este rol. Es único: con él entra a la app.`}><Input {...f.bind('pin')} inputMode="numeric" className="h-10 font-mono tracking-widest" maxLength={pinLen} /></Field>
          <Field label="Teléfono"><Input {...f.bind('phone')} type="tel" /></Field>
          <Field label="Puesto"><Input {...f.bind('job_title')} /></Field>
          <Field label="Fecha de ingreso"><Input type="date" {...f.bind('hired_at')} /></Field>
        </FormGrid>
        <Field label="Notas"><Textarea {...f.bind('notes')} /></Field>
      </div>
    </Modal>
  );
}
