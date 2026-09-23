import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router';

/**
 * `/progress/issues` was the test-finding list before the two problem pages merged;
 * its rows are now the same list, shown without a type filter.
 */
export default function IssuesRedirect(): ReactElement {
  const { search } = useLocation();

  return <Navigate replace to={`/progress/problems${search}`} />;
}
