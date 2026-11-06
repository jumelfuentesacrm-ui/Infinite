import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fuentes incluidas en la app (funcionan sin conexión en la PWA)
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans-condensed/latin-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-700.css';
import './index.css';
import { brand } from '@core/config';
import { App } from '@app/App';

document.documentElement.style.setProperty('--brand', brand.primaryColor);
document.title = brand.title ?? brand.name;

const root = document.getElementById('root')!;
const render = () => createRoot(root).render(<StrictMode><App /></StrictMode>);

if (import.meta.env.VITE_DEMO === '1') {
  // Demo: arranca la base de datos en el navegador antes de mostrar la app
  root.innerHTML = `<div style="min-height:100dvh;display:grid;place-items:center;background:#15181C;color:#C2C6CC;font:500 14px 'IBM Plex Sans',system-ui,sans-serif;text-align:center;padding:24px">
    <div><div style="width:44px;height:44px;margin:0 auto 16px;border-radius:12px;background:${brand.primaryColor};display:grid;place-items:center;color:#fff;font:700 16px 'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif">${brand.shortName.slice(0, 2).toUpperCase()}</div>
    <div style="color:#fff;font-size:17px;font-weight:600">${brand.name}</div>
    <div id="demo-step" style="margin-top:10px">Preparando demo…</div>
    <div style="margin-top:6px;font-size:12px;opacity:.55">La primera vez tarda unos segundos: se instala la base de datos completa en su navegador.</div></div></div>`;
  const step = (m: string) => { const el = document.getElementById('demo-step'); if (el) el.textContent = m; };
  import('./demo/backend')
    .then((m) => m.bootDemo(step))
    .then(() => { root.innerHTML = ''; render(); })
    .catch((e) => step('No se pudo iniciar el demo en este navegador: ' + (e?.message ?? e)));
} else {
  render();
}
