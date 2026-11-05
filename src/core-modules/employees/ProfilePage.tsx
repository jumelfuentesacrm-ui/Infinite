import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '@core/auth/AuthProvider';
import { Button, KeyValue, PageHeader, Section } from '@core/ui/primitives';
import { ResetPin } from './EmployeeDetail';

export default function ProfilePage() {
  const { profile, logout, permissions } = useAuth();
  const [pin, setPin] = useState(false);
  if (!profile) return null;
  return (
    <>
      <PageHeader title="Mi perfil" />
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Datos">
          <KeyValue items={[['Nombre', profile.full_name], ['Código', <span className="num">{profile.employee_code}</span>],
            ['Rol', profile.role_name], ['Puesto', profile.job_title], ['Permisos activos', permissions.size]]} />
        </Section>
        <Section title="Seguridad">
          <div className="flex flex-wrap gap-2">
            <Button icon={KeyRound} onClick={() => setPin(true)}>Cambiar mi PIN</Button>
            <Button icon={LogOut} variant="dark" onClick={logout}>Cerrar sesión</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Si usa un teléfono o tableta compartida, cierre sesión al terminar.</p>
        </Section>
      </div>
      {pin && <ResetPin self employeeId={profile.id} onClose={() => setPin(false)} />}
    </>
  );
}
