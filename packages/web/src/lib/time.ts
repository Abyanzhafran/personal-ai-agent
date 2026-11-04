import { locale, t } from './i18n';

const pad = (value: number) => String(value).padStart(2, '0');
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

/** "Hari ini, 14:32", "Kemarin, 17:20", atau "25 Okt, 09:14", dalam zona waktu lokal. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `${t('time.today')}, ${time}`;
  if (days === 1) return `${t('time.yesterday')}, ${time}`;
  return `${dayMonth.format(date)}, ${time}`;
}

/** "13:42" atau, dengan `seconds`, "13:42:01", dalam zona waktu lokal. */
export function formatClock(iso: string, seconds = false): string {
  const date = new Date(iso);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return seconds ? `${clock}:${pad(date.getSeconds())}` : clock;
}

/** "3 menit lalu"; null berarti belum pernah. Selisih negatif (jam bergeser) dibaca "baru saja". */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return t('time.never');
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { n: minutes });
  if (minutes < 24 * 60) return t('time.hoursAgo', { n: Math.floor(minutes / 60) });
  return t('time.daysAgo', { n: Math.floor(minutes / (24 * 60)) });
}

/** "48 dtk" atau "1 mnt 5 dtk"; null selama check belum selesai. */
export function formatDuration(startedAt: string, finishedAt: string | null): string | null {
  if (finishedAt === null) return null;
  const seconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
  return seconds < 60
    ? t('time.seconds', { n: seconds })
    : t('time.minutesSeconds', { m: Math.floor(seconds / 60), s: seconds % 60 });
}
