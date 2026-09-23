import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncResource<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly reload: () => void;
  /** Replaces the loaded value in place, for optimistic edits that must not refetch. */
  readonly mutate: (updater: (current: T) => T) => void;
}

interface ResourceState<T> {
  readonly requestKey: string;
  readonly data?: T;
  readonly error?: unknown;
}

/**
 * Loads one request per `key` and keeps the result beside the key it belongs to.
 *
 * Loading is derived from that key rather than set inside the effect: a
 * synchronous `setState` in an effect body cascades renders, and the key already
 * says whether the state on screen belongs to the request being made. `reload()`
 * changes the key, so a retry shows the loading state again.
 */
export function useAsyncResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  const [state, setState] = useState<ResourceState<T>>({ requestKey: '' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const requestKey = `${key}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ requestKey, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ requestKey, error });
      });

    return () => controller.abort();
  }, [requestKey]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const mutate = useCallback(
    (updater: (current: T) => T) => {
      setState((current) =>
        current.requestKey === requestKey && current.data !== undefined
          ? { ...current, data: updater(current.data) }
          : current,
      );
    },
    [requestKey],
  );

  return {
    data: state.requestKey === requestKey ? state.data : undefined,
    error: state.requestKey === requestKey ? state.error : undefined,
    loading: state.requestKey !== requestKey,
    reload,
    mutate,
  };
}
