import {
  buildCopyText,
  type CheckDetail,
  type CheckSummary,
  type Finding,
  type Severity,
} from '@cc/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  CircleAlert,
  CircleMinus,
  Code,
  Copy,
  Info,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { runningCheckId, useStartCheck } from '../lib/checks';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { useRepo } from '../lib/projects';
import { formatClock, formatDuration, formatWhen } from '../lib/time';
import { FilterChip } from './check-history';
import { PageHeader } from './page-header';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { SeverityChip } from './ui/severity-chip';

const SEVERITIES = ['break', 'warn', 'info'] as const;
const RANK: Record<Severity, number> = { break: 0, warn: 1, info: 2 };
type Filter = 'all' | Severity | 'noConsumer';

/** Sorot baris di cuplikan mengikuti severity finding (token di globals.css). */
const HIGHLIGHT: Record<Severity, string> = {
  break: 'bg-code-highlight-break',
  warn: 'bg-code-highlight-warn',
  info: 'bg-code-highlight-info',
};

/** Ikon di depan chip filter saat tidak aktif; warna mengikuti chip severity. */
const FILTER_ICON: Record<Severity | 'noConsumer', { Icon: LucideIcon; className: string }> = {
  break: { Icon: CircleAlert, className: 'text-on-error-container' },
  warn: { Icon: TriangleAlert, className: 'text-on-warning-container' },
  info: { Icon: Info, className: 'text-primary' },
  noConsumer: { Icon: CircleMinus, className: 'text-on-surface-variant' },
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Urutan yang sama dengan teks salin (CC-050): severity, repo, file, baris. */
const byWhere = (a: Finding, b: Finding) =>
  RANK[a.severity] - RANK[b.severity] ||
  compare(a.consumer_repo ?? '', b.consumer_repo ?? '') ||
  compare(a.file ?? '', b.file ?? '') ||
  (a.line ?? 0) - (b.line ?? 0);

const worst = (group: readonly Finding[]) =>
  Math.min(...group.map((finding) => RANK[finding.severity]));

/** Kartu per endpoint; endpoint dengan severity terburuk dulu, lalu menurut nama. */
function groupByEndpoint(findings: readonly Finding[]): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>();
  for (const finding of [...findings].sort(byWhere)) {
    const group = groups.get(finding.endpoint);
    if (group) group.push(finding);
    else groups.set(finding.endpoint, [finding]);
  }
  return [...groups].sort(([a, left], [b, right]) => worst(left) - worst(right) || compare(a, b));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Token yang membuat baris ini ditandai (nama field atau path) ditebalkan. */
function Emphasis({ text, tokens }: { text: string; tokens: readonly string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`));
  return <>{parts.map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part))}</>;
}

function Snippet({
  snippet,
  severity,
}: {
  snippet: NonNullable<Finding['snippet']>;
  severity: Severity;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-sm bg-surface-container-high py-2 font-mono text-code">
      <div className="min-w-max">
        {snippet.lines.map((line) => {
          const hit = line.n === snippet.highlight;
          return (
            <div
              key={line.n}
              data-highlight={hit ? severity : undefined}
              className={cn('flex', hit && HIGHLIGHT[severity])}
            >
              <span className="w-11 flex-none pr-3 text-right text-on-surface-variant">
                {line.n}
              </span>
              <span className="whitespace-pre">
                {hit ? <Emphasis text={line.text} tokens={snippet.tokens} /> : line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const t = useT();
  const { consumer_repo: repo, file, line, confidence, via_symbol: symbol, snippet } = finding;
  const where = [
    repo,
    symbol && t('report.viaHop2', { symbol }),
    confidence && t(`report.confidence.${confidence}`),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="border-t border-divider px-6 py-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_380px] flex-wrap items-center gap-2">
          <SeverityChip severity={finding.severity}>
            {t(`report.severity.${finding.severity}`)}
          </SeverityChip>
          <Chip className="font-mono">{finding.kind}</Chip>
          <span className="min-w-0 flex-[1_1_300px] text-body">{finding.detail}</span>
        </div>
        {repo !== null && file !== null && line !== null && (
          <div className="min-w-0 flex-[0_1_300px]">
            <div className="flex items-center gap-1.5 font-mono text-code">
              <Code aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 break-all">
                {file}:{line}
              </span>
            </div>
            <div className="pl-[22px] text-label text-on-surface-variant">{where}</div>
          </div>
        )}
      </div>
      {snippet && <Snippet snippet={snippet} severity={finding.severity} />}
    </div>
  );
}

function EndpointCard({
  endpoint,
  chips,
  children,
}: {
  endpoint: string;
  chips: ReactNode;
  children: ReactNode;
}) {
  const space = endpoint.indexOf(' ');
  return (
    <section
      aria-label={endpoint}
      className="mb-6 overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-surface-container px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {space > 0 && (
            <span className="font-mono text-label font-bold text-on-surface-variant">
              {endpoint.slice(0, space)}
            </span>
          )}
          <span className="font-mono text-title font-medium">{endpoint.slice(space + 1)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      </div>
      {children}
    </section>
  );
}

const code =
  'rounded-[4px] bg-neutral-container px-1.5 py-px font-mono text-[0.92em] text-on-surface';

function FindingsCard({
  endpoint,
  findings,
  matched,
}: {
  endpoint: string;
  findings: readonly Finding[];
  matched: readonly string[];
}) {
  const t = useT();
  return (
    <EndpointCard
      endpoint={endpoint}
      chips={SEVERITIES.map((severity) => {
        const count = findings.filter((finding) => finding.severity === severity).length;
        return (
          count > 0 && (
            <SeverityChip key={severity} severity={severity}>
              {t(`checks.result.${severity}`, { count })}
            </SeverityChip>
          )
        );
      })}
    >
      {findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
      {matched.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-divider px-6 py-3 text-code text-on-surface-variant">
          <span>{t('report.matched')}</span>
          {matched.map((name) => (
            <code key={name} className={code}>
              {name}
            </code>
          ))}
        </div>
      )}
    </EndpointCard>
  );
}

function NoConsumerCard({ endpoint, repos }: { endpoint: string; repos: number }) {
  const t = useT();
  return (
    <EndpointCard
      endpoint={endpoint}
      chips={<SeverityChip severity="info">{t('report.noConsumer.chip')}</SeverityChip>}
    >
      <div className="border-t border-divider px-6 py-4">
        <div className="text-code">{t('report.noConsumer.title')}</div>
        <div className="text-label text-on-surface-variant">
          {t('report.noConsumer.searched', { repos })}
        </div>
      </div>
      <p className="flex items-start gap-2 border-t border-divider px-6 py-3 text-code text-on-surface-variant">
        <Info aria-hidden className="mt-px size-[18px] shrink-0 text-primary" />
        {t('report.noConsumer.note')}
      </p>
    </EndpointCard>
  );
}

const sha7 = (sha: string | null) => sha?.slice(0, 7) ?? '—';

function Footer({ check, summary }: { check: CheckDetail['check']; summary: CheckSummary }) {
  const t = useT();
  const lastFetch = useRepo(check.provider_repo_id).data?.last_fetch_at;
  const mono = 'font-mono text-on-surface';
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-6 py-4 text-label text-on-surface-variant">
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <span>
          {t('report.footer.base')} <span className={mono}>{sha7(check.base_sha)}</span>
        </span>
        <span>
          {t('report.footer.head')}{' '}
          <span className={mono}>
            {check.head_ref} @ {sha7(check.head_sha)}
          </span>
        </span>
        {lastFetch !== undefined && (
          <span>
            {t('report.footer.fetch')}{' '}
            {lastFetch === null ? t('time.never') : formatWhen(lastFetch)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <span>{t('report.footer.consumers')}</span>
        {Object.entries(summary.consumer_shas).map(([name, sha]) => (
          <span key={name} className={mono}>
            {name} @ {sha7(sha)}
          </span>
        ))}
      </div>
      <div>{t('report.footer.legend')}</div>
    </div>
  );
}

/**
 * Laporan check yang menemukan dampak (CC-082): ringkasan, filter severity + consumer, satu kartu per
 * endpoint, dan footer metadata. Jumlah di chip dihitung dari finding milik consumer yang dipilih;
 * endpoint tanpa consumer bukan milik consumer mana pun, jadi hilang saat satu consumer dipilih.
 */
export function CheckReport({ detail, summary }: { detail: CheckDetail; summary: CheckSummary }) {
  const t = useT();
  const navigate = useNavigate();
  const start = useStartCheck();
  const [filter, setFilter] = useState<Filter>('all');
  const [consumer, setConsumer] = useState('');
  const { check, findings, provider_repo_name: provider } = detail;

  const consumers = [...new Set(findings.flatMap((finding) => finding.consumer_repo ?? []))].sort();
  const scoped =
    consumer === '' ? findings : findings.filter((finding) => finding.consumer_repo === consumer);
  const noConsumer = consumer === '' ? summary.endpoints_without_consumer : [];
  const shown = filter === 'all' ? scoped : scoped.filter((finding) => finding.severity === filter);
  const groups = filter === 'noConsumer' ? [] : groupByEndpoint(shown);
  const bare = filter === 'all' || filter === 'noConsumer' ? noConsumer : [];

  const affected = new Set(
    findings.filter((finding) => finding.kind !== 'spec_stale').map((finding) => finding.endpoint),
  );
  const repos = Object.keys(summary.consumer_shas).length;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('report.filter.all'), count: scoped.length + noConsumer.length },
    ...SEVERITIES.map((severity) => ({
      key: severity,
      label: t(`report.severity.${severity}`),
      count: scoped.filter((finding) => finding.severity === severity).length,
    })),
    { key: 'noConsumer', label: t('report.filter.noConsumer'), count: noConsumer.length },
  ];

  function rerun() {
    const open = (checkId: number) =>
      void navigate({ to: '/checks/$checkId', params: { checkId: String(checkId) } });
    start.mutate(
      {
        provider_repo_id: check.provider_repo_id,
        head_ref: check.head_ref,
        base_ref: check.base_ref,
      },
      {
        onSuccess: (created) => open(created.id),
        // Project ini sudah punya check berjalan: tampilkan yang itu, bukan galat buntu.
        onError: (error) => {
          const running = runningCheckId(error);
          if (running !== undefined) open(running);
        },
      },
    );
  }

  async function copy() {
    const text = buildCopyText({
      id: check.id,
      provider,
      base_ref: check.base_ref,
      head_ref: check.head_ref,
      base_sha: check.base_sha ?? '',
      head_sha: check.head_sha ?? '',
      summary,
      findings: findings.map((finding) => ({
        endpoint: finding.endpoint,
        location:
          finding.consumer_repo !== null && finding.file !== null && finding.line !== null
            ? { repo: finding.consumer_repo, file: finding.file, line: finding.line }
            : null,
        kind: finding.kind,
        severity: finding.severity,
        detail: finding.detail,
        confidence: finding.confidence,
        via_symbol: finding.via_symbol,
      })),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('report.copied'));
    } catch {
      toast.error(t('report.copyFailed'));
    }
  }

  return (
    <>
      <PageHeader
        title={t('report.title', { provider, base: check.base_ref, head: check.head_ref })}
        subtitle={t('report.summary', {
          time: check.finished_at === null ? '—' : formatClock(check.finished_at),
          duration: formatDuration(check.started_at, check.finished_at) ?? t('checks.noDuration'),
          files: summary.files_checked,
          repos,
          hop2: summary.files_via_hop2,
          endpoints: affected.size,
          none: summary.endpoints_without_consumer.length,
        })}
        actions={
          <>
            <Button variant="outlined" onClick={() => void copy()}>
              <Copy aria-hidden />
              {t('report.copy')}
            </Button>
            <Button disabled={start.isPending} onClick={rerun}>
              <RefreshCw aria-hidden />
              {t('report.rerun')}
            </Button>
          </>
        }
      />

      {summary.counts.break > 0 && (
        <aside
          aria-label={t('report.callout.title')}
          className="mb-6 flex items-start gap-3 rounded-md bg-surface-container px-6 py-4"
        >
          <Info aria-hidden className="size-6 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="font-medium">{t('report.callout.title')}</div>
            <div className="text-on-surface-variant">{t('report.callout.body')}</div>
          </div>
        </aside>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <div role="group" aria-label={t('report.filter.label')} className="flex flex-wrap gap-2">
          {chips.map(({ key, label, count }) => {
            const icon = key === 'all' ? undefined : FILTER_ICON[key];
            return (
              <FilterChip
                key={key}
                active={filter === key}
                onClick={() => setFilter(key)}
                icon={
                  icon && <icon.Icon aria-hidden className={cn('size-[18px]', icon.className)} />
                }
              >
                {label} {count}
              </FilterChip>
            );
          })}
        </div>
        <select
          aria-label={t('report.consumer.label')}
          value={consumer}
          onChange={(event) => setConsumer(event.target.value)}
          className="h-8 rounded-sm border border-outline bg-transparent px-3 text-body font-medium text-on-surface"
        >
          <option value="">{t('report.consumer.all')}</option>
          {consumers.map((name) => (
            <option key={name} value={name}>
              {t('report.consumer.one', { name })}
            </option>
          ))}
        </select>
      </div>

      {groups.map(([endpoint, group]) => (
        <FindingsCard
          key={endpoint}
          endpoint={endpoint}
          findings={group}
          matched={summary.matched_fields[endpoint] ?? []}
        />
      ))}
      {bare.map((endpoint) => (
        <NoConsumerCard key={endpoint} endpoint={endpoint} repos={repos} />
      ))}
      {groups.length === 0 && bare.length === 0 && (
        <p className="mb-6 text-body text-on-surface-variant">{t('report.empty')}</p>
      )}

      <Footer check={check} summary={summary} />
      <p className="text-label text-on-surface-variant">
        {t('report.artifacts', { path: `runs/checks/${check.id}/` })}
      </p>
    </>
  );
}
