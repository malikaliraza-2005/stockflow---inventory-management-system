/**
 * Edit Product — WIR §8 / FR-PROD-02 (F4, Admin). Fetches the product +
 * categories, renders ProductForm in edit mode. The form is keyed by `version`
 * so a STALE_WRITE reload (onReload → refetch) re-seeds it with the fresh
 * version and server values.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { listCategories, type Category } from '../../api/categories';
import { getProduct } from '../../api/products';
import { ProductForm } from '../../components/domain/ProductForm';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useQueryState } from '../../hooks/useQueryState';
import { useToast } from '../../hooks/useToast';

export default function EditProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: product, loading, error, refetch } = useQueryState(() => getProduct(id), [id]);

  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    void listCategories({ limit: 100, sort: 'name', order: 'asc' }).then((r) =>
      setCategories(r.data),
    );
  }, []);

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

  return (
    <section className="max-w-2xl space-y-4">
      <nav className="text-sm text-gray-500">
        <button type="button" onClick={() => navigate('/products')} className="hover:underline">
          Products
        </button>{' '}
        → <span className="text-gray-900">{product.name}</span> → Edit
      </nav>
      <h1 className="text-xl font-semibold text-gray-900">Edit {product.name}</h1>
      <ProductForm
        key={product.version} // reload after STALE_WRITE re-seeds the form
        mode="edit"
        product={product}
        categories={categories}
        onSaved={(p) => {
          toast.success('Changes saved.');
          navigate(`/products/${p.id}`);
        }}
        onCancel={() => navigate(`/products/${id}`)}
        onReload={refetch}
      />
    </section>
  );
}
