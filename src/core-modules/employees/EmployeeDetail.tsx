import { Suspense, useState } from 'react';
import { EmployeeHistory } from '@core/ui/EmployeeHistory';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { useParams } from 'react-router-dom';
import { KeyRound, Pencil, Power } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { fleetKeys, ROLE_LABELS, type Employee } from '@core/data/shared';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { useSlotItems } from '@core/modules/Slot';
import { Badge, Button, KeyValue, PageHeader, QueryView, Section, Spinner, Tabs } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea, useForm } from '@core/ui/form';
import { Modal, useConfirm } from '@core/ui/Modal';
import { fmtDate, fmtDateTime } from '@core/lib/format';
import { EMPLOYEE_STATUS } from './EmployeesPage';
import { PermissionOverrides } from './PermissionOverrides';

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const q = useData(['employees', id], () => run(supabase.from('employees').select('*').eq('id', id).single()) as Promise<Employee>);
  const tabs = useSlotItems('employee.tabs');
  const { can, profile, isAdmin } = useAuth();
  const confirm = useConfirm();
  const [tab, setTab] = useState('info');
  const [modal, setModal] = useState<null | 'edit' | 'pin'>(null);
  const toggle = useAction((s: string) => rpc('set_employee_status', { p_employee: id, p_status: s }),
    { invalidate: [fleetKeys.employees], success: 'Estado actualizado' });

  return (
    <QueryView q={q}>
      {(e) => {
        const st = EMPLOYEE_STATUS[e.status as keyof typeof EMPLOYEE_STATUS];
        return (
          <>
            <PageHeader back="/empleados" eyebrow={ROLE_LABELS[e.role_id] ?? e.role_id}
              title={<span className="flex flex-wrap items-center gap-3">{e.full_name}<Badge tone={st?.tone}>{st?.label}</Badge></span>}
              subtitle={<span className="tag-unit">{e.employee_code}</span>}
              actions={<>
                <Can perm="employees.manage"><Button icon={KeyRound} onClick={() => setModal('pin')}>Restablecer PIN</Button></Can>
                <Can perm={["employees.edit", "employees.view"]}><Button icon={Pencil} onClick={() => setModal('edit')}>Editar</Button></Can>
                {can('employees.edit') && e.id !== profile?.id && (
                  <Button icon={Power} variant={e.status === 'active' ? 'ghost' : 'primary'} onClick={async () => {
                    const next = e.status === 'active' ? 'inactive' : 'active';
                    if (next === 'inactive' && !(await confirm({ title: 'Desactivar empleado', body: 'No podrá entrar al sistema y se cerrarán sus asignaciones de vehículo. Su historial se conserva.', confirm: 'Desactivar', danger: true }))) return;
                    toggle.mutate(next);
                  }}>{e.status === 'active' ? 'Desactivar' : 'Activar'}</Button>
                )}
              </>} />
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: 'info', label: 'Expediente' },
              ...(isAdmin || e.id === profile?.id ? [{ id: 'history', label: 'Historial' }] : []),
              ...(can('employees.manage') ? [{ id: 'perms', label: 'Permisos' }] : []),
              ...tabs.map((t) => ({ id: t.id, label: t.label ?? t.id })),
            ]} />
            {tab === 'history' && <EmployeeHistory employeeId={e.id} />}
            {tab === 'info' && (
              <Section title="Datos">
                <KeyValue items={[
                  ['Nombre', e.full_name], ['Código', <span className="num">{e.employee_code}</span>], ['Rol', ROLE_LABELS[e.role_id]],
                  ['Puesto', e.job_title], ['Teléfono', e.phone], ['Ingreso', fmtDate(e.hired_at)],
                  ['Último acceso', fmtDateTime(e.last_login_at)], ['Creado', fmtDate(e.created_at)],
                ]} />
                {e.notes && <p className="mt-4 border-t border-line pt-3 text-sm text-ink-2">{e.notes}</p>}
              </Section>
            )}
            {tab === 'perms' && <PermissionOverrides employee={e} />}
            {tabs.filter((t) => t.id === tab).map((t) => {
              const C = t.component as React.ComponentType<{ employeeId: string }>;
              return <Suspense key={t.id} fallback={<Spinner />}><C employeeId={e.id} /></Suspense>;
            })}
            {modal === 'edit' && <EditEmployee e={e} onClose={() => setModal(null)} />}
            {modal === 'pin' && <ResetPin employeeId={e.id} onClose={() => setModal(null)} />}
          </>
        );
      }}
    </QueryView>
  );
}

function EditEmployee({ e, onClose }: { e: Employee; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const { save: saveOrRequest } = useSaveOrRequest();
  const f = useForm({ full_name: e.full_name, phone: e.phone ?? '', job_title: e.job_title ?? '', role_id: e.role_id, hired_at: e.hired_at ?? '', notes: e.notes ?? '' });
  const save = useAction(() => {
    const v = { ...f.values, phone: f.values.phone || null, job_title: f.values.job_title || null, hired_at: f.values.hired_at || null, notes: f.values.notes || null };
    if (!isAdmin) delete (v as Partial<typeof v>).role_id;
    return saveOrRequest('employees', e.id, v, e as unknown as Record<string, unknown>);
  }, { invalidate: [fleetKeys.employees, ['employees', e.id]], success: savedMsg('Empleado actualizado'), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Editar empleado"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Nombre completo"><Input {...f.bind('full_name')} /></Field>
          <Field label="Rol" hint={!isAdmin ? 'Solo el administrador cambia el rol' : undefined}>
            <Select {...f.bind('role_id')} disabled={!isAdmin} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Teléfono"><Input {...f.bind('phone')} /></Field>
          <Field label="Puesto"><Input {...f.bind('job_title')} /></Field>
          <Field label="Fecha de ingreso"><Input type="date" {...f.bind('hired_at')} /></Field>
        </FormGrid>
        <Field label="Notas"><Textarea {...f.bind('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function ResetPin({ employeeId, onClose, self }: { employeeId: string; onClose: () => void; self?: boolean }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const save = useAction(() => {
    if (pin !== pin2) throw new Error('Los PIN no coinciden');
    return rpc('set_employee_pin', { p_employee: employeeId, p_pin: pin });
  }, { success: 'PIN actualizado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={self ? 'Cambiar mi PIN' : 'Restablecer PIN'} size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={pin.length < 4} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Nuevo PIN" hint="4 a 8 dígitos, evite secuencias como 1234"><Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={8} type="password" className="h-10 font-mono tracking-widest" /></Field>
        <Field label="Repetir PIN"><Input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={8} type="password" className="h-10 font-mono tracking-widest" /></Field>
        {!self && <p className="text-xs text-muted">Si la cuenta estaba bloqueada por intentos fallidos, se desbloquea.</p>}
      </div>
    </Modal>
  );
}
