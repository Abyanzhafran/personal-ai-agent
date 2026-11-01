import { describe, expect, it } from 'vitest';
import { CheckEvent, EVENT_TYPES, STEP_STATUSES } from './index.js';

const step = { type: 'step', seq: 1, number: 2, name: 'Spec', status: 'done', detail: 'ok' };
const log = { type: 'log', seq: 2, at: '2026-11-01T00:00:00.000Z', category: 'git', message: 'x' };
const done = { type: 'done', seq: 3, status: 'findings' };

describe('CheckEvent', () => {
  it('menerima step, log, dan done', () => {
    for (const event of [step, log, done]) {
      expect(CheckEvent.parse(event)).toEqual(event);
    }
  });

  it('EVENT_TYPES sama dengan type di CheckEvent', () => {
    expect(CheckEvent.options.map((option) => option.shape.type.value)).toEqual([...EVENT_TYPES]);
  });

  it('nilai status langkah persis seperti kontrak', () => {
    expect([...STEP_STATUSES]).toEqual(['running', 'done', 'failed', 'skipped']);
  });

  it.each([
    ['tanpa seq', { ...step, seq: undefined }],
    ['seq nol', { ...step, seq: 0 }],
    ['seq pecahan', { ...log, seq: 1.5 }],
    ['status langkah asing', { ...step, status: 'selesai' }],
    ['type asing', { ...log, type: 'progress' }],
    ['done dengan status running', { ...done, status: 'running' }],
  ])('menolak %s', (_nama, event) => {
    expect(CheckEvent.safeParse(event).success).toBe(false);
  });
});
