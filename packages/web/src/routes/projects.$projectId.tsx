import { createFileRoute } from '@tanstack/react-router';
import { ProjectsScreen } from '../components/projects-screen';

export const Route = createFileRoute('/projects/$projectId')({
  staticData: { crumbs: () => [{ label: 'nav.projects', to: '/' }] },
  component: ProjectScreen,
});

function ProjectScreen() {
  const { projectId } = Route.useParams();
  return <ProjectsScreen projectId={Number(projectId)} />;
}
