import { Suspense } from 'react';
import { useModules } from './registry';
import { useAuth } from '@core/auth/AuthProvider';
import type { SlotName, SlotProps } from './slots';
import type { SlotContribution } from './types';

/** Renderiza todas las aportaciones de los módulos activos a un slot. */
export function Slot<N extends SlotName>({ name, props, wrap }: {
  name: N;
  props: SlotProps[N];
  wrap?: (node: React.ReactNode, c: SlotContribution<N>) => React.ReactNode;
}) {
  const items = useSlotItems(name);
  return (
    <>
      {items.map((c) => {
        const C = c.component as React.ComponentType<SlotProps[N]>;
        const node = <Suspense key={c.id} fallback={null}><C {...props} /></Suspense>;
        return wrap ? <span key={c.id} className="contents">{wrap(node, c)}</span> : node;
      })}
    </>
  );
}

/** Aportaciones visibles para el usuario actual (filtra por permiso). */
export function useSlotItems<N extends SlotName>(name: N) {
  const { slot } = useModules();
  const { can } = useAuth();
  return slot(name).filter((c) => can(c.perm));
}
