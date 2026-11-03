import { createFileRoute } from '@tanstack/react-router';
import { GuideScreen } from '../components/guide-screen';

export const Route = createFileRoute('/panduan')({
  component: GuideScreen,
});
