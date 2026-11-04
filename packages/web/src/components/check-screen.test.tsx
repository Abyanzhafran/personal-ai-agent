import type { CheckDetail, CheckEvent, CheckStatus } from '@cc/shared';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fetchMock, json, renderAt, serve } from '../test-utils';

let seq = 0;
beforeEach(() => {
  seq = 0;
  FakeEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

// Jam lokal, sama seperti yang ditampilkan layar, supaya test tidak bergantung zona waktu.
const clock = (second: number) => new Date(2026, 10, 4, 13, 42, second).toISOString();

const detail = (status: CheckStatus, error: string | null = null): CheckDetail => ({
  check: {
    id: 31,
    project_id: 1,
    provider_repo_id: 11,
    base_ref: 'main',
    head_ref: 'feature/xyz',
    base_sha: null,
    head_sha: null,
    status,
    started_at: clock(0),
    finished_at: status === 'running' ? null : clock(20),
    error,
  },
  project_name: 'Order Platform',
  provider_repo_name: 'svc-order',
  findings: [],
  summary: null,
});

const step = (
  number: number,
  status: 'running' | 'done' | 'failed' | 'skipped',
  text = '',
): CheckEvent => ({
  type: 'step',
  seq: ++seq,
  number,
  name: `Langkah ${number}`,
  status,
  detail: text,
});
const log = (second: number, category: string, message: string): CheckEvent => ({
  type: 'log',
  seq: ++seq,
  at: clock(second),
  category,
  message,
});
const finish = (status: 'clean' | 'findings' | 'failed' | 'cancelled'): CheckEvent => ({
  type: 'done',
  seq: ++seq,
  status,
});

const source = () => FakeEventSource.instances.at(-1) as FakeEventSource;
const emit = (...events: CheckEvent[]) =>
  act(() => {
    for (const event of events) source().emit(event);
  });

const HISTORY = 'GET /api/checks?page=1&page_size=25';
const emptyHistory = () => ({
  items: [],
  page: 1,
  page_size: 25,
  total_items: 0,
  counts: { total: 0, by_project: [] },
});

/** Layar terbuka dan koneksi SSE-nya sudah tersambung. */
async function openRunning(extra: Record<string, () => unknown> = {}) {
  serve({ 'GET /api/checks/31': () => detail('running'), ...extra });
  const view = renderAt('/checks/31');
  await screen.findByRole('heading', { level: 1, name: 'Check berjalan' });
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  return view;
}

const stepRows = () =>
  within(screen.getByRole('list', { name: 'Langkah check' })).getAllByRole('listitem');
const statuses = () => stepRows().map((row) => row.getAttribute('data-status'));

describe('Check berjalan', () => {
  it('header memuat provider, ref, dan jam mulai; semua langkah menunggu sebelum ada event', async () => {
    await openRunning();

    expect(screen.getByText('svc-order · main → feature/xyz · dimulai 13:42')).toBeTruthy();
    expect(source().url).toBe('/api/checks/31/events');
    expect(statuses()).toEqual(Array(6).fill('waiting'));
    expect(stepRows().map((row) => row.textContent)).toEqual([
      '1. Resolve ref + diff specMenunggudeterministik',
      '2. Cari consumerMenunggu diff specdeterministik',
      '3. Ekstraksi pemakaian API (hop 1)Menunggu pencarian consumerClaude',
      '4. Cari pemakai simbol (hop 2)Menunggu hop 1git grep + Claude',
      '5. BandingkanMenunggu ekstraksideterministik',
      '6. LaporanMenunggu perbandingandeterministik',
    ]);
    expect(screen.getByText('Langkah 1 dari 6')).toBeTruthy();
  });

  it('event SSE menggerakkan langkah, progres, dan log tanpa polling', async () => {
    await openRunning();

    emit(
      log(1, 'start', 'check #31 · svc-order · main → feature/xyz'),
      step(1, 'running'),
      step(
        1,
        'done',
        'merge-base a1b2c3d · 5 perubahan breaking di 3 endpoint · spec_stale: tidak',
      ),
      step(2, 'running'),
      step(2, 'done', '11 file kandidat di 3 repo (git grep) · repo e2e dilewati'),
      step(3, 'running', '7 dari 11 file selesai · 4 dari cache · batas 40 file per check'),
      log(19, 'extract', 'src/api/orders.ts (cache)'),
    );

    expect(statuses()).toEqual(['done', 'done', 'running', 'waiting', 'waiting', 'waiting']);
    const rows = stepRows().map((row) => row.textContent);
    expect(rows[0]).toContain('merge-base a1b2c3d · 5 perubahan breaking di 3 endpoint');
    expect(rows[2]).toContain('7 dari 11 file selesai · 4 dari cache · batas 40 file per check');
    expect(screen.getByText('Langkah 3 dari 6')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Progres check' }).getAttribute('aria-valuenow'),
    ).toBe('50');
    expect(screen.getByRole('log', { name: 'Log' }).textContent).toBe(
      '13:42:01startcheck #31 · svc-order · main → feature/xyz13:42:19extractsrc/api/orders.ts (cache)',
    );
    // Hanya pemuatan awal detail check: kemajuan datang dari SSE, bukan polling.
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/checks/31')).toHaveLength(1);
  });

  it('refresh di tengah check: buffer yang dikirim ulang memulihkan langkah tanpa menggandakan log', async () => {
    await openRunning();
    const buffer = [
      step(1, 'running'),
      step(1, 'done', 'merge-base a1b2c3d'),
      log(2, 'grep', '11 candidate files in 3 repos'),
      step(2, 'running'),
    ];

    emit(...buffer);
    emit(...buffer); // sambung ulang: server mengirim buffer dari awal

    expect(statuses()).toEqual(['done', 'running', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(screen.getByRole('log', { name: 'Log' }).textContent).toBe(
      '13:42:02grep11 candidate files in 3 repos',
    );
    expect(screen.getByText('Langkah 2 dari 6')).toBeTruthy();
  });

  it('langkah gagal dan dilewati punya status sendiri; progres berhenti di langkah terakhir yang terlihat', async () => {
    await openRunning();

    emit(
      step(1, 'done'),
      step(2, 'failed', 'git grep gagal'),
      step(3, 'skipped'),
      step(4, 'skipped'),
      step(5, 'skipped'),
    );

    expect(statuses()).toEqual(['done', 'failed', 'skipped', 'skipped', 'skipped', 'waiting']);
    expect(
      stepRows().map((row) => within(row).getByRole('img').getAttribute('aria-label')),
    ).toEqual(['Selesai', 'Gagal', 'Dilewati', 'Dilewati', 'Dilewati', 'Menunggu']);
    expect(screen.getByText('Langkah 5 dari 6')).toBeTruthy();
  });

  it('Batalkan meminta konfirmasi; "Lanjutkan check" menutupnya tanpa membatalkan', async () => {
    await openRunning();

    await userEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Batalkan check?' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Lanjutkan check' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);
  });

  it('konfirmasi membatalkan lalu berpindah ke riwayat', async () => {
    let cancelled = false;
    const { router } = await openRunning({
      'GET /api/checks/31': () => detail(cancelled ? 'cancelled' : 'running'),
      'POST /api/checks/31/cancel': () => {
        cancelled = true;
        return detail('cancelled').check;
      },
      'GET /api/projects': () => [],
      [HISTORY]: () =>
        cancelled
          ? {
              ...emptyHistory(),
              items: [
                {
                  ...detail('cancelled').check,
                  project_name: 'Order Platform',
                  provider_repo_name: 'svc-order',
                  counts: null,
                  spec_stale: false,
                },
              ],
              total_items: 1,
            }
          : emptyHistory(),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batalkan check' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/checks/31/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Checks' })).toBeTruthy();
    // Riwayat menampilkan check itu dengan status Dibatalkan.
    expect(await screen.findByText('Dibatalkan')).toBeTruthy();
  });

  it('event done memuat ulang check dan layar pindah dari progres ke tampilan selesai', async () => {
    let status: CheckStatus = 'running';
    await openRunning({ 'GET /api/checks/31': () => detail(status) });
    emit(step(1, 'done'), step(6, 'done', '7 finding disimpan'));

    status = 'findings';
    emit(finish('findings'));

    const screenEl = await screen.findByTestId('screen');
    expect(screenEl.getAttribute('data-route')).toBe('/checks/$checkId');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('check yang tidak berjalan', () => {
  it('check yang sudah selesai langsung ke tampilan selesai tanpa membuka SSE', async () => {
    serve({ 'GET /api/checks/31': () => detail('clean') });
    renderAt('/checks/31');

    expect((await screen.findByTestId('screen')).getAttribute('data-route')).toBe(
      '/checks/$checkId',
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('check tidak ada → pesan, bukan layar kosong', async () => {
    serve({
      'GET /api/checks/31': () =>
        json(
          { error: { code: 'check_not_found', message: 'Check tidak ditemukan', details: null } },
          404,
        ),
    });
    renderAt('/checks/31');

    expect(await screen.findByText('Check tidak ditemukan.')).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
