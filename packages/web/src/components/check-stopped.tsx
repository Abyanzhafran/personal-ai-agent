import type { CheckDetail } from '@cc/shared';
import { CircleAlert, CircleMinus, RefreshCw } from 'lucide-react';
import { useRerunCheck } from '../lib/checks';
import { useT } from '../lib/i18n';
import { formatClock, formatDuration } from '../lib/time';
import { Callout } from './callout';
import { PageHeader } from './page-header';
import { Button } from './ui/button';

/**
 * Check yang berhenti tanpa laporan (CC-083): `failed` dengan alasan dari `checks.error`, atau
 * `cancelled`. Tanpa daftar finding; satu-satunya aksi adalah Jalankan ulang.
 */
export function CheckStopped({ detail }: { detail: CheckDetail }) {
  const t = useT();
  const { check, provider_repo_name: provider } = detail;
  const { rerun, pending } = useRerunCheck(check);
  const failed = check.status === 'failed';
  const subtitle = t(failed ? 'stopped.failed.subtitle' : 'stopped.cancelled.subtitle', {
    time: check.finished_at === null ? '—' : formatClock(check.finished_at),
    duration: formatDuration(check.started_at, check.finished_at) ?? t('checks.noDuration'),
  });
  return (
    <>
      <PageHeader
        title={t('report.title', { provider, base: check.base_ref, head: check.head_ref })}
        subtitle={subtitle}
        actions={
          <Button disabled={pending} onClick={rerun}>
            <RefreshCw aria-hidden />
            {t('report.rerun')}
          </Button>
        }
      />
      {failed ? (
        <Callout tone="error" icon={CircleAlert} title={t('stopped.failed.title')}>
          {check.error && <p className="font-mono text-code">{check.error}</p>}
        </Callout>
      ) : (
        <Callout tone="info" icon={CircleMinus} title={t('stopped.cancelled.title')}>
          {t('stopped.cancelled.body')}
        </Callout>
      )}
    </>
  );
}
