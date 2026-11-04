import type { Project, ProjectRepo } from '@cc/shared';
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

const scanning = () => ({ status: 'scanning', error: null, profile: null });

const NOT_READY = 'Tambahkan minimal satu repo service dan satu repo lain.';
const detail = (p: Project) => ({ ...p, ready_for_check: false, not_ready_reason: NOT_READY });

const withRepos = (repos: ProjectRepo[] = REPOS, extra: Record<string, () => unknown> = {}) =>
  serve({
    'GET /api/projects': () => PROJECTS,
    'GET /api/projects/1/repos': () => repos,
    'GET /api/projects/2/repos': () => [],
    'GET /api/projects/2': () => detail(PROJECTS[1]!),
    // Hanya repo yang boleh dipindai; panggilan lain berarti salah pilih repo (dijawab 404).
    'POST /api/repos/12/discovery': scanning,
    'POST /api/repos/15/discovery': scanning,
    ...extra,
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
  it('tujuh kolom dengan urutan mockup; judul kolom terakhir (chevron) hanya untuk pembaca layar', async () => {
    withRepos();
    renderAt('/');
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual([
      'Repo',
      'Peran',
      'Path lokal',
      'Branch',
      'Spec',
      'Profil discovery',
      'Aksi',
    ]);
    expect(headers.at(-1)?.querySelector('.sr-only')?.textContent).toBe('Aksi');
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
  it('Panduan menuju /panduan', async () => {
    withRepos();
    renderAt('/');
    const guide = await screen.findByRole('link', { name: 'Panduan' });
    expect(guide.getAttribute('href')).toBe('/panduan');
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

describe('project tanpa repo', () => {
  it('menampilkan Belum ada repo, dua syarat, dan alasan dari server, bukan tombol mati tanpa penjelasan', async () => {
    withRepos();
    renderAt('/projects/2');
    const title = await screen.findByRole('heading', { level: 2, name: 'Belum ada repo' });
    expect(screen.queryByRole('table')).toBeNull();

    const card = within(title.parentElement!);
    expect(card.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Minimal 1 repo serviceBelum',
      'Minimal 1 consumer (microfrontend atau service lain)Belum',
    ]);
    expect(await card.findByText(NOT_READY)).toBeTruthy();
    // Tombol di kartu ini membuka dialog yang sama dengan tombol di header.
    await userEvent.click(card.getByRole('button', { name: 'Tambah repo' }));
    expect(await screen.findByRole('dialog', { name: 'Tambah repo' })).toBeTruthy();
  });
});

describe('dialog Project baru', () => {
  const NAME_TAKEN = 'Sudah ada project dengan nama serupa (folder "billing"). Pakai nama lain.';

  async function openDialog() {
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Project baru' }));
    return screen.findByRole('dialog', { name: 'Project baru' });
  }
  const fieldsOf = (dialog: HTMLElement) => ({
    name: within(dialog).getByLabelText('Nama project') as HTMLInputElement,
    description: within(dialog).getByLabelText('Deskripsi') as HTMLTextAreaElement,
    submit: within(dialog).getByRole('button', { name: 'Buat project' }) as HTMLButtonElement,
  });
  const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

  it('Buat project nonaktif selama nama kosong; nama dibatasi 60 karakter', async () => {
    withRepos();
    const { name, submit } = fieldsOf(await openDialog());
    expect(submit.disabled).toBe(true);
    await userEvent.type(name, '   ');
    expect(submit.disabled).toBe(true);
    await userEvent.type(name, 'Customer Support');
    expect(submit.disabled).toBe(false);
    expect(name.maxLength).toBe(60);
  });

  it('menyimpan: nama dan deskripsi terkirim, dialog menutup, project baru terpilih', async () => {
    const projects = [...PROJECTS];
    const created = project(3, 'Customer Support');
    withRepos(REPOS, {
      'GET /api/projects': () => projects,
      'POST /api/projects': () => {
        projects.push(created);
        return created;
      },
      'GET /api/projects/3/repos': () => [],
      'GET /api/projects/3': () => detail(created),
    });
    const { name, description, submit } = fieldsOf(await openDialog());
    await userEvent.type(name, 'Customer Support');
    await userEvent.type(description, 'Portal');
    await userEvent.click(submit);

    await screen.findByRole('heading', { level: 1, name: 'Customer Support' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posted().map(([url, init]) => [url, JSON.parse(init?.body as string)])).toEqual([
      ['/api/projects', { name: 'Customer Support', description: 'Portal' }],
    ]);
    expect(
      sidebar().getByRole('link', { name: 'Customer Support' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('409 slug bentrok: dialog tetap terbuka, pesan di bawah field nama, isian tidak hilang, tanpa toast', async () => {
    const details = {
      slug: 'billing',
      fields: [{ in: 'body', path: 'name', message: NAME_TAKEN }],
    };
    withRepos(REPOS, {
      'POST /api/projects': () =>
        json({ error: { code: 'project_slug_taken', message: NAME_TAKEN, details } }, 409),
    });
    const dialog = await openDialog();
    const { name, description, submit } = fieldsOf(dialog);
    await userEvent.type(name, 'BILLING');
    await userEvent.type(description, 'Tagihan');
    await userEvent.click(submit);

    expect((await within(dialog).findByRole('alert')).textContent).toBe(NAME_TAKEN);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect([name.value, description.value]).toEqual(['BILLING', 'Tagihan']);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(submit.disabled).toBe(false);
    // Hanya satu kemunculan: galat yang menunjuk isian tidak ikut menjadi toast.
    expect(screen.getAllByText(NAME_TAKEN)).toHaveLength(1);
  });

  it('Buat project nonaktif selama request berjalan', async () => {
    let finish!: (res: Response) => void;
    withRepos(REPOS, {
      'POST /api/projects': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const { name, submit } = fieldsOf(await openDialog());
    await userEvent.type(name, 'Customer Support');
    await userEvent.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true));

    finish(json(project(3, 'Customer Support'), 201));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Esc menutup dialog dan fokus kembali ke tombol Project baru', async () => {
    withRepos();
    renderAt('/');
    const trigger = await screen.findByRole('button', { name: 'Project baru' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('klik di luar dialog menutupnya dan fokus kembali ke tombol Project baru', async () => {
    withRepos();
    renderAt('/');
    const trigger = await screen.findByRole('button', { name: 'Project baru' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');

    // Radix menonaktifkan pointer-events pada body saat dialog terbuka; klik di luar tetap dikirim.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('Batal menutup dialog dan mengosongkan isian untuk pembukaan berikutnya', async () => {
    withRepos();
    const dialog = await openDialog();
    await userEvent.type(fieldsOf(dialog).name, 'Setengah jadi');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Project baru' }));
    expect(fieldsOf(await screen.findByRole('dialog', { name: 'Project baru' })).name.value).toBe(
      '',
    );
    expect(posted()).toEqual([]);
  });
});

describe('dialog Tambah repo', () => {
  const REPOS_URL = '/api/projects/1/repos';

  async function openDialog() {
    renderAt('/');
    await tableCells();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah repo' }));
    return screen.findByRole('dialog', { name: 'Tambah repo' });
  }
  const fieldsOf = (dialog: HTMLElement) => ({
    path: within(dialog).getByLabelText('Path lokal') as HTMLInputElement,
    name: within(dialog).getByLabelText('Nama repo') as HTMLInputElement,
    branch: within(dialog).getByLabelText('Default branch') as HTMLInputElement,
    save: within(dialog).getByRole('button', { name: 'Simpan' }) as HTMLButtonElement,
  });
  const role = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name });
  const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  const bodyOf = (call: (typeof fetchMock.mock.calls)[number]) =>
    JSON.parse(call[1]?.body as string);

  it('judul menyebut project tujuan; peran awalnya service', async () => {
    withRepos();
    const dialog = await openDialog();
    expect(within(dialog).getByText('Ke project Order Platform')).toBeTruthy();
    expect(role(dialog, 'service').getAttribute('aria-pressed')).toBe('true');
    expect(role(dialog, 'microfrontend').getAttribute('aria-pressed')).toBe('false');
    expect(role(dialog, 'e2e').getAttribute('aria-pressed')).toBe('false');
  });

  it('tidak ada request apa pun selama mengisi isian, sebelum Simpan', async () => {
    withRepos();
    const dialog = await openDialog();
    const { path, name, branch } = fieldsOf(dialog);
    const before = fetchMock.mock.calls.length;

    await userEvent.type(path, '/work/svc-inventory');
    await userEvent.type(name, '-baru');
    await userEvent.type(branch, 'develop');
    await userEvent.click(role(dialog, 'e2e'));

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('mengisi path memperbarui nama default sampai user mengubah nama sendiri', async () => {
    withRepos();
    const dialog = await openDialog();
    const { path, name } = fieldsOf(dialog);

    await userEvent.type(path, '/work/svc-inventory');
    expect(name.value).toBe('svc-inventory');
    await userEvent.clear(path);
    await userEvent.type(path, 'C:\\work\\svc-payment\\');
    expect(name.value).toBe('svc-payment');

    await userEvent.type(name, '-lama');
    await userEvent.type(path, 'x');
    expect(name.value).toBe('svc-payment-lama');
  });

  it('Simpan: kirim isian (nama default tidak dikirim), dialog menutup, baris baru muncul dan ikut diperbarui', async () => {
    const added = repo({ id: 16, name: 'svc-added', profile_status: 'scanning' });
    // 0: sebelum simpan; 1: sesudah simpan (sedang dipindai); 2: pindai selesai.
    let phase = 0;
    withRepos(REPOS, {
      [`GET ${REPOS_URL}`]: () =>
        phase === 0
          ? REPOS
          : [...REPOS, phase++ === 1 ? added : { ...added, profile_status: 'pending_review' }],
      [`POST ${REPOS_URL}`]: () => {
        phase = 1;
        return { ...added, profile_status: 'not_scanned' };
      },
    });
    const dialog = await openDialog();
    const { path, branch, save } = fieldsOf(dialog);
    await userEvent.type(path, '/work/svc-added');
    await userEvent.type(branch, 'develop');
    await userEvent.click(role(dialog, 'microfrontend'));
    await userEvent.click(save);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted().map((call) => [call[0], bodyOf(call)])).toEqual([
      [
        REPOS_URL,
        { role: 'microfrontend', local_path: '/work/svc-added', default_branch: 'develop' },
      ],
    ]);

    const statusOf = async (repoName: string) => {
      const row = (await screen.findByText(repoName)).closest('tr')!;
      return within(row).getAllByRole('cell')[5]!.textContent;
    };
    await waitFor(async () => expect(await statusOf('svc-added')).toBe('Sedang dipindai'));
    await waitFor(async () => expect(await statusOf('svc-added')).toBe('Menunggu review'), {
      timeout: 5000,
    });
  }, 10_000);

  it('nama yang diubah user ikut dikirim', async () => {
    withRepos(REPOS, { [`POST ${REPOS_URL}`]: () => repo({ id: 16, name: 'kustom' }) });
    const dialog = await openDialog();
    const { path, name, save } = fieldsOf(dialog);
    await userEvent.type(path, '/work/svc-added');
    await userEvent.clear(name);
    await userEvent.type(name, 'kustom');
    await userEvent.click(save);

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(bodyOf(posted()[0]!)).toEqual({
      role: 'service',
      local_path: '/work/svc-added',
      name: 'kustom',
      default_branch: '',
    });
  });

  it.each([
    ['bukan repo git', 'local_path', 400, 'repo_not_git', 'Folder ini bukan repo git: /work/x'],
    [
      'branch tidak ada',
      'default_branch',
      400,
      'branch_not_found',
      'Branch "dev" tidak ada di origin.',
    ],
    ['path duplikat', 'local_path', 409, 'repo_path_taken', 'Path sudah terdaftar di project ini'],
    ['nama duplikat', 'name', 409, 'repo_name_taken', 'Nama repo "x" sudah dipakai repo lain.'],
  ] as const)(
    'galat server (%s) tampil di isian yang tepat, dialog tetap terbuka, isian tidak hilang',
    async (_label, field, status, code, message) => {
      const details = { fields: [{ in: 'body', path: field, message }] };
      withRepos(REPOS, {
        [`POST ${REPOS_URL}`]: () => json({ error: { code, message, details } }, status),
      });
      const dialog = await openDialog();
      const fields = fieldsOf(dialog);
      await userEvent.type(fields.path, '/work/x');
      await userEvent.type(fields.branch, 'dev');
      await userEvent.click(fields.save);

      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).toBe(message);
      const target = { local_path: fields.path, name: fields.name, default_branch: fields.branch }[
        field
      ];
      const hint = document.getElementById(target.getAttribute('aria-describedby')!);
      expect(hint?.contains(alert)).toBe(true);
      expect(target.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect([fields.path.value, fields.branch.value]).toEqual(['/work/x', 'dev']);
      // Hanya satu kemunculan: galat yang menunjuk isian tidak ikut menjadi toast.
      expect(screen.getAllByText(message)).toHaveLength(1);
    },
  );

  it('Simpan nonaktif selama request berjalan', async () => {
    let finish!: (res: Response) => void;
    withRepos(REPOS, {
      [`POST ${REPOS_URL}`]: () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const dialog = await openDialog();
    const { path, save } = fieldsOf(dialog);
    await userEvent.type(path, '/work/x');
    await userEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));

    finish(json(repo({ id: 16, name: 'x' }), 201));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Batal menutup dialog; pembukaan berikutnya mulai dari isian kosong', async () => {
    withRepos();
    const dialog = await openDialog();
    await userEvent.type(fieldsOf(dialog).path, '/work/setengah');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Tambah repo' }));
    const again = await screen.findByRole('dialog', { name: 'Tambah repo' });
    expect(fieldsOf(again).path.value).toBe('');
    expect(posted()).toEqual([]);
  });
});
