import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import type { id as realId } from '../locales/id';
import { createAppRouter } from '../router';

// Setiap teks kamus diganti penanda `§kunci§`: teks shell yang bukan penanda berarti hardcode.
vi.mock('../locales/id', async (importOriginal) => {
  const { id } = await importOriginal<{ id: typeof realId }>();
  return { id: Object.fromEntries(Object.keys(id).map((key) => [key, `§${key}§`])) };
});

afterEach(cleanup);

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
  await screen.findByTestId('screen');

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
