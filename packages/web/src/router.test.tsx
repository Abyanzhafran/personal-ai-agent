import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';
import { fetchMock, serve } from './test-utils';

// Layar Checks memanggil API; di sini cukup daftar kosong.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  serve({
    'GET /api/projects': () => [],
    'GET /api/checks?page=1&page_size=25': () => ({
      items: [],
      page: 1,
      page_size: 25,
      total_items: 0,
      counts: { total: 0, by_project: [] },
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const screenRoute = async () => (await screen.findByTestId('screen')).getAttribute('data-route');
const checksHeading = () => screen.findByRole('heading', { level: 1, name: 'Checks' });

describe('rute', () => {
  // `/`, `/projects/:id`, `/repos/:id/discovery`, `/panduan`, dan `/checks` sudah layar sungguhan: lihat components/*-screen.test.tsx.
  it.each([['/checks/42', '/checks/$checkId', '{"checkId":"42"}']])(
    '%s merender layarnya',
    async (path, route, params) => {
      renderAt(path);
      expect(await screenRoute()).toBe(route);
      const text = (await screen.findByTestId('screen')).textContent ?? '';
      if (params) expect(text).toContain(params);
    },
  );

  it('path yang tidak dikenal menampilkan not-found, bukan layar kosong', async () => {
    renderAt('/tidak/ada');
    expect(await screen.findByTestId('not-found')).toBeTruthy();
    expect(screen.queryByTestId('screen')).toBeNull();
  });

  it('/checks dan /checks/:id adalah dua rute berbeda', async () => {
    const router = renderAt('/checks');
    await checksHeading();
    expect(screen.queryByTestId('screen')).toBeNull();
    await router.navigate({ to: '/checks/$checkId', params: { checkId: '5' } });
    expect(await screenRoute()).toBe('/checks/$checkId');
  });
});

describe('navigasi', () => {
  it('berpindah rute tanpa memuat ulang halaman: shell tetap objek DOM yang sama', async () => {
    const router = renderAt('/checks/42');
    expect(await screenRoute()).toBe('/checks/$checkId');
    const nav = screen.getByTestId('nav');

    // Breadcrumb di halaman ini juga bertaut "Checks"; yang diuji adalah nav rail.
    await userEvent.click(within(nav).getByRole('link', { name: 'Checks' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/checks'));
    await checksHeading();
    expect(screen.getByTestId('nav')).toBe(nav);

    await router.navigate({ to: '/checks/$checkId', params: { checkId: '5' } });
    expect(await screenRoute()).toBe('/checks/$checkId');
    expect(screen.getByTestId('nav')).toBe(nav);
  });

  it('klik link dicegat router (preventDefault), sehingga browser tidak memuat halaman baru', async () => {
    renderAt('/checks/42');
    await screenRoute();
    const link = within(screen.getByTestId('nav')).getByRole('link', { name: 'Checks' });
    // fireEvent.click mengembalikan false bila ada handler yang memanggil preventDefault().
    expect(fireEvent.click(link)).toBe(false);
  });

  it('navigasi programatik membawa parameter', async () => {
    const router = renderAt('/checks/42');
    await screenRoute();
    await router.navigate({ to: '/checks/$checkId', params: { checkId: '99' } });
    expect(await screenRoute()).toBe('/checks/$checkId');
    expect((await screen.findByTestId('screen')).textContent).toContain('"checkId":"99"');
  });
});
