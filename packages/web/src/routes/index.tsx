import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/')({
  staticData: { crumbs: () => [{ label: 'nav.projects', to: '/' }] },
  component: () => <PlaceholderScreen route="/" />,
});
