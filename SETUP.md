# Instalación para un cliente

## 1. Crear la copia del cliente (solo con lo que compró)
```bash
npm run modules new-client ../acme-flota inspections,timeclock,fuel,workorders,inventory,maintenance
cd ../acme-flota && npm install
```
Las dependencias se añaden solas (ej. `parts_catalog` agrega `inventory`).
Edite `client.config.json` → nombre, compañía, color, zona horaria.

## 2. Supabase
1. Cree el proyecto en supabase.com.
2. Instale la CLI y enlace: `npx supabase login && npx supabase link --project-ref <ref>`
3. Genere y aplique migraciones:
   ```bash
   npm run modules sync
   npx supabase db push --include-all
   ```
4. Publique las funciones:
   ```bash
   npx supabase functions deploy pin-login --no-verify-jwt
   npx supabase functions deploy run-alerts --no-verify-jwt
   npx supabase functions deploy gps-ingest --no-verify-jwt   # solo si tiene GPS
   npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24) ALLOWED_ORIGIN=https://flota.cliente.com
   ```
5. Auth › Providers: deje **Email** habilitado (lo usa internamente pin-login) y desactive “Allow new users to sign up”.
6. Alertas automáticas cada hora (SQL Editor):
   ```sql
   create extension if not exists pg_cron;
   select cron.schedule('run-alerts', '5 * * * *', 'select public.run_alerts()');
   ```
7. Primer administrador:
   ```bash
   cp .env.example .env.local    # complete URL, anon key y service role key
   npm run bootstrap-admin -- ADMIN "Nombre Apellido" 482613
   ```

## 3. Vercel
- Importe el repositorio de GitHub. Framework: Vite (usa `vercel.json`).
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. (Nunca la service role key.)

## 4. Primer uso (administrador)
1. Flota › Modelos: verifique Yanmar Bull UTV, Can-Am Outlander 2018 y 2024 (ya vienen creados).
2. Configuración › Intervalos de mantenimiento: cargue los intervalos **del manual oficial** de cada modelo (con su fuente).
3. Configuración › Plantillas de inspección: ajuste los puntos por modelo si hace falta.
4. Empleados: cree choferes, mecánicos y supervisores (código + PIN). Asigne vehículos desde el expediente.
5. Configuración › Ponches: active la geocerca cuando esté listo.
6. Catálogo OEM: suba los manuales en PDF y luego importe la tabla de piezas (CSV/Excel/JSON; hay plantilla).

## GPS con pantalla apagada
Un navegador no puede enviar ubicación con la pantalla apagada (límite de iOS/Android). Opciones:
- **Rastreador GPS** en el vehículo (recomendado): regístrelo en Configuración › Dispositivos GPS y
  configure la URL `…/functions/v1/gps-ingest` con su token (formato estándar u OsmAnd/Traccar).
- Envoltorio nativo (Capacitor + plugin de geolocalización en segundo plano) que envíe al mismo endpoint.
- Mientras la app esté abierta, el teléfono comparte ubicación desde “Mi vehículo”.

## Añadir un módulo a un cliente existente
Copie `modules/<id>` desde el maestro, actívelo en `client.config.json`, `npm run modules sync`,
`npx supabase db push --include-all` y redeploy. Datos existentes no se tocan.
