/**
 * F5 T-c — UploadService vs SEC-08 / BR-36/38 with an injected fake Cloudinary
 * client (no network). Covers the signature shape, folder-scoped destroy
 * (APR-03 → 403 outside ims/prod), not-found mapping, and best-effort
 * destroyQuietly (skips out-of-folder, swallows failures).
 */
import { describe, expect, it } from 'vitest';

import { ForbiddenError, NotFoundError } from '../../src/errors/AppError.js';
import type { CloudinaryClient, DestroyResult } from '../../src/lib/cloudinary.js';
import { UploadService } from '../../src/services/UploadService.js';

function fakeCloudinary(result: DestroyResult['result'] = 'ok') {
  const destroyed: string[] = [];
  const client: CloudinaryClient = {
    cloudName: 'test-cloud',
    apiKey: 'test-key',
    signUpload: ({ folder, timestamp }) => ({
      signature: `sig(${folder}:${timestamp})`,
      timestamp,
    }),
    destroy: async (publicId) => {
      destroyed.push(publicId);
      return { result };
    },
    listFolder: async () => [],
  };
  return { client, destroyed };
}

describe('createSignature', () => {
  it('returns signed params scoped to ims/prod', () => {
    const { client } = fakeCloudinary();
    const service = new UploadService({ cloudinary: client, now: () => 1_700_000_000 });
    expect(service.createSignature()).toEqual({
      signature: 'sig(ims/prod:1700000000)',
      timestamp: 1_700_000_000,
      apiKey: 'test-key',
      cloudName: 'test-cloud',
      folder: 'ims/prod',
    });
  });
});

describe('destroy (APR-03 folder scope)', () => {
  it('destroys an in-folder asset', async () => {
    const { client, destroyed } = fakeCloudinary('ok');
    await new UploadService({ cloudinary: client }).destroy('ims/prod/abc123');
    expect(destroyed).toEqual(['ims/prod/abc123']);
  });

  it('a publicId outside ims/prod → 403 and never calls Cloudinary', async () => {
    const { client, destroyed } = fakeCloudinary();
    const service = new UploadService({ cloudinary: client });
    await expect(service.destroy('other/folder/x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.destroy('ims/prod')).rejects.toBeInstanceOf(ForbiddenError); // prefix, not inside
    expect(destroyed).toEqual([]);
  });

  it('an unknown asset → 404', async () => {
    const { client } = fakeCloudinary('not found');
    await expect(
      new UploadService({ cloudinary: client }).destroy('ims/prod/gone'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('destroyQuietly (BR-38 best-effort)', () => {
  it('destroys only in-folder ids and never throws', async () => {
    const { client, destroyed } = fakeCloudinary();
    const service = new UploadService({ cloudinary: client });
    await service.destroyQuietly(['ims/prod/a', 'evil/b', 'ims/prod/c']);
    expect(destroyed.sort()).toEqual(['ims/prod/a', 'ims/prod/c']);
  });

  it('swallows a Cloudinary failure', async () => {
    const client: CloudinaryClient = {
      cloudName: 'c',
      apiKey: 'k',
      signUpload: ({ timestamp }) => ({ signature: 's', timestamp }),
      destroy: async () => {
        throw new Error('cloudinary down');
      },
      listFolder: async () => [],
    };
    await expect(
      new UploadService({ cloudinary: client }).destroyQuietly(['ims/prod/a']),
    ).resolves.toBeUndefined();
  });
});
