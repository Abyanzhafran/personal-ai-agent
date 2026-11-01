import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function NotFound() {
  return <section data-testid="not-found">404</section>;
}
