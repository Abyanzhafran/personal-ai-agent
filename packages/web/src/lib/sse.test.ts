import type { CheckEvent } from '@cc/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckEvents } from './sse';

/** jsdom tidak punya EventSource. Penyambungan ulang adalah tugas browser; test meniru akibatnya. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(event: CheckEvent) {
    const message = new MessageEvent(event.type, { data: JSON.stringify(event) });
    for (const listener of this.listeners.get(event.type) ?? []) listener(message);
  }
}

const step = (seq: number): CheckEvent => ({
  type: 'step',
  seq,
  number: seq,
  name: `Langkah ${seq}`,
  status: 'done',
  detail: '',
});
const done: CheckEvent = { type: 'done', seq: 3, status: 'clean' };
const seqs = (events: CheckEvent[]) => events.map((event) => event.seq);
const current = () => FakeEventSource.instances.at(-1) as FakeEventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('useCheckEvents', () => {
  it('menyambung ke endpoint check dan mengumpulkan event berurutan', () => {
    const { result } = renderHook(() => useCheckEvents(7));
    expect(current().url).toBe('/api/checks/7/events');

    act(() => current().emit(step(1)));
    act(() => current().emit({ type: 'log', seq: 2, at: 't', category: 'git', message: 'm' }));

    expect(result.current.map((event) => event.type)).toEqual(['step', 'log']);
  });

  it('koneksi putus lalu tersambung ulang (buffer dikirim ulang) tidak menggandakan event', () => {
    const { result } = renderHook(() => useCheckEvents(7));
    act(() => current().emit(step(1)));
    act(() => current().emit(step(2)));

    // Browser menyambung ulang pada objek EventSource yang sama; server mengirim ulang dari awal.
    act(() => current().emit(step(1)));
    act(() => current().emit(step(2)));
    act(() => current().emit(step(3)));

    expect(seqs(result.current)).toEqual([1, 2, 3]);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(current().closed).toBe(false);
  });

  it('menutup koneksi saat done supaya browser tidak menyambung lagi', () => {
    const { result } = renderHook(() => useCheckEvents(7));
    act(() => current().emit(step(1)));
    act(() => current().emit(step(2)));
    act(() => current().emit(done));

    expect(result.current.at(-1)).toEqual(done);
    expect(current().closed).toBe(true);
  });

  it('menutup koneksi saat unmount', () => {
    const { unmount } = renderHook(() => useCheckEvents(7));
    unmount();
    expect(current().closed).toBe(true);
  });

  it('pindah check: koneksi lama ditutup, koneksi baru mulai dari daftar kosong', () => {
    const { result, rerender } = renderHook(({ id }) => useCheckEvents(id), {
      initialProps: { id: 7 },
    });
    act(() => current().emit(step(1)));
    const first = current();

    rerender({ id: 8 });

    expect(first.closed).toBe(true);
    expect(current().url).toBe('/api/checks/8/events');
    expect(result.current).toEqual([]);
  });

  it('event yang tidak sesuai skema melempar galat, bukan dibuang diam-diam', () => {
    renderHook(() => useCheckEvents(7));
    expect(() => current().emit({ type: 'step', seq: 1 } as CheckEvent)).toThrow();
  });
});
