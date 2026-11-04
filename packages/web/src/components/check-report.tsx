import {
  buildCopyText,
  type CheckDetail,
  type CheckSummary,
  type Finding,
  type Severity,
} from '@cc/shared';
import {
  CircleAlert,
  CircleCheck,
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
import { useRerunCheck } from '../lib/checks';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { useProjectRepos, useRepo } from '../lib/projects';
import { formatClock, formatDuration, formatWhen } from '../lib/time';
import { Callout } from './callout';
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

/** Consumer yang ikut diperiksa pada laporan bersih; jumlah file per repo tidak tersimpan. */
function CheckedConsumers({ names }: { names: readonly string[] }) {
  const t = useT();
  return (
    <section
      aria-label={t('report.clean.checked')}
      className="mb-6 overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest"
    >
      <h2 className="px-6 py-4 text-title font-medium">{t('report.clean.checked')}</h2>
      <ul>
        {names.map((name) => (
          <li key={name} className="flex items-center gap-3 border-t border-divider px-6 py-3">
            <CircleCheck aria-hidden className="size-[18px] shrink-0 text-on-success-container" />
            <span className="flex-1 font-medium">{name}</span>
            <span className="text-on-surface-variant">{t('report.clean.noConflict')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Hasil diff untuk laporan `spec_stale` saja: tidak ada dampak ke consumer. */
function StaleDiff({ check, searched }: { check: CheckDetail['check']; searched: boolean }) {
  const t = useT();
  return (
    <section
      aria-label={t('report.stale.diff.title')}
      className="mb-6 overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest"
    >
      <h2 className="px-6 py-4 text-title font-medium">{t('report.stale.diff.title')}</h2>
      <div className="flex items-start gap-2 border-t border-divider px-6 py-3">
        <CircleCheck aria-hidden className="size-5 shrink-0 text-on-success-container" />
        <div>
          {t('report.stale.diff.body', { base: check.base_ref, head: check.head_ref })}
          {!searched && (
            <div className="mt-1 text-on-surface-variant">{t('report.stale.diff.noSearch')}</div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Laporan check selesai (CC-082, CC-083): ringkasan, catatan per varian (spec usang, bersih, tanpa
 * check ini, tidak lengkap), filter severity + consumer, satu kartu per endpoint, dan footer.
 * `spec_stale` bukan milik endpoint mana pun, jadi tampil sebagai catatan, bukan kartu. Jumlah di
 * chip dihitung dari finding milik consumer yang dipilih; endpoint tanpa consumer hilang saat satu
 * consumer dipilih. Chip berjumlah 0 disembunyikan, kecuali "Semua" dan yang sedang aktif.
 */
export function CheckReport({ detail, summary }: { detail: CheckDetail; summary: CheckSummary }) {
  const t = useT();
  const { check, findings, provider_repo_name: provider } = detail;
  const { rerun, pending } = useRerunCheck(check);
  const projectRepos = useProjectRepos(check.project_id).data;
  const [filter, setFilter] = useState<Filter>('all');
  const [consumer, setConsumer] = useState('');

  const stale = findings.find((finding) => finding.kind === 'spec_stale');
  const impact = findings.filter((finding) => finding.kind !== 'spec_stale');
  const staleOnly =
    stale !== undefined && impact.length === 0 && summary.endpoints_without_consumer.length === 0;
  // Bersih = tidak ada break/warn (spec_stale dihitung warn, jadi laporan stale tidak pernah bersih).
  const clean = summary.counts.break === 0 && summary.counts.warn === 0;

  const consumers = [...new Set(impact.flatMap((finding) => finding.consumer_repo ?? []))].sort();
  const scoped =
    consumer === '' ? impact : impact.filter((finding) => finding.consumer_repo === consumer);
  const noConsumer = consumer === '' ? summary.endpoints_without_consumer : [];
  const shown = filter === 'all' ? scoped : scoped.filter((finding) => finding.severity === filter);
  const groups = filter === 'noConsumer' ? [] : groupByEndpoint(shown);
  const bare = filter === 'all' || filter === 'noConsumer' ? noConsumer : [];
  const filterable = impact.length + summary.endpoints_without_consumer.length > 0;

  const affected = new Set(impact.map((finding) => finding.endpoint));
  const checked = Object.keys(summary.consumer_shas);
  const repos = checked.length;
  // Konflik backend ke backend: semua consumer yang punya temuan berperan service.
  const backendOnly =
    consumers.length > 0 &&
    consumers.every((name) => projectRepos?.find((repo) => repo.name === name)?.role === 'service');

  const candidates: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('report.filter.all'), count: scoped.length + noConsumer.length },
    ...SEVERITIES.map((severity) => ({
      key: severity,
      label: t(`report.severity.${severity}`),
      count: scoped.filter((finding) => finding.severity === severity).length,
    })),
    { key: 'noConsumer', label: t('report.filter.noConsumer'), count: noConsumer.length },
  ];
  const chips = candidates.filter(({ key, count }) => key === 'all' || count > 0 || key === filter);

  const subtitle = [
    t('report.sub.done', {
      time: check.finished_at === null ? '—' : formatClock(check.finished_at),
    }),
    formatDuration(check.started_at, check.finished_at) ?? t('checks.noDuration'),
    ...(staleOnly
      ? []
      : [
          summary.files_via_hop2 > 0
            ? t('report.sub.filesHop2', {
                files: summary.files_checked,
                repos,
                hop2: summary.files_via_hop2,
              })
            : t('report.sub.files', { files: summary.files_checked, repos }),
          clean
            ? t('report.sub.nonBreaking', { n: summary.counts.info })
            : t('report.sub.affected', { n: affected.size }),
          ...(summary.endpoints_without_consumer.length > 0
            ? [t('report.sub.none', { n: summary.endpoints_without_consumer.length })]
            : []),
        ]),
  ].join(' · ');

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
        subtitle={subtitle}
        actions={
          <>
            {!staleOnly && (
              <Button variant="outlined" onClick={() => void copy()}>
                <Copy aria-hidden />
                {t('report.copy')}
              </Button>
            )}
            <Button disabled={pending} onClick={rerun}>
              <RefreshCw aria-hidden />
              {t('report.rerun')}
            </Button>
          </>
        }
      />

      {stale && (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t('report.stale.title')}
          tag="spec_stale"
        >
          <p>{stale.detail}</p>
          <p>{t('report.stale.hint', { provider })}</p>
        </Callout>
      )}
      {clean && (
        <Callout tone="success" icon={CircleCheck} title={t('report.clean.title')}>
          {t('report.clean.body')}
        </Callout>
      )}
      {summary.counts.break > 0 && (
        <Callout tone="info" icon={Info} title={t('report.callout.title')}>
          {t(backendOnly ? 'report.callout.bodyBackend' : 'report.callout.body')}
        </Callout>
      )}
      {summary.incomplete && (
        <Callout tone="warning" icon={TriangleAlert} title={t('report.incomplete.title')}>
          {t('report.incomplete.body', { n: summary.skipped_files })}
        </Callout>
      )}

      {filterable && (
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
      )}

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
      {filterable && groups.length === 0 && bare.length === 0 && (
        <p className="mb-6 text-body text-on-surface-variant">{t('report.empty')}</p>
      )}

      {staleOnly && <StaleDiff check={check} searched={repos > 0} />}
      {clean && repos > 0 && <CheckedConsumers names={checked} />}
      {clean && (
        <Callout tone="info" icon={Info} title={t('report.clean.limit.title')}>
          {t('report.clean.limit.body')}
        </Callout>
      )}

      {!staleOnly && (
        <>
          <Footer check={check} summary={summary} />
          <p className="text-label text-on-surface-variant">
            {t('report.artifacts', { path: `runs/checks/${check.id}/` })}
          </p>
        </>
      )}
    </>
  );
}
