import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

/** Build de demostración: las llamadas se resuelven dentro del navegador (src/demo). */
const DEMO = import.meta.env.VITE_DEMO === '1';
const demoFetch: typeof fetch | undefined = DEMO
  ? async (input, init) => (await import('../../demo/fetch')).demoFetch(input, init)
  : undefined;
class InertSocket { readyState = 0; binaryType = 'arraybuffer'; onopen = null; onclose = null; onerror = null; onmessage = null; close() {} send() {} }

export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: !DEMO, storageKey: 'fleet-ops-auth' },
  ...(DEMO ? { global: { fetch: demoFetch }, realtime: { transport: InertSocket as never } } : {}),
});

export const functionsUrl = `${url}/functions/v1`;
