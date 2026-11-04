import { createFileRoute } from '@tanstack/react-router';
import { CheckScreen } from '../components/check-screen';

export const Route = createFileRoute('/checks/$checkId')({
  staticData: {
    crumbs: ({ checkId }) => [
      { label: 'nav.checks', to: '/checks' },
      { label: 'breadcrumb.check', vars: { id: checkId } },
    ],
  },
  component: CheckRoute,
});

function CheckRoute() {
  const { checkId } = Route.useParams();
  return <CheckScreen checkId={Number(checkId)} />;
}
