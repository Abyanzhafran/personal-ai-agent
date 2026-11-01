import { createLink } from '@tanstack/react-router';
import { Folder, ListChecks, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCrumbs, type CrumbTo } from '../lib/crumbs';
import { useT, type MessageKey } from '../lib/i18n';
import { NavRail, NavRailItem } from './ui/nav-rail';
import { Toaster } from './ui/toast';

const RailLink = createLink(NavRailItem);

const DESTINATIONS: { to: CrumbTo; label: MessageKey; icon: ReactNode }[] = [
  { to: '/', label: 'nav.projects', icon: <Folder /> },
  { to: '/checks', label: 'nav.checks', icon: <ListChecks /> },
];

/** Rangka semua layar: nav rail 80 px di kiri; konten melipat ke bawah bila terlalu sempit. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const section = useCrumbs()[0]?.to;
  return (
    <div className="flex min-h-screen flex-wrap">
      <NavRail aria-label={t('nav.label')} data-testid="nav">
        <div
          role="img"
          aria-label={t('app.name')}
          className="mb-7 flex size-10 items-center justify-center rounded-md bg-primary text-on-primary"
        >
          <ShieldCheck size={22} />
        </div>
        {DESTINATIONS.map(({ to, label, icon }) => (
          <RailLink key={to} to={to} icon={icon} active={to === section}>
            {t(label)}
          </RailLink>
        ))}
      </NavRail>
      <main className="min-w-0 flex-[999_1_560px] px-10 pt-8 pb-12">{children}</main>
      <Toaster containerAriaLabel={t('toast.label')} />
    </div>
  );
}
