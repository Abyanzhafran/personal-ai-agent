import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/repos/$repoId/discovery')({
  component: DiscoveryScreen,
});

function DiscoveryScreen() {
  const { repoId } = Route.useParams();
  return <PlaceholderScreen route="/repos/$repoId/discovery" params={{ repoId }} />;
}
