import { cleanup, screen, within } from '@testing-library/react';
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

const card = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('section') as HTMLElement;

describe('layar Panduan', () => {
  it('tertaut dua arah: tombol Panduan di Projects, tombol Buka Projects kembali', async () => {
    serve({
      'GET /api/projects': () => [project(1, 'Order Platform')],
      'GET /api/projects/1/repos': () => [repo({ id: 11, name: 'svc-order' })],
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Panduan' }));
    await screen.findByRole('heading', { level: 1, name: 'Contract Check' });

    await userEvent.click(screen.getByRole('link', { name: 'Buka Projects' }));
    await screen.findByRole('heading', { level: 1, name: 'Order Platform' });
  });

  it('halaman statis: tidak memanggil API, dua kartu masalah, empat langkah', async () => {
    renderAt('/panduan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Contract Check' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Tanpa tool ini',
      'Dengan Contract Check',
      'Cara pakai',
    ]);
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      'Daftarkan project',
      'Tinjau profil repo',
      'Jalankan check',
      'Baca laporan',
    ]);
  });

  it('hanya langkah dengan tujuan tanpa id yang punya tombol: Projects dan Checks', async () => {
    renderAt('/panduan');
    const list = await screen.findByRole('list');
    expect(
      within(list)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Buka Projects', '/'],
      ['Buka Checks', '/checks'],
    ]);
  });

  it('`kode` dan **tebal** di kamus menjadi <code> dan <b>, tanpa tanda aslinya', async () => {
    renderAt('/panduan');
    const without = await card('Tanpa tool ini');
    expect([...without.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'feature/xyz',
      'total',
      'page_size',
      'limit',
      'GET /orders',
      'page_size',
      'data.total',
      'element not found: order-total',
    ]);

    const withTool = await card('Dengan Contract Check');
    expect(withTool.querySelector('b')?.textContent).toBe('Jalankan check');
    for (const el of [without, withTool]) expect(el.textContent).not.toMatch(/[`*]/);
  });

  it('dua finding break menunjuk file dan baris consumer', async () => {
    renderAt('/panduan');
    const withTool = await card('Dengan Contract Check');
    const chips = withTool.querySelectorAll('[data-severity="break"]');
    expect([...chips].map((c) => c.textContent)).toEqual(['Break', 'Break']);
    expect(withTool.textContent).toContain('microfrontend-dashboard · src/api/orders.ts:42');
    expect(withTool.textContent).toContain('microfrontend-dashboard · src/pages/OrdersPage.tsx:88');
  });
});
