import {
  CHECK_PAGE_SIZES,
  Check,
  CheckDetail,
  CheckList,
  ERROR_CODES,
  RepoCompare,
  RepoFetchResult,
  RepoRef,
} from '@cc/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiError, apiFetch } from './api';
import { useApiMutation } from './mutation';

/** Search params `/checks`: filter project, halaman, ukuran halaman. Kosong = semua, halaman 1, default. */
export interface ChecksSearch {
  project?: number | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
}

const positiveInt = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

/** Nilai yang tidak sah dibuang diam-diam (URL diketik tangan), bukan dijadikan galat. */
export function parseChecksSearch(search: Record<string, unknown>): ChecksSearch {
  const size = positiveInt(search['page_size']);
  return {
    project: positiveInt(search['project']),
    page: positiveInt(search['page']),
    page_size: size !== undefined && CHECK_PAGE_SIZES.some((n) => n === size) ? size : undefined,
  };
}

/** Riwayat satu halaman; halaman sebelumnya tetap tampil selama halaman baru dimuat. */
export const useChecks = ({
  project,
  page,
  page_size,
}: {
  project?: number | undefined;
  page: number;
  page_size: number;
}) => {
  const params = new URLSearchParams();
  if (project !== undefined) params.set('project', String(project));
  params.set('page', String(page));
  params.set('page_size', String(page_size));
  return useQuery({
    queryKey: ['checks', { project, page, page_size }],
    queryFn: () => apiFetch(`/api/checks?${params}`, CheckList),
    placeholderData: keepPreviousData,
  });
};

/** Check + finding + ringkasan. Kuncinya `['checks', id]`, jadi mutasi yang menginvalidasi `['checks']` ikut memuat ulang. */
export const useCheck = (checkId: number) =>
  useQuery({
    queryKey: ['checks', checkId],
    queryFn: () => apiFetch(`/api/checks/${checkId}`, CheckDetail),
    // Check yang tidak ada tidak akan muncul karena dicoba ulang; pesannya langsung tampil.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 1,
  });

/** Menunggu statusnya tertulis (D-59), jadi sesudah sukses check sudah `cancelled`. */
export const useCancelCheck = (checkId: number) =>
  useApiMutation({
    mutationFn: () => apiFetch(`/api/checks/${checkId}/cancel`, Check, { method: 'POST' }),
    invalidates: [['checks']],
  });

/** Branch `origin` lalu tag, untuk saran isian ref. */
export const useRepoRefs = (repoId: number | undefined) =>
  useQuery({
    queryKey: ['repos', repoId, 'refs'],
    queryFn: () => apiFetch(`/api/repos/${repoId}/refs`, RepoRef.array()),
    enabled: repoId !== undefined,
  });

export type CompareState = { ok: true; compare: RepoCompare } | { ok: false; message: string };

/**
 * Merge-base untuk ref yang sedang diketik. Ref yang belum ada (404) adalah jawaban, bukan galat:
 * dikembalikan sebagai `{ ok: false }` supaya mengetik tidak memunculkan toast di tiap tombol.
 */
export const useRepoCompare = (repoId: number | undefined, base: string, head: string) =>
  useQuery({
    queryKey: ['repos', repoId, 'compare', base, head],
    queryFn: async (): Promise<CompareState> => {
      const params = new URLSearchParams({ base, head });
      try {
        const compare = await apiFetch(`/api/repos/${repoId}/compare?${params}`, RepoCompare);
        return { ok: true, compare };
      } catch (error) {
        if (error instanceof ApiError && error.code === ERROR_CODES.ref_not_found) {
          return { ok: false, message: error.message };
        }
        throw error;
      }
    },
    enabled: repoId !== undefined && base !== '' && head !== '',
  });

/** Fetch semua repo project. Hasil per repo ada di respons; kegagalan satu repo bukan galat HTTP. */
export const useFetchProject = (projectId: number) =>
  useApiMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/fetch`, RepoFetchResult.array(), { method: 'POST' }),
    invalidates: [['projects', projectId, 'repos'], ['repos']],
  });

/** 202: check sudah berjalan di latar belakang; layar pindah ke check itu. */
export const useStartCheck = () =>
  useApiMutation({
    mutationFn: (body: { provider_repo_id: number; head_ref: string; base_ref: string }) =>
      apiFetch('/api/checks', Check, { method: 'POST', body }),
    invalidates: [['checks']],
  });

/** Id check yang sedang berjalan bila galat ini 409 `check_already_running`; selain itu undefined. */
export function runningCheckId(error: unknown): number | undefined {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.check_already_running) {
    return undefined;
  }
  const id = (error.details as { check_id?: unknown } | null)?.check_id;
  return typeof id === 'number' ? id : undefined;
}

/**
 * "Jalankan ulang": check baru dengan ref yang sama lalu dibuka. Bila project sudah punya check
 * berjalan (409), yang itu yang dibuka, bukan galat buntu.
 */
export function useRerunCheck(check: Pick<Check, 'provider_repo_id' | 'head_ref' | 'base_ref'>) {
  const navigate = useNavigate();
  const start = useStartCheck();
  const open = (checkId: number) =>
    void navigate({ to: '/checks/$checkId', params: { checkId: String(checkId) } });
  return {
    pending: start.isPending,
    rerun: () =>
      start.mutate(
        {
          provider_repo_id: check.provider_repo_id,
          head_ref: check.head_ref,
          base_ref: check.base_ref,
        },
        {
          onSuccess: (created) => open(created.id),
          onError: (error) => {
            const running = runningCheckId(error);
            if (running !== undefined) open(running);
          },
        },
      ),
  };
}
