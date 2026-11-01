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
