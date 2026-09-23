import { useEffect, useRef } from 'react';
import { useLocation, useResolvedPath } from 'react-router';

/**
 * Runs `onRefetch` when the user comes back to this page from a child route.
 *
 * A dialog or drawer is a child route, so saving in one returns to the page that
 * opened it without remounting it. The page's own data would stay stale until a
 * manual reload, which is exactly when the user expects to see the change.
 */
export function useRefetchOnReturn(onRefetch: () => void): void {
  const location = useLocation();
  const parentPath = useResolvedPath('.').pathname;
  const previousPathRef = useRef(location.pathname);
  const onRefetchRef = useRef(onRefetch);

  useEffect(() => {
    onRefetchRef.current = onRefetch;
  });

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = location.pathname;
    if (
      previousPath !== location.pathname &&
      location.pathname === parentPath
    ) {
      onRefetchRef.current();
    }
  }, [location.pathname, parentPath]);
}
