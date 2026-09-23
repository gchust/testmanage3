import type { ReactElement } from 'react';
import { Navigate } from 'react-router';

/**
 * The tracker is the application, so `/` only forwards to the overview. It stays
 * `authz: 'skip'` so no permission change can leave a signed-in user with nowhere
 * to land; the overview itself still enforces its own page access.
 */
export default function HomeRedirect(): ReactElement {
  return <Navigate replace to='/progress' />;
}
