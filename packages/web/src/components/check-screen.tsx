import { ApiError } from '../lib/api';
import { useCheck } from '../lib/checks';
import { useT } from '../lib/i18n';
import { CheckReport } from './check-report';
import { CheckRunning } from './check-running';
import { CheckStopped } from './check-stopped';
import { PageHeader } from './page-header';
import { PlaceholderScreen } from './PlaceholderScreen';
import { QueryStatus } from './query-status';

/**
 * `/checks/$checkId` memilih tampilan dari status check: berjalan → progres SSE (CC-081), selesai
 * (temuan atau bersih) → laporan (CC-082, CC-083), gagal atau dibatalkan → alasan + Jalankan ulang
 * (CC-083). Selama data belum ada atau check tidak ada, yang tampil header dengan breadcrumb,
 * supaya halaman tidak kosong. Placeholder hanya untuk hasil selesai tanpa ringkasan, yang tidak
 * pernah ditulis server.
 */
export function CheckScreen({ checkId }: { checkId: number }) {
  const t = useT();
  const query = useCheck(checkId);
  const { data, error } = query;

  if (!data) {
    return (
      <>
        <PageHeader title={t('breadcrumb.check', { id: checkId })} />
        {error instanceof ApiError && error.status === 404 ? (
          <p>{t('check.notFound')}</p>
        ) : (
          <QueryStatus queries={[query]} />
        )}
      </>
    );
  }
  const { status } = data.check;
  if (status === 'running') return <CheckRunning detail={data} />;
  if ((status === 'findings' || status === 'clean') && data.summary) {
    return <CheckReport detail={data} summary={data.summary} />;
  }
  if (status === 'failed' || status === 'cancelled') return <CheckStopped detail={data} />;
  return <PlaceholderScreen route="/checks/$checkId" params={{ checkId: String(checkId) }} />;
}
