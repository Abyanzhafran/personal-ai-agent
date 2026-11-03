import { Link } from '@tanstack/react-router';
import { Code as CodeIcon, CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useT, type MessageKey } from '../lib/i18n';
import { cn } from '../lib/cn';
import { PageHeader } from './page-header';
import { buttonVariants } from './ui/button';
import { Chip } from './ui/chip';
import { SeverityChip } from './ui/severity-chip';

function Code({ className, ...props }: ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'rounded-[4px] bg-neutral-container px-1.5 py-px font-mono text-[0.92em]',
        className,
      )}
      {...props}
    />
  );
}

/** Teks kamus: `kode` menjadi <code>, **tebal** menjadi <b>. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
        if (part.startsWith('`')) return <Code key={i}>{part.slice(1, -1)}</Code>;
        if (part.startsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
        return part;
      })}
    </>
  );
}

function Card({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 flex-[1_1_440px] overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
      <header className="flex items-center justify-between gap-2 bg-surface-container px-6 py-3">
        <h2 className="text-title font-medium">{title}</h2>
        {badge}
      </header>
      <div className="px-6 pb-3">{children}</div>
    </section>
  );
}

function Row({ day, repo, children }: { day: string; repo: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-t border-divider py-3">
      <div className="w-30 flex-none">
        <div className="text-code font-medium">{day}</div>
        <div className="font-mono text-label text-on-surface-variant">{repo}</div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const WITHOUT_ROWS = ['mon', 'tue', 'wed'] as const;
const FINDINGS = ['sent', 'read'] as const;

interface Step {
  title: MessageKey;
  body: MessageKey;
  /** Hanya langkah yang punya layar tujuan tanpa id yang diberi tombol. */
  link?: { to: '/' | '/checks'; label: MessageKey };
}

const STEPS: Step[] = [
  {
    title: 'guide.step.register.title',
    body: 'guide.step.register.body',
    link: { to: '/', label: 'guide.step.register.open' },
  },
  { title: 'guide.step.review.title', body: 'guide.step.review.body' },
  {
    title: 'guide.step.run.title',
    body: 'guide.step.run.body',
    link: { to: '/checks', label: 'guide.step.run.open' },
  },
  { title: 'guide.step.read.title', body: 'guide.step.read.body' },
];

/** Halaman statis "Masalah dan cara pakai" (CC-084), tertaut dari tombol Panduan di layar Projects. */
export function GuideScreen() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('guide.title')} subtitle={t('guide.subtitle')} />

      <div className="mb-10 flex flex-wrap gap-6">
        <Card
          title={t('guide.without.title')}
          badge={
            <Chip className="bg-error-container text-on-error-container">
              <CircleAlert aria-hidden />
              {t('guide.without.badge')}
            </Chip>
          }
        >
          {WITHOUT_ROWS.map((row) => (
            <Row
              key={row}
              day={t(`guide.without.${row}.day`)}
              repo={t(`guide.without.${row}.repo`)}
            >
              <Rich text={t(`guide.without.${row}.text`)} />
            </Row>
          ))}
        </Card>

        <Card
          title={t('guide.with.title')}
          badge={
            <Chip className="bg-success-container text-on-success-container">
              <CircleCheck aria-hidden />
              {t('guide.with.badge')}
            </Chip>
          }
        >
          <Row day={t('guide.with.day')} repo={t('guide.with.repo')}>
            <Rich text={t('guide.with.run')} />
          </Row>
          <div className="flex flex-col gap-2 border-t border-divider pt-3">
            {FINDINGS.map((finding) => (
              <div key={finding} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity="break">{t('guide.with.break')}</SeverityChip>
                  <Code>{t('guide.with.endpoint')}</Code>
                  <span>
                    <Rich text={t(`guide.with.${finding}.text`)} />
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pl-1 font-mono text-code">
                  <CodeIcon aria-hidden className="size-4 shrink-0" />
                  {t(`guide.with.${finding}.at`)}
                </div>
              </div>
            ))}
            <p className="pt-1 text-on-surface-variant">{t('guide.with.fix')}</p>
          </div>
        </Card>
      </div>

      <h2 className="mb-4 text-[22px] leading-7 font-normal">{t('guide.steps.title')}</h2>
      <ol className="mb-10 flex flex-wrap gap-4">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-6 py-5"
          >
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-full bg-secondary-container font-medium text-on-secondary-container"
            >
              {i + 1}
            </span>
            <h3 className="text-title font-medium">{t(step.title)}</h3>
            <p className="flex-1 text-on-surface-variant">{t(step.body)}</p>
            {step.link && (
              <div>
                <Link to={step.link.to} className={buttonVariants({ variant: 'outlined' })}>
                  {t(step.link.label)}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="flex items-start gap-2 text-label text-on-surface-variant">
        <Info aria-hidden className="size-4 shrink-0" />
        <span>
          <Rich text={t('guide.note')} />
        </span>
      </p>
    </>
  );
}
