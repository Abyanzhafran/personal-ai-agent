import type { Project, ProjectRepo } from '@cc/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { createAppRouter } from '../router';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

/** Menjawab `fetch` menurut "METODE /path"; rute yang tidak terdaftar dijawab 404. */
function serve(routes: Record<string, () => unknown>) {
  fetchMock.mockImplementation((url, init) => {
    const method = init?.method ?? 'GET';
    const body = routes[`${method} ${url}`]?.();
    return Promise.resolve(
      body === undefined
        ? json({ error: { code: 'tidak_ada', message: 'Tidak ada', details: null } }, 404)
        : json(body, method === 'POST' ? 202 : 200),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const project = (id: number, name: string): Project => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
});

const repo = (fields: Partial<ProjectRepo> & Pick<ProjectRepo, 'id' | 'name'>): ProjectRepo => ({
  project_id: 1,
  role: 'service',
  local_path: `/work/${fields.name}`,
  default_branch: 'main',
  spec_path: null,
  spec_cmd: null,
  profile_status: 'not_scanned',
  profile_error: null,
  last_fetch_at: null,
  ...fields,
});

const PROJECTS = [project(1, 'Order Platform'), project(2, 'Billing')];

const REPOS = [
  repo({ id: 11, name: 'svc-order', spec_path: 'api/openapi.yaml', profile_status: 'approved' }),
  repo({
    id: 12,
    name: 'svc-inventory',
    default_branch: 'develop',
    profile_status: 'pending_review',
  }),
  repo({ id: 13, name: 'mfe-dashboard', role: 'microfrontend', profile_status: 'approved' }),
  repo({ id: 14, name: 'e2e-suite', role: 'e2e', profile_status: 'skipped' }),
  repo({ id: 15, name: 'svc-new' }),
];

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const scanning = () => ({ status: 'scanning', error: null, profile: null });

const withRepos = (repos: ProjectRepo[] = REPOS) =>
  serve({
    'GET /api/projects': () => PROJECTS,
    'GET /api/projects/1/repos': () => repos,
    'GET /api/projects/2/repos': () => [],
    // Hanya repo yang boleh dipindai; panggilan lain berarti salah pilih repo (dijawab 404).
    'POST /api/repos/12/discovery': scanning,
    'POST /api/repos/15/discovery': scanning,
  });

/** Sel tiap baris data tabel repo, urut kolom (header dilewati). */
async function tableCells() {
  const table = await screen.findByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
}

const sidebar = () => within(screen.getByRole('navigation', { name: 'Daftar project' }));

describe('sidebar dan header', () => {
  it('/ memilih project pertama; sidebar memuat semua project dan menandai yang terpilih', async () => {
    withRepos();
    renderAt('/');
    // Sebelum project termuat, judulnya masih "Projects".
    await screen.findByRole('heading', { level: 1, name: 'Order Platform' });
    await screen.findByText('5 repo · 1 profil menunggu review');

    expect(
      sidebar()
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Order Platform', 'Billing']);
    expect(
      sidebar().getByRole('link', { name: 'Order Platform' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      sidebar().getByRole('link', { name: 'Billing' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('/projects/:id memilih project itu dan memuat repo-nya', async () => {
    withRepos();
    renderAt('/projects/2');
    await screen.findByRole('heading', { level: 1, name: 'Billing' });
    expect(sidebar().getByRole('link', { name: 'Billing' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await screen.findByText('0 repo');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/2/repos', expect.anything());
  });

  it('project yang tidak ada menampilkan pesan, tanpa tabel dan tombol aksi', async () => {
    withRepos();
    renderAt('/projects/99');
    expect(await screen.findByText('Project tidak ditemukan.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tambah repo' })).toBeNull();
  });
});

describe('tabel repo', () => {
  it('tujuh kolom dengan urutan mockup; kolom terakhir (chevron) tanpa judul', async () => {
    withRepos();
    renderAt('/');
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Repo', 'Peran', 'Path lokal', 'Branch', 'Spec', 'Profil discovery', '']);
  });

  it('satu baris per repo: nama, peran, path, dan branch dari server', async () => {
    withRepos();
    renderAt('/');
    const rows = (await tableCells()).map((cells) => cells.slice(0, 4).map((c) => c.textContent));
    expect(rows).toEqual([
      ['svc-order', 'service', '/work/svc-order', 'main'],
      ['svc-inventory', 'service', '/work/svc-inventory', 'develop'],
      ['mfe-dashboard', 'microfrontend', '/work/mfe-dashboard', 'main'],
      ['e2e-suite', 'e2e', '/work/e2e-suite', 'main'],
      ['svc-new', 'service', '/work/svc-new', 'main'],
    ]);
  });

  it('kolom Spec: path, "Belum diisi" miring, tanda hubung, dan e2e dikecualikan', async () => {
    withRepos();
    renderAt('/');
    const specs = (await tableCells()).map((cells) => cells[4]!);
    expect(specs.map((c) => c.textContent)).toEqual([
      'api/openapi.yaml',
      'Belum diisi',
      '—',
      'Dikecualikan dari pencarian consumer',
      'Belum diisi',
    ]);
    expect(within(specs[1]!).getByText('Belum diisi').className).toContain('italic');
  });

  it('kolom Profil discovery: Disetujui, Menunggu review, Belum dipindai, Tidak dipindai', async () => {
    withRepos();
    renderAt('/');
    const profiles = (await tableCells()).map((cells) => cells[5]!.textContent);
    expect(profiles).toEqual([
      'Disetujui',
      'Menunggu review',
      'Disetujui',
      'Tidak dipindai',
      'Belum dipindai',
    ]);
  });

  // Jsdom tidak menghitung gaya; yang dibuktikan di sini hanya nama kelasnya.
  it('path lokal dan branch memakai kelas mono + truncate, bukan membungkus', async () => {
    withRepos();
    renderAt('/');
    const [, , path, branch] = (await tableCells())[0]!;
    for (const cell of [path!, branch!]) {
      const classes = (cell.firstElementChild as HTMLElement).className.split(' ');
      expect(classes).toEqual(expect.arrayContaining(['font-mono', 'truncate']));
    }
  });

  it('chevron menuju Tinjau profil repo itu', async () => {
    withRepos();
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'Tinjau profil svc-inventory' });
    expect(link.getAttribute('href')).toBe('/repos/12/discovery');
  });

  it('catatan read-only ada di bawah tabel', async () => {
    withRepos();
    renderAt('/');
    await screen.findByRole('table');
    expect(screen.getByText(/^Repo hanya dibaca \(git show, git grep\)/)).toBeTruthy();
  });

  it('selama ada repo yang dipindai, daftar ditanyakan lagi sampai statusnya berubah', async () => {
    let calls = 0;
    serve({
      'GET /api/projects': () => PROJECTS,
      'GET /api/projects/1/repos': () => [
        repo({
          id: 11,
          name: 'svc-order',
          profile_status: calls++ === 0 ? 'scanning' : 'pending_review',
        }),
      ],
    });
    renderAt('/');
    expect((await tableCells())[0]![5]!.textContent).toBe('Sedang dipindai');
    await screen.findByText('Menunggu review', {}, { timeout: 5000 });
  }, 10_000);
});

describe('tombol aksi', () => {
  it('Panduan menuju /panduan; Tambah repo nonaktif sampai dialognya ada (CC-078)', async () => {
    withRepos();
    renderAt('/');
    const guide = await screen.findByRole('link', { name: 'Panduan' });
    expect(guide.getAttribute('href')).toBe('/panduan');
    expect(
      (screen.getByRole('button', { name: 'Tambah repo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Jalankan discovery memindai repo belum dipindai dan menunggu review, bukan yang disetujui, e2e, atau sedang dipindai', async () => {
    withRepos([...REPOS, repo({ id: 16, name: 'svc-busy', profile_status: 'scanning' })]);
    renderAt('/');
    await tableCells();
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan discovery' }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([url]) => url);
      expect(posted.sort()).toEqual(['/api/repos/12/discovery', '/api/repos/15/discovery']);
    });
  });

  it('Jalankan discovery nonaktif bila tidak ada repo yang perlu dipindai', async () => {
    withRepos([REPOS[0]!, REPOS[3]!]);
    renderAt('/');
    await tableCells();
    expect(
      (screen.getByRole('button', { name: 'Jalankan discovery' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
