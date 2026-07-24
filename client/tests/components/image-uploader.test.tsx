/**
 * F5 — ImageUploader (FEV-01) failure paths + happy path: a successful upload
 * attaches {publicId, url, isPrimary:true} (first image primary, DBR-03); an
 * upload failure surfaces a Retry/Remove tile and never attaches (save not
 * blocked, BR-37); an invalid type is rejected client-side before any request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/upload', () => ({
  createUploadSignature: vi.fn(),
  uploadToCloudinary: vi.fn(),
  destroyUpload: vi.fn(),
}));

import { createUploadSignature, uploadToCloudinary } from '../../src/api/upload';
import { ImageUploader } from '../../src/components/domain/ImageUploader';

const mockedSign = vi.mocked(createUploadSignature);
const mockedUpload = vi.mocked(uploadToCloudinary);

const SIGNED = { signature: 's', timestamp: 1, apiKey: 'k', cloudName: 'c', folder: 'ims/prod' };

function pngFile(name = 'a.png') {
  return new File(['data'], name, { type: 'image/png' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSign.mockResolvedValue(SIGNED);
});

describe('ImageUploader (FEV-01)', () => {
  it('uploads and attaches the first image as primary', async () => {
    mockedUpload.mockResolvedValue({
      publicId: 'ims/prod/abc',
      url: 'https://res.cloudinary.com/abc.jpg',
    });
    const onChange = vi.fn();
    render(<ImageUploader value={[]} onChange={onChange} />);

    await userEvent.upload(screen.getByLabelText(/upload product images/i), pngFile());

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { publicId: 'ims/prod/abc', url: 'https://res.cloudinary.com/abc.jpg', isPrimary: true },
      ]),
    );
  });

  it('a failed upload shows Retry/Remove and does not attach (BR-37)', async () => {
    mockedUpload.mockRejectedValue(new Error('network'));
    const onChange = vi.fn();
    render(<ImageUploader value={[]} onChange={onChange} />);

    await userEvent.upload(screen.getByLabelText(/upload product images/i), pngFile());

    expect(await screen.findByText(/upload failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled(); // never blocks/attaches
  });

  it('rejects a disallowed type before requesting a signature', async () => {
    const onChange = vi.fn();
    render(<ImageUploader value={[]} onChange={onChange} />);

    const gif = new File(['data'], 'a.gif', { type: 'image/gif' });
    // applyAccept:false bypasses the input's accept filter so the file reaches
    // the component's own type guard (the real client-side defense).
    await userEvent.upload(screen.getByLabelText(/upload product images/i), gif, {
      applyAccept: false,
    });

    expect(await screen.findByText(/jpeg, png, or webp/i)).toBeInTheDocument();
    expect(mockedSign).not.toHaveBeenCalled();
  });
});
