// Spesifikasi API untuk fixture. Spec `base` (main) dan `head` (feature/xyz) dibuat dari satu fungsi
// supaya selisihnya persis kasus yang dijanjikan CC-090 dan tidak ada perbedaan lain.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type OrderSpecVariant = 'base' | 'head';

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Json): Json => ({ 'application/json': { schema } });
const str: Json = { type: 'string' };
const object = (properties: Record<string, Json>, required: string[]): Json => ({
  type: 'object',
  properties,
  required,
});

/**
 * Selisih head terhadap base (tujuh kasus CC-090):
 * 1. query `page_size` di GET /orders dihapus (diganti `limit` yang opsional);
 * 2. field response `total` di GET /orders dihapus;
 * 3. `currency` di body POST /orders menjadi required;
 * 4. `note` tidak pernah ada di spec (consumer Go tetap mengirimnya);
 * 5. `grand_total` di GET /orders/{order_id} berubah number -> string;
 * 6. `quantity` di GET /orders/{order_id} melebar integer -> number;
 * 7. endpoint POST /orders/{order_id}/cancel dihapus.
 */
export function orderServiceSpec(variant: OrderSpecVariant): Json {
  const head = variant === 'head';
  const orderId: Json = { name: 'order_id', in: 'path', required: true, schema: str };

  return {
    openapi: '3.0.3',
    info: { title: 'Order Service', version: '1.0.0' },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          parameters: [
            head
              ? { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }
              : { name: 'page_size', in: 'query', required: false, schema: { type: 'integer' } },
            { name: 'status', in: 'query', required: false, schema: ref('OrderStatus') },
          ],
          responses: {
            '200': { description: 'Daftar pesanan', content: json(ref('OrderList')) },
          },
        },
        post: {
          operationId: 'createOrder',
          requestBody: { required: true, content: json(ref('CreateOrderRequest')) },
          responses: {
            '201': { description: 'Pesanan dibuat', content: json(ref('OrderCreated')) },
          },
        },
      },
      '/orders/{order_id}': {
        get: {
          operationId: 'getOrder',
          parameters: [orderId],
          responses: {
            '200': { description: 'Detail pesanan', content: json(ref('OrderDetail')) },
          },
        },
      },
      ...(head
        ? {}
        : {
            '/orders/{order_id}/cancel': {
              post: {
                operationId: 'cancelOrder',
                parameters: [orderId],
                responses: { '204': { description: 'Pesanan dibatalkan' } },
              },
            },
          }),
    },
    components: {
      schemas: {
        OrderStatus: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
        OrderListItem: object({ id: str, status: ref('OrderStatus') }, ['id', 'status']),
        OrderList: object(
          {
            items: { type: 'array', items: ref('OrderListItem') },
            ...(head ? {} : { total: { type: 'integer' } }),
          },
          head ? ['items'] : ['items', 'total'],
        ),
        OrderLine: object({ id: str, sku: str, quantity: { type: head ? 'number' : 'integer' } }, [
          'id',
          'sku',
          'quantity',
        ]),
        OrderDetail: object(
          {
            id: str,
            status: ref('OrderStatus'),
            grand_total: { type: head ? 'string' : 'number' },
            items: { type: 'array', items: ref('OrderLine') },
          },
          ['id', 'status', 'grand_total', 'items'],
        ),
        CreateOrderLine: object({ sku: str, quantity: { type: 'integer' } }, ['sku', 'quantity']),
        CreateOrderRequest: object(
          {
            customer_id: str,
            items: { type: 'array', items: ref('CreateOrderLine') },
            currency: str,
          },
          head ? ['customer_id', 'items', 'currency'] : ['customer_id', 'items'],
        ),
        OrderCreated: object({ id: str, status: ref('OrderStatus') }, ['id', 'status']),
      },
    },
  };
}

/** Swagger 2 untuk svc-payment, urutan kunci seperti keluaran `swag init`. */
export function paymentSwagger(): Json {
  const payment: Json = { $ref: '#/definitions/handlers.Payment' };
  return {
    swagger: '2.0',
    info: { title: 'Payment Service', version: '1.0' },
    host: 'localhost:8081',
    basePath: '/api/v1',
    schemes: ['http'],
    paths: {
      '/payments': {
        post: {
          consumes: ['application/json'],
          produces: ['application/json'],
          summary: 'Buat pembayaran',
          operationId: 'createPayment',
          parameters: [
            {
              description: 'Data pembayaran',
              name: 'body',
              in: 'body',
              required: true,
              schema: { $ref: '#/definitions/handlers.PaymentRequest' },
            },
          ],
          responses: { '201': { description: 'Created', schema: payment } },
        },
      },
      '/payments/{id}': {
        get: {
          produces: ['application/json'],
          summary: 'Ambil pembayaran',
          operationId: 'getPayment',
          parameters: [
            {
              type: 'string',
              description: 'Nomor pembayaran',
              name: 'id',
              in: 'path',
              required: true,
            },
          ],
          responses: { '200': { description: 'OK', schema: payment } },
        },
      },
    },
    definitions: {
      'handlers.Payment': {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: str,
          id: str,
          order_id: str,
          status: str,
        },
      },
      'handlers.PaymentRequest': {
        type: 'object',
        properties: { amount: { type: 'number' }, currency: str, order_id: str },
      },
    },
  };
}

function sortKeysDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key] as Json)]),
    );
  }
  return value;
}

/** Bentuk yang di-commit: kunci terurut, indentasi rapi, newline di akhir. */
export function committedSpecText(spec: Json, indent = 2): string {
  return `${JSON.stringify(sortKeysDeep(spec), null, indent)}\n`;
}

/**
 * Pengganti generator spec sungguhan (mis. `python -c "...app.openapi()"`) agar `spec_cmd` fixture
 * tidak butuh Python atau Go terpasang. Hasilnya sengaja berbeda format dari berkas yang di-commit
 * (urutan kunci dan spasi), seperti generator nyata, jadi deteksi spec_stale harus menormalkannya.
 */
export function exportScriptText(spec: Json): string {
  return [
    '// Menulis openapi.json ke direktori kerja (dibangkitkan oleh fixtures/make-fixtures.ts).',
    "import { writeFileSync } from 'node:fs';",
    '',
    `const spec = ${JSON.stringify(spec, null, 2)};`,
    '',
    "writeFileSync('openapi.json', JSON.stringify(spec));",
    '',
  ].join('\n');
}
