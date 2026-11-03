import { Project, ProjectDetail, ProjectRepo, RepoProfileResponse } from '@cc/shared';
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
