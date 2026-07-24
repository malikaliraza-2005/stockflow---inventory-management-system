/**
 * Product Detail — WIR §6 / FR-PROD (F4). Any role views (read-only for Staff);
 * Admin gets the lifecycle bar. Archived products show a banner and suppress
 * edit/archive (Restore only). "Print QR label" renders the client-side QRLabel
 * (FR-PROD-08 — no server endpoint) and prints just the label.
 *
 * Movement actions (Stock In/Out/Adjust) arrive with F6.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { archiveProduct, deleteProduct, getProduct, restoreProduct } from '../../api/products';
import { QRLabel } from '../../components/domain/QRLabel';
import { StockStatusBadge } from '../../components/domain/StockStatusBadge';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { usePermission } from '../../hooks/usePermission';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';
import { messageFor } from '../../lib/errorMap';
import { formatMoney } from '../../lib/formatters';
import { selectCurrency, useSettingsStore } from '../../stores/settingsStore';

export default function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const can = usePermission();
  const canManage = can('products.manage');
  const currency = useSettingsStore(selectCurrency);

  const { data: product, loading, error, refetch } = useQueryState(() => getProduct(id), [id]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [busy, setBusy] = useState(false);

  async function runLifecycle(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? messageFor(err.code) : messageFor('INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteProduct(id);
      setConfirmDelete(false);
      toast.success('Product deleted.');
      navigate('/products');
    } catch (err) {
      setConfirmDelete(false);
      toast.error(err instanceof ApiError ? messageFor(err.code) : messageFor('INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error || !product) {
    return (
      <AlertBanner
        tone="danger"
        message="Couldn't load this product."
        action={
          <Button variant="secondary" onClick={refetch}>
            Retry
          </Button>
        }
      />
    );
  }

  const primaryImage = product.images.find((img) => img.isPrimary) ?? product.images[0];

  return (
    <section className="space-y-4">
      <nav className="text-sm text-gray-500">
        <button type="button" onClick={() => navigate('/products')} className="hover:underline">
          Products
        </button>{' '}
        → <span className="text-gray-900">{product.name}</span>
      </nav>

      {product.isArchived && (
        <AlertBanner tone="warning" message={`${product.name} is archived.`} />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <div className="flex h-60 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          {primaryImage ? (
            <img
              src={primaryImage.url}
              alt={product.name}
              className="max-h-full max-w-full rounded"
            />
          ) : (
            <span className="text-4xl text-gray-300" aria-hidden="true">
              ▣
            </span>
          )}
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">{product.name}</h1>
            <StockStatusBadge status={product.stockStatus} isArchived={product.isArchived} />
          </div>
          <Row label="SKU" value={<span className="font-mono">{product.sku}</span>} />
          <Row label="Barcode" value={product.barcode ?? '—'} />
          <Row label="Category" value={product.categoryName ?? '—'} />
          <Row label="Cost price" value={formatMoney(product.costPrice, currency)} />
          <Row label="Selling price" value={formatMoney(product.sellingPrice, currency)} />
          <Row label="Quantity" value={String(product.quantity)} />
          <Row label="Low-stock threshold" value={String(product.lowStockThreshold)} />
          <Row label="Supplier" value={product.supplier ? product.supplier.name : '—'} />
          {product.description && <Row label="Description" value={product.description} />}
        </dl>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-gray-200 pt-4">
        <Button variant="secondary" onClick={() => setShowLabel(true)}>
          Print QR label
        </Button>
        {canManage && !product.isArchived && (
          <>
            <Button onClick={() => navigate(`/products/${id}/edit`)}>Edit</Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void runLifecycle(() => archiveProduct(id), 'Product archived.')}
            >
              Archive
            </Button>
          </>
        )}
        {canManage && product.isArchived && (
          <Button
            loading={busy}
            onClick={() => void runLifecycle(() => restoreProduct(id), 'Product restored.')}
          >
            Restore
          </Button>
        )}
        {canManage && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${product.name}`}
        size="sm"
        dismissOnOverlay={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Delete this product permanently? Products with stock history can only be archived.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showLabel} onClose={() => setShowLabel(false)} title="QR label" size="sm">
        <div className="space-y-4">
          <div className="qr-print flex justify-center">
            <QRLabel sku={product.sku} name={product.name} />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowLabel(false)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{value}</dd>
    </div>
  );
}
