import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { createAppRouter } from '../router';

// Kamus diganti nilai penanda: teks shell yang berubah ikut kamus, bukan hardcode.
vi.mock('../locales/id', () => ({
  id: { 'nav.projects': 'P-KAMUS', 'nav.checks': 'C-KAMUS', 'nav.guide': 'G-KAMUS' },
}));

afterEach(cleanup);

it('teks navigasi shell datang dari kamus', async () => {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const nav = await screen.findByTestId('nav');
  const labels = within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
  expect(labels).toEqual(['P-KAMUS', 'C-KAMUS', 'G-KAMUS']);
});
