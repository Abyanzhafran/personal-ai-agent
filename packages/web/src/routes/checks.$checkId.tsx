import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/checks/$checkId')({
  component: CheckScreen,
});

function CheckScreen() {
  const { checkId } = Route.useParams();
  return <PlaceholderScreen route="/checks/$checkId" params={{ checkId }} />;
}
