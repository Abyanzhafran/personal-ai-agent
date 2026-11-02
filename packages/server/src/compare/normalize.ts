const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;

/** Panjang `${...}` di awal `path` (kurung kurawal seimbang); 0 bila tidak diawali `${`. */
function leadingExpressionLength(path: string): number {
  if (!path.startsWith('${')) return 0;
  let depth = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i] === '{') depth++;
    else if (path[i] === '}' && --depth === 0) return i + 1;
  }
  return 0;
}

/**
 * Membuang awalan base URL: teks `base_url_pattern` profil bila path diawali olehnya, origin
 * absolut (`https://host:port`), lalu ekspresi `${...}` di awal (mis. `${import.meta.env.VITE_API_URL}`).
 */
function stripBaseUrl(path: string, baseUrlPattern: string | null | undefined): string {
  let rest = path;
  const pattern = baseUrlPattern?.trim();
  if (pattern && rest.startsWith(pattern)) rest = rest.slice(pattern.length);
  rest = rest.replace(ORIGIN, '');
  for (let end = leadingExpressionLength(rest); end > 0; end = leadingExpressionLength(rest)) {
    rest = rest.slice(end);
  }
  return rest;
}

/**
 * Path pemakaian di kode (CC-044) → bentuk yang sama dengan `normalized_path` endpoint (D-36):
 * `/api/v1/orders/${id}`, `/orders/:id`, dan `/orders/{orderId}` semuanya berakhir `.../orders/{}`.
 * Query string dan hash dibuang; segmen yang memuat `${`/`{` atau diawali `:` menjadi `{}`
 * (segmen campuran seperti `orders-${kind}` juga satu `{}`).
 *
 * `undefined` bila tidak ada segmen statis tersisa (`${url}`, `/${a}/${b}`, kosong): path dirakit
 * dinamis dan tidak bisa dicocokkan.
 */
export function normalizeUsagePath(
  path: string,
  baseUrlPattern?: string | null,
): string | undefined {
  const withoutBase = stripBaseUrl(path.trim(), baseUrlPattern).split(/[?#]/)[0] ?? '';
  const segments = withoutBase
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (segment.includes('{') || segment.startsWith(':') ? '{}' : segment));
  return segments.some((segment) => segment !== '{}') ? `/${segments.join('/')}` : undefined;
}
