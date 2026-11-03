import { createFileRoute } from '@tanstack/react-router';
import { ProjectsScreen } from '../components/projects-screen';

export const Route = createFileRoute('/')({
  staticData: { crumbs: () => [{ label: 'nav.projects', to: '/' }] },
  component: () => <ProjectsScreen />,
});
