/**
 * SearchInput — UCA §3.1 (first consumer F2): local draft state, debounced
 * commit (300 ms), reachable clear button. The COMMITTED value lives in the
 * page's URL params (SMA §2) — this component only debounces the draft.
 */
import { useEffect, useRef, useState } from 'react';

export interface SearchInputProps {
  value: string;
  onDebouncedChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  label?: string;
}

export function SearchInput({
  value,
  onDebouncedChange,
  placeholder = 'Search…',
  debounceMs = 300,
  label = 'Search',
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // Adopt external value changes (e.g. URL param reset) without firing back
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return undefined;
    const timer = setTimeout(() => {
      committed.current = draft;
      onDebouncedChange(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [draft, debounceMs, onDebouncedChange]);

  return (
    <div className="relative">
      <input
        type="search"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded-md border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-brand-500"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setDraft('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      )}
    </div>
  );
}
