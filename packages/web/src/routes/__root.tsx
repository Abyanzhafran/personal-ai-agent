import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

// Kerangka sementara; digantikan app shell (nav rail, breadcrumb) di CC-073.
function RootLayout() {
  return (
    <>
      <nav data-testid="nav">
        <Link to="/">projects</Link> <Link to="/checks">checks</Link>{' '}
        <Link to="/panduan">panduan</Link>
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
