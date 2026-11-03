import { describe, expect, it } from 'vitest';
import { createCheckRegistry, type ActiveJob } from './registry.js';

const job = (over: Partial<ActiveJob> = {}): ActiveJob => ({
  checkId: 1,
  projectId: 10,
  repoIds: new Set([100, 101]),
  abort: new AbortController(),
  done: Promise.resolve(),
  ...over,
});

describe('createCheckRegistry', () => {
  it('satu job per project: forProject menemukannya, add kedua untuk project yang sama ditolak', () => {
    const registry = createCheckRegistry();
    const first = job();
    registry.add(first);

    expect(registry.forProject(10)).toBe(first);
    expect(registry.forProject(11)).toBeUndefined();
    expect(() => registry.add(job({ checkId: 2 }))).toThrow(/sudah punya check berjalan/);
    registry.add(job({ checkId: 3, projectId: 11 }));
    expect(registry.forProject(11)?.checkId).toBe(3);
  });

  it('remove melepas job menurut id check; project bisa dipakai lagi', () => {
    const registry = createCheckRegistry();
    registry.add(job());
    registry.remove(99);
    expect(registry.forProject(10)).toBeDefined();

    registry.remove(1);
    expect(registry.forProject(10)).toBeUndefined();
    registry.add(job({ checkId: 2 }));
    expect(registry.forProject(10)?.checkId).toBe(2);
  });

  it('usesRepo benar hanya untuk repo yang dibaca job aktif', () => {
    const registry = createCheckRegistry();
    registry.add(job());

    expect(registry.usesRepo(100)).toBe(true);
    expect(registry.usesRepo(101)).toBe(true);
    expect(registry.usesRepo(102)).toBe(false);
    registry.remove(1);
    expect(registry.usesRepo(100)).toBe(false);
  });

  it('stopAll mengabort setiap job lalu menunggu done-nya', async () => {
    const registry = createCheckRegistry();
    let finished = false;
    const abort = new AbortController();
    const done = new Promise<void>((resolve) => {
      abort.signal.addEventListener('abort', () => {
        setTimeout(() => {
          finished = true;
          resolve();
        }, 10);
      });
    });
    registry.add(job({ abort, done }));

    await registry.stopAll();

    expect(abort.signal.aborted).toBe(true);
    expect(finished).toBe(true);
  });
});
