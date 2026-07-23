/**
 * ResetLinkModal — UCA §5.2 (F2): shows the out-of-band reset link with a
 * [Copy] button (AS-6 — the operator delivers it themselves; the system
 * never emails). The link is displayed once; there is no re-fetch.
 */
import { useState } from 'react';

import type { components } from '../../types/api';
import { formatDateTime } from '../../lib/formatters';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

type ResetLinkResponse = components['schemas']['ResetLinkResponse'];

export interface ResetLinkModalProps {
  open: boolean;
  result: ResetLinkResponse | null;
  targetName: string;
  onClose: () => void;
}

export function ResetLinkModal({ open, result, targetName, onClose }: ResetLinkModalProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.resetLink);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked — the link is still selectable below
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Password reset link" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Send this single-use link to <strong>{targetName}</strong> yourself — the system does not
          email it. It expires {result ? formatDateTime(result.expiresAt) : ''}.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label="Reset link"
            value={result?.resetLink ?? ''}
            className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
