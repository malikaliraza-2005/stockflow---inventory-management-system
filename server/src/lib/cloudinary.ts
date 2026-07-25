/**
 * Cloudinary wrapper (SEC-08) — the ONLY module that talks to the Cloudinary
 * SDK. Everything else depends on the `CloudinaryClient` interface so services
 * stay unit-testable with an injected fake (no network in tests).
 *
 * Signed uploads only: the server signs `{folder, timestamp}` with the API
 * secret; the browser uploads directly to Cloudinary with that signature —
 * image bytes never transit this API. Destroy is a server-side Admin API call.
 */
import { v2 as cloudinary } from 'cloudinary';

export interface SignedUploadParams {
  signature: string;
  timestamp: number;
}

export interface DestroyResult {
  /** Cloudinary returns 'ok' | 'not found' (among others). */
  result: string;
}

/** One asset from a folder listing (Admin API) — the orphan sweep's input. */
export interface CloudinaryAsset {
  publicId: string;
  createdAt: Date;
}

export interface CloudinaryClient {
  readonly cloudName: string;
  readonly apiKey: string;
  /** Sign the params the browser will send (folder + timestamp). */
  signUpload(params: { folder: string; timestamp: number }): SignedUploadParams;
  /** Destroy one asset by publicId (Admin API). */
  destroy(publicId: string): Promise<DestroyResult>;
  /**
   * List every asset under a folder prefix (Admin API), following pagination.
   * The BEV-04 orphan sweep's discovery mechanism (F6, first consumer).
   */
  listFolder(folder: string): Promise<CloudinaryAsset[]>;
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function createCloudinary(config: CloudinaryConfig): CloudinaryClient {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    signUpload({ folder, timestamp }) {
      const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, config.apiSecret);
      return { signature, timestamp };
    },
    async destroy(publicId) {
      return (await cloudinary.uploader.destroy(publicId)) as DestroyResult;
    },
    async listFolder(folder) {
      const assets: CloudinaryAsset[] = [];
      let nextCursor: string | undefined;
      do {
        const page = (await cloudinary.api.resources({
          type: 'upload',
          prefix: folder,
          max_results: 500,
          ...(nextCursor ? { next_cursor: nextCursor } : {}),
        })) as {
          resources: { public_id: string; created_at: string }[];
          next_cursor?: string;
        };
        for (const r of page.resources) {
          assets.push({ publicId: r.public_id, createdAt: new Date(r.created_at) });
        }
        nextCursor = page.next_cursor;
      } while (nextCursor);
      return assets;
    },
  };
}
