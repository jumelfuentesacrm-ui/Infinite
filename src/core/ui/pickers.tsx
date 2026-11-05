import { Select } from './form';
import { useEmployees, useModels, useVehicles, modelLabel, ROLE_LABELS } from '@core/data/shared';

type PickerProps = { value: string | null | undefined; onChange: (id: string) => void; placeholder?: string; disabled?: boolean; required?: boolean };

export function VehicleSelect({ value, onChange, placeholder = 'Seleccione vehículo', disabled, required, exclude = ['retired'] }: PickerProps & { exclude?: string[] }) {
  const { data = [] } = useVehicles();
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required} placeholder={placeholder}
      options={data.filter((v) => !exclude.includes(v.status) || v.id === value)
        .map((v) => ({ value: v.id, label: `${v.unit_number} · ${modelLabel(v.vehicle_models)}` }))} />
  );
}

export function EmployeeSelect({ value, onChange, placeholder = 'Seleccione empleado', roles, disabled, required }: PickerProps & { roles?: string[] }) {
  const { data = [] } = useEmployees({ roles, activeOnly: true });
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required} placeholder={placeholder}
      options={data.map((e) => ({ value: e.id, label: `${e.full_name} · ${ROLE_LABELS[e.role_id] ?? e.role_id}` }))} />
  );
}

export function ModelSelect({ value, onChange, placeholder = 'Seleccione modelo', disabled, required }: PickerProps) {
  const { data = [] } = useModels();
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required} placeholder={placeholder}
      options={data.map((m) => ({ value: m.id, label: modelLabel(m) }))} />
  );
}
