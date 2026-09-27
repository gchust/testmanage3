import type { ApiClient } from '@nocobase/app-client';
export interface TaskInput {
  title: string;
  requirements: string;
  acceptanceCriteria: string;
  taskType: 'create' | 'improve' | 'fix';
  targetBranch: string;
  sampleData: boolean;
  buildReview: 'auto' | 'off' | 'full';
}
export interface BuildTask extends TaskInput {
  id: string;
  issueNumber: number | null;
  repository: string;
  createdByName: string;
  updatedAt: string;
  latestRun?: BuildRun | null;
}
export interface BuildComment {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}
export interface BuildRun {
  id: string;
  status: string;
  active: boolean;
  workflowRunId: string | null;
  issueNumber: number | null;
  createdAt: string;
  requestedByName: string;
  error: string | null;
  result: null | {
    execution: string;
    acceptance: string;
    delivery: string;
    reportUrl: string;
    pullRequestUrl: string | null;
    runUrl: string;
    environmentUrl: string | null;
    revision: number;
  };
}
export interface TaskDetail {
  task: BuildTask;
  comments: BuildComment[];
  runs: BuildRun[];
  configured: boolean;
  repository: string;
}
export async function listTasks(api: ApiClient, signal?: AbortSignal) {
  return (
    await api.request<{
      data: { tasks: BuildTask[]; configured: boolean; repository: string };
    }>({ path: 'build-tasks', signal })
  ).data;
}
export async function getTask(
  api: ApiClient,
  id: string,
  signal?: AbortSignal,
) {
  return (
    await api.request<{ data: TaskDetail }>({
      path: `build-tasks/${id}`,
      signal,
    })
  ).data;
}
export async function saveTask(api: ApiClient, input: TaskInput, id?: string) {
  return (
    await api.request<{ data: BuildTask }>({
      path: id ? `build-tasks/${id}` : 'build-tasks',
      method: id ? 'PATCH' : 'POST',
      json: input,
    })
  ).data;
}
export async function commentTask(api: ApiClient, id: string, content: string) {
  return (
    await api.request<{ data: BuildComment }>({
      path: `build-tasks/${id}/comments`,
      method: 'POST',
      json: { content },
    })
  ).data;
}
export async function triggerTask(api: ApiClient, id: string, key: string) {
  return (
    await api.request<{ data: BuildRun }>({
      path: `build-tasks/${id}/runs`,
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    })
  ).data;
}
export async function refreshRun(api: ApiClient, id: string, runId: string) {
  return (
    await api.request<{ data: BuildRun }>({
      path: `build-tasks/${id}/runs/${runId}/refresh`,
      method: 'POST',
    })
  ).data;
}
