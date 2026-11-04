import type { CheckDetail } from '@cc/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { FakeEventSource, fetchMock, project, renderAt, repo, serve } from '../test-utils';

// Warna tidak bisa dihitung di jsdom (CSS Tailwind tidak dimuat), jadi aturan kontras dimatikan.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const at = (minute: number) => new Date(2026, 10, 4, 13, minute).toISOString();
const PROJECT = project(1, 'Order Platform');
const REPOS = [
  repo({
    id: 11,
    name: 'svc-order',
    role: 'service',
    spec_path: 'openapi.yaml',
    profile_status: 'approved',
  }),
  repo({ id: 12, name: 'mfe-dashboard', role: 'microfrontend', profile_status: 'pending_review' }),
  repo({ id: 13, name: 'e2e-suite', role: 'e2e', profile_status: 'skipped' }),
];

const CHECK = {
  id: 31,
  project_id: 1,
  provider_repo_id: 11,
  base_ref: 'main',
  head_ref: 'feature/xyz',
  base_sha: null,
  head_sha: null,
  status: 'running',
  started_at: at(0),
  finished_at: null,
  error: null,
};
const RUNNING: CheckDetail = {
  check: CHECK as CheckDetail['check'],
  project_name: 'Order Platform',
  provider_repo_name: 'svc-order',
  findings: [],
  summary: null,
};

const projectsRoutes = {
  'GET /api/projects': () => [PROJECT],
  'GET /api/projects/1/repos': () => REPOS,
};
const checksRoutes = {
  ...projectsRoutes,
  'GET /api/projects/1': () => ({ ...PROJECT, ready_for_check: true, not_ready_reason: null }),
  'GET /api/repos/11/refs': () => [],
  'GET /api/checks?page=1&page_size=25': () => ({
    items: [
      {
        ...CHECK,
        status: 'clean',
        finished_at: at(1),
        project_name: 'Order Platform',
        provider_repo_name: 'svc-order',
        counts: { break: 0, warn: 0, info: 0 },
        spec_stale: false,
      },
    ],
    page: 1,
    page_size: 25,
    total_items: 1,
    counts: { total: 1, by_project: [{ project_id: 1, name: 'Order Platform', count: 1 }] },
  }),
};
const discoveryRoutes = {
  ...projectsRoutes,
  'GET /api/repos/12': () => REPOS[1],
  'GET /api/repos/12/profile': () => ({
    status: 'pending_review',
    error: null,
    profile: {
      profile_md: '# Profil\n\nService order.',
      spec_path: null,
      spec_cmd: null,
      handler_dirs: [],
      http_client: null,
      base_url_pattern: null,
    },
  }),
};
const checkRoutes = { 'GET /api/checks/31': () => RUNNING };

const noViolations = async (root: Element) => expect(await axe(root)).toHaveNoViolations();

describe('axe bersih di lima layar utama', () => {
  it('Projects', async () => {
    serve(projectsRoutes);
    const { container } = renderAt('/');
    await screen.findByText('svc-order');
    await noViolations(container);
  });

  it('dialog Project baru', async () => {
    serve(projectsRoutes);
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Project baru' }));
    await screen.findByRole('dialog', { name: 'Project baru' });
    await noViolations(document.body);
  });

  it('Tinjau profil repo', async () => {
    serve(discoveryRoutes);
    const { container } = renderAt('/repos/12/discovery');
    await screen.findByRole('button', { name: 'Setujui & simpan' });
    await noViolations(container);
  });

  it('Checks', async () => {
    serve(checksRoutes);
    const { container } = renderAt('/checks');
    await screen.findByRole('heading', { name: 'Riwayat' });
    await noViolations(container);
  });

  it('Check berjalan', async () => {
    serve(checkRoutes);
    const { container } = renderAt('/checks/31');
    await screen.findByRole('progressbar', { name: 'Progres check' });
    await noViolations(container);
  });

  it('Panduan', async () => {
    serve({});
    const { container } = renderAt('/panduan');
    await screen.findByRole('heading', { level: 1 });
    await noViolations(container);
  });
});

// Layar yang memuat data: skeleton selama memuat, pesan + "Coba lagi" saat API mati.
const SCREENS = [
  {
    name: 'Projects',
    path: '/',
    routes: projectsRoutes,
    ready: () => screen.findByText('svc-order'),
  },
  {
    name: 'Checks',
    path: '/checks',
    routes: checksRoutes,
    ready: () => screen.findByRole('heading', { name: 'Riwayat' }),
  },
  {
    name: 'Check',
    path: '/checks/31',
    routes: checkRoutes,
    ready: () => screen.findByRole('progressbar', { name: 'Progres check' }),
  },
  {
    name: 'Tinjau profil repo',
    path: '/repos/12/discovery',
    routes: discoveryRoutes,
    // Tab repo menyusul setelah editor, jadi ditunggu juga.
    ready: async () => {
      await screen.findByRole('button', { name: 'Setujui & simpan' });
      await screen.findByRole('link', { name: /svc-order/ });
    },
  },
];

describe.each(SCREENS)('$name: loading dan API mati', ({ path, routes, ready }) => {
  it('menampilkan skeleton selama memuat', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    renderAt(path);

    expect(await screen.findByRole('status', { name: 'Memuat…' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('API mati → pesan dan tombol Coba lagi, bukan skeleton tanpa batas; Coba lagi memulihkan', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAt(path);

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain('Tidak dapat terhubung ke server');
    expect(screen.queryByRole('status', { name: 'Memuat…' })).toBeNull();

    serve(routes);
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));

    await ready();
    expect(screen.queryByRole('alert')).toBeNull();
  }, 15_000);
});

/** Elemen yang bisa difokus, urut DOM; Tab harus melewati tepat daftar ini. */
const focusable = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.matches(':disabled'));

async function tabThrough(user: ReturnType<typeof userEvent.setup>) {
  const expected = focusable();
  const visited: (Element | null)[] = [];
  for (let step = 0; step < expected.length; step++) {
    await user.tab();
    visited.push(document.activeElement);
  }
  const label = (el: Element | null) =>
    el === null
      ? 'null'
      : `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}`;
  expect(visited.map(label)).toEqual(expected.map(label));
}

describe('keyboard saja', () => {
  it('Tab melewati semua kontrol di Projects, Checks, dan Tinjau profil, berurutan', async () => {
    for (const { path, routes, ready } of [SCREENS[0]!, SCREENS[1]!, SCREENS[3]!]) {
      const user = userEvent.setup();
      serve(routes);
      renderAt(path);
      await ready();
      await tabThrough(user);
      cleanup();
    }
  });

  it('dialog Project baru: Enter membuka, fokus terkurung di dalam, Esc menutup dan fokus kembali', async () => {
    const user = userEvent.setup();
    serve(projectsRoutes);
    renderAt('/');
    const trigger = await screen.findByRole('button', { name: 'Project baru' });
    trigger.focus();

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Project baru' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let step = 0; step < 8; step++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Project baru: ketik nama lalu Enter menyimpan', async () => {
    const user = userEvent.setup();
    serve({ ...projectsRoutes, 'POST /api/projects': () => project(2, 'Billing') });
    renderAt('/');
    (await screen.findByRole('button', { name: 'Project baru' })).focus();
    await user.keyboard('{Enter}');

    await user.type(await screen.findByLabelText('Nama project'), 'Billing{Enter}');

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/projects' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/projects' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: 'Billing' });
  });

  it('Checks: ketik head ref lalu Enter menjalankan check', async () => {
    const user = userEvent.setup();
    serve({
      ...checksRoutes,
      'POST /api/checks': () => ({ ...CHECK, id: 32 }),
      'GET /api/checks/32': () => ({ ...RUNNING, check: { ...CHECK, id: 32 } }),
    });
    renderAt('/checks');
    const head = await screen.findByLabelText('Head ref');
    await waitFor(() => expect(screen.getByLabelText('Base ref')).toHaveProperty('value', 'main'));

    await user.type(head, 'feature/xyz{Enter}');

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/checks' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/checks' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      provider_repo_id: 11,
      head_ref: 'feature/xyz',
      base_ref: 'main',
    });
  });

  it('Check berjalan: Batalkan lewat keyboard, Esc menutup dialog dan fokus kembali ke tombol', async () => {
    const user = userEvent.setup();
    serve(checkRoutes);
    renderAt('/checks/31');
    const cancel = await screen.findByRole('button', { name: 'Batalkan' });
    cancel.focus();

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Batalkan check?' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });
});
