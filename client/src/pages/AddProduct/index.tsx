/**
 * Add Product — WIR §7 / FR-PROD-01 (F4, Admin). Fetches categories for the
 * form's select, then renders ProductForm in create mode. On save → detail.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listCategories, type Category } from '../../api/categories';
import { ProductForm } from '../../components/domain/ProductForm';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../hooks/useToast';

export default function AddProductPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void listCategories({ limit: 100, sort: 'name', order: 'asc' }).then((r) => {
      setCategories(r.data);
      setLoaded(true);
    });
  }, []);

  return (
    <section className="max-w-2xl space-y-4">
      <nav className="text-sm text-gray-500">
        <button type="button" onClick={() => navigate('/products')} className="hover:underline">
          Products
        </button>{' '}
        → <span className="text-gray-900">New</span>
      </nav>
      <h1 className="text-xl font-semibold text-gray-900">Add product</h1>
      {loaded ? (
        <ProductForm
          mode="create"
          categories={categories}
          onSaved={(p) => {
            toast.success('Product created.');
            navigate(`/products/${p.id}`);
          }}
          onCancel={() => navigate('/products')}
        />
      ) : (
        <Spinner />
      )}
    </section>
  );
}
