/** NotFoundPage — the ratified 404 (SMP §9 / UCA §4). Stateless. */
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="mx-auto mt-16 max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">Page not found</h1>
      <p className="text-sm text-gray-600">That page doesn't exist — or hasn't shipped yet.</p>
      <Link to="/" className="text-sm text-brand-600 hover:underline">
        Back to Dashboard
      </Link>
    </section>
  );
}
