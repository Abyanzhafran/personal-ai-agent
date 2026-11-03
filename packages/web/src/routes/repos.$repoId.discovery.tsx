import { createFileRoute } from '@tanstack/react-router';
import { DiscoveryScreen } from '../components/discovery-screen';

export const Route = createFileRoute('/repos/$repoId/discovery')({
  staticData: {
    crumbs: () => [{ label: 'nav.projects', to: '/' }, { label: 'breadcrumb.discovery' }],
  },
  component: DiscoveryRoute,
});

function DiscoveryRoute() {
  const { repoId } = Route.useParams();
  return <DiscoveryScreen repoId={Number(repoId)} />;
}
