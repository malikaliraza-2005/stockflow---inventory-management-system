/**
 * ScanResultCard — UCA §5.2 / WIR §9. The lookup-tail rendering of the scanner
 * machine: `found | not-found | archived`, each a named variant with
 * role-dependent CTAs.
 *
 *  - found:     name · qty · status badge → Stock In / Stock Out (any role),
 *               Adjust (Admin), View. Post-movement (WIR Issue 2a): the quantity
 *               updates with a success flash and the card stays ready for the
 *               next scan.
 *  - not-found: Admin → "Create product with this code" (create-from-barcode
 *               route state); Staff → "notify an administrator" (FR-SCAN-04).
 *  - archived:  reported as archived, NEVER "not found" (BR-07); movement/adjust
 *               actions suppressed; Admin sees Restore (FR-SCAN-05, WIR Issue 2).
 *
 * The scanned code is opaque untrusted text: rendered escaped by React's default,
 * never navigated to or executed (BR-16 / SEC-07).
 */
import type { ProductLookup } from '../../api/products';
import { Button } from '../ui/Button';
import { StockStatusBadge } from './StockStatusBadge';

export type ScanResult =
  | { kind: 'found'; product: ProductLookup }
  | { kind: 'archived'; product: ProductLookup }
  | { kind: 'not-found'; code: string };

export interface ScanResultCardProps {
  result: ScanResult;
  /** movements.adjust — Admin only. */
  canAdjust: boolean;
  /** products.manage — gates create-from-barcode. */
  canCreateProduct: boolean;
  /** products.lifecycle — gates Restore. */
  canRestore: boolean;
  /** Post-movement success flash (WIR Issue 2a). */
  flash?: boolean;
  /** Rendered inside the pop-up dialog — drop the standalone card chrome. */
  flat?: boolean;
  onStockIn: () => void;
  onStockOut: () => void;
  onAdjust: () => void;
  onView: () => void;
  onRestore: () => void;
  onCreateProduct: () => void;
  onScanNext: () => void;
}

function ProductThumb({ product }: { product: ProductLookup }) {
  if (product.primaryImageUrl) {
    return (
      <img
        src={product.primaryImageUrl}
        alt=""
        className="h-16 w-16 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400"
    >
      No image
    </div>
  );
}

export function ScanResultCard(props: ScanResultCardProps) {
  const { result, flash = false, flat = false } = props;
  const flashClass = flash ? 'ring-2 ring-success-600 bg-success-100' : 'ring-1 ring-gray-200';
  // In the dialog the surface is the modal itself; only the flash keeps a skin.
  const chrome = flat
    ? flash
      ? 'rounded-lg bg-success-100 p-3 ring-1 ring-success-600 transition-colors'
      : ''
    : `rounded-lg bg-white p-4 shadow-sm transition-colors ${flashClass}`;

  return (
    <section aria-label="Scan result" className={chrome}>
      {result.kind === 'not-found' ? (
        <div className="space-y-3">
          <div>
            <p className="font-medium text-gray-900">No product for that code</p>
            <p className="break-all text-sm text-gray-500">{result.code}</p>
          </div>
          {props.canCreateProduct ? (
            <Button variant="primary" onClick={props.onCreateProduct}>
              Create product with this code
            </Button>
          ) : (
            <p className="text-sm text-gray-600">Product not found — notify an administrator.</p>
          )}
          <div>
            <Button variant="ghost" onClick={props.onScanNext}>
              Scan another
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <ProductThumb product={result.product} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{result.product.name}</p>
              <p className="text-sm text-gray-500">{result.product.sku}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-gray-700">Qty {result.product.quantity}</span>
                <StockStatusBadge
                  status={result.product.stockStatus}
                  isArchived={result.kind === 'archived'}
                />
              </div>
            </div>
          </div>

          {flash && (
            <p role="status" aria-live="polite" className="text-sm font-medium text-success-600">
              Stock updated.
            </p>
          )}

          {result.kind === 'archived' ? (
            <div className="flex flex-wrap gap-2">
              <p className="w-full text-sm text-gray-600">{result.product.name} is archived.</p>
              {props.canRestore && (
                <Button variant="secondary" onClick={props.onRestore}>
                  Restore
                </Button>
              )}
              <Button variant="ghost" onClick={props.onView}>
                View
              </Button>
              <Button variant="ghost" onClick={props.onScanNext}>
                Scan another
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={props.onStockIn}>
                Stock In
              </Button>
              <Button variant="secondary" onClick={props.onStockOut}>
                Stock Out
              </Button>
              {props.canAdjust && (
                <Button variant="ghost" onClick={props.onAdjust}>
                  Adjust
                </Button>
              )}
              <Button variant="ghost" onClick={props.onView}>
                View
              </Button>
              <Button variant="ghost" onClick={props.onScanNext}>
                Scan another
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
