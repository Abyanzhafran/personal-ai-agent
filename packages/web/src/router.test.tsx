import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';

afterEach(cleanup);

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

describe('rute', () => {
  it.each([
    ['/', '/', null],
    ['/projects/7', '/projects/$projectId', '{"projectId":"7"}'],
    ['/repos/12/discovery', '/repos/$repoId/discovery', '{"repoId":"12"}'],
    ['/checks', '/checks', null],
    ['/checks/42', '/checks/$checkId', '{"checkId":"42"}'],
    ['/panduan', '/panduan', null],
  ])('%s merender layarnya', async (path, route, params) => {
    renderAt(path);
    expect(await screenRoute()).toBe(route);
    const text = (await screen.findByTestId('screen')).textContent ?? '';
    if (params) expect(text).toContain(params);
  });

  it('path yang tidak dikenal menampilkan not-found, bukan layar kosong', async () => {
    renderAt('/tidak/ada');
    expect(await screen.findByTestId('not-found')).toBeTruthy();
    expect(screen.queryByTestId('screen')).toBeNull();
  });

  it('/checks dan /checks/:id adalah dua rute berbeda', async () => {
    renderAt('/checks');
    expect(await screenRoute()).toBe('/checks');
  });
});

describe('navigasi', () => {
  it('berpindah rute tanpa memuat ulang halaman: shell tetap objek DOM yang sama', async () => {
    const router = renderAt('/');
    expect(await screenRoute()).toBe('/');
    const nav = screen.getByTestId('nav');

    await userEvent.click(screen.getByRole('link', { name: 'checks' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/checks'));
    expect(await screenRoute()).toBe('/checks');
    expect(screen.getByTestId('nav')).toBe(nav);

    await userEvent.click(screen.getByRole('link', { name: 'panduan' }));
    expect(await screenRoute()).toBe('/panduan');
    expect(screen.getByTestId('nav')).toBe(nav);
  });

  it('klik link dicegat router (preventDefault), sehingga browser tidak memuat halaman baru', async () => {
    renderAt('/');
    await screenRoute();
    const link = screen.getByRole('link', { name: 'checks' });
    // fireEvent.click mengembalikan false bila ada handler yang memanggil preventDefault().
    expect(fireEvent.click(link)).toBe(false);
  });

  it('navigasi programatik membawa parameter', async () => {
    const router = renderAt('/');
    await screenRoute();
    await router.navigate({ to: '/checks/$checkId', params: { checkId: '99' } });
    expect(await screenRoute()).toBe('/checks/$checkId');
    expect((await screen.findByTestId('screen')).textContent).toContain('"checkId":"99"');
  });
});
