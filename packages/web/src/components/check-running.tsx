import type { CheckDetail, StepEvent, StepStatus } from '@cc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  LoaderCircle,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCancelCheck } from '../lib/checks';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { useCheckEvents } from '../lib/sse';
import { formatClock } from '../lib/time';
import { PageHeader } from './page-header';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Progress } from './ui/progress';

const STEPS = [1, 2, 3, 4, 5, 6] as const;

/** Tanda per langkah (Check berjalan di mockup): deterministik, atau memanggil Claude. */
const KIND = {
  1: 'deterministic',
  2: 'deterministic',
  3: 'claude',
  4: 'grepClaude',
  5: 'deterministic',
  6: 'deterministic',
} as const;

type RowStatus = StepStatus | 'waiting';

const ICON: Record<RowStatus, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Circle, className: 'text-outline' },
  running: { Icon: LoaderCircle, className: 'animate-spin text-primary' },
  done: { Icon: CircleCheck, className: 'text-on-success-container' },
  failed: { Icon: CircleAlert, className: 'text-on-error-container' },
  skipped: { Icon: CircleMinus, className: 'text-outline' },
};

function StepRow({ number, event }: { number: (typeof STEPS)[number]; event?: StepEvent }) {
  const t = useT();
  const status: RowStatus = event?.status ?? 'waiting';
  const { Icon, className } = ICON[status];
  const kind = KIND[number];
  return (
    <li
      data-status={status}
      className="flex items-start gap-4 border-t border-divider px-6 py-4 first:border-t-0"
    >
      <Icon
        role="img"
        aria-label={t(`run.status.${status}`)}
        className={cn('size-6 shrink-0', className)}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-title font-medium',
            status === 'waiting' && 'text-on-surface-variant',
          )}
        >
          {number}. {t(`run.step.${number}`)}
        </div>
        <div className="text-body text-on-surface-variant">
          {event?.detail || (event ? '' : t(`run.waiting.${number}`))}
        </div>
      </div>
      <Chip tone={kind === 'deterministic' ? 'neutral' : 'tonal'}>
        {kind !== 'deterministic' && <Sparkles aria-hidden />}
        {t(`run.kind.${kind}`)}
      </Chip>
    </li>
  );
}

/**
 * Layar Check berjalan (CC-081). Langkah dan log digerakkan event SSE; refresh halaman menyambung
 * ulang dan server mengirim buffer dari awal, jadi keadaan langkah pulih dari event, bukan dari DB.
 * Saat `done` datang, detail check dimuat ulang dan `CheckScreen` pindah ke tampilan selesai.
 */
export function CheckRunning({ detail }: { detail: CheckDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { check } = detail;
  const events = useCheckEvents(check.id);
  const cancel = useCancelCheck(check.id);
  const [confirming, setConfirming] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const lastStep = new Map<number, StepEvent>();
  for (const event of events) if (event.type === 'step') lastStep.set(event.number, event);
  const logs = events.filter((event) => event.type === 'log');
  const finished = events.some((event) => event.type === 'done');

  // "Langkah N dari 6": langkah yang sedang berjalan, atau yang terakhir terlihat.
  const running = [...lastStep.values()].find((event) => event.status === 'running')?.number;
  const current = running ?? Math.max(1, ...lastStep.keys());
  const percent = Math.round((current / STEPS.length) * 100);

  useEffect(() => {
    if (finished) void client.invalidateQueries({ queryKey: ['checks'] });
  }, [finished, client]);

  useEffect(() => {
    const panel = logRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [logs.length]);

  // `mutateAsync`, bukan callback `mutate`: sesudah sukses detail dimuat ulang dan layar ini
  // sudah dilepas sebelum callback `mutate` sempat jalan.
  async function confirmCancel() {
    try {
      await cancel.mutateAsync();
      void navigate({ to: '/checks' });
    } catch {
      // Galat sudah ditampilkan sebagai toast; dialog tinggal ditutup.
    }
    setConfirming(false);
  }

  return (
    <>
      <PageHeader
        title={t('run.title')}
        subtitle={`${detail.provider_repo_name} · ${check.base_ref} → ${check.head_ref} · ${t('run.startedAt', { time: formatClock(check.started_at) })}`}
        actions={
          <Button variant="outlined" onClick={() => setConfirming(true)}>
            {t('run.cancel')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-start gap-6">
        <section className="min-w-0 flex-[1_1_520px] overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
          <div className="px-6 pt-5 pb-4">
            <div className="mb-2 flex justify-between text-label text-on-surface-variant">
              <span>{t('run.stepOf', { n: current, total: STEPS.length })}</span>
              <span>{percent}%</span>
            </div>
            <Progress value={percent} aria-label={t('run.progress')} />
          </div>
          <ol aria-label={t('run.steps')}>
            {STEPS.map((number) => (
              <StepRow key={number} number={number} event={lastStep.get(number)} />
            ))}
          </ol>
        </section>

        <section className="min-w-0 flex-[1_1_420px] overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
          <h2 className="border-b border-divider px-6 py-4 text-title font-medium">
            {t('run.log')}
          </h2>
          <div
            ref={logRef}
            role="log"
            aria-label={t('run.log')}
            className="flex max-h-[480px] flex-col gap-1.5 overflow-y-auto bg-surface-container-high px-6 py-4 font-mono text-code"
          >
            {logs.map((log) => (
              <div key={log.seq} className="flex gap-3">
                <span className="flex-none text-on-surface-variant">
                  {formatClock(log.at, true)}
                </span>
                <span className="w-14 flex-none font-medium">{log.category}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle className="mb-2">{t('run.cancel.title')}</DialogTitle>
          <DialogDescription className="text-body">{t('run.cancel.body')}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="text">
                {t('run.cancel.keep')}
              </Button>
            </DialogClose>
            <Button type="button" disabled={cancel.isPending} onClick={() => void confirmCancel()}>
              {t('run.cancel.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
