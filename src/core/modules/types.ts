/**
 * Contrato de módulos.
 *
 * Cada módulo exporta un `ModuleManifest` desde `modules/<id>/ui/index.tsx`.
 * El núcleo lo descubre solo (por carpeta) y lo integra: rutas, menú, accesos
 * rápidos del teléfono, widgets del dashboard, reportes y "slots".
 *
 * REGLA: un módulo NUNCA importa código de otro módulo. Para integrarse con otro
 * (ej. el Taller mostrando el selector de piezas del Inventario) se usan SLOTS:
 * el módulo anfitrión declara <Slot name="..."/> y los demás aportan componentes.
 * Si el otro módulo no está instalado, el slot simplemente queda vacío.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SlotName, SlotProps } from './slots';

export type Perm = string;
/** Uno o varios permisos; con varios basta con tener cualquiera. */
export type PermRule = Perm | Perm[];

type AnyComponent<P = object> = ComponentType<P> | LazyExoticComponent<ComponentType<P>>;

export interface AppRoute {
  path: string;
  component: AnyComponent;
  perm?: PermRule;
}

export type NavGroup = 'principal' | 'operaciones' | 'flota' | 'taller' | 'administracion';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: PermRule;
  group: NavGroup;
  order?: number;
  /** Visible también en la barra inferior del teléfono */
  mobile?: boolean;
}

export interface FieldAction {
  to: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  perm?: PermRule;
  tone?: 'default' | 'primary' | 'danger';
  order?: number;
}

export interface DashboardWidget {
  id: string;
  component: AnyComponent;
  perm?: PermRule;
  size?: 'kpi' | 'half' | 'full';
  order?: number;
}

export interface SlotContribution<N extends SlotName = SlotName> {
  slot: N;
  id: string;
  label?: string;
  component: AnyComponent<SlotProps[N]>;
  perm?: PermRule;
  order?: number;
}

export interface ReportDef {
  id: string;
  title: string;
  description: string;
  perm?: PermRule;
  component: AnyComponent;
}

export interface SettingsPanel {
  id: string;
  title: string;
  perm?: PermRule;
  component: AnyComponent;
}

export interface ModuleManifest {
  id: string;
  name: string;
  icon: LucideIcon;
  /** Núcleo: siempre activo, no se puede desactivar */
  core?: boolean;
  routes?: AppRoute[];
  nav?: NavItem[];
  fieldActions?: FieldAction[];
  dashboard?: DashboardWidget[];
  slots?: SlotContribution<any>[];
  reports?: ReportDef[];
  settings?: SettingsPanel[];
  /** Cómo enlazar a las entidades de este módulo desde el historial/notificaciones */
  entityLinks?: Record<string, (id: string) => string>;
}

/** Ayuda de tipos para declarar manifiestos */
export const defineModule = (m: ModuleManifest) => m;
/** Aporta un componente a un slot: contribute('vehicle.tabs', { id, label, component }) */
export const contribute = <N extends SlotName>(slot: N, c: Omit<SlotContribution<N>, 'slot'>): SlotContribution<N> => ({ ...c, slot });

/** lazy() para exportaciones con nombre: lazyExport(() => import('./pages'), 'MiPagina') */
export function lazyExport<T extends Record<string, unknown>, K extends keyof T>(load: () => Promise<T>, key: K) {
  return lazy(() => load().then((m) => ({ default: m[key] as ComponentType<any> })));
}
