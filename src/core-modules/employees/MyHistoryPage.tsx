import { PageHeader } from '@core/ui/primitives';
import { EmployeeHistory } from '@core/ui/EmployeeHistory';

export default function MyHistoryPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mi historial" subtitle="Todo lo que ha hecho en cada máquina" />
      <EmployeeHistory />
    </div>
  );
}
