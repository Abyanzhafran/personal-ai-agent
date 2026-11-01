import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { useT } from '../lib/i18n';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

// Kerangka sementara; digantikan app shell (nav rail, breadcrumb) di CC-073.
function RootLayout() {
  const t = useT();
  return (
    <>
      <nav data-testid="nav">
        <Link to="/">{t('nav.projects')}</Link> <Link to="/checks">{t('nav.checks')}</Link>{' '}
        <Link to="/panduan">{t('nav.guide')}</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function NotFound() {
  return <section data-testid="not-found">404</section>;
}
