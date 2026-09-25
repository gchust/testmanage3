import { useApiClient } from '@nocobase/app-client';
import { createContext, useContext } from 'react';
import { useAsyncResource } from '../test-progress/use-async-resource.js';
export function useTrackerOptionsResource(enabled: boolean) {
  const api = useApiClient();
  return useAsyncResource(
    'evaluation-tracker-options-' + enabled,
    async (signal) => {
      if (!enabled) return { features: [], problems: [] };
      return (
        await api.request<{
          data: {
            features: Array<{ id: number; name: string; level: string }>;
            problems: Array<{ id: number; title: string }>;
          };
        }>({ path: 'evaluations/options', signal })
      ).data;
    },
  );
}

const empty = { data: undefined, error: undefined, loading: false };
export const TrackerOptionsContext =
  createContext<
    Pick<
      ReturnType<typeof useTrackerOptionsResource>,
      'data' | 'error' | 'loading'
    >
  >(empty);
export function useTrackerOptions() {
  return useContext(TrackerOptionsContext);
}
