import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { useApiMutation } from './mutation';
import { createQueryClient } from './query-client';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

function setup(mutationFn: () => Promise<unknown>) {
  const client = createQueryClient();
  const projects = vi.fn().mockResolvedValue(['order']);
  const checks = vi.fn().mockResolvedValue([]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      // Dua query aktif: hanya yang kuncinya diawali 'projects' yang boleh dimuat ulang.
      useQuery({ queryKey: ['projects', 'list'], queryFn: projects });
      useQuery({ queryKey: ['checks', 'list'], queryFn: checks });
      return useApiMutation({ mutationFn, invalidates: [['projects']] });
    },
    { wrapper },
  );
  return { ...hook, projects, checks };
}

describe('useApiMutation', () => {
  it('mutasi berhasil memuat ulang query terkait saja', async () => {
    const { result, projects, checks } = setup(() => Promise.resolve({ id: 1 }));
    await waitFor(() => expect(projects).toHaveBeenCalledTimes(1));

    await act(() => result.current.mutateAsync());

    expect(projects).toHaveBeenCalledTimes(2);
    expect(checks).toHaveBeenCalledTimes(1);
  });

  it('mutasi gagal tidak memuat ulang apa pun dan galatnya menjadi toast', async () => {
    const { result, projects } = setup(() =>
      Promise.reject(new ApiError(409, 'project_slug_taken', 'Slug sudah dipakai')),
    );
    await waitFor(() => expect(projects).toHaveBeenCalledTimes(1));

    await act(() => result.current.mutateAsync().catch(() => undefined));

    expect(projects).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Slug sudah dipakai');
  });
});
