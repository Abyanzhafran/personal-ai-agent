import { describe, expect, it } from 'vitest';
import { mapLimit } from './concurrency.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('mapLimit', () => {
  it('tidak pernah menjalankan lebih dari `limit` sekaligus, dan memakai seluruh jatah', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      peak = Math.max(peak, ++running);
      await sleep(10);
      running--;
    });
    expect(peak).toBe(3);
  });

  it('hasil mengikuti urutan item walau selesainya terbalik', async () => {
    const delays = [30, 20, 10, 0];
    expect(
      await mapLimit(delays, 4, async (ms) => {
        await sleep(ms);
        return ms;
      }),
    ).toEqual(delays);
  });

  it('daftar kosong, limit lebih besar dari jumlah item, dan limit 1 (berurutan)', async () => {
    expect(await mapLimit([], 4, async (x: number) => x)).toEqual([]);
    expect(await mapLimit([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);

    const order: string[] = [];
    await mapLimit(['a', 'b', 'c'], 1, async (x) => {
      order.push(`mulai ${x}`);
      await sleep(5);
      order.push(`selesai ${x}`);
    });
    expect(order).toEqual(['mulai a', 'selesai a', 'mulai b', 'selesai b', 'mulai c', 'selesai c']);
  });
});
