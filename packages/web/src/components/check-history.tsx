import { CHECK_PAGE_SIZES, type CheckListItem } from '@cc/shared';
import { Link } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChecksSearch } from '../lib/checks';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { formatDuration, formatWhen } from '../lib/time';
import { Chip } from './ui/chip';
import { SeverityChip } from './ui/severity-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Counts = { total: number; by_project: { project_id: number; name: string; count: number }[] };

/** Kolom Hasil. `spec_stale` diturunkan dari findings; finding itu juga dihitung warn, jadi dikurangi. */
function ResultChips({ item }: { item: CheckListItem }) {
  const t = useT();
  const { status, counts, spec_stale: specStale } = item;
  const warn = (counts?.warn ?? 0) - (specStale ? 1 : 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === 'running' && <Chip>{t('checks.result.running')}</Chip>}
      {status === 'clean' && (
        <SeverityChip severity="clean">{t('checks.result.clean')}</SeverityChip>
      )}
      {status === 'cancelled' && (
        <SeverityChip severity="cancelled">{t('checks.result.cancelled')}</SeverityChip>
      )}
      {status === 'failed' && (
        <>
          <SeverityChip severity="failed">{t('checks.result.failed')}</SeverityChip>
          {item.error && (
            <span className="font-mono text-label text-on-surface-variant">{item.error}</span>
          )}
        </>
      )}
      {status === 'findings' && (
        <>
          {counts && counts.break > 0 && (
            <SeverityChip severity="break">
              {t('checks.result.break', { count: counts.break })}
            </SeverityChip>
          )}
          {warn > 0 && (
            <SeverityChip severity="warn">{t('checks.result.warn', { count: warn })}</SeverityChip>
          )}
          {counts && counts.info > 0 && (
            <SeverityChip severity="info">
              {t('checks.result.info', { count: counts.info })}
            </SeverityChip>
          )}
          {specStale && (
            <SeverityChip severity="spec_stale">{t('checks.result.specStale')}</SeverityChip>
          )}
        </>
      )}
    </div>
  );
}

/** Chip filter; `icon` tampil di depan hanya saat tidak aktif (aktif = tanda centang). */
export function FilterChip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm px-3 text-body font-medium',
        active
          ? 'bg-secondary-container text-on-secondary-container'
          : 'border border-outline bg-transparent text-on-surface',
      )}
    >
      {active ? <Check aria-hidden className="size-[18px]" /> : icon}
      {children}
    </button>
  );
}

const pageButton =
  'inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container disabled:pointer-events-none disabled:opacity-[0.38]';

/**
 * Riwayat check (CC-080): chip filter per project beserta jumlahnya, tabel delapan kolom, dan
 * pagination. Filter dan halaman hidup di search params URL; mengganti filter atau ukuran halaman
 * kembali ke halaman 1.
 */
export function CheckHistory({
  items,
  counts,
  totalItems,
  page,
  pageSize,
  search,
  onSearch,
}: {
  items: readonly CheckListItem[];
  counts: Counts;
  totalItems: number;
  page: number;
  pageSize: number;
  search: ChecksSearch;
  onSearch: (next: ChecksSearch) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(totalItems / pageSize));
  const goTo = (target: number) => onSearch({ ...search, page: target <= 1 ? undefined : target });

  return (
    <section className="rounded-md border border-outline-variant bg-surface-container-lowest">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-divider px-6 py-4">
        <h2 className="text-title font-medium">{t('checks.history')}</h2>
        <div role="group" aria-label={t('checks.filter.label')} className="flex flex-wrap gap-2">
          <FilterChip
            active={search.project === undefined}
            onClick={() => onSearch({ ...search, project: undefined, page: undefined })}
          >
            {t('checks.filter.all')} {counts.total}
          </FilterChip>
          {counts.by_project.map((entry) => (
            <FilterChip
              key={entry.project_id}
              active={search.project === entry.project_id}
              onClick={() => onSearch({ ...search, project: entry.project_id, page: undefined })}
            >
              {entry.name} {entry.count}
            </FilterChip>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-8 text-body text-on-surface-variant">{t('checks.empty')}</p>
      ) : (
        <Table className="min-w-[1200px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t('checks.col.id')}</TableHead>
              <TableHead className="w-44">{t('checks.col.when')}</TableHead>
              <TableHead className="w-40">{t('checks.col.project')}</TableHead>
              <TableHead className="w-40">{t('checks.col.provider')}</TableHead>
              <TableHead>{t('checks.col.refs')}</TableHead>
              <TableHead className="w-[320px]">{t('checks.col.result')}</TableHead>
              <TableHead className="w-28">{t('checks.col.duration')}</TableHead>
              <TableHead className="w-[76px]">
                <span className="sr-only">{t('table.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-on-surface-variant">{item.id}</TableCell>
                <TableCell>
                  <span className="block truncate">{formatWhen(item.started_at)}</span>
                </TableCell>
                <TableCell className="truncate text-on-surface-variant">
                  {item.project_name}
                </TableCell>
                <TableCell className="truncate font-medium">{item.provider_repo_name}</TableCell>
                <TableCell>
                  <span className="block truncate font-mono text-code">
                    {item.base_ref} → {item.head_ref}
                  </span>
                </TableCell>
                <TableCell>
                  <ResultChips item={item} />
                </TableCell>
                <TableCell className="text-on-surface-variant">
                  {formatDuration(item.started_at, item.finished_at) ?? t('checks.noDuration')}
                </TableCell>
                <TableCell className="px-0">
                  <Link
                    to="/checks/$checkId"
                    params={{ checkId: String(item.id) }}
                    aria-label={t('checks.open', { id: item.id })}
                    className="flex size-11 items-center justify-center text-on-surface-variant"
                  >
                    <ChevronRight aria-hidden />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-divider px-6 py-2 text-label text-on-surface-variant">
        <label className="flex items-center gap-2">
          {t('checks.pageSize')}
          <select
            value={pageSize}
            onChange={(event) =>
              onSearch({ ...search, page_size: Number(event.target.value), page: undefined })
            }
            className="h-8 rounded-sm border border-outline bg-transparent px-2 text-body text-on-surface"
          >
            {CHECK_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t('checks.range', {
            from: totalItems === 0 ? 0 : (page - 1) * pageSize + 1,
            to: Math.min(page * pageSize, totalItems),
            total: totalItems,
          })}
        </span>
        <div className="flex">
          <button
            type="button"
            aria-label={t('checks.prev')}
            disabled={page <= 1}
            onClick={() => goTo(Math.min(page - 1, pages))}
            className={pageButton}
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('checks.next')}
            disabled={page >= pages}
            onClick={() => goTo(page + 1)}
            className={pageButton}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
