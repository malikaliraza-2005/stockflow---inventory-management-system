/**
 * ProductForm — UCA §5 / WIR §7-8 (F4). Shared create/edit catalog form.
 *  - create: name, SKU (blank = auto BR-04), barcode, category, description,
 *    pricing, initial quantity, low-stock threshold, supplier.
 *  - edit:   same minus initial quantity; SKU read-only (immutable BR-03);
 *    a hidden `version` drives optimistic concurrency (STALE_WRITE banner).
 *
 * `images` is added by the F5 ImageUploader. Server-echo mapping (VAL §7): 400
 * details[] → fields; DUPLICATE_SKU/BARCODE name the conflict; STALE_WRITE shows
 * a reload banner with input preserved (EC-28).
 */
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import type { Category } from '../../api/categories';
import {
  createProduct,
  updateProduct,
  type Product,
  type ProductCreateRequest,
  type ProductUpdateRequest,
} from '../../api/products';
import { messageFor } from '../../lib/errorMap';
import { productCreateSchema, productUpdateSchema } from '../../lib/validation/schemas/products';
import { AlertBanner } from '../ui/AlertBanner';
import { Button } from '../ui/Button';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { SubmitRow } from '../ui/SubmitRow';

export interface ProductFormProps {
  mode: 'create' | 'edit';
  product?: Product | undefined;
  categories: Category[];
  onSaved: (product: Product) => void;
  onCancel: () => void;
  /** Edit-only: re-fetch the product after a STALE_WRITE. */
  onReload?: (() => void) | undefined;
}

type FieldErrors = Record<string, string>;

export function ProductForm({
  mode,
  product,
  categories,
  onSaved,
  onCancel,
  onReload,
}: ProductFormProps) {
  const isEdit = mode === 'edit';

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [costPrice, setCostPrice] = useState(product?.costPrice ?? '');
  const [sellingPrice, setSellingPrice] = useState(product?.sellingPrice ?? '');
  const [initialQuantity, setInitialQuantity] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState(
    product ? String(product.lowStockThreshold) : '',
  );
  const [supplierName, setSupplierName] = useState(product?.supplier?.name ?? '');
  const [supplierContact, setSupplierContact] = useState(product?.supplier?.contactName ?? '');
  const [supplierPhone, setSupplierPhone] = useState(product?.supplier?.phone ?? '');
  const [supplierEmail, setSupplierEmail] = useState(product?.supplier?.email ?? '');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);

  // Default the category select to the first option on create.
  useEffect(() => {
    if (!isEdit && !categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [isEdit, categoryId, categories]);

  function supplierPayload() {
    if (!supplierName.trim()) return undefined;
    return {
      name: supplierName,
      ...(supplierContact.trim() ? { contactName: supplierContact } : {}),
      ...(supplierPhone.trim() ? { phone: supplierPhone } : {}),
      ...(supplierEmail.trim() ? { email: supplierEmail } : {}),
    };
  }

  function applyServerError(error: ApiError): boolean {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      const next: FieldErrors = {};
      for (const item of error.details as { field: string; message: string }[]) {
        next[item.field] ??= item.message;
      }
      setErrors(next);
      return true;
    }
    if (error.code === 'DUPLICATE_SKU') {
      setErrors({ sku: messageFor('DUPLICATE_SKU') });
      return true;
    }
    if (error.code === 'DUPLICATE_BARCODE') {
      setErrors({ barcode: error.message || messageFor('DUPLICATE_BARCODE') });
      return true;
    }
    if (error.code === 'STALE_WRITE') {
      setStale(true);
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    setStale(false);

    const raw = isEdit
      ? {
          version: product?.version,
          name,
          barcode,
          categoryId,
          description,
          costPrice,
          sellingPrice,
          lowStockThreshold: lowStockThreshold || undefined,
          supplier: supplierPayload(),
        }
      : {
          name,
          sku,
          barcode,
          categoryId,
          description,
          costPrice,
          sellingPrice,
          initialQuantity,
          lowStockThreshold: lowStockThreshold || undefined,
          supplier: supplierPayload(),
        };

    const schema = isEdit ? productUpdateSchema : productCreateSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const saved = isEdit
        ? await updateProduct(product!.id, parsed.data as ProductUpdateRequest)
        : await createProduct(parsed.data as ProductCreateRequest);
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError && !applyServerError(error)) {
        setFormError(messageFor(error.code));
      } else if (!(error instanceof ApiError)) {
        setFormError(messageFor('INTERNAL_ERROR'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-6">
      {stale && (
        <AlertBanner
          tone="warning"
          message="This product changed since you opened it. Reload and reapply your edits."
          action={
            onReload ? (
              <Button variant="secondary" onClick={onReload}>
                Reload
              </Button>
            ) : undefined
          }
        />
      )}
      {formError && (
        <p role="alert" className="text-sm text-danger-600">
          {formError}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-gray-800">Basics</legend>
        <FormField label="Name" htmlFor="p-name" error={errors.name} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...fieldAria('p-name', errors.name)}
          />
        </FormField>
        <FormField
          label="SKU"
          htmlFor="p-sku"
          error={errors.sku}
          hint={isEdit ? undefined : 'Leave blank to auto-generate from the category'}
        >
          <Input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={isEdit}
            {...fieldAria('p-sku', errors.sku, isEdit ? undefined : 'hint')}
          />
        </FormField>
        <FormField label="Barcode" htmlFor="p-barcode" error={errors.barcode}>
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            {...fieldAria('p-barcode', errors.barcode)}
          />
        </FormField>
        <FormField label="Category" htmlFor="p-category" error={errors.categoryId} required>
          <select
            id="p-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Description" htmlFor="p-description" error={errors.description}>
          <textarea
            id="p-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </FormField>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="text-sm font-semibold text-gray-800">Pricing</legend>
        <FormField label="Cost price" htmlFor="p-cost" error={errors.costPrice} required>
          <Input
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            inputMode="decimal"
            {...fieldAria('p-cost', errors.costPrice)}
          />
        </FormField>
        <FormField label="Selling price" htmlFor="p-selling" error={errors.sellingPrice} required>
          <Input
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            inputMode="decimal"
            {...fieldAria('p-selling', errors.sellingPrice)}
          />
        </FormField>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="text-sm font-semibold text-gray-800">Stock</legend>
        {!isEdit && (
          <FormField label="Initial quantity" htmlFor="p-qty" error={errors.initialQuantity}>
            <Input
              value={initialQuantity}
              onChange={(e) => setInitialQuantity(e.target.value)}
              inputMode="numeric"
              {...fieldAria('p-qty', errors.initialQuantity)}
            />
          </FormField>
        )}
        <FormField
          label="Low-stock threshold"
          htmlFor="p-threshold"
          error={errors.lowStockThreshold}
          hint={isEdit ? undefined : 'Blank uses the system default'}
        >
          <Input
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            inputMode="numeric"
            {...fieldAria('p-threshold', errors.lowStockThreshold, isEdit ? undefined : 'hint')}
          />
        </FormField>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="text-sm font-semibold text-gray-800">Supplier (optional)</legend>
        <FormField label="Supplier name" htmlFor="p-sup-name" error={errors['supplier.name']}>
          <Input
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            {...fieldAria('p-sup-name', errors['supplier.name'])}
          />
        </FormField>
        <FormField label="Contact" htmlFor="p-sup-contact">
          <Input
            value={supplierContact}
            onChange={(e) => setSupplierContact(e.target.value)}
            {...fieldAria('p-sup-contact')}
          />
        </FormField>
        <FormField label="Phone" htmlFor="p-sup-phone">
          <Input
            value={supplierPhone}
            onChange={(e) => setSupplierPhone(e.target.value)}
            {...fieldAria('p-sup-phone')}
          />
        </FormField>
        <FormField label="Email" htmlFor="p-sup-email">
          <Input
            value={supplierEmail}
            onChange={(e) => setSupplierEmail(e.target.value)}
            {...fieldAria('p-sup-email')}
          />
        </FormField>
      </fieldset>

      <SubmitRow
        onCancel={onCancel}
        submitLabel={isEdit ? 'Save changes' : 'Save product'}
        loading={loading}
      />
    </form>
  );
}
