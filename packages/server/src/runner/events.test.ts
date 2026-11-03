import { CheckEvent, type CheckEvent as CheckEventType } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { createCheckEvents, STEP_NAMES } from './events.js';

const NOW = new Date('2026-11-03T13:42:01.000Z');

function setup() {
  const events = createCheckEvents({ now: () => NOW });
  events.open(7);
  return { events, report: events.reporter(7) };
}

const received = (events: ReturnType<typeof createCheckEvents>, checkId = 7) => {
  const seen: CheckEventType[] = [];
  const subscription = events.subscribe(checkId, (event) => seen.push(event));
  return { seen, subscription };
};

describe('createCheckEvents', () => {
  it('seq naik dari 1; semua event lolos skema CheckEvent', () => {
    const { events, report } = setup();

    report.log('start', 'check #7');
    report.step(1, 'running');
    report.step(1, 'done', 'merge-base a1b2c3d');
    events.emit(7, { type: 'done', status: 'clean' });

    const { subscription } = received(events);
    expect(subscription?.replay.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    for (const event of subscription?.replay ?? []) expect(CheckEvent.parse(event)).toEqual(event);
    expect(subscription?.replay[0]).toEqual({
      type: 'log',
      seq: 1,
      at: NOW.toISOString(),
      category: 'start',
      message: 'check #7',
    });
    expect(subscription?.replay[2]).toMatchObject({
      type: 'step',
      number: 1,
      name: STEP_NAMES[0],
      status: 'done',
      detail: 'merge-base a1b2c3d',
    });
  });

  it('klien yang telat menerima event sebelumnya lalu event baru, tanpa celah atau duplikat', () => {
    const { events, report } = setup();
    report.step(1, 'done');
    report.step(2, 'done');
    report.step(3, 'running', '1 dari 5 file selesai');

    const { seen, subscription } = received(events);
    report.step(3, 'running', '2 dari 5 file selesai');

    expect(subscription?.replay.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(seen.map((e) => e.seq)).toEqual([4]);
    expect(subscription?.finished).toBe(false);
  });

  it('done menutup aliran: event sesudahnya diabaikan dan langganan baru langsung selesai', () => {
    const { events, report } = setup();
    const { seen } = received(events);

    events.emit(7, { type: 'done', status: 'findings' });
    report.log('extract', 'terlambat');

    expect(seen.map((e) => e.type)).toEqual(['done']);
    const late = received(events).subscription;
    expect(late?.finished).toBe(true);
    expect(late?.replay).toHaveLength(1);
    expect(events.listenerCount(7)).toBe(0);
  });

  it('unsubscribe melepas pendengar; pendengar yang melempar tidak menghentikan emit', () => {
    const { events, report } = setup();
    const { seen, subscription } = received(events);
    events.subscribe(7, () => {
      throw new Error('soket putus');
    });
    expect(events.listenerCount(7)).toBe(2);

    report.log('grep', 'a');
    subscription?.unsubscribe();
    report.log('grep', 'b');

    expect(seen.map((e) => (e.type === 'log' ? e.message : ''))).toEqual(['a']);
    expect(events.listenerCount(7)).toBe(1);
  });

  it('failRunning menandai langkah yang sedang berjalan; tanpa langkah berjalan tidak ada event', () => {
    const { events, report } = setup();
    report.failRunning('tidak ada');
    report.step(1, 'done');
    report.step(2, 'running');
    report.failRunning('git grep gagal');
    report.failRunning('sekali saja');

    const steps = (received(events).subscription?.replay ?? []).filter((e) => e.type === 'step');
    expect(steps.map((e) => (e.type === 'step' ? [e.number, e.status, e.detail] : []))).toEqual([
      [1, 'done', ''],
      [2, 'running', ''],
      [2, 'failed', 'git grep gagal'],
    ]);
  });

  it('check tanpa buffer → subscribe undefined; hanya 20 check selesai terakhir yang disimpan', () => {
    const { events } = setup();
    expect(events.subscribe(99, () => undefined)).toBeUndefined();

    for (let id = 100; id < 125; id++) {
      events.open(id);
      events.emit(id, { type: 'done', status: 'clean' });
    }

    expect(events.subscribe(100, () => undefined)).toBeUndefined(); // dibuang
    expect(events.subscribe(104, () => undefined)).toBeUndefined();
    expect(events.subscribe(105, () => undefined)?.finished).toBe(true);
    expect(events.subscribe(7, () => undefined)?.finished).toBe(false); // masih berjalan, tidak dibuang
  });
});
