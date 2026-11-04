import type { ProjectRepo } from '@cc/shared';
import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  ChevronRight,
  CircleCheck,
  Folder,
  Info,
  Pencil,
  Plus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';
import { useProject, useProjectRepos, useProjects, useRunDiscovery } from '../lib/projects';
import { AddRepoDialog } from './add-repo-dialog';
import { NewProjectDialog } from './new-project-dialog';
import { PageHeader } from './page-header';
import { QueryStatus } from './query-status';
import { Button, buttonVariants } from './ui/button';
import { Chip } from './ui/chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type ProfileStatus = ProjectRepo['profile_status'];

// Warna dan ikon dari Main.dc.html (mockup v2); status tanpa entri memakai chip netral.
const PROFILE_CHIP: Record<ProfileStatus, { className?: string; Icon?: LucideIcon }> = {
  approved: { className: 'bg-success-container text-on-success-container', Icon: CircleCheck },
  pending_review: { className: 'bg-warning-container text-on-warning-container', Icon: Pencil },
  not_scanned: {},
  scanning: {},
  skipped: {},
};

/** Discovery yang bisa dijalankan dari tombol project: belum dipindai atau draf belum disetujui. */
const needsDiscovery = (repo: ProjectRepo) =>
  repo.profile_status === 'not_scanned' || repo.profile_status === 'pending_review';

const mono = 'block truncate font-mono text-code text-on-surface-variant';

function SpecCell({ repo }: { repo: ProjectRepo }) {
  const t = useT();
  if (repo.role === 'e2e') {
    return <span className="text-label text-on-surface-variant">{t('repos.spec.e2e')}</span>;
  }
  if (repo.spec_path) return <span className={mono}>{repo.spec_path}</span>;
  return repo.role === 'service' ? (
    <span className="text-on-surface-variant italic">{t('repos.spec.empty')}</span>
  ) : (
    <span className="text-on-surface-variant">{t('repos.spec.none')}</span>
  );
}

function ProfileChip({ status }: { status: ProfileStatus }) {
  const t = useT();
  const { className, Icon } = PROFILE_CHIP[status];
  return (
    <Chip className={className} data-status={status}>
      {Icon && <Icon aria-hidden />}
      {t(`repos.profile.${status}`)}
    </Chip>
  );
}

function RepoTable({ repos }: { repos: readonly ProjectRepo[] }) {
  const t = useT();
  return (
    <div className="rounded-md border border-outline-variant bg-surface-container-lowest">
      <Table className="min-w-[980px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>{t('repos.col.name')}</TableHead>
            <TableHead className="w-40">{t('repos.col.role')}</TableHead>
            <TableHead>{t('repos.col.path')}</TableHead>
            <TableHead className="w-32">{t('repos.col.branch')}</TableHead>
            <TableHead>{t('repos.col.spec')}</TableHead>
            <TableHead className="w-44">{t('repos.col.profile')}</TableHead>
            <TableHead className="w-[76px]">
              <span className="sr-only">{t('table.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repos.map((repo) => (
            <TableRow key={repo.id}>
              <TableCell className="truncate font-medium">{repo.name}</TableCell>
              <TableCell>
                <Chip className="font-mono">{repo.role}</Chip>
              </TableCell>
              <TableCell>
                <span className={mono}>{repo.local_path}</span>
              </TableCell>
              <TableCell>
                <span className={mono}>{repo.default_branch}</span>
              </TableCell>
              <TableCell>
                <SpecCell repo={repo} />
              </TableCell>
              <TableCell>
                <ProfileChip status={repo.profile_status} />
              </TableCell>
              <TableCell className="px-0">
                <Link
                  to="/repos/$repoId/discovery"
                  params={{ repoId: String(repo.id) }}
                  aria-label={t('repos.review', { name: repo.name })}
                  className="flex size-11 items-center justify-center text-on-surface-variant"
                >
                  <ChevronRight aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Project tanpa repo (CC-077): dua syarat siap-check dan alasan dari server, bukan tombol mati. */
function EmptyRepos({ reason, onAdd }: { reason: string | null | undefined; onAdd: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-outline-variant bg-surface-container-lowest px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container"
      >
        <Folder className="size-7" />
      </span>
      <h2 className="text-[22px] leading-7 font-normal">{t('projects.empty.title')}</h2>
      <p className="max-w-[480px] text-body text-on-surface-variant">{t('projects.empty.body')}</p>
      <ul className="flex w-full max-w-[420px] flex-col gap-2 text-left">
        {(['projects.empty.needService', 'projects.empty.needConsumer'] as const).map((key) => (
          <li
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-outline-variant px-4 py-2.5"
          >
            {t(key)}
            <Chip>{t('projects.empty.notYet')}</Chip>
          </li>
        ))}
      </ul>
      <Button onClick={onAdd}>
        <Plus aria-hidden />
        {t('projects.addRepo')}
      </Button>
      {reason && <p className="text-label text-on-surface-variant">{reason}</p>}
    </div>
  );
}

/**
 * Layar Projects (CC-076): daftar project di kiri, project terpilih di kanan. Tanpa `projectId`
 * (rute `/`), project pertama yang terpilih. Kartu "Check terakhir" menunggu endpoint check (CC-064).
 */
export function ProjectsScreen({ projectId }: { projectId?: number }) {
  const t = useT();
  const projectsQuery = useProjects();
  const projects = projectsQuery.data;
  const current =
    projects && (projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId));
  const reposQuery = useProjectRepos(current?.id);
  const repos = reposQuery.data;
  // Alasan check belum bisa jalan hanya ditampilkan di state kosong, jadi hanya diminta di sana.
  const detail = useProject(repos?.length === 0 ? current?.id : undefined).data;
  const discovery = useRunDiscovery(current?.id ?? 0);
  const [adding, setAdding] = useState(false);

  const pendingReview = repos?.filter((repo) => repo.profile_status === 'pending_review').length;
  const subtitle =
    repos &&
    (pendingReview
      ? t('projects.summaryPending', { count: repos.length, pending: pendingReview })
      : t('projects.summary', { count: repos.length }));
  const runnable = repos?.filter(needsDiscovery) ?? [];

  return (
    <div className="flex flex-wrap items-start gap-8">
      <aside className="flex w-66 flex-none flex-col gap-3">
        <NewProjectDialog />
        <nav aria-label={t('projects.list')} className="flex flex-col gap-1">
          {projects?.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: String(project.id) }}
              aria-current={project.id === current?.id ? 'page' : undefined}
              className={cn(
                'flex min-h-14 items-center rounded-xl px-4 text-body font-medium',
                project.id === current?.id
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'text-on-surface hover:bg-surface-container',
              )}
            >
              {project.name}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-[999_1_560px]">
        <PageHeader
          title={current?.name ?? t('nav.projects')}
          subtitle={subtitle}
          actions={
            current && (
              <>
                <Link to="/panduan" className={buttonVariants({ variant: 'outlined' })}>
                  <BookOpen aria-hidden />
                  {t('projects.guide')}
                </Link>
                <Button
                  variant="outlined"
                  disabled={runnable.length === 0 || discovery.isPending}
                  onClick={() => discovery.mutate(runnable)}
                >
                  <Sparkles aria-hidden />
                  {t('projects.discover')}
                </Button>
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden />
                  {t('projects.addRepo')}
                </Button>
              </>
            )
          }
        />
        <QueryStatus queries={[projectsQuery, reposQuery]} />
        {projects && !current && <p>{t('projects.notFound')}</p>}
        {current && <AddRepoDialog project={current} open={adding} onOpenChange={setAdding} />}
        {repos && (
          <>
            {repos.length === 0 ? (
              <EmptyRepos reason={detail?.not_ready_reason} onAdd={() => setAdding(true)} />
            ) : (
              <RepoTable repos={repos} />
            )}
            <p className="mt-4 flex items-center gap-2 text-label text-on-surface-variant">
              <Info aria-hidden className="size-4 shrink-0" />
              {t('projects.readOnlyNote')}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
