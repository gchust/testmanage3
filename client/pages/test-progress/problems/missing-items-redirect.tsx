import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router';

/**
 * `/progress/missing-items` was the Example gap list before the two problem pages
 * merged; land old links on the same rows through the unified list.
 */
export default function MissingItemsRedirect(): ReactElement {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('type', 'example');

  return <Navigate replace to={`/progress/problems?${params.toString()}`} />;
}
