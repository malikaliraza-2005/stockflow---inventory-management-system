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

export interface CloudinaryClient {
  readonly cloudName: string;
  readonly apiKey: string;
  /** Sign the params the browser will send (folder + timestamp). */
  signUpload(params: { folder: string; timestamp: number }): SignedUploadParams;
  /** Destroy one asset by publicId (Admin API). */
  destroy(publicId: string): Promise<DestroyResult>;
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
  };
}
