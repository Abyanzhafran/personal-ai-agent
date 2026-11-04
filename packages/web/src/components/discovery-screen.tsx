import type { ProjectRepo, Repo, RepoProfile, RepoProfileResponse } from '@cc/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, CircleCheck, Pencil, Sparkles, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import {
  useApproveProfile,
  useProjectRepos,
  useProjects,
  useRepo,
  useRepoProfile,
  useRescan,
} from '../lib/projects';
import { PageHeader } from './page-header';
import { QueryStatus } from './query-status';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { TextField } from './ui/text-field';

// Ikon status di tab (Discovery.dc.html); status lain, termasuk e2e, tanpa ikon.
const TAB_ICON: Partial<
  Record<ProjectRepo['profile_status'], { Icon: LucideIcon; className: string }>
> = {
  approved: { Icon: CircleCheck, className: 'text-on-success-container' },
  pending_review: { Icon: Pencil, className: 'text-on-warning-container' },
};

// Judul `#` profil menjadi `h2`: halaman ini sudah punya `h1`.
const PREVIEW_HEADINGS = { h1: 'h2', h2: 'h3', h3: 'h4' } as const;
const PREVIEW_STYLE =
  '[&_:is(h2,h3,h4)]:mb-4 [&_h2]:text-[22px] [&_h2]:leading-7 [&_:is(h3,h4)]:text-title [&_:is(h3,h4)]:font-medium [&_p]:mb-2.5 [&_ul]:list-disc [&_ol]:list-decimal [&_:is(ul,ol)]:pl-5 [&_li]:mb-2.5 [&_code]:rounded-[4px] [&_code]:bg-neutral-container [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.92em]';

function RepoTabs({ repos, currentId }: { repos: readonly ProjectRepo[]; currentId: number }) {
  const t = useT();
  return (
    <nav
      aria-label={t('discovery.tabs')}
      className="mb-6 flex overflow-x-auto border-b border-divider"
    >
      {repos.map((repo) => {
        const icon = TAB_ICON[repo.profile_status];
        const current = repo.id === currentId;
        return (
          <Link
            key={repo.id}
            to="/repos/$repoId/discovery"
            params={{ repoId: String(repo.id) }}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex h-12 items-center gap-2 px-4 text-body font-medium whitespace-nowrap',
              current
                ? 'text-primary shadow-[inset_0_-3px_0_var(--color-primary)]'
                : 'text-on-surface-variant',
            )}
          >
            {icon && <icon.Icon aria-hidden className={cn('size-4', icon.className)} />}
            {repo.name}
          </Link>
        );
      })}
    </nav>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-outline-variant bg-surface-container-lowest p-6 text-body text-on-surface-variant">
      {children}
    </p>
  );
}

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-[1_1_480px] overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
      <div className="flex h-12 items-center border-b border-divider bg-surface-container px-5 text-body font-medium">
        {title}
      </div>
      {children}
    </div>
  );
}

interface ReviewProps {
  repo: Repo;
  repos: readonly ProjectRepo[] | undefined;
  /** Folder profil: `contexts/projects/<slug>/`; kosong selama daftar project belum termuat. */
  slug: string | undefined;
}

/** Judul, tab repo, dan isi halaman; `actions` dan `children` datang dari keadaan profilnya. */
function Frame({
  repo,
  repos,
  actions,
  children,
}: Pick<ReviewProps, 'repo' | 'repos'> & { actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t('discovery.title')}
        subtitle={t('discovery.subtitle')}
        actions={actions}
      />
      {repos && <RepoTabs repos={repos} currentId={repo.id} />}
      {children}
    </>
  );
}

function NotScanned({
  repo,
  repos,
  error,
}: Pick<ReviewProps, 'repo' | 'repos'> & { error: string | null }) {
  const t = useT();
  const rescan = useRescan(repo);
  return (
    <Frame
      repo={repo}
      repos={repos}
      actions={
        <Button variant="outlined" disabled={rescan.isPending} onClick={() => rescan.mutate()}>
          <Sparkles aria-hidden />
          {t('discovery.rescan')}
        </Button>
      }
    >
      <Message>
        {t('discovery.notScanned')}
        {error && ` ${t('discovery.lastError', { error })}`}
      </Message>
    </Frame>
  );
}

/**
 * Editor profil (draf atau yang sudah disetujui). Isiannya dimulai dari `draft` saat dipasang; layar
 * memasangnya ulang bila draf dari server berganti, jadi pindai ulang menggantikan isi editor.
 */
function ProfileEditor({
  repo,
  repos,
  slug,
  draft,
  error,
}: ReviewProps & { draft: RepoProfile; error: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const rescan = useRescan(repo);
  const approve = useApproveProfile(repo);
  const applyId = useId();
  const [markdown, setMarkdown] = useState(draft.profile_md);
  const [specCmd, setSpecCmd] = useState(draft.spec_cmd ?? '');
  const [applySpecPath, setApplySpecPath] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const dirty = markdown !== draft.profile_md || specCmd !== (draft.spec_cmd ?? '');

  function submit() {
    approve.mutate(
      {
        profile_md: markdown,
        apply_spec_path: applySpecPath && draft.spec_path !== null,
        spec_cmd: specCmd.trim() === '' ? null : specCmd,
      },
      {
        onSuccess: () =>
          void navigate({
            to: '/projects/$projectId',
            params: { projectId: String(repo.project_id) },
          }),
      },
    );
  }

  return (
    <Frame
      repo={repo}
      repos={repos}
      actions={
        <>
          <Button
            variant="outlined"
            disabled={rescan.isPending}
            onClick={() => (dirty ? setConfirming(true) : rescan.mutate())}
          >
            <Sparkles aria-hidden />
            {t('discovery.rescan')}
          </Button>
          <Button disabled={approve.isPending || markdown.trim() === ''} onClick={submit}>
            <Check aria-hidden />
            {t('discovery.approve')}
          </Button>
        </>
      }
    >
      {error && <Message>{t('discovery.lastError', { error })}</Message>}
      <div className="flex flex-wrap gap-6">
        <Pane title={t('discovery.editor')}>
          <textarea
            aria-label={t('discovery.editorLabel')}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            className="block h-[380px] w-full resize-none bg-surface-container-lowest px-5 py-4 font-mono text-code leading-[22px] text-on-surface"
          />
        </Pane>
        <Pane title={t('discovery.preview')}>
          <div
            className={cn(
              'h-[380px] overflow-auto px-5 py-4 text-body leading-[22px]',
              PREVIEW_STYLE,
            )}
          >
            <Markdown components={PREVIEW_HEADINGS}>{markdown}</Markdown>
          </div>
        </Pane>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md bg-surface-container px-4 py-2">
        {draft.spec_path !== null ? (
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={applyId}
              checked={applySpecPath}
              onCheckedChange={(checked) => setApplySpecPath(checked === true)}
            />
            <label htmlFor={applyId} className="text-body">
              {t('discovery.applySpecPath', { path: draft.spec_path })}
            </label>
          </div>
        ) : (
          <span />
        )}
        {slug && (
          <span className="font-mono text-label text-on-surface-variant">
            {`contexts/projects/${slug}/${repo.name}.md`}
          </span>
        )}
      </div>
      <div className="mt-6 max-w-xl [--field-bg:var(--color-surface)]">
        <TextField
          label={t('discovery.specCmd')}
          supporting={t('discovery.specCmdHint')}
          className="font-mono"
          value={specCmd}
          onChange={(event) => setSpecCmd(event.target.value)}
        />
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>{t('discovery.confirmTitle')}</DialogTitle>
          <DialogDescription className="text-body">{t('discovery.confirmBody')}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="text">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button
              onClick={() => {
                setConfirming(false);
                rescan.mutate();
              }}
            >
              {t('discovery.rescan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>
  );
}

/** Body menurut keadaan profil: e2e, sedang dipindai, belum dipindai, atau ada profil untuk ditinjau. */
function Review({ profile, ...props }: ReviewProps & { profile: RepoProfileResponse }) {
  const t = useT();
  const { repo, repos } = props;
  if (profile.status === 'skipped') {
    return (
      <Frame repo={repo} repos={repos}>
        <Message>{t('discovery.skipped')}</Message>
      </Frame>
    );
  }
  if (profile.status === 'scanning') {
    return (
      <Frame repo={repo} repos={repos}>
        <Message>{t('discovery.scanning')}</Message>
      </Frame>
    );
  }
  if (profile.profile === null)
    return <NotScanned repo={repo} repos={repos} error={profile.error} />;
  return (
    <ProfileEditor
      key={`${repo.id}:${JSON.stringify(profile.profile)}`}
      {...props}
      draft={profile.profile}
      error={profile.error}
    />
  );
}

/** Layar Tinjau profil repo (CC-079). */
export function DiscoveryScreen({ repoId }: { repoId: number }) {
  const t = useT();
  const repoQuery = useRepo(repoId);
  const profileQuery = useRepoProfile(repoId);
  const repo = repoQuery.data;
  const profile = profileQuery.data;
  const repos = useProjectRepos(repo?.project_id).data;
  const slug = useProjects().data?.find((project) => project.id === repo?.project_id)?.slug;

  if (!repo || !profile) {
    return (
      <>
        <PageHeader title={t('discovery.title')} />
        <QueryStatus queries={[repoQuery, profileQuery]} />
      </>
    );
  }
  return <Review repo={repo} repos={repos} slug={slug} profile={profile} />;
}
