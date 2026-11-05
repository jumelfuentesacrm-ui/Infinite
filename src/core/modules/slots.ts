/**
 * Puntos de extensión (slots) disponibles. Agregar un slot aquí es la ÚNICA forma
 * de que un módulo exponga un lugar donde otros módulos pueden integrarse.
 */
export interface VehicleRef { id: string; unit_number: string; model_id: string; status: string }

export interface SlotProps {
  /** Pestañas del expediente del vehículo */
  'vehicle.tabs': { vehicleId: string };
  /** Botones de acción en el expediente del vehículo */
  'vehicle.actions': { vehicle: VehicleRef };
  /** Pestañas del expediente del empleado */
  'employee.tabs': { employeeId: string };
  /** Acciones en el detalle de una inspección (ej. crear orden de trabajo) */
  'inspection.actions': { inspectionId: string; vehicleId: string; summary: string };
  /** Acciones en el detalle de un incidente */
  'incident.actions': { incidentId: string; vehicleId: string | null; summary: string };
  /** Formas de añadir piezas a una orden de trabajo (inventario, catálogo OEM) */
  'workorder.parts': { workOrderId: string; vehicleId: string; modelId: string; onAdded: () => void };
  /** Información extra bajo "Mi vehículo" en el teléfono del chofer */
  'field.vehicle': { vehicleId: string };
  /** Panel del mecánico: bloques adicionales */
  'shop.home': Record<string, never>;
  /** Botones de acceso rápido en la barra superior (ej. reportar accidente) */
  'shell.quick': Record<string, never>;
}

export type SlotName = keyof SlotProps;
