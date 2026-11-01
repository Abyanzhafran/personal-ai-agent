import type { OrderDetail } from '../api/orders';
import { formatCurrency } from '../lib/format';

interface Props {
  order: OrderDetail;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu pembayaran',
  paid: 'Sudah dibayar',
  shipped: 'Dikirim',
};

// Label status untuk ringkasan; status yang tidak dikenal ditampilkan apa adanya.
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

// Jumlah baris rincian pada satu pesanan.
export function lineCount(order: OrderDetail): number {
  return order.items.length;
}

// Menampilkan total satu pesanan sebagai rupiah.
// Komponen ini tidak mengambil data sendiri; induknya yang memuat detail pesanan.
// Nilai total datang dari backend dan diformat di sini, bukan di server.
// Tidak ada penanganan total kosong karena backend selalu mengirimnya.
// Kalau tipe total berubah, tampilan ini ikut berubah.
export function OrderSummary({ order }: Props) {
  return (
    <span>{formatCurrency(order.grand_total)}</span>
  );
}
