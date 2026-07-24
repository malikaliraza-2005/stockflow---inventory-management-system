/**
 * ImageUploader — FEV-01 (F5). Select ≤ 5 images (client validates type/size)
 * → POST /upload/signature → DIRECT upload to Cloudinary with per-file progress
 * → hold {publicId, url} in form state; images attach only on product save.
 *
 * Failure isolation (BR-37): an upload failure never blocks the save — the
 * failed tile offers Retry/Remove and the product can be saved without it.
 * Remove-before-save destroys the asset (DELETE /upload/:publicId, BR-38);
 * abandoned uploads are the backend sweep's job (no navigate-away cleanup).
 * Exactly-one-primary is enforced in-component (DBR-03 client mirror).
 */
import { useRef, useState, type ChangeEvent } from 'react';

import { createUploadSignature, destroyUpload, uploadToCloudinary } from '../../api/upload';
import { Button } from '../ui/Button';

export interface FormImage {
  publicId: string;
  url: string;
  isPrimary: boolean;
}

export interface ImageUploaderProps {
  value: FormImage[];
  onChange: (images: FormImage[]) => void;
  max?: number;
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

interface Pending {
  id: number;
  file: File;
  progress: number;
  error?: string | undefined;
}

export function ImageUploader({ value, onChange, max = 5 }: ImageUploaderProps) {
  const [pending, setPending] = useState<Pending[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  // Latest committed images — appends read this to avoid stale closures across
  // concurrent uploads.
  const valueRef = useRef(value);
  valueRef.current = value;

  const total = value.length + pending.length;

  function patchPending(id: number, patch: Partial<Pending>) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function startUpload(item: Pending) {
    patchPending(item.id, { error: undefined, progress: 0 });
    try {
      const signed = await createUploadSignature(item.file.type, item.file.size);
      const uploaded = await uploadToCloudinary(item.file, signed, (f) =>
        patchPending(item.id, { progress: f }),
      );
      // Append; first image becomes primary (DBR-03).
      onChange([...valueRef.current, { ...uploaded, isPrimary: valueRef.current.length === 0 }]);
      setPending((prev) => prev.filter((p) => p.id !== item.id));
    } catch {
      patchPending(item.id, { error: 'Upload failed' });
    }
  }

  function onSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow re-selecting the same file
    for (const file of files) {
      if (value.length + pending.length >= max) break;
      const id = ++idRef.current;
      if (!ALLOWED.includes(file.type)) {
        setPending((prev) => [...prev, { id, file, progress: 0, error: 'Use JPEG, PNG, or WebP' }]);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setPending((prev) => [...prev, { id, file, progress: 0, error: 'Max size is 5 MB' }]);
        continue;
      }
      const item: Pending = { id, file, progress: 0 };
      setPending((prev) => [...prev, item]);
      void startUpload(item);
    }
  }

  function removeImage(publicId: string) {
    void destroyUpload(publicId).catch(() => undefined); // best-effort (BR-38)
    const next = value.filter((img) => img.publicId !== publicId);
    if (next.length > 0 && !next.some((img) => img.isPrimary) && next[0]) {
      next[0] = { ...next[0], isPrimary: true }; // keep exactly one primary
    }
    onChange(next);
  }

  function setPrimary(publicId: string) {
    onChange(value.map((img) => ({ ...img, isPrimary: img.publicId === publicId })));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={total >= max}
        >
          + Upload
        </Button>
        <span className="text-xs text-gray-500">≤ {max} · ≤ 5 MB · JPEG/PNG/WebP</span>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(',')}
          multiple
          className="hidden"
          aria-label="Upload product images"
          onChange={onSelect}
        />
      </div>

      {(value.length > 0 || pending.length > 0) && (
        <ul className="flex flex-wrap gap-3">
          {value.map((img) => (
            <li key={img.publicId} className="relative w-24">
              <img src={img.url} alt="" className="h-24 w-24 rounded object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => removeImage(img.publicId)}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-gray-800 text-xs text-white"
              >
                ×
              </button>
              <button
                type="button"
                aria-label={img.isPrimary ? 'Primary image' : 'Set as primary'}
                aria-pressed={img.isPrimary}
                onClick={() => setPrimary(img.publicId)}
                className={`mt-1 w-full rounded px-2 py-0.5 text-xs ${
                  img.isPrimary ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {img.isPrimary ? '◉ Primary' : '○ Primary'}
              </button>
            </li>
          ))}

          {pending.map((p) => (
            <li key={p.id} className="w-24">
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 p-1 text-center">
                {p.error ? (
                  <span className="text-xs text-danger-600">{p.error}</span>
                ) : (
                  <span className="text-xs text-gray-500">{Math.round(p.progress * 100)}%</span>
                )}
              </div>
              {p.error && (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => void startUpload(p)}
                    className="flex-1 rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-700"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                    className="flex-1 rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-700"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
