import { useEffect, useRef, useState } from 'react';
import { Camera, FileText, Paperclip, X, ImageIcon } from 'lucide-react';
import { signedUrl, attachFile } from '@core/data/storage';
import { useAttachments, type Attachment } from '@core/data/shared';
import { useAction } from '@core/data/api';
import { Button, cx } from './primitives';

/** Imagen privada de Storage (URL firmada) */
export function StorageImage({ path, alt, className }: { path: string | null | undefined; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) signedUrl(path).then((u) => on && setUrl(u)).catch(() => {}); return () => { on = false; }; }, [path]);
  if (!path) return <div className={cx('grid place-items-center bg-sunken text-faint', className)}><ImageIcon className="size-6" /></div>;
  return url ? <img src={url} alt={alt} className={cx('object-cover', className)} loading="lazy" /> : <div className={cx('animate-pulse bg-sunken', className)} />;
}

export async function openStorageFile(path: string) {
  const url = await signedUrl(path);
  window.open(url, '_blank', 'noopener');
}

/** Selector de fotos/archivos local (antes de guardar). Usa la cámara en el teléfono. */
export function FilePicker({ files, onChange, accept = 'image/*', capture = true, label = 'Añadir foto', max = 6 }: {
  files: File[]; onChange: (f: File[]) => void; accept?: string; capture?: boolean; label?: string; max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''));
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <div key={i} className="relative size-20 overflow-hidden rounded-md border border-line bg-sunken">
          {previews[i] ? <img src={previews[i]} alt="" className="size-full object-cover" />
            : <div className="grid size-full place-items-center p-1 text-center text-[10px] text-muted"><FileText className="mb-1 size-5" />{f.name.slice(0, 18)}</div>}
          <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
            className="absolute top-1 right-1 rounded-full bg-ink/70 p-0.5 text-white" aria-label="Quitar"><X className="size-3" /></button>
        </div>
      ))}
      {files.length < max && (
        <button type="button" onClick={() => ref.current?.click()}
          className="grid size-20 place-items-center rounded-md border border-dashed border-line-strong text-muted hover:border-brand hover:text-brand">
          <span className="flex flex-col items-center gap-1 text-[11px]">{accept.startsWith('image') ? <Camera className="size-5" /> : <Paperclip className="size-5" />}{label}</span>
        </button>
      )}
      <input ref={ref} type="file" hidden accept={accept} multiple {...(capture && accept.startsWith('image') ? { capture: 'environment' as const } : {})}
        onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, max)); e.target.value = ''; }} />
    </div>
  );
}

/** Galería + subida de adjuntos de cualquier entidad */
export function Attachments({ moduleId, entityType, entityId, canUpload = true }: {
  moduleId: string; entityType: string; entityId: string; canUpload?: boolean;
}) {
  const q = useAttachments(entityType, [entityId]);
  const [pending, setPending] = useState<File[]>([]);
  const upload = useAction(async (files: File[]) => { for (const f of files) await attachFile(moduleId, entityType, entityId, f); },
    { invalidate: [['attachments', entityType]], success: 'Archivos guardados', onSuccess: () => setPending([]) });
  return (
    <div className="space-y-3">
      <AttachmentGrid items={q.data ?? []} />
      {canUpload && (
        <div className="space-y-2">
          <FilePicker files={pending} onChange={setPending} accept="image/*,application/pdf" capture={false} label="Adjuntar" />
          {pending.length > 0 && <Button size="sm" variant="primary" loading={upload.isPending} onClick={() => upload.mutate(pending)}>Subir {pending.length} archivo(s)</Button>}
        </div>
      )}
    </div>
  );
}

export function AttachmentGrid({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a) => (
        <button key={a.id} type="button" onClick={() => openStorageFile(a.storage_path)} title={a.file_name}
          className="size-20 overflow-hidden rounded-md border border-line bg-sunken">
          {a.mime_type?.startsWith('image/') ? <StorageImage path={a.storage_path} alt={a.file_name} className="size-full" />
            : <span className="grid size-full place-items-center p-1 text-center text-[10px] text-muted"><FileText className="mb-1 size-5" />{a.file_name.slice(0, 20)}</span>}
        </button>
      ))}
    </div>
  );
}
