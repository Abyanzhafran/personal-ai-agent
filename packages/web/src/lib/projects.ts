import {
  Project,
  ProjectDetail,
  ProjectRepo,
  Repo,
  RepoProfileResponse,
  type Role,
} from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { useApiMutation } from './mutation';

/** Selama ada repo yang dipindai, daftar ditanyakan lagi sampai discovery di server selesai. */
const SCAN_POLL_MS = 2000;

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch('/api/projects', Project.array()),
  });

export const useProjectRepos = (projectId: number | undefined) =>
  useQuery({
    queryKey: ['projects', projectId, 'repos'],
    queryFn: () => apiFetch(`/api/projects/${projectId}/repos`, ProjectRepo.array()),
    enabled: projectId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.some((repo) => repo.profile_status === 'scanning') ? SCAN_POLL_MS : false,
  });

export const useProject = (projectId: number | undefined) =>
  useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => apiFetch(`/api/projects/${projectId}`, ProjectDetail),
    enabled: projectId !== undefined,
  });

/** `description` kosong disimpan server sebagai tanpa deskripsi. */
export const useCreateProject = () =>
  useApiMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiFetch('/api/projects', Project, { method: 'POST', body }),
    invalidates: [['projects']],
  });

/** Server mendeteksi `default_branch` dari origin/HEAD bila kosong, dan `name` dari folder bila tidak dikirim. */
export const useCreateRepo = (projectId: number) =>
  useApiMutation({
    mutationFn: (body: { role: Role; local_path: string; name?: string; default_branch: string }) =>
      apiFetch(`/api/projects/${projectId}/repos`, Repo, { method: 'POST', body }),
    invalidates: [['projects', projectId]],
  });

export const useRepo = (repoId: number) =>
  useQuery({
    queryKey: ['repos', repoId],
    queryFn: () => apiFetch(`/api/repos/${repoId}`, Repo),
  });

export const useRepoProfile = (repoId: number) =>
  useQuery({
    queryKey: ['repos', repoId, 'profile'],
    queryFn: () => apiFetch(`/api/repos/${repoId}/profile`, RepoProfileResponse),
    refetchInterval: (query) => (query.state.data?.status === 'scanning' ? SCAN_POLL_MS : false),
  });

/** Pindai ulang satu repo (202); hasilnya dipantau lewat `useRepoProfile`. */
export const useRescan = (repo: Repo) =>
  useApiMutation({
    mutationFn: () =>
      apiFetch(`/api/repos/${repo.id}/discovery`, RepoProfileResponse, { method: 'POST' }),
    invalidates: [
      ['repos', repo.id],
      ['projects', repo.project_id, 'repos'],
    ],
  });

/** `spec_cmd` null mengosongkan perintah; `apply_spec_path` menyalin `spec_path` draf ke repo. */
export const useApproveProfile = (repo: Repo) =>
  useApiMutation({
    mutationFn: (body: { profile_md: string; apply_spec_path: boolean; spec_cmd: string | null }) =>
      apiFetch(`/api/repos/${repo.id}/profile`, RepoProfileResponse, { method: 'PUT', body }),
    invalidates: [
      ['repos', repo.id],
      ['projects', repo.project_id],
    ],
  });

/** Memulai discovery untuk repo yang diberikan; server membalas 202 dan memindai di latar belakang. */
export const useRunDiscovery = (projectId: number) =>
  useApiMutation({
    mutationFn: (repos: readonly ProjectRepo[]) =>
      Promise.all(
        repos.map((repo) =>
          apiFetch(`/api/repos/${repo.id}/discovery`, RepoProfileResponse, { method: 'POST' }),
        ),
      ),
    invalidates: [['projects', projectId, 'repos']],
  });
