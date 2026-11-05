/**
 * Archivos: bucket privado "files". Ruta <modulo>/<entidad>/<uuid>-<nombre>.
 * Los adjuntos se registran en la tabla `attachments` (una para todo el sistema).
 */
import { supabase } from './supabase';
import { run, toAppError } from './api';

const BUCKET = 'files';
const MAX_IMAGE_SIDE = 1920;

/** Reduce fotos grandes del teléfono antes de subirlas (ahorra datos y espacio). */
async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.82));
  } catch { return file; }
}

export async function uploadFile(moduleId: string, folder: string, file: File) {
  const blob = await shrinkImage(file);
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${moduleId}/${folder}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || file.type, upsert: false,
  });
  if (error) throw toAppError(error);
  return { path, size: blob.size, mime: blob.type || file.type, name: file.name };
}

export async function attachFile(moduleId: string, entityType: string, entityId: string, file: File, caption?: string) {
  const up = await uploadFile(moduleId, entityType, file);
  return run(supabase.from('attachments').insert({
    module_id: moduleId, entity_type: entityType, entity_id: entityId, storage_path: up.path,
    file_name: up.name, mime_type: up.mime, size_bytes: up.size, caption: caption ?? null,
  }).select().single());
}

const urlCache = new Map<string, { url: string; exp: number }>();
export async function signedUrl(path: string) {
  if (import.meta.env.VITE_DEMO === '1') return (await import('../../demo/fetch')).demoFileUrl(path);
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw toAppError(error);
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}
