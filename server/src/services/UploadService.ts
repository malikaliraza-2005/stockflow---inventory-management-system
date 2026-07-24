/**
 * UploadService — SEC-08 / BR-36, 38 (BEA §6). Issues scoped signed-upload
 * params and destroys assets. The image bytes never touch this API (the browser
 * uploads directly to Cloudinary with the signature).
 *
 * Folder scope is the security boundary (APR-03): signatures are pinned to
 * `ims/prod`, and destroy REFUSES any publicId outside that prefix with a 403 —
 * this endpoint can never delete assets beyond the app's own uploads.
 */
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import type { CloudinaryClient } from '../lib/cloudinary.js';

export const UPLOAD_FOLDER = 'ims/prod';
const FOLDER_PREFIX = `${UPLOAD_FOLDER}/`;

export interface UploadSignaturePayload {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
}

export interface UploadServiceDeps {
  cloudinary: CloudinaryClient;
  /** Test seam — production uses the wall clock (epoch seconds). */
  now?: () => number;
}

export class UploadService {
  private readonly cloudinary: CloudinaryClient;
  private readonly now: () => number;

  constructor(deps: UploadServiceDeps) {
    this.cloudinary = deps.cloudinary;
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** POST /upload/signature — sign an upload scoped to `ims/prod`. Type/size are
   *  already validated by the schema (BR-36). */
  createSignature(): UploadSignaturePayload {
    const timestamp = this.now();
    const { signature } = this.cloudinary.signUpload({ folder: UPLOAD_FOLDER, timestamp });
    return {
      signature,
      timestamp,
      apiKey: this.cloudinary.apiKey,
      cloudName: this.cloudinary.cloudName,
      folder: UPLOAD_FOLDER,
    };
  }

  /** DELETE /upload/:publicId — folder-scoped destroy (APR-03). Outside the
   *  app's folder → 403; unknown asset → 404. */
  async destroy(publicId: string): Promise<void> {
    this.assertInFolder(publicId);
    const { result } = await this.cloudinary.destroy(publicId);
    if (result === 'not found') throw new NotFoundError('Image not found.');
  }

  /** Best-effort cleanup (BR-38 / FEV-01) — never throws: a destroy failure is
   *  logged by the caller's degradation path, never blocks the request. Used for
   *  replaced/removed images and failed-save orphans. Skips out-of-folder ids. */
  async destroyQuietly(publicIds: string[]): Promise<void> {
    await Promise.all(
      publicIds
        .filter((id) => id.startsWith(FOLDER_PREFIX))
        .map((id) => this.cloudinary.destroy(id).catch(() => undefined)),
    );
  }

  private assertInFolder(publicId: string): void {
    if (!publicId.startsWith(FOLDER_PREFIX)) {
      throw new ForbiddenError('That image is outside this application’s upload folder.');
    }
  }
}
