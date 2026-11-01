import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/checks/')({
  component: () => <PlaceholderScreen route="/checks" />,
});
