/**
 * Scanner page — SMP §9.8 / WIR §9 / FR-SCAN-01…07 (F8, Any role). The camera
 * floor workflow, orchestrated: it owns the LOOKUP TAIL of the FEA §6.1 machine
 * (`looking-up → found | not-found | archived`) and launches the Phase-3
 * movement dialogs with the scanned product (Step 0 skipped).
 *
 * Guarantees:
 *  - `ManualCodeEntry` is rendered in EVERY state (FR-SCAN-01) — the page shell
 *    and the fallback never depend on the camera chunk.
 *  - `ScannerViewport` is a LAZY chunk (SMP §7): the ZXing decoder loads only
 *    here, and a chunk-load failure degrades to manual entry via a local
 *    boundary — it never blanks the page.
 *  - Every decoded/typed payload is guarded (BR-16) before lookup; a hostile
 *    code is rendered escaped and never navigated to or executed (SEC-07).
 *  - The dialogs carry the F6 idempotency + BR-15 machinery unchanged; on
 *    success the card flashes and shows the new quantity, ready for the next
 *    scan (WIR Issue 2a).
 *  - Create-from-barcode hands the code to Add Product via route state (Admin).
 */
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import type { MovementResponse } from '../../api/movements';
import { lookupProduct, restoreProduct, type ProductLookup } from '../../api/products';
import { AdjustmentDialog } from '../../components/domain/AdjustmentDialog';
import { ManualCodeEntry } from '../../components/domain/ManualCodeEntry';
import { ScanResultCard, type ScanResult } from '../../components/domain/ScanResultCard';
import { StockMovementDialog } from '../../components/domain/StockMovementDialog';
import type { PickedProduct } from '../../components/domain/ProductPicker';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { usePermission } from '../../hooks/usePermission';
import { useToast } from '../../hooks/useToast';
import { messageFor } from '../../lib/errorMap';
import { parseScanCode } from '../../lib/validation/schemas/scanner';

// Lazy — the ZXing decoder chunk downloads only with this route (SMP §7).
const ScannerViewport = lazy(() => import('../../components/domain/ScannerViewport'));

type PageState =
  | { phase: 'scanning' }
  | { phase: 'looking-up'; code: string }
  | { phase: 'invalid' }
  | { phase: 'error'; message: string }
  | { phase: 'result'; result: ScanResult };

type DialogState = { kind: 'stock'; type: 'STOCK_IN' | 'STOCK_OUT' } | { kind: 'adjust' } | null;

function toPicked(product: ProductLookup): PickedProduct {
  return { id: product.id, name: product.name, sku: product.sku, quantity: product.quantity };
}

export default function ScannerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const can = usePermission();
  const canAdjust = can('movements.adjust');
  const canCreateProduct = can('products.manage');
  const canRestore = can('products.lifecycle');

  const [state, setState] = useState<PageState>({ phase: 'scanning' });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [flash, setFlash] = useState(false);

  // Pause camera decodes whenever a result/lookup/dialog is active — the stream
  // stays alive, so resuming is instant (no re-permission).
  const paused = state.phase !== 'scanning' || dialog !== null;

  // Post-movement flash auto-clears; the card stays in `found`, ready for next.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [flash]);

  async function runLookup(raw: string) {
    const parsed = parseScanCode(raw);
    if (!parsed.ok || parsed.code === undefined) {
      setState({ phase: 'invalid' }); // BR-16 — never hits the network
      return;
    }
    const code = parsed.code;
    setState({ phase: 'looking-up', code });
    try {
      const product = await lookupProduct(code);
      setState({
        phase: 'result',
        result: product.isArchived ? { kind: 'archived', product } : { kind: 'found', product },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_BARCODE') {
          setState({ phase: 'invalid' });
          return;
        }
        if (err.code === 'NOT_FOUND') {
          setState({ phase: 'result', result: { kind: 'not-found', code } });
          return;
        }
        setState({ phase: 'error', message: messageFor(err.code) });
        return;
      }
      setState({ phase: 'error', message: messageFor('INTERNAL_ERROR') });
    }
  }

  function resumeScanning() {
    setFlash(false);
    setState({ phase: 'scanning' });
  }

  function handleMovementCompleted(result: MovementResponse, message: string) {
    setDialog(null);
    setState((prev) => {
      if (prev.phase !== 'result' || prev.result.kind === 'not-found') return prev;
      return {
        phase: 'result',
        result: {
          ...prev.result,
          product: {
            ...prev.result.product,
            quantity: result.product.quantity,
            stockStatus: result.product.stockStatus,
          },
        },
      };
    });
    setFlash(true);
    toast.success(message);
  }

  async function handleRestore(product: ProductLookup) {
    try {
      const restored = await restoreProduct(product.id);
      setState({
        phase: 'result',
        result: {
          kind: 'found',
          product: {
            ...product,
            quantity: restored.quantity,
            stockStatus: restored.stockStatus,
            isArchived: false,
          },
        },
      });
      toast.success('Product restored.');
    } catch (err) {
      toast.error(err instanceof ApiError ? messageFor(err.code) : messageFor('INTERNAL_ERROR'));
    }
  }

  const foundProduct =
    state.phase === 'result' && state.result.kind !== 'not-found' ? state.result.product : null;

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-gray-900">Scanner</h1>

      <CameraErrorBoundary>
        <Suspense
          fallback={
            <div className="h-[55vh] max-h-130 w-full animate-pulse rounded-lg bg-gray-200 md:h-80" />
          }
        >
          <ScannerViewport onDecoded={runLookup} paused={paused} />
        </Suspense>
      </CameraErrorBoundary>

      <ManualCodeEntry onSubmit={runLookup} disabled={state.phase === 'looking-up'} />

      {state.phase === 'looking-up' && (
        <div role="status" aria-live="polite">
          <div className="h-24 w-full animate-pulse rounded-lg bg-gray-200" />
          <span className="sr-only">Looking up {state.code}…</span>
        </div>
      )}

      {state.phase === 'invalid' && (
        <AlertBanner
          tone="danger"
          message={messageFor('INVALID_BARCODE')}
          action={
            <Button variant="secondary" onClick={resumeScanning}>
              Scan again
            </Button>
          }
        />
      )}

      {state.phase === 'error' && (
        <AlertBanner
          tone="danger"
          message={state.message}
          action={
            <Button variant="secondary" onClick={resumeScanning}>
              Try again
            </Button>
          }
        />
      )}

      {state.phase === 'result' && (
        <ScanResultCard
          result={state.result}
          canAdjust={canAdjust}
          canCreateProduct={canCreateProduct}
          canRestore={canRestore}
          flash={flash}
          onStockIn={() => setDialog({ kind: 'stock', type: 'STOCK_IN' })}
          onStockOut={() => setDialog({ kind: 'stock', type: 'STOCK_OUT' })}
          onAdjust={() => setDialog({ kind: 'adjust' })}
          onView={() => {
            if (foundProduct) navigate(`/products/${foundProduct.id}`);
          }}
          onRestore={() => {
            if (foundProduct) void handleRestore(foundProduct);
          }}
          onCreateProduct={() => {
            if (state.result.kind === 'not-found') {
              navigate('/products/new', { state: { barcode: state.result.code } });
            }
          }}
          onScanNext={resumeScanning}
        />
      )}

      {foundProduct && (
        <>
          <StockMovementDialog
            open={dialog?.kind === 'stock'}
            onClose={() => setDialog(null)}
            product={toPicked(foundProduct)}
            defaultType={dialog?.kind === 'stock' ? dialog.type : 'STOCK_IN'}
            onCompleted={(result) => handleMovementCompleted(result, 'Stock updated.')}
          />
          {canAdjust && (
            <AdjustmentDialog
              open={dialog?.kind === 'adjust'}
              onClose={() => setDialog(null)}
              product={toPicked(foundProduct)}
              onCompleted={(result) => handleMovementCompleted(result, 'Adjustment recorded.')}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * If the lazy ZXing chunk fails to load (offline, cache miss on a new deploy),
 * degrade to manual-entry-only instead of blanking the page — the camera is
 * additive, manual entry is the guaranteed workflow (R-1 posture).
 */
class CameraErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex h-40 items-center justify-center rounded-lg bg-gray-100 p-6 text-center text-sm text-gray-600">
          Camera unavailable — use manual entry below.
        </div>
      );
    }
    return this.props.children;
  }
}
