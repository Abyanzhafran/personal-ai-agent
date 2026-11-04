import { ApiError } from '../lib/api';
import { useCheck } from '../lib/checks';
import { useT } from '../lib/i18n';
import { CheckRunning } from './check-running';
import { PlaceholderScreen } from './PlaceholderScreen';

/**
 * `/checks/$checkId` memilih tampilan dari status check: berjalan → progres SSE (CC-081), selesai →
 * laporan (CC-082, sementara masih placeholder).
 */
export function CheckScreen({ checkId }: { checkId: number }) {
  const t = useT();
  const { data, error } = useCheck(checkId);

  if (error instanceof ApiError && error.status === 404) return <p>{t('check.notFound')}</p>;
  if (!data) return null;
  return data.check.status === 'running' ? (
    <CheckRunning detail={data} />
  ) : (
    <PlaceholderScreen route="/checks/$checkId" params={{ checkId: String(checkId) }} />
  );
}
