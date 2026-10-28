import { createFileRoute } from '@tanstack/react-router';
import NotFoundPage from '../../components/NotFoundPage';
import { authorizeRoute } from '../../lib/router/access';


export const Route = createFileRoute('/_authenticated/$')({
  beforeLoad: authorizeRoute('*'),
  component: NotFoundPage,
});
