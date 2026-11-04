import type { UseQueryResult } from '@tanstack/react-query';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useT } from '../lib/i18n';
import { Button } from './ui/button';

type StatusQuery = Pick<UseQueryResult, 'isLoading' | 'isError' | 'error' | 'refetch'>;

function Skeleton() {
  const t = useT();
  return (
    <div role="status" aria-label={t('state.loading')} className="flex flex-col gap-3">
      <div aria-hidden className="h-6 w-1/3 animate-pulse rounded-sm bg-neutral-container" />
      <div aria-hidden className="h-32 animate-pulse rounded-md bg-neutral-container" />
      <div aria-hidden className="h-32 animate-pulse rounded-md bg-neutral-container" />
    </div>
  );
}

/**
 * Status query utama sebuah layar: skeleton selama memuat, pesan galat + "Coba lagi" bila gagal,
 * dan tidak merender apa pun selain itu. Layar tetap merender datanya sendiri. Galat tetap juga
 * muncul sebagai toast (D-28); pesan di sini yang tidak hilang dan bisa dicoba ulang.
 */
export function QueryStatus({ queries }: { queries: readonly StatusQuery[] }) {
  const t = useT();
  const failed = queries.filter((query) => query.isError);
  const first = failed[0];
  if (first) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-outline-variant bg-surface-container-lowest px-6 py-5"
      >
        <p className="flex items-center gap-2">
          <CircleAlert aria-hidden className="size-5 shrink-0 text-on-error-container" />
          {first.error instanceof ApiError ? first.error.message : t('api.unexpected')}
        </p>
        <Button variant="outlined" onClick={() => failed.forEach((query) => void query.refetch())}>
          <RefreshCw aria-hidden />
          {t('state.retry')}
        </Button>
      </div>
    );
  }
  return queries.some((query) => query.isLoading) ? <Skeleton /> : null;
}
