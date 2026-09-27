import { useCan } from '@nocobase/app-plugin-authorization/client';
export function useTaskPermission(action: string) {
  return useCan({ resource: { type: 'resource', id: 'buildTasks' }, action });
}
