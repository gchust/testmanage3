import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAsyncResource } from '../test-progress/use-async-resource.js';
export function useEvaluationData<T>(path: string) {
  const api = useApiClient();
  return useAsyncResource<T>(
    path,
    async (signal) =>
      (await api.request<{ data: T }>({ path: 'evaluations/' + path, signal }))
        .data,
  );
}
export function useAction(reload?: () => void) {
  const api = useApiClient(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false);
  async function submit<T>(
    path: string,
    json?: unknown,
    method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
  ): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await api.request<{ data: T } | undefined>({
        path: 'evaluations/' + path,
        method,
        json,
      });
      toast.success(t('evaluations.saved'));
      reload?.();
      return result?.data;
    } catch {
      toast.error(t('evaluations.saveError'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, submit };
}
