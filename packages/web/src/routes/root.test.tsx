import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import type { id as realId } from '../locales/id';
import { createAppRouter } from '../router';

// Setiap teks kamus diganti penanda `§kunci§`: teks shell yang bukan penanda berarti hardcode.
vi.mock('../locales/id', async (importOriginal) => {
  const { id } = await importOriginal<{ id: typeof realId }>();
  return { id: Object.fromEntries(Object.keys(id).map((key) => [key, `§${key}§`])) };
});

// /checks/42 memuat check lewat API; yang diuji di sini hanya teks shell, jadi jawabannya kosong.
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('[]')));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Sisa teks yang diizinkan: pemisah breadcrumb "/" (tanda baca) dan petunjuk tombol pintas "alt+T"
// yang ditambahkan sonner ke nama wadah toast.
const withoutMarkers = (text: string) => text.replace(/§[^§]+§/g, '').replace(/[\s/]|alt\+T/g, '');

it('teks shell (nav, logo, breadcrumb, wadah toast) seluruhnya datang dari kamus', async () => {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ['/checks/42'] }),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: '§breadcrumb.label§' });

  const shell = document.body.cloneNode(true) as HTMLElement;
  // Judul dan isi diberikan layar ke PageHeader; hanya breadcrumb-nya milik shell.
  for (const el of shell.querySelectorAll('h1, pre')) el.remove();
  expect(shell.textContent).toContain('§nav.checks§');
  expect(withoutMarkers(shell.textContent)).toBe('');

  const labels = [...shell.querySelectorAll('[aria-label]')].map((el) =>
    el.getAttribute('aria-label'),
  );
  expect(labels).toEqual(
    expect.arrayContaining(['§nav.label§', '§app.name§', '§breadcrumb.label§']),
  );
  for (const label of labels) expect(withoutMarkers(label ?? '')).toBe('');
});

it('layar Panduan: seluruh teksnya datang dari kamus dan setiap kunci guide.* terpakai', async () => {
  const { id } = await vi.importActual<{ id: typeof realId }>('../locales/id');
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ['/panduan'] }),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const main = await screen.findByRole('main');
  await screen.findByRole('heading', { level: 1 });

  // Nomor langkah adalah angka dekoratif (aria-hidden), bukan teks bahasa.
  const shown = main.cloneNode(true) as HTMLElement;
  for (const el of shown.querySelectorAll('[aria-hidden="true"]')) el.remove();
  const text = shown.textContent ?? '';
  expect(withoutMarkers(text)).toBe('');
  for (const key of Object.keys(id).filter((k) => k.startsWith('guide.'))) {
    expect(text).toContain(`§${key}§`);
  }
  for (const el of main.querySelectorAll('[aria-label], [title]')) {
    expect(withoutMarkers(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '')).toBe(
      '',
    );
  }
});
