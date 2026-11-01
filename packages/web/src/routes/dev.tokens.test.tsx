import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_TOKENS, FONT_TOKENS, RADIUS_TOKENS, TEXT_TOKENS } from '../design/tokens';
import { createQueryClient } from '../lib/query-client';
import { createAppRouter } from '../router';

afterEach(cleanup);

describe('/dev/tokens', () => {
  it('menampilkan seluruh token: warna, radius, font, dan skala teks', async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ['/dev/tokens'] }),
    });
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('tokens-page');

    const shown = [...container.querySelectorAll('[data-token]')].map((el) =>
      el.getAttribute('data-token'),
    );
    const expected = [
      ...COLOR_TOKENS.map((t) => `color-${t}`),
      ...RADIUS_TOKENS.map((t) => `radius-${t}`),
      ...FONT_TOKENS.map((t) => `font-${t}`),
      ...TEXT_TOKENS.map((t) => `text-${t}`),
    ];
    expect(shown.sort()).toEqual(expected.sort());
  });

  it('swatch memakai var(--color-*), bukan nilai hex', async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ['/dev/tokens'] }),
    });
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('tokens-page');
    const swatch = container.querySelector('[data-token="color-primary"] span');
    expect((swatch as HTMLElement).style.backgroundColor).toBe('var(--color-primary)');
  });
});
