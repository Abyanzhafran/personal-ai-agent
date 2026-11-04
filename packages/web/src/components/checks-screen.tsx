import { DEFAULT_CHECK_PAGE_SIZE } from '@cc/shared';
import { useChecks, type ChecksSearch } from '../lib/checks';
import { useT } from '../lib/i18n';
import { CheckHistory } from './check-history';
import { NewCheckCard } from './new-check-card';
import { PageHeader } from './page-header';

/**
 * Layar Checks (CC-080): form Check baru di atas, riwayat di bawah. Filter project, halaman, dan
 * ukuran halaman datang dari search params rute (`search`) dan diubah lewat `onSearch`.
 */
export function ChecksScreen({
  search,
  onSearch,
}: {
  search: ChecksSearch;
  onSearch: (next: ChecksSearch) => void;
}) {
  const t = useT();
  const page = search.page ?? 1;
  const pageSize = search.page_size ?? DEFAULT_CHECK_PAGE_SIZE;
  const checks = useChecks({ project: search.project, page, page_size: pageSize }).data;

  const scope =
    search.project === undefined
      ? t('checks.scope.all')
      : (checks?.counts.by_project.find((p) => p.project_id === search.project)?.name ?? '');
  const subtitle = checks && t('checks.subtitle', { scope, count: checks.total_items });

  return (
    <>
      <PageHeader title={t('nav.checks')} subtitle={subtitle} />
      <NewCheckCard />
      {checks && (
        <CheckHistory
          items={checks.items}
          counts={checks.counts}
          totalItems={checks.total_items}
          page={page}
          pageSize={pageSize}
          search={search}
          onSearch={onSearch}
        />
      )}
    </>
  );
}
