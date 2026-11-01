import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/checks/')({
  staticData: { crumbs: () => [{ label: 'nav.checks', to: '/checks' }] },
  component: () => <PlaceholderScreen route="/checks" />,
});
