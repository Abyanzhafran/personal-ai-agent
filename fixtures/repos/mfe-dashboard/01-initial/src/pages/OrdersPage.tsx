import { Suspense, useState } from 'react';

import { useOrders } from '../hooks/useOrders';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'pending', label: 'Menunggu pembayaran' },
  { value: 'paid', label: 'Sudah dibayar' },
  { value: 'shipped', label: 'Dikirim' },
];

interface FilterState {
  size: number;
  status: string;
  page: number;
}

function readFilters(search: string): FilterState {
  const query = new URLSearchParams(search);
  const page = Number(query.get('page') ?? '1');
  return {
    size: PAGE_SIZE,
    status: query.get('status') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function writeFilters(filters: FilterState): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.page > 1) query.set('page', String(filters.page));
  return query.toString();
}

function pageNumbers(current: number, pages: number): number[] {
  const first = Math.max(1, current - 2);
  const last = Math.min(pages, current + 2);
  const result: number[] = [];
  for (let n = first; n <= last; n += 1) result.push(n);
  return result;
}

interface StatusFilterProps {
  value: string;
  onChange: (value: string) => void;
}

function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <select
      aria-label="Filter status"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Teks ringkas filter aktif, dipakai sebagai keterangan tabel.
// Urutan: status dulu, lalu halaman.
// Tanpa filter aktif teksnya "Semua pesanan".
function describeFilters(filters: FilterState): string {
  const parts: string[] = [];
  if (filters.status) {
    const option = STATUS_OPTIONS.find((o) => o.value === filters.status);
    parts.push(option ? option.label : filters.status);
  }
  if (filters.page > 1) parts.push(`halaman ${filters.page}`);
  return parts.length > 0 ? parts.join(', ') : 'Semua pesanan';
}

interface TableProps {
  filters: FilterState;
  onPage: (page: number) => void;
}

function OrderTable({ filters, onPage }: TableProps) {
  // Jumlah halaman dihitung dari total yang dikirim backend.
  const { data } = useOrders(filters);
  const pages = Math.ceil(
    data.total / PAGE_SIZE
  );

  return (
    <section aria-label="Daftar pesanan">
      <table>
        <caption>{describeFilters(filters)}</caption>
        <thead>
          <tr>
            <th>Nomor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Halaman">
        {pageNumbers(filters.page, pages).map((n) => (
          <button key={n} type="button" aria-current={n === filters.page} onClick={() => onPage(n)}>
            {n}
          </button>
        ))}
      </nav>
    </section>
  );
}

export function OrdersPage() {
  const [filters, setFilters] = useState<FilterState>(() => readFilters(window.location.search));

  const update = (next: FilterState) => {
    setFilters(next);
    window.history.replaceState(null, '', `?${writeFilters(next)}`);
  };

  return (
    <main>
      <h1>Pesanan</h1>
      <StatusFilter value={filters.status} onChange={(status) => update({ ...filters, status, page: 1 })} />
      <Suspense fallback={<p>Memuat...</p>}>
        <OrderTable filters={filters} onPage={(page) => update({ ...filters, page })} />
      </Suspense>
    </main>
  );
}
