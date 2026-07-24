/**
 * QRLabel — UCA §5 / FR-PROD-08 (F4). Client-rendered, PRINT-CLEAN label: a QR
 * of the SKU plus human-readable name + SKU. There is deliberately no server
 * endpoint (05 §9.1) — the label is generated in the browser and printed.
 *
 * On screen it is a normal block; `window.print()` from the parent prints just
 * this label (the app chrome is `print:hidden`, this is `print:block`).
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface QRLabelProps {
  sku: string;
  name: string;
}

export function QRLabel({ sku, name }: QRLabelProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(sku, { margin: 1, width: 160 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [sku]);

  return (
    <div className="inline-flex flex-col items-center gap-2 rounded-md border border-gray-200 bg-white p-4 text-center">
      {dataUrl ? (
        <img src={dataUrl} alt={`QR code for ${sku}`} width={160} height={160} />
      ) : (
        <div className="h-40 w-40" aria-hidden="true" />
      )}
      <div>
        <p className="text-sm font-medium text-gray-900">{name}</p>
        <p className="font-mono text-xs text-gray-600">{sku}</p>
      </div>
    </div>
  );
}
