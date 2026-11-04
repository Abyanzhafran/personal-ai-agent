import { useNavigate } from '@tanstack/react-router';
import { Play, RefreshCw } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  runningCheckId,
  useFetchProject,
  useRepoCompare,
  useRepoRefs,
  useStartCheck,
} from '../lib/checks';
import { useT } from '../lib/i18n';
import { useProject, useProjectRepos, useProjects } from '../lib/projects';
import { formatAgo } from '../lib/time';
import { useDebounced } from '../lib/use-debounced';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { TextField } from './ui/text-field';

const code =
  'rounded-[4px] bg-neutral-container px-1.5 py-px font-mono text-[0.92em] text-on-surface';

/**
 * Form "Check baru" (CC-080): project, provider (repo service), base dan head ref, strip info, dan
 * tombol Jalankan check. Mengganti project atau provider mengosongkan ref yang sudah diketik.
 */
export function NewCheckCard() {
  const t = useT();
  const navigate = useNavigate();
  const refListId = useId();
  const projects = useProjects().data;
  const [projectId, setProjectId] = useState<number>();
  const [providerId, setProviderId] = useState<number>();
  const [typedBase, setTypedBase] = useState<string>();
  const [head, setHead] = useState('');

  const project = projects?.find((p) => p.id === projectId) ?? projects?.[0];
  const repos = useProjectRepos(project?.id).data;
  const detail = useProject(project?.id).data;
  const providers = repos?.filter((repo) => repo.role === 'service') ?? [];
  const provider = providers.find((repo) => repo.id === providerId) ?? providers[0];
  const base = typedBase ?? provider?.default_branch ?? '';
  const refs = useRepoRefs(provider?.id).data;
  const compare = useRepoCompare(provider?.id, useDebounced(base), useDebounced(head)).data;

  const start = useStartCheck();
  const fetchProject = useFetchProject(project?.id ?? 0);

  const consumers = repos?.filter((repo) => repo.id !== provider?.id && repo.role !== 'e2e') ?? [];
  const hasE2e = repos?.some((repo) => repo.role === 'e2e') ?? false;
  const lastFetch =
    repos
      ?.flatMap((repo) => (repo.last_fetch_at === null ? [] : [repo.last_fetch_at]))
      .sort()
      .at(-1) ?? null;
  const ready = detail?.ready_for_check === true;
  const canRun =
    ready && provider !== undefined && base.trim() !== '' && head.trim() !== '' && !start.isPending;

  const pickProject = (id: number) => {
    setProjectId(id);
    setProviderId(undefined);
    setTypedBase(undefined);
    setHead('');
  };
  const pickProvider = (id: number) => {
    setProviderId(id);
    setTypedBase(undefined);
    setHead('');
  };

  // Branch dibaca dari origin (hasil fetch); tag dan commit apa adanya.
  const shown = (ref: string) =>
    refs?.some((r) => r.name === ref && r.kind === 'branch') ? `origin/${ref}` : ref;

  function run(event: FormEvent) {
    event.preventDefault();
    if (!provider || !canRun) return;
    const open = (checkId: number) =>
      void navigate({ to: '/checks/$checkId', params: { checkId: String(checkId) } });
    start.mutate(
      { provider_repo_id: provider.id, head_ref: head.trim(), base_ref: base.trim() },
      {
        onSuccess: (check) => open(check.id),
        // Project ini sudah punya check berjalan: tampilkan yang itu, bukan galat buntu.
        onError: (error) => {
          const running = runningCheckId(error);
          if (running !== undefined) open(running);
        },
      },
    );
  }

  function fetchNow() {
    fetchProject.mutate(undefined, {
      onSuccess: (results) => {
        const failed = results.filter((result) => !result.ok).map((result) => result.name);
        if (failed.length > 0) toast.error(t('checks.fetchFailed', { names: failed.join(', ') }));
      },
    });
  }

  return (
    <section className="mb-6 rounded-md border border-outline-variant bg-surface-container-lowest px-6 py-5">
      <h2 className="mb-5 text-title font-medium">{t('checks.new')}</h2>
      {projects?.length === 0 && <p>{t('checks.noProjects')}</p>}
      {projects && project && (
        <form onSubmit={run}>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
            <div className="min-w-0 flex-[1_1_180px]">
              <Select
                label={t('checks.field.project')}
                supporting={t('checks.hint.projects', { count: projects.length })}
                value={project.id}
                onChange={(event) => pickProject(Number(event.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 flex-[1_1_180px]">
              <Select
                label={t('checks.field.provider')}
                supporting={
                  provider &&
                  t('checks.hint.spec', { spec: provider.spec_path ?? t('repos.spec.empty') })
                }
                value={provider?.id ?? ''}
                onChange={(event) => pickProvider(Number(event.target.value))}
              >
                {providers.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 flex-[1_1_180px]">
              <TextField
                label={t('checks.field.base')}
                supporting={t('checks.hint.base')}
                className="font-mono"
                list={refListId}
                value={base}
                onChange={(event) => setTypedBase(event.target.value)}
              />
            </div>
            <div className="min-w-0 flex-[1_1_180px]">
              <TextField
                label={t('checks.field.head')}
                supporting={t('checks.hint.head')}
                className="font-mono"
                list={refListId}
                value={head}
                onChange={(event) => setHead(event.target.value)}
              />
            </div>
            <datalist id={refListId}>
              {refs?.map((ref) => (
                <option key={`${ref.kind}:${ref.name}`} value={ref.name} />
              ))}
            </datalist>
            <Button type="submit" size="large" disabled={!canRun}>
              <Play aria-hidden />
              {t('checks.run')}
            </Button>
          </div>
          {detail && !detail.ready_for_check && detail.not_ready_reason && (
            <p role="status" className="mt-3 text-label text-on-surface-variant">
              {detail.not_ready_reason}
            </p>
          )}
        </form>
      )}

      {project && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-surface-container px-4 py-3 text-label text-on-surface-variant">
            {base.trim() !== '' && head.trim() !== '' && (
              <span>{t('checks.read.from', { base: shown(base), head: shown(head) })}</span>
            )}
            {compare?.ok && (
              <span>
                {t('checks.read.mergeBase', { sha: compare.compare.merge_base.slice(0, 7) })}
              </span>
            )}
            {compare && !compare.ok && (
              <span role="alert" className="text-on-error-container">
                {compare.message}
              </span>
            )}
            <span>{t('checks.read.lastFetch', { ago: formatAgo(lastFetch) })}</span>
            <Button
              type="button"
              variant="outlined"
              disabled={fetchProject.isPending}
              onClick={fetchNow}
            >
              <RefreshCw aria-hidden />
              {t('checks.fetchNow')}
            </Button>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-label text-on-surface-variant">
            {consumers.length > 0 && (
              <>
                <span>{t('checks.consumers.before')}</span>
                {consumers.map((repo) => (
                  <code key={repo.id} className={code}>
                    {repo.name}
                  </code>
                ))}
                <span>{t('checks.consumers.after')}</span>
              </>
            )}
            {hasE2e && <span>{t('checks.consumers.e2e')}</span>}
            <span>{t('checks.oneAtATime')}</span>
          </p>
        </>
      )}
    </section>
  );
}
