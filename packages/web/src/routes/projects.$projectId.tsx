import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/PlaceholderScreen';

export const Route = createFileRoute('/projects/$projectId')({
  staticData: { crumbs: () => [{ label: 'nav.projects', to: '/' }] },
  component: ProjectScreen,
});

function ProjectScreen() {
  const { projectId } = Route.useParams();
  return <PlaceholderScreen route="/projects/$projectId" params={{ projectId }} />;
}
