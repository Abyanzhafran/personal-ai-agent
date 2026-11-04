import type { CheckEvent, Project, ProjectRepo } from '@cc/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';

/** Alat bersama test layar yang memanggil API: `fetch` palsu yang dijawab per rute. */

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

/**
 * Menjawab `fetch` menurut "METODE /path"; rute yang tidak terdaftar dijawab 404. Rute yang
 * mengembalikan `Response` (galat) atau promise-nya (jawaban yang ditahan) dipakai apa adanya.
 */
export function serve(routes: Record<string, () => unknown>) {
  fetchMock.mockImplementation((url, init) => {
    const method = init?.method ?? 'GET';
    const body = routes[`${method} ${url}`]?.();
    if (body instanceof Response || body instanceof Promise) return Promise.resolve(body);
    return Promise.resolve(
      body === undefined
        ? json({ error: { code: 'tidak_ada', message: 'Tidak ada', details: null } }, 404)
        : json(body, method === 'POST' ? 202 : 200),
    );
  });
}

/**
 * jsdom tidak punya EventSource. Pasang dengan `vi.stubGlobal('EventSource', FakeEventSource)` dan
 * kosongkan `instances` tiap test; `emit` mengirim event ke pendengar seperti server SSE.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(event: CheckEvent) {
    const message = new MessageEvent(event.type, { data: JSON.stringify(event) });
    for (const listener of this.listeners.get(event.type) ?? []) listener(message);
  }
}

export const project = (id: number, name: string): Project => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  description: null,
});

/** Repo di project 1, belum dipindai; `fields` menimpa. */
export const repo = (
  fields: Partial<ProjectRepo> & Pick<ProjectRepo, 'id' | 'name'>,
): ProjectRepo => ({
  project_id: 1,
  role: 'service',
  local_path: `/work/${fields.name}`,
  default_branch: 'main',
  spec_path: null,
  spec_cmd: null,
  profile_status: 'not_scanned',
  profile_error: null,
  last_fetch_at: null,
  ...fields,
});

export function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...view };
}
