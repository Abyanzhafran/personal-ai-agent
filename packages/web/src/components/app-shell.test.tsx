import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { createAppRouter } from '../router';

afterEach(cleanup);

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const trailOf = (nav: HTMLElement) =>
  [...nav.children].filter((el) => el.getAttribute('aria-hidden') !== 'true');

describe('app shell', () => {
  // [path, tujuan nav rail yang aktif, jejak breadcrumb]
  it.each<[string, string | null, string[]]>([
    ['/', 'Projects', ['Projects']],
    ['/projects/7', 'Projects', ['Projects']],
    ['/repos/12/discovery', 'Projects', ['Projects', 'Tinjau profil repo']],
    ['/checks', 'Checks', ['Checks']],
    ['/checks/42', 'Checks', ['Checks', 'Check #42']],
    ['/panduan', null, []],
  ])('%s: nav aktif %s, breadcrumb %j', async (path, active, trail) => {
    renderAt(path);
    const rail = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    const current = within(rail)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent);
    expect(current).toEqual(active ? [active] : []);

    const crumbs = screen.queryByRole('navigation', { name: 'Jejak halaman' });
    expect(crumbs && trailOf(crumbs).map((el) => el.textContent)).toEqual(
      trail.length > 0 ? trail : null,
    );
  });

  it('crumb induk adalah tautan, crumb terakhir adalah halaman saat ini', async () => {
    renderAt('/checks/42');
    const crumbs = await screen.findByRole('navigation', { name: 'Jejak halaman' });
    const [parent, current] = trailOf(crumbs);
    expect(parent?.tagName).toBe('A');
    expect(parent?.getAttribute('href')).toBe('/checks');
    expect(current?.tagName).toBe('SPAN');
    expect(current?.getAttribute('aria-current')).toBe('page');
  });

  it('nav rail memuat dua tujuan dan logo, tanpa tombol bahasa', async () => {
    renderAt('/');
    const rail = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    const links = within(rail).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Projects', '/'],
      ['Checks', '/checks'],
    ]);
    expect(within(rail).getByRole('img', { name: 'Contract Check' })).toBeTruthy();
    expect(within(rail).queryByRole('button')).toBeNull();
  });

  it('Toaster terpasang di akar', async () => {
    renderAt('/');
    await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(document.querySelector('section[aria-label^="Notifikasi"]')).not.toBeNull();
  });

  it('konten melipat (bukan terpotong) saat sempit: kelas flex-wrap dan min-w-0', async () => {
    renderAt('/');
    const rail = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(rail.parentElement?.className).toContain('flex-wrap');
    expect(document.querySelector('main')?.className).toContain('min-w-0');
    expect(document.querySelector('header')?.className).toContain('flex-wrap');
  });
});
