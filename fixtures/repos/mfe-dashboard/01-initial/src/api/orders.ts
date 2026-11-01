import { http } from './http';

export interface Params {
  size: number;
  status?: string;
}

export interface OrderListItem {
  id: string;
  status: string;
}

export interface OrderList {
  items: OrderListItem[];
  total: number;
}

export interface OrderLine {
  id: string;
  sku: string;
  quantity: number;
}

export interface OrderDetail {
  id: string;
  status: string;
  grand_total: number;
  items: OrderLine[];
}

/**
 * Daftar pesanan untuk dashboard.
 * Filter status bersifat opsional; ukuran halaman dikirim apa adanya ke backend.
 * Mengembalikan isi body (lihat interceptor di http.ts).
 * Dipakai lewat hook useOrders.
 *
 * Catatan: pemanggil tidak perlu membungkus hasilnya lagi;
 * penanganan galat jaringan ada di interceptor dan di lapisan query.
 */
export const listOrders = (p: Params) =>
  http.get('/orders', {
    params: { page_size: p.size, status: p.status },
  });

export const getOrder = (id: string) => http.get(`/orders/${id}`);
