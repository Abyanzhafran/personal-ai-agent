import type { ProjectRepo, RepoProfile } from '@cc/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMock, project, renderAt, repo, serve } from '../test-utils';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const PROJECT = project(1, 'Order Platform');

const SVC_ORDER = repo({ id: 11, name: 'svc-order', profile_status: 'approved' });
const SVC_INVENTORY = repo({ id: 12, name: 'svc-inventory', profile_status: 'pending_review' });
const E2E = repo({ id: 14, name: 'e2e-suite', role: 'e2e', profile_status: 'skipped' });
const SVC_NEW = repo({ id: 15, name: 'svc-new' });
const TABS: ProjectRepo[] = [SVC_ORDER, SVC_INVENTORY, E2E, SVC_NEW];

const draft = (profile_md: string): RepoProfile => ({
  profile_md,
  spec_path: 'docs/swagger.json',
  spec_cmd: 'swag init',
  handler_dirs: [],
  http_client: null,
  base_url_pattern: null,
});
const DRAFT = draft('# svc-inventory\n\n- **Spec file:** `docs/swagger.json`\n');
const pending = (profile: RepoProfile) => ({ status: 'pending_review', error: null, profile });
const SCANNING = { status: 'scanning', error: null, profile: null };

/** `GET /api/repos/:id` memberi status tersimpan di DB; `skipped` dan `scanning` hanya ada di daftar. */
const stored = (r: ProjectRepo) =>
  r.profile_status === 'skipped' || r.profile_status === 'scanning'
    ? { ...r, profile_status: 'not_scanned' }
    : r;

/** Layar `target` dengan profil `response`; `extra` menambah atau menimpa rute. */
const serveRepo = (
  target: ProjectRepo,
  response: unknown,
  extra: Record<string, () => unknown> = {},
) =>
  serve({
    'GET /api/projects': () => [PROJECT],
    'GET /api/projects/1/repos': () => TABS,
    [`GET /api/repos/${target.id}`]: () => stored(target),
    [`GET /api/repos/${target.id}/profile`]: () => response,
    ...extra,
  });

const editor = () => screen.findByRole('textbox', { name: 'Profil repo dalam markdown' });
const preview = () => screen.getByText('Pratinjau').parentElement!;
const header = (name: string) => screen.findByRole('button', { name });
const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const putBody = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  return call && JSON.parse(call[1]?.body as string);
};

describe('tab repo', () => {
  it('satu tab per repo di project, tab aktif ditandai; ikon status hanya untuk yang sudah dipindai', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT));
    renderAt('/repos/12/discovery');
    const tabs = within(await screen.findByRole('navigation', { name: 'Repo di project ini' }));

    const links = tabs.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['svc-order', '/repos/11/discovery'],
      ['svc-inventory', '/repos/12/discovery'],
      ['e2e-suite', '/repos/14/discovery'],
      ['svc-new', '/repos/15/discovery'],
    ]);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null]);
    // Disetujui dan menunggu review punya ikon; e2e dan belum dipindai tidak.
    expect(links.map((a) => a.querySelectorAll('svg').length)).toEqual([1, 1, 0, 0]);
  });
});

describe('editor dan pratinjau', () => {
  it('editor memuat markdown profil; pratinjau merender judul, daftar, tebal, dan kode', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT));
    renderAt('/repos/12/discovery');
    expect(((await editor()) as HTMLTextAreaElement).value).toBe(DRAFT.profile_md);

    const view = within(preview());
    // Judul `#` profil diturunkan menjadi h2: h1 milik halaman.
    expect(view.getByRole('heading', { level: 2, name: 'svc-inventory' })).toBeTruthy();
    expect(view.getByText('Spec file:').tagName).toBe('STRONG');
    expect(view.getByText('docs/swagger.json').tagName).toBe('CODE');
    expect(view.getAllByRole('listitem')).toHaveLength(1);
  });

  it('pratinjau mengikuti editor saat diketik, tanpa menunggu', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT));
    renderAt('/repos/12/discovery');
    const box = await editor();
    await userEvent.clear(box);
    expect(preview().querySelector('h2')).toBeNull();

    await userEvent.type(box, '# Judul baru');
    // Tanpa waitFor: pratinjau sudah sama dengan isi editor begitu pengetikan selesai.
    expect(within(preview()).getByRole('heading', { level: 2, name: 'Judul baru' })).toBeTruthy();
  });

  it('HTML mentah di profil tidak dirender (profil dibuat dari kode repo)', async () => {
    serveRepo(SVC_INVENTORY, pending(draft('<img src=x onerror=alert(1)>\n\n<b>tebal</b>')));
    renderAt('/repos/12/discovery');
    await editor();
    expect(preview().querySelector('img, b')).toBeNull();
  });

  it('menampilkan path berkas tujuan dan kotak isi spec_path otomatis (tercentang)', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT));
    renderAt('/repos/12/discovery');
    await editor();
    expect(
      await screen.findByText('contexts/projects/order-platform/svc-inventory.md'),
    ).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: 'Isi spec_path otomatis: docs/swagger.json' });
    expect(box.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Setujui & simpan', () => {
  const approved = { status: 'approved', error: null, profile: DRAFT };

  it('mengirim markdown hasil edit; spec_cmd kosong dikirim sebagai null; lalu kembali ke project', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT), { 'PUT /api/repos/12/profile': () => approved });
    const { router } = renderAt('/repos/12/discovery');
    const box = await editor();
    await userEvent.clear(box);
    await userEvent.type(box, '# Disetujui');
    await userEvent.clear(screen.getByLabelText('Perintah spec (spec_cmd)'));
    await userEvent.click(await header('Setujui & simpan'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/1'));
    expect(putBody()).toEqual({ profile_md: '# Disetujui', apply_spec_path: true, spec_cmd: null });
  });

  it('spec_cmd yang diisi ikut dikirim; kotak spec_path yang dicabut mengirim apply_spec_path false', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT), { 'PUT /api/repos/12/profile': () => approved });
    renderAt('/repos/12/discovery');
    await editor();
    const cmd = screen.getByLabelText('Perintah spec (spec_cmd)') as HTMLInputElement;
    expect(cmd.value).toBe('swag init');
    await userEvent.clear(cmd);
    await userEvent.type(cmd, 'make spec');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(await header('Setujui & simpan'));

    await waitFor(() => expect(putBody()).toBeDefined());
    expect(putBody()).toEqual({
      profile_md: DRAFT.profile_md,
      apply_spec_path: false,
      spec_cmd: 'make spec',
    });
  });

  it('nonaktif bila markdown kosong', async () => {
    serveRepo(SVC_INVENTORY, pending(DRAFT));
    renderAt('/repos/12/discovery');
    await userEvent.clear(await editor());
    expect(((await header('Setujui & simpan')) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Pindai ulang', () => {
  const NEW_DRAFT = draft('# Hasil pindai baru');

  /** 0: profil lama; 1: tepat sesudah POST (sedang dipindai); 2+: hasil pindai baru. */
  function serveRescan() {
    let phase = 0;
    serveRepo(SVC_INVENTORY, undefined, {
      'GET /api/repos/12/profile': () =>
        phase === 0 ? pending(DRAFT) : phase++ === 1 ? SCANNING : pending(NEW_DRAFT),
      'POST /api/repos/12/discovery': () => {
        phase = 1;
        return SCANNING;
      },
    });
  }

  it('tanpa perubahan: langsung memindai, lalu isi editor diganti hasil baru', async () => {
    serveRescan();
    renderAt('/repos/12/discovery');
    await editor();
    await userEvent.click(await header('Pindai ulang'));

    expect(await screen.findByText(/sedang dipindai/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(
      async () =>
        expect(((await editor()) as HTMLTextAreaElement).value).toBe('# Hasil pindai baru'),
      { timeout: 5000 },
    );
    expect(posted()).toHaveLength(1);
  }, 10_000);

  it('ada perubahan: minta konfirmasi dulu; Batal tidak memindai dan menjaga editan', async () => {
    serveRescan();
    renderAt('/repos/12/discovery');
    const box = (await editor()) as HTMLTextAreaElement;
    await userEvent.type(box, ' editan saya');
    await userEvent.click(await header('Pindai ulang'));

    const dialog = await screen.findByRole('dialog', { name: 'Ganti isi editor?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted()).toEqual([]);
    expect(box.value).toBe(`${DRAFT.profile_md} editan saya`);
  });

  it('ada perubahan: setelah dikonfirmasi, editan diganti hasil pindai baru', async () => {
    serveRescan();
    renderAt('/repos/12/discovery');
    await userEvent.type(await editor(), ' editan saya');
    await userEvent.click(await header('Pindai ulang'));
    const dialog = await screen.findByRole('dialog', { name: 'Ganti isi editor?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pindai ulang' }));

    await waitFor(
      async () =>
        expect(((await editor()) as HTMLTextAreaElement).value).toBe('# Hasil pindai baru'),
      { timeout: 5000 },
    );
    expect(posted()).toHaveLength(1);
  }, 10_000);
});

describe('keadaan lain', () => {
  it('repo e2e: tanpa tombol pindai dan setujui, tanpa editor; tab-nya tanpa ikon', async () => {
    serveRepo(E2E, { status: 'skipped', error: null, profile: null });
    renderAt('/repos/14/discovery');

    expect(await screen.findByText('Repo e2e tidak dipindai oleh discovery.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pindai ulang' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Setujui & simpan' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Profil repo dalam markdown' })).toBeNull();
    const tab = await screen.findByRole('link', { name: 'e2e-suite' });
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(tab.querySelector('svg')).toBeNull();
  });

  it('belum dipindai: pesan dan galat terakhir, hanya tombol Pindai ulang', async () => {
    serveRepo(SVC_NEW, { status: 'not_scanned', error: 'Discovery gagal: x', profile: null });
    renderAt('/repos/15/discovery');

    expect(await screen.findByText(/Repo ini belum dipindai\./)).toBeTruthy();
    expect(screen.getByText(/Pindai terakhir gagal: Discovery gagal: x/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Setujui & simpan' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Profil repo dalam markdown' })).toBeNull();
    expect(((await header('Pindai ulang')) as HTMLButtonElement).disabled).toBe(false);
  });
});
