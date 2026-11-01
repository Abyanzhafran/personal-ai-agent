import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { createAppRouter } from '../router';

afterEach(cleanup);

async function renderUiPage() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ['/dev/ui'] }),
  });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('ui-page');
  return view;
}

describe('/dev/ui', () => {
  it('menampilkan setiap komponen dari kartu CC-072', async () => {
    const { container } = await renderUiPage();
    const shown = [...container.querySelectorAll('[data-component]')].map((el) =>
      el.getAttribute('data-component'),
    );
    expect(shown.sort()).toEqual(
      [
        'button',
        'text-field',
        'textarea',
        'select',
        'checkbox',
        'chip',
        'severity-chip',
        'tabs',
        'table',
        'progress',
        'dialog',
        'toast',
        'nav-rail',
      ].sort(),
    );
  });

  it('menampilkan varian: empat gaya tombol dua ukuran, tujuh severity, dua nada chip', async () => {
    const { container } = await renderUiPage();
    const buttons = [...container.querySelectorAll('[data-component="button"] button')];
    const has = (cls: string) => buttons.some((b) => b.className.split(' ').includes(cls));
    for (const cls of [
      'bg-primary',
      'bg-secondary-container',
      'border-outline',
      'bg-transparent',
    ]) {
      expect(has(cls), cls).toBe(true);
    }
    expect(has('h-10')).toBe(true);
    expect(has('h-14')).toBe(true);
    expect(buttons.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);

    const severities = [...container.querySelectorAll('[data-severity]')].map((el) =>
      el.getAttribute('data-severity'),
    );
    for (const s of ['break', 'warn', 'info', 'clean', 'spec_stale', 'cancelled', 'failed']) {
      expect(severities, s).toContain(s);
    }
    expect(container.querySelectorAll('[data-component="chip"] span').length).toBe(2);
  });

  it('dialog terbuka dari tombol dan Esc menutupnya; progress punya aria-valuenow', async () => {
    const user = userEvent.setup();
    const { container } = await renderUiPage();

    const bars = [...container.querySelectorAll('[role="progressbar"]')];
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['0', '50', '100']);

    await user.click(screen.getByRole('button', { name: 'Buka dialog' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
