/**
 * Menjalankan `fn` untuk tiap item dengan paling banyak `limit` yang berjalan bersamaan. Hasil
 * mengikuti urutan `items`. `fn` tidak boleh melempar: galat per item harus dijadikan nilai hasil,
 * supaya satu kegagalan tidak membatalkan item lain.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Pintu antre untuk pekerjaan yang datang satu-satu (bukan daftar yang sudah ada): `run(fn)`
 * menjalankan `fn` bila jatah `limit` masih ada, selain itu menunggu giliran (urutan datang).
 * Galat dari `fn` merambat ke pemanggil dan jatahnya tetap dilepas.
 */
export function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (fn) => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      // Jatah diserahkan langsung ke antrean terdepan; `active` tidak turun-naik di antaranya.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
