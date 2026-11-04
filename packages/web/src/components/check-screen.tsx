import { ApiError } from '../lib/api';
import { useCheck } from '../lib/checks';
import { useT } from '../lib/i18n';
import { CheckReport } from './check-report';
import { CheckRunning } from './check-running';
import { PageHeader } from './page-header';
import { PlaceholderScreen } from './PlaceholderScreen';

/**
 * `/checks/$checkId` memilih tampilan dari status check: berjalan → progres SSE (CC-081), selesai →
 * laporan (CC-082) bila ada temuan; status lain (bersih, gagal, dibatalkan) sementara placeholder
 * sampai CC-083. Selama data belum ada atau check tidak ada, yang tampil header dengan breadcrumb,
 * supaya halaman tidak kosong.
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
  if (data.check.status === 'running') return <CheckRunning detail={data} />;
  if (data.check.status === 'findings' && data.summary) {
    return <CheckReport detail={data} summary={data.summary} />;
  }
  return <PlaceholderScreen route="/checks/$checkId" params={{ checkId: String(checkId) }} />;
}
