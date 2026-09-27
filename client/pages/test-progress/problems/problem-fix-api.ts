import type { ApiClient } from '@nocobase/app-client';

export type FixVerdict =
  | 'confirmed'
  | 'not_reproducible'
  | 'already_fixed'
  | 'not_framework'
  | 'needs_info'
  | 'error';
export interface FixRun {
  id: string;
  problemId: number;
  origin: 'testmanage' | 'github';
  status: string;
  active: boolean;
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  error: string | null;
  result: null | {
    verdict: FixVerdict;
    summary: string;
    pullRequestUrl: string | null;
    branch: string | null;
  };
}
export interface FixRuns {
  runs: FixRun[];
  configured: boolean;
  repository: string;
}
export async function listFixRuns(
  api: ApiClient,
  problemId: number,
  signal?: AbortSignal,
) {
  return (
    await api.request<{ data: FixRuns }>({
      path: `problem-fixes/problems/${problemId}/runs`,
      signal,
    })
  ).data;
}
export async function triggerFix(
  api: ApiClient,
  problemId: number,
  key: string,
) {
  return (
    await api.request<{ data: FixRun }>({
      path: `problem-fixes/problems/${problemId}/runs`,
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    })
  ).data;
}
export async function refreshFixRun(
  api: ApiClient,
  problemId: number,
  runId: string,
) {
  return (
    await api.request<{ data: FixRun }>({
      path: `problem-fixes/problems/${problemId}/runs/${runId}/refresh`,
      method: 'POST',
    })
  ).data;
}
