/**
 * Upload endpoint schemas — VAL §5 "Uploads" (F5 T-a). The signature request
 * declares what the browser intends to upload so the server can reject
 * disallowed types/sizes BEFORE issuing a signature (BR-36).
 */
import { z } from 'zod';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (BR-36)

export const uploadMessages = {
  contentType: 'Only JPEG, PNG, or WebP images are allowed',
  size: 'Image must be 5 MB or smaller',
} as const;

/** POST /upload/signature — §15 uploads. */
export const uploadSignatureSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES, uploadMessages.contentType),
  size: z
    .number(uploadMessages.size)
    .int(uploadMessages.size)
    .positive(uploadMessages.size)
    .max(MAX_IMAGE_BYTES, uploadMessages.size),
});

export type UploadSignatureInput = z.infer<typeof uploadSignatureSchema>;
