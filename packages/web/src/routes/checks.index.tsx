import { createFileRoute } from '@tanstack/react-router';
import { ChecksScreen } from '../components/checks-screen';
import { parseChecksSearch } from '../lib/checks';

export const Route = createFileRoute('/checks/')({
  validateSearch: parseChecksSearch,
  staticData: { crumbs: () => [{ label: 'nav.checks', to: '/checks' }] },
  component: ChecksRoute,
});

function ChecksRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ChecksScreen search={search} onSearch={(next) => void navigate({ search: next })} />;
}
