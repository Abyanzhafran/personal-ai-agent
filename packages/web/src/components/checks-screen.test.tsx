import type { CheckListItem } from '@cc/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMock, json, project, renderAt, repo, serve } from '../test-utils';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const PROJECTS = [project(1, 'Order Platform'), project(2, 'Billing')];
const NOT_READY = 'Tambahkan minimal satu repo service dan satu repo lain.';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ORDER_REPOS = [
  repo({ id: 11, name: 'svc-order', spec_path: 'api/openapi.yaml', last_fetch_at: minutesAgo(9) }),
  repo({ id: 12, name: 'svc-payment', last_fetch_at: minutesAgo(3) }),
  repo({
    id: 13,
    name: 'mfe-dashboard',
    role: 'microfrontend',
    last_fetch_at: minutesAgo(5),
  }),
  repo({ id: 14, name: 'e2e-suite', role: 'e2e' }),
];
const BILLING_REPOS = [
  repo({ id: 21, project_id: 2, name: 'svc-invoice', default_branch: 'develop' }),
  repo({ id: 22, project_id: 2, name: 'svc-ledger', role: 'microfrontend' }),
];
const REFS = [
  { name: 'main', kind: 'branch', sha: SHA },
  { name: 'feature/xyz', kind: 'branch', sha: SHA },
  { name: 'v1.0', kind: 'tag', sha: SHA },
];

const COUNTS = {
  total: 8,
  by_project: [
    { project_id: 2, name: 'Billing', count: 2 },
    { project_id: 1, name: 'Order Platform', count: 6 },
  ],
};

const item = (fields: Partial<CheckListItem> & Pick<CheckListItem, 'id'>): CheckListItem => ({
  project_id: 1,
  provider_repo_id: 11,
  base_ref: 'main',
  head_ref: 'feature/xyz',
  base_sha: null,
  head_sha: null,
  status: 'clean',
  started_at: minutesAgo(10),
  finished_at: minutesAgo(9),
  error: null,
  project_name: 'Order Platform',
  provider_repo_name: 'svc-order',
  counts: { break: 0, warn: 0, info: 0 },
  spec_stale: false,
  ...fields,
});

const page = (items: CheckListItem[], extra: Record<string, unknown> = {}) => ({
  items,
  page: 1,
  page_size: 25,
  total_items: items.length,
  counts: COUNTS,
  ...extra,
});

const FIRST_PAGE = 'GET /api/checks?page=1&page_size=25';

/** API dasar: dua project (Order siap, Billing belum), tiap daftar dijawab; `extra` menimpa. */
const withApi = (extra: Record<string, () => unknown> = {}) =>
  serve({
    'GET /api/projects': () => PROJECTS,
    'GET /api/projects/1': () => ({
      ...PROJECTS[0],
      ready_for_check: true,
      not_ready_reason: null,
    }),
    'GET /api/projects/1/repos': () => ORDER_REPOS,
    'GET /api/projects/2': () => ({
      ...PROJECTS[1],
      ready_for_check: false,
      not_ready_reason: NOT_READY,
    }),
    'GET /api/projects/2/repos': () => BILLING_REPOS,
    'GET /api/repos/11/refs': () => REFS,
    'GET /api/repos/21/refs': () => [],
    [FIRST_PAGE]: () => page([item({ id: 1 })]),
    ...extra,
  });

const runButton = () => screen.findByRole('button', { name: 'Jalankan check' });
const field = (label: string) => screen.findByLabelText<HTMLInputElement>(label);

/** Sel tiap baris data tabel riwayat, urut kolom (header dilewati). */
async function historyRows() {
  const table = await screen.findByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
}

const postedBody = () => {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/checks' && init?.method === 'POST',
  );
  return JSON.parse(call?.[1]?.body as string) as unknown;
};

describe('form Check baru', () => {
  it('provider hanya repo service, base terisi default branch, consumer tanpa provider dan e2e', async () => {
    withApi();
    renderAt('/checks');

    const provider = await screen.findByRole('combobox', { name: 'Provider (service)' });
    await waitFor(() =>
      expect(
        within(provider)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['svc-order', 'svc-payment']),
    );
    expect((await field('Base ref')).value).toBe('main');
    expect(screen.getByText('Spec: api/openapi.yaml')).toBeTruthy();
    const sentence = screen.getByText('Consumer dicari di').parentElement as HTMLElement;
    expect(
      within(sentence)
        .getAllByText(/^(svc|mfe|e2e)/)
        .map((code) => code.textContent),
    ).toEqual(['svc-payment', 'mfe-dashboard']);
    expect(within(sentence).getByText('Repo e2e dikecualikan.')).toBeTruthy();
  });

  it('Fetch terakhir memakai last_fetch_at terbaru dari semua repo project (CC-065 AC3)', async () => {
    withApi();
    renderAt('/checks');
    expect(await screen.findByText('Fetch terakhir: 3 menit lalu')).toBeTruthy();
  });

  it('ganti project memuat ulang provider, ref, dan consumer', async () => {
    withApi();
    renderAt('/checks');
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Project' }),
      'Billing',
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/2/repos', expect.anything()),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/21/refs', expect.anything());
    const provider = screen.getByRole('combobox', { name: 'Provider (service)' });
    await waitFor(() =>
      expect(
        within(provider)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['svc-invoice']),
    );
    expect((await field('Base ref')).value).toBe('develop');
    expect(screen.getByText('svc-ledger')).toBeTruthy();
    expect(screen.queryByText('Repo e2e dikecualikan.')).toBeNull();
  });

  it('tombol nonaktif tanpa head ref; project belum siap menampilkan not_ready_reason', async () => {
    withApi();
    renderAt('/checks');
    const run = await runButton();
    await waitFor(() => expect(screen.getByRole('option', { name: 'svc-order' })).toBeTruthy());
    expect((run as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(await field('Head ref'), 'feature/xyz');
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Billing');
    await userEvent.type(await field('Head ref'), 'feature/x');
    expect(await screen.findByText(NOT_READY)).toBeTruthy();
    expect((run as HTMLButtonElement).disabled).toBe(true);
  });

  it('strip info: ref yang dibaca dan merge-base; ref yang tidak ada tampil sebagai pesan', async () => {
    withApi({
      'GET /api/repos/11/compare?base=main&head=feature%2Fxyz': () => ({
        base_sha: SHA,
        head_sha: SHA,
        merge_base: SHA,
      }),
      'GET /api/repos/11/compare?base=main&head=feature%2Fhilang': () =>
        json(
          {
            error: {
              code: 'ref_not_found',
              message: 'origin/feature/hilang tidak ada',
              details: null,
            },
          },
          404,
        ),
    });
    renderAt('/checks');
    const head = await field('Head ref');

    await userEvent.type(head, 'feature/xyz');
    expect(await screen.findByText('Dibaca dari origin/main dan origin/feature/xyz')).toBeTruthy();
    expect(await screen.findByText('Merge-base: a1b2c3d')).toBeTruthy();

    await userEvent.clear(head);
    await userEvent.type(head, 'feature/hilang');
    expect((await screen.findByRole('alert')).textContent).toBe('origin/feature/hilang tidak ada');
  });

  it('Jalankan check mengirim provider dan ref lalu pindah ke check itu', async () => {
    withApi({
      'POST /api/checks': () => ({
        id: 31,
        project_id: 1,
        provider_repo_id: 11,
        base_ref: 'main',
        head_ref: 'feature/xyz',
        base_sha: null,
        head_sha: null,
        status: 'running',
        started_at: minutesAgo(0),
        finished_at: null,
        error: null,
      }),
    });
    const { router } = renderAt('/checks');
    await waitFor(() => expect(screen.getByRole('option', { name: 'svc-order' })).toBeTruthy());
    await userEvent.type(await field('Head ref'), 'feature/xyz');
    const run = await runButton();
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));

    await userEvent.click(run);

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks/31'));
    expect(postedBody()).toEqual({
      provider_repo_id: 11,
      head_ref: 'feature/xyz',
      base_ref: 'main',
    });
  });

  it('409 check sedang berjalan → diarahkan ke check milik project itu', async () => {
    withApi({
      'POST /api/checks': () =>
        json(
          {
            error: {
              code: 'check_already_running',
              message: 'Project ini sudah punya check yang sedang berjalan. Tunggu sampai selesai.',
              details: { project_id: 1, check_id: 7 },
            },
          },
          409,
        ),
    });
    const { router } = renderAt('/checks');
    await waitFor(() => expect(screen.getByRole('option', { name: 'svc-order' })).toBeTruthy());
    await userEvent.type(await field('Head ref'), 'feature/xyz');
    const run = await runButton();
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));

    await userEvent.click(run);

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks/7'));
  });

  it('Fetch sekarang memanggil fetch project lalu memuat ulang Fetch terakhir', async () => {
    let fetched = false;
    const now = () => new Date().toISOString();
    withApi({
      'GET /api/projects/1/repos': () =>
        fetched ? ORDER_REPOS.map((r) => ({ ...r, last_fetch_at: now() })) : ORDER_REPOS,
      'POST /api/projects/1/fetch': () => {
        fetched = true;
        return ORDER_REPOS.map((r) => ({
          repo_id: r.id,
          name: r.name,
          ok: true,
          error: null,
          last_fetch_at: now(),
        }));
      },
    });
    renderAt('/checks');
    await screen.findByText('Fetch terakhir: 3 menit lalu');

    await userEvent.click(screen.getByRole('button', { name: 'Fetch sekarang' }));

    expect(await screen.findByText('Fetch terakhir: baru saja')).toBeTruthy();
  });

  it('tanpa project: pesan di form, riwayat tetap tampil', async () => {
    withApi({
      'GET /api/projects': () => [],
      [FIRST_PAGE]: () => page([], { counts: { total: 0, by_project: [] } }),
    });
    renderAt('/checks');
    expect(
      await screen.findByText('Belum ada project. Buat project di halaman Projects dulu.'),
    ).toBeTruthy();
    expect(await screen.findByText('Belum ada check.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Jalankan check' })).toBeNull();
  });
});

describe('riwayat', () => {
  const at = (daysAgo: number, hour: number, minute: number) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const span = (start: Date, seconds: number) => ({
    started_at: start.toISOString(),
    finished_at: new Date(start.getTime() + seconds * 1000).toISOString(),
  });

  it('delapan kolom; chip hasil per status; spec_stale tidak dihitung ganda sebagai warn', async () => {
    withApi({
      [FIRST_PAGE]: () =>
        page([
          item({
            id: 128,
            status: 'findings',
            counts: { break: 3, warn: 2, info: 1 },
            ...span(at(0, 13, 43), 48),
          }),
          item({
            id: 127,
            provider_repo_name: 'svc-payment',
            status: 'findings',
            counts: { break: 0, warn: 1, info: 0 },
            spec_stale: true,
            ...span(at(1, 17, 20), 31),
          }),
          item({ id: 126, ...span(new Date(2020, 9, 25, 9, 14), 12) }),
          item({ id: 125, status: 'cancelled', counts: null }),
          item({ id: 124, status: 'running', counts: null, finished_at: null }),
        ]),
    });
    renderAt('/checks');

    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['#', 'Waktu', 'Project', 'Provider', 'Base → Head', 'Hasil', 'Durasi', '']);
    const rows = await historyRows();
    /** Teks sel (baris, kolom) dari data tabel. */
    const cell = (row: number, column: number) => rows[row]?.[column]?.textContent;

    expect(rows.map((_, row) => cell(row, 0))).toEqual(['128', '127', '126', '125', '124']);
    expect(cell(0, 1)).toBe('Hari ini, 13:43');
    expect(cell(1, 1)).toBe('Kemarin, 17:20');
    expect(cell(2, 1)).toBe('25 Okt, 09:14');
    expect(cell(0, 2)).toBe('Order Platform');
    expect(cell(1, 3)).toBe('svc-payment');
    expect(cell(0, 4)).toBe('main → feature/xyz');
    expect(cell(0, 5)).toBe('3 break2 warn1 info');
    expect(cell(1, 5)).toBe('spec_stale');
    expect(cell(2, 5)).toBe('Bersih');
    expect(cell(3, 5)).toBe('Dibatalkan');
    expect(cell(4, 5)).toBe('Berjalan');
    expect(cell(0, 6)).toBe('48 dtk');
    expect(cell(4, 6)).toBe('—');
    expect(
      within(rows[0]?.[7] as HTMLElement)
        .getByRole('link', { name: 'Buka check #128' })
        .getAttribute('href'),
    ).toBe('/checks/128');
  });

  it('baris Gagal menampilkan chip Gagal dan alasannya di sampingnya', async () => {
    withApi({
      [FIRST_PAGE]: () =>
        page([
          item({
            id: 123,
            status: 'failed',
            counts: null,
            error: 'origin/feature/old tidak ada',
          }),
        ]),
    });
    renderAt('/checks');

    const [row] = await historyRows();
    expect(row?.[5]?.textContent).toBe('Gagalorigin/feature/old tidak ada');
  });

  it('chip filter menampilkan jumlah yang sama dengan hasil filter dan tidak berubah saat dipilih', async () => {
    const six = Array.from({ length: 6 }, (_, index) => item({ id: 100 + index }));
    withApi({
      'GET /api/checks?project=1&page=1&page_size=25': () => page(six),
    });
    const { router } = renderAt('/checks');
    const chips = await screen.findByRole('group', { name: 'Filter project' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Semua 8', 'Billing 2', 'Order Platform 6']);

    await userEvent.click(within(chips).getByRole('button', { name: 'Order Platform 6' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ project: 1 }));
    await waitFor(async () => expect(await historyRows()).toHaveLength(6));
    expect(
      within(chips).getByRole('button', { name: 'Order Platform 6' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(chips).getByRole('button', { name: 'Semua 8' })).toBeTruthy();
    expect(screen.getByText('Order Platform · 6 check')).toBeTruthy();
  });

  it('pagination: halaman berikutnya, ukuran halaman kembali ke halaman 1, tersimpan di URL', async () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => item({ id: from - index }));
    withApi({
      [FIRST_PAGE]: () => page(rows(60, 25), { total_items: 60 }),
      'GET /api/checks?page=2&page_size=25': () => page(rows(35, 25), { page: 2, total_items: 60 }),
      'GET /api/checks?page=1&page_size=10': () =>
        page(rows(60, 10), { page_size: 10, total_items: 60 }),
    });
    const { router } = renderAt('/checks');
    expect(await screen.findByText('1–25 dari 60')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Halaman sebelumnya' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    expect(await screen.findByText('26–50 dari 60')).toBeTruthy();
    expect(router.state.location.search).toEqual({ page: 2 });

    await userEvent.selectOptions(screen.getByLabelText('Baris per halaman'), '10');
    expect(await screen.findByText('1–10 dari 60')).toBeTruthy();
    expect(router.state.location.search).toEqual({ page_size: 10 });
    expect(
      Array.from((screen.getByLabelText('Baris per halaman') as HTMLSelectElement).options).map(
        (o) => o.value,
      ),
    ).toEqual(['10', '25', '50', '100']);
  });

  it('search params dibaca dari URL; nilai yang tidak sah dibuang', async () => {
    withApi({
      'GET /api/checks?project=2&page=3&page_size=50': () =>
        page([item({ id: 9, project_id: 2, project_name: 'Billing' })], {
          page: 3,
          page_size: 50,
          total_items: 101,
        }),
    });
    renderAt('/checks?project=2&page=3&page_size=50');
    expect(await screen.findByText('101–101 dari 101')).toBeTruthy();
    cleanup();

    withApi();
    const { router } = renderAt('/checks?page_size=7&page=abc');
    await historyRows();
    expect(router.state.location.search).toEqual({});
  });

  it('belum ada check: pesan kosong, tanpa tabel', async () => {
    withApi({ [FIRST_PAGE]: () => page([], { counts: { total: 0, by_project: [] } }) });
    renderAt('/checks');
    expect(await screen.findByText('Belum ada check.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('0–0 dari 0')).toBeTruthy();
  });
});
