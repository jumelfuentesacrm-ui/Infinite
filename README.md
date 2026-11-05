# Fleet Ops — Sistema modular de flota, operaciones y taller

PWA (React + Vite + Supabase) para administrar vehículos de trabajo, UTVs y ATVs:
flota, empleados, inspecciones, operaciones, ponches, GPS, accidentes, combustible,
mantenimiento preventivo, taller, inventario, catálogo OEM, documentos, notificaciones y reportes.

## Arquitectura: núcleo + módulos "lego"

```
src/core/            Kit compartido: auth PIN, permisos, datos, UI, registro de módulos
src/core-modules/    Núcleo SIEMPRE instalado: dashboard, flota, empleados, notificaciones, panel móvil, configuración
modules/<id>/        Cada módulo opcional, autocontenido:
  module.json          id, nombre, dependencias, versión de migración
  db/schema.sql        tablas, RLS, funciones, permisos y alertas del módulo
  ui/index.tsx         manifiesto: rutas, menú, accesos móviles, widgets, slots, reportes, ajustes
  functions/           Edge Functions propias (opcional, ej. gps/gps-ingest)
supabase/core/       SQL del núcleo
supabase/migrations/ GENERADO por `npm run modules sync` (no editar)
client.config.json   marca del cliente y módulos activos
```

| Módulo | id | Depende de |
|---|---|---|
| Inspecciones | `inspections` | — |
| Operaciones (calendario) | `operations` | — |
| Ponches | `timeclock` | — |
| GPS | `gps` | — |
| Accidentes | `accidents` | — |
| Combustible | `fuel` | — |
| Mantenimiento | `maintenance` | — |
| Inventario | `inventory` | — |
| Taller / órdenes de trabajo | `workorders` | — (se integra con inventario y catálogo si existen) |
| Catálogo OEM | `parts_catalog` | `inventory` |
| Documentos | `documents` | — |
| Reportes | `reports` | — |

### Reglas que evitan el espagueti (se validan en cada build)
1. **Un módulo nunca importa otro módulo.** Solo `@core/*` y paquetes npm.
2. **El núcleo nunca importa módulos.** Los descubre por carpeta (`import.meta.glob`).
3. Para integrarse se usan **slots** (`src/core/modules/slots.ts`): el Taller muestra
   `<Slot name="workorder.parts"/>`; Inventario y Catálogo aportan sus selectores. Si un módulo
   no está, el slot queda vacío y nada se rompe.
4. En la base de datos, los módulos publican su historial en `vehicle_timeline`, sus alertas en
   `alert_jobs` y sus notificaciones con `app.notify()`. Integraciones entre módulos opcionales son
   "blandas" (se comprueba en tiempo de ejecución si la otra función existe).

`npm run modules check` falla si alguien rompe estas reglas.

### Tres formas de quitar funciones a un cliente
| Situación | Cómo |
|---|---|
| No lo compró | No se copia: `npm run modules new-client ../cliente inspections,fuel` |
| Ocultarlo en su build | `client.config.json` → `"fuel": false` |
| Apagarlo o darlo a prueba en caliente | Configuración › Módulos (desactivar o fecha fin de prueba). El servidor deja de aceptar escrituras; **los datos se conservan** y se pueden consultar |

## Seguridad
- Acceso con código de empleado + PIN (4–8 dígitos, bcrypt, bloqueo tras intentos fallidos) vía Edge Function `pin-login`.
- RBAC granular: permisos por módulo y acción, por rol (Configuración › Roles) y excepciones por empleado.
- **Todo se valida en Postgres**: RLS en cada tabla y funciones `security definer` con `app.require_perm()`. Ocultar botones es solo comodidad.
- Operaciones críticas en una sola transacción (inventario con bloqueo de fila, órdenes, inspecciones, ponches).
- Historial inmutable: sin `DELETE` para usuarios; archivado lógico; auditoría con valor anterior/nuevo de cada cambio.

## Comandos
```bash
npm run dev               # desarrollo
npm run build             # valida módulos + tipos + build de producción
npm run modules list      # módulos instalados
npm run modules sync      # genera supabase/migrations y supabase/functions
npm run db:test           # aplica todo en un Postgres local y corre las pruebas de flujo
```
Ver **SETUP.md** para instalar un cliente y **MODULES.md** para crear un módulo nuevo.
