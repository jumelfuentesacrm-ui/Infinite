import { brand } from '@core/config';

/** Se muestra si faltan las variables de Supabase (instalación incompleta). */
export function SetupNotice() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-card border border-line bg-panel p-6 shadow-card">
        <h1 className="text-lg font-semibold">{brand.name}: falta configurar la conexión</h1>
        <p className="mt-2 text-sm text-muted">
          Defina <code className="num">VITE_SUPABASE_URL</code> y <code className="num">VITE_SUPABASE_ANON_KEY</code> en
          <code className="num"> .env.local</code> (desarrollo) o en las variables de entorno de Vercel. Vea SETUP.md.
        </p>
      </div>
    </div>
  );
}
