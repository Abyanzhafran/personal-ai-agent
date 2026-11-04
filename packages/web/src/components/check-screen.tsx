import { ApiError } from '../lib/api';
import { useCheck } from '../lib/checks';
import { useT } from '../lib/i18n';
import { CheckRunning } from './check-running';
import { PageHeader } from './page-header';
import { PlaceholderScreen } from './PlaceholderScreen';

/**
 * `/checks/$checkId` memilih tampilan dari status check: berjalan → progres SSE (CC-081), selesai →
 * laporan (CC-082, sementara masih placeholder). Selama data belum ada atau check tidak ada, yang
 * tampil header dengan breadcrumb, supaya halaman tidak kosong.
 */
export function CheckScreen({ checkId }: { checkId: number }) {
  const t = useT();
  const { data, error } = useCheck(checkId);

  if (!data) {
    return (
      <>
        <PageHeader title={t('breadcrumb.check', { id: checkId })} />
        {error instanceof ApiError && error.status === 404 && <p>{t('check.notFound')}</p>}
      </>
    );
  }
  return data.check.status === 'running' ? (
    <CheckRunning detail={data} />
  ) : (
    <PlaceholderScreen route="/checks/$checkId" params={{ checkId: String(checkId) }} />
  );
}
