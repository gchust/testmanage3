import type { ApiClient } from '@nocobase/app-client';

export type FeatureLevel = 'dimension' | 'feature';
/** Skills/docs availability gate: `available` meets the minimum bar, gaps are problems. */
export type AvailabilityStatus = 'available' | 'missing' | 'unspecified';
export type ExampleExistsStatus = 'yes' | 'no' | 'unspecified';
export type FeatureStatus =
  | 'testable'
  | 'developed'
  | 'testCompleted'
  | 'refactoring'
  | 'inProgress'
  | 'deferred'
  | 'unspecified';

/** Material gaps and test findings are one table with a type. */
export type ProblemType =
  'skills' | 'docs' | 'example' | 'automation' | 'manual';
export type ProblemStatus =
  'pending' | 'fixing' | 'regression' | 'verified' | 'cancelled';

/** Per-type problem counts; `open` means not yet verified. */
export interface ProblemCounts {
  readonly total: number;
  readonly open: number;
}

export type ProblemCountsByType = Readonly<Record<ProblemType, ProblemCounts>>;

export interface FeaturePoint {
  readonly id: number;
  readonly name: string;
  readonly level: FeatureLevel;
  readonly parentId: number | null;
  readonly parentName: string | null;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly skillsStatus: AvailabilityStatus;
  readonly docsStatus: AvailabilityStatus;
  readonly exampleExists: ExampleExistsStatus;
  readonly exampleExpected: string | null;
  readonly exampleCurrent: string | null;
  readonly status: FeatureStatus;
  readonly designScore: number | null;
  readonly designNote: string | null;
  readonly developmentScore: number | null;
  readonly developmentNote: string | null;
  readonly agentFriendlinessScore: number | null;
  readonly agentFriendlinessNote: string | null;
  readonly outputQualityScore: number | null;
  readonly outputQualityNote: string | null;
  readonly remark: string | null;
  readonly sortOrder: number;
  readonly problems: ProblemCountsByType;
}

export interface Problem {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly featurePointId: number | null;
  readonly featurePointName: string | null;
  readonly type: ProblemType;
  readonly status: ProblemStatus;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly factorySource?: {
    reportId: string;
    taskTitle: string;
    issueUrl: string;
    pullRequestUrl: string | null;
    environmentUrl?: string | null;
    runUrl: string;
    files: string[];
  };
}

/** One Markdown comment under a problem. */
export interface ProblemComment {
  readonly id: number;
  readonly problemId: number;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ProblemCommentPayload {
  content?: string;
}

/** Timeline entry kinds; `status` carries the from/to statuses. */
export type ProblemActivityKind = 'created' | 'status';

export interface ProblemActivity {
  readonly id: number;
  readonly problemId: number;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly kind: ProblemActivityKind;
  readonly fromStatus: ProblemStatus | null;
  readonly toStatus: ProblemStatus | null;
  readonly createdAt: string;
}

/** Derived criteria display: the stored flag plus open problems of the same type. */
export type CriteriaState = 'unspecified' | 'missing' | 'complete' | 'hasGaps';

export interface CriteriaBreakdown {
  readonly unspecified: number;
  readonly missing: number;
  readonly complete: number;
  readonly hasGaps: number;
}

export interface ExampleExistsBreakdown {
  readonly yes: number;
  readonly no: number;
  readonly unspecified: number;
}

export interface DimensionSummary {
  readonly id: number;
  readonly name: string;
  readonly status: FeatureStatus;
  readonly featureCount: number;
  readonly statusCounts: Readonly<Record<FeatureStatus, number>>;
  readonly problems: ProblemCounts;
}

/** Open problems grouped by owner account; `ownerId: null` is the unassigned bucket. */
export interface OwnerWorkload {
  readonly ownerId: string | null;
  readonly owner: string | null;
  readonly open: number;
  readonly total: number;
}

export interface ProgressSummary {
  readonly totals: {
    readonly dimensions: number;
    readonly features: number;
    readonly materialProblems: number;
    readonly openMaterialProblems: number;
    readonly testProblems: number;
    readonly openTestProblems: number;
  };
  readonly statusCounts: Readonly<Record<FeatureStatus, number>>;
  readonly readiness: {
    readonly skills: CriteriaBreakdown;
    readonly docs: CriteriaBreakdown;
    readonly example: CriteriaBreakdown;
  };
  readonly exampleExists: ExampleExistsBreakdown;
  readonly problems: ProblemCountsByType;
  readonly dimensions: readonly DimensionSummary[];
  /** Per-owner workload, most open problems first. */
  readonly owners: readonly OwnerWorkload[];
}

export interface FeaturePointPayload {
  name?: string;
  level?: FeatureLevel;
  parentId?: number | null;
  ownerId?: string | null;
  skillsStatus?: AvailabilityStatus;
  docsStatus?: AvailabilityStatus;
  exampleExists?: ExampleExistsStatus;
  exampleExpected?: string | null;
  exampleCurrent?: string | null;
  status?: FeatureStatus;
  designScore?: number | null;
  designNote?: string | null;
  developmentScore?: number | null;
  developmentNote?: string | null;
  agentFriendlinessScore?: number | null;
  agentFriendlinessNote?: string | null;
  outputQualityScore?: number | null;
  outputQualityNote?: string | null;
  remark?: string | null;
}

export interface ProblemPayload {
  title?: string;
  description?: string | null;
  featurePointId?: number | null;
  type?: ProblemType;
  status?: ProblemStatus;
  ownerId?: string | null;
}

export interface ProblemFilter {
  readonly featurePointId?: number;
  readonly type?: ProblemType;
  readonly status?: ProblemStatus;
  /** Only problems that are not yet verified. */
  readonly open?: boolean;
  /** Exact owner match, for the "only mine" view. */
  readonly owner?: string;
  /** Exact account match, for the "only mine" view. */
  readonly ownerId?: string;
}

/** A member an owner can be assigned to; read-only, credentials stay elsewhere. */
export interface ProblemMember {
  readonly id: string;
  readonly name: string;
  readonly username: string | null;
}

/**
 * The criteria cell shown for one flag and its matching problems. Recorded problems
 * are evidence the material exists with gaps, so they win over a stale or not yet
 * filled flag; the flag only decides the no-problem states. Kept here so the list,
 * detail and overview pages derive the same state (field-rubric §5.3).
 */
export function criteriaState(
  flag: AvailabilityStatus | ExampleExistsStatus,
  openProblems: number,
): CriteriaState {
  if (openProblems > 0) {
    return 'hasGaps';
  }
  if (flag === 'unspecified') {
    return 'unspecified';
  }
  if (flag === 'missing' || flag === 'no') {
    return 'missing';
  }

  return 'complete';
}

export async function fetchSummary(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<ProgressSummary> {
  const response = await api.request<{ data: ProgressSummary }>({
    path: 'test-progress/summary',
    signal,
  });
  return response.data;
}

export async function fetchFeaturePoints(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<FeaturePoint[]> {
  const response = await api.request<{ data: FeaturePoint[] }>({
    path: 'test-progress/feature-points',
    signal,
  });
  return response.data;
}

export async function fetchFeaturePoint(
  api: ApiClient,
  id: number,
  signal?: AbortSignal,
): Promise<FeaturePoint> {
  const response = await api.request<{ data: FeaturePoint }>({
    path: `test-progress/feature-points/${encodeURIComponent(String(id))}`,
    signal,
  });
  return response.data;
}

export async function createFeaturePoint(
  api: ApiClient,
  payload: FeaturePointPayload,
): Promise<FeaturePoint> {
  const response = await api.request<{ data: FeaturePoint }>({
    path: 'test-progress/feature-points',
    method: 'POST',
    json: payload,
  });
  return response.data;
}

export async function updateFeaturePoint(
  api: ApiClient,
  id: number,
  payload: FeaturePointPayload,
): Promise<FeaturePoint> {
  const response = await api.request<{ data: FeaturePoint }>({
    path: `test-progress/feature-points/${encodeURIComponent(String(id))}`,
    method: 'PATCH',
    json: payload,
  });
  return response.data;
}

export async function deleteFeaturePoint(
  api: ApiClient,
  id: number,
): Promise<void> {
  await api.request<void>({
    path: `test-progress/feature-points/${encodeURIComponent(String(id))}`,
    method: 'DELETE',
  });
}

export async function fetchMembers(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<ProblemMember[]> {
  const response = await api.request<{ data: ProblemMember[] }>({
    path: 'test-progress/members',
    signal,
  });
  return response.data;
}

export async function fetchProblems(
  api: ApiClient,
  filter: ProblemFilter = {},
  signal?: AbortSignal,
): Promise<Problem[]> {
  const query: Record<string, string> = {};
  if (filter.featurePointId !== undefined) {
    query.featurePointId = String(filter.featurePointId);
  }
  if (filter.type !== undefined) {
    query.type = filter.type;
  }
  if (filter.status !== undefined) {
    query.status = filter.status;
  }
  if (filter.open === true) {
    query.open = 'true';
  }
  if (filter.owner !== undefined) {
    query.owner = filter.owner;
  }
  if (filter.ownerId !== undefined) {
    query.ownerId = filter.ownerId;
  }

  const response = await api.request<{ data: Problem[] }>({
    path: 'test-progress/problems',
    query,
    signal,
  });
  return response.data;
}

export async function fetchProblem(
  api: ApiClient,
  id: number,
  signal?: AbortSignal,
): Promise<Problem> {
  const response = await api.request<{ data: Problem }>({
    path: `test-progress/problems/${encodeURIComponent(String(id))}`,
    signal,
  });
  return response.data;
}

export async function createProblem(
  api: ApiClient,
  payload: ProblemPayload,
): Promise<Problem> {
  const response = await api.request<{ data: Problem }>({
    path: 'test-progress/problems',
    method: 'POST',
    json: payload,
  });
  return response.data;
}

export async function updateProblem(
  api: ApiClient,
  id: number,
  payload: ProblemPayload,
): Promise<Problem> {
  const response = await api.request<{ data: Problem }>({
    path: `test-progress/problems/${encodeURIComponent(String(id))}`,
    method: 'PATCH',
    json: payload,
  });
  return response.data;
}

export async function deleteProblem(api: ApiClient, id: number): Promise<void> {
  await api.request<void>({
    path: `test-progress/problems/${encodeURIComponent(String(id))}`,
    method: 'DELETE',
  });
}

export async function fetchProblemActivities(
  api: ApiClient,
  problemId: number,
  signal?: AbortSignal,
): Promise<ProblemActivity[]> {
  const response = await api.request<{ data: ProblemActivity[] }>({
    path: `test-progress/problems/${encodeURIComponent(String(problemId))}/activities`,
    signal,
  });
  return response.data;
}

export async function fetchProblemComments(
  api: ApiClient,
  problemId: number,
  signal?: AbortSignal,
): Promise<ProblemComment[]> {
  const response = await api.request<{ data: ProblemComment[] }>({
    path: `test-progress/problems/${encodeURIComponent(String(problemId))}/comments`,
    signal,
  });
  return response.data;
}

export async function createProblemComment(
  api: ApiClient,
  problemId: number,
  payload: ProblemCommentPayload,
): Promise<ProblemComment> {
  const response = await api.request<{ data: ProblemComment }>({
    path: `test-progress/problems/${encodeURIComponent(String(problemId))}/comments`,
    method: 'POST',
    json: payload,
  });
  return response.data;
}

export async function deleteProblemComment(
  api: ApiClient,
  commentId: number,
): Promise<void> {
  await api.request<void>({
    path: `test-progress/problem-comments/${encodeURIComponent(String(commentId))}`,
    method: 'DELETE',
  });
}

/** Reads the server's `{ code, message }` error body, falling back to the error itself. */
export function describeApiError(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const payload = (error as { payload?: unknown }).payload;
    if (payload !== null && typeof payload === 'object') {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message !== '') {
        return message;
      }
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }

  return String(error);
}
