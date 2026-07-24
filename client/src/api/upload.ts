/**
 * Upload client — 05 §7.9 (F5). The signature + destroy calls go through our
 * API; the actual image bytes go DIRECTLY to Cloudinary (SEC-08) via a raw XHR
 * (so it bypasses the app interceptor and reports per-file progress, FEV-01).
 */
import { api } from './client';
import type { components } from '../types/api';

export type UploadSignatureResponse = components['schemas']['UploadSignatureResponse'];

/** What the form holds per image; `isPrimary` is layered on in the component. */
export interface UploadedImage {
  publicId: string;
  url: string;
}

export async function createUploadSignature(
  contentType: string,
  size: number,
): Promise<UploadSignatureResponse> {
  const response = await api.post<UploadSignatureResponse>('/upload/signature', {
    contentType,
    size,
  });
  return response.data;
}

export async function destroyUpload(publicId: string): Promise<void> {
  // publicId contains '/', so it must be percent-encoded in the path (APR-03).
  await api.delete(`/upload/${encodeURIComponent(publicId)}`);
}

/** Direct browser → Cloudinary upload with progress. Resolves the attach ref. */
export function uploadToCloudinary(
  file: File,
  signed: UploadSignatureResponse,
  onProgress: (fraction: number) => void,
): Promise<UploadedImage> {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', signed.apiKey);
  form.append('timestamp', String(signed.timestamp));
  form.append('signature', signed.signature);
  form.append('folder', signed.folder);

  const endpoint = `https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`;

  return new Promise<UploadedImage>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { public_id: string; secure_url: string };
          resolve({ publicId: body.public_id, url: body.secure_url });
        } catch {
          reject(new Error('Malformed upload response'));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}
