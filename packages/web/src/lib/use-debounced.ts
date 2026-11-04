import { useEffect, useState } from 'react';

/** Nilai yang mengikuti `value` setelah `ms` tanpa perubahan; render pertama langsung memakai nilai awal. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
