import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/checks/$checkId')({
  staticData: {
    crumbs: ({ checkId }) => [
      { label: 'nav.checks', to: '/checks' },
      { label: 'breadcrumb.check', vars: { id: checkId } },
    ],
  },
  component: CheckScreen,
});

function CheckScreen() {
  const { checkId } = Route.useParams();
  return <PlaceholderScreen route="/checks/$checkId" params={{ checkId }} />;
}
