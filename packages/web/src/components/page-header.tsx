import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import { useCrumbs } from '../lib/crumbs';
import { useT } from '../lib/i18n';

function Breadcrumb() {
  const t = useT();
  const crumbs = useCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={t('breadcrumb.label')} className="text-label text-on-surface-variant">
      {crumbs.map((crumb, index) => {
        const text = t(crumb.label, crumb.vars);
        const last = index === crumbs.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true"> / </span>}
            {crumb.to && !last ? (
              <Link to={crumb.to} className="text-primary hover:underline">
                {text}
              </Link>
            ) : (
              <span aria-current={last ? 'page' : undefined}>{text}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Tombol aksi di kanan; melipat ke bawah judul bila sempit. */
  actions?: ReactNode;
}

/** Header halaman: breadcrumb (dari rute), judul, subjudul, aksi. Teks datang dari pemanggil. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Breadcrumb />
        <h1 className="mt-1 text-headline font-normal">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
