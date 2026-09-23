import type { Application } from '@nocobase/app-server/application';
import {
  databaseManagerToken,
  type DatabaseManager,
  type Row,
} from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

export const FEATURE_LEVELS = ['dimension', 'feature'] as const;
export type FeatureLevel = (typeof FEATURE_LEVELS)[number];

export const EXAMPLE_EXISTS_STATUSES = ['yes', 'no', 'unspecified'] as const;
export type ExampleExistsStatus = (typeof EXAMPLE_EXISTS_STATUSES)[number];

/**
 * Skills and docs are availability gates, not coverage judgements: a feature point
 * keeps growing, so "complete" can never be decided. `available` means the material
 * meets the minimum usability bar recorded in testing-statistics/field-rubric.md;
 * gaps are tracked as problems of the matching type.
 */
export const AVAILABILITY_STATUSES = [
  'available',
  'missing',
  'unspecified',
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/**
 * Material gaps and test findings are one table with a type: a missing skill is a
 * problem like any other, it just counts towards a different criteria cell. See
 * testing-statistics/field-rubric.md §5.
 */
export const PROBLEM_TYPES = [
  'skills',
  'docs',
  'example',
  'automation',
  'manual',
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const PROBLEM_STATUSES = [
  'pending',
  'fixing',
  'regression',
  'verified',
  'cancelled',
] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** A problem is closed once it is verified or explicitly cancelled. */
export const CLOSED_PROBLEM_STATUSES: readonly ProblemStatus[] = [
  'verified',
  'cancelled',
];

export const FEATURE_STATUSES = [
  'testable',
  'developed',
  'testCompleted',
  'refactoring',
  'inProgress',
  'deferred',
  'unspecified',
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export class TestProgressValidationError extends Error {
  public readonly code: string = 'VALIDATION_FAILED';

  public constructor(message: string) {
    super(message);
    this.name = 'TestProgressValidationError';
  }
}

export class TestProgressNotFoundError extends Error {
  public readonly code: string = 'NOT_FOUND';

  public constructor(message: string) {
    super(message);
    this.name = 'TestProgressNotFoundError';
  }
}

export class TestProgressConflictError extends Error {
  public readonly code: string = 'CONFLICT';

  public constructor(message: string) {
    super(message);
    this.name = 'TestProgressConflictError';
  }
}

/** Problems of one type raised against a feature point; `open` means not yet verified. */
export interface ProblemCounts {
  total: number;
  open: number;
}

export interface FeaturePointRecord {
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
  readonly problems: Readonly<Record<ProblemType, ProblemCounts>>;
}

export interface ProblemRecord {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly featurePointId: number;
  readonly featurePointName: string | null;
  readonly type: ProblemType;
  readonly status: ProblemStatus;
  readonly owner: string | null;
  readonly ownerId: string | null;
}

/** One comment under a problem; `authorId` is the Better Auth user id. */
export interface ProblemCommentRecord {
  readonly id: number;
  readonly problemId: number;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ProblemCommentInput {
  content?: string;
}

/** The signed-in actor a comment or timeline entry is attributed to. */
export interface ProblemActor {
  readonly id: string | null;
  readonly name: string;
}

/** Timeline entry kinds; kept as strings so a new kind needs no schema change. */
export const PROBLEM_ACTIVITY_KINDS = ['created', 'status'] as const;
export type ProblemActivityKind = (typeof PROBLEM_ACTIVITY_KINDS)[number];

/** Read-only member list for owner pickers; credentials stay with Authentication. */
export interface ProblemMemberRecord {
  readonly id: string;
  readonly name: string;
  readonly username: string | null;
}

export interface ProblemActivityRecord {
  readonly id: number;
  readonly problemId: number;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly kind: ProblemActivityKind;
  readonly fromStatus: ProblemStatus | null;
  readonly toStatus: ProblemStatus | null;
  readonly createdAt: string;
}

export interface FeaturePointInput {
  name?: string;
  level?: FeatureLevel;
  parentId?: number | null;
  /** Account association; authoritative, and refreshes the legacy `owner` text. */
  ownerId?: string | null;
  /** Legacy name write; resolves to an account when the name is unique. */
  owner?: string | null;
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

export interface ProblemInput {
  title?: string;
  description?: string | null;
  featurePointId?: number;
  type?: ProblemType;
  status?: ProblemStatus;
  /** Account association; authoritative, and refreshes the legacy `owner` text. */
  ownerId?: string | null;
  /** Legacy name write; resolves to an account when the name is unique. */
  owner?: string | null;
}

export interface ProblemFilter {
  readonly featurePointId?: number;
  readonly type?: ProblemType;
  readonly status?: ProblemStatus;
  /** Only problems that are not yet verified. */
  readonly open?: boolean;
  /** Exact owner name match; kept for scripts, the UI filters by `ownerId`. */
  readonly owner?: string;
  /** Exact account match, for the "only mine" view. */
  readonly ownerId?: string;
}

export interface AvailabilityBreakdown {
  available: number;
  missing: number;
  unspecified: number;
}

/** Derived criteria display: flags plus open problems of the matching type. */
export interface CriteriaBreakdown {
  unspecified: number;
  missing: number;
  complete: number;
  hasGaps: number;
}

export interface ExampleExistsBreakdown {
  yes: number;
  no: number;
  unspecified: number;
}

export interface DimensionSummary {
  readonly id: number;
  readonly name: string;
  readonly status: FeatureStatus;
  readonly featureCount: number;
  readonly statusCounts: Record<FeatureStatus, number>;
  readonly problems: ProblemCounts;
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
  readonly statusCounts: Record<FeatureStatus, number>;
  readonly readiness: {
    readonly skills: CriteriaBreakdown;
    readonly docs: CriteriaBreakdown;
    readonly example: CriteriaBreakdown;
  };
  readonly exampleExists: ExampleExistsBreakdown;
  readonly problems: Readonly<Record<ProblemType, ProblemCounts>>;
  readonly dimensions: readonly DimensionSummary[];
}

export interface TestProgressService {
  listFeaturePoints(): Promise<FeaturePointRecord[]>;
  getFeaturePoint(id: number): Promise<FeaturePointRecord>;
  createFeaturePoint(input: FeaturePointInput): Promise<FeaturePointRecord>;
  updateFeaturePoint(
    id: number,
    patch: FeaturePointInput,
  ): Promise<FeaturePointRecord>;
  deleteFeaturePoint(id: number): Promise<void>;
  listProblems(filter?: ProblemFilter): Promise<ProblemRecord[]>;
  getProblem(id: number): Promise<ProblemRecord>;
  createProblem(
    input: ProblemInput,
    actor?: ProblemActor,
  ): Promise<ProblemRecord>;
  updateProblem(
    id: number,
    patch: ProblemInput,
    actor?: ProblemActor,
  ): Promise<ProblemRecord>;
  deleteProblem(id: number): Promise<void>;
  listProblemActivities(problemId: number): Promise<ProblemActivityRecord[]>;
  listMembers(): Promise<readonly ProblemMemberRecord[]>;
  listProblemComments(problemId: number): Promise<ProblemCommentRecord[]>;
  createProblemComment(
    problemId: number,
    input: ProblemCommentInput,
    author: ProblemActor,
  ): Promise<ProblemCommentRecord>;
  deleteProblemComment(id: number, author: ProblemActor): Promise<void>;
  getSummary(): Promise<ProgressSummary>;
}

export const testProgressServiceToken: ServiceToken<TestProgressService> =
  createServiceToken<TestProgressService>('app/test-progress-service');

const FEATURE_POINT_SELECTION = [
  'id',
  'name',
  'level',
  'parentId',
  'owner',
  'ownerId',
  'skillsStatus',
  'docsStatus',
  'exampleExists',
  'exampleExpected',
  'exampleCurrent',
  'status',
  'designScore',
  'designNote',
  'developmentScore',
  'developmentNote',
  'agentFriendlinessScore',
  'agentFriendlinessNote',
  'outputQualityScore',
  'outputQualityNote',
  'remark',
  'sortOrder',
] as const;

function requireRecord(payload: unknown): Record<string, unknown> {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new TestProgressValidationError(
      'Request body must be a JSON object.',
    );
  }

  return payload as Record<string, unknown>;
}

function readRequiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TestProgressValidationError(`${field} is required.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new TestProgressValidationError(
      `${field} must be at most ${maxLength} characters.`,
    );
  }

  return trimmed;
}

function readNullableString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TestProgressValidationError(`${field} must be text.`);
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new TestProgressValidationError(
      `${field} must be at most ${maxLength} characters.`,
    );
  }

  return trimmed;
}

function readEnum<T extends string>(
  values: readonly T[],
  value: unknown,
  field: string,
  fallback: T,
): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  ) {
    return value as T;
  }

  throw new TestProgressValidationError(
    `${field} must be one of: ${values.join(', ')}.`,
  );
}

function readId(value: unknown, field: string): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TestProgressValidationError(
      `${field} must be a positive integer.`,
    );
  }

  return id;
}

function readScore(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new TestProgressValidationError(
      `${field} must be a number between 0 and 10.`,
    );
  }

  return Math.round(score * 10) / 10;
}

/** Validates one feature point payload. `partial` is for PATCH: absent keys stay untouched. */
export function parseFeaturePointInput(
  payload: unknown,
  options: { partial: boolean },
): FeaturePointInput {
  const record = requireRecord(payload);
  const input: FeaturePointInput = {};
  const write = (key: keyof FeaturePointInput): boolean =>
    !options.partial || key in record;

  if (write('name')) {
    input.name = readRequiredString(record.name, 'name', 200);
  }
  if (write('level')) {
    input.level = readEnum(FEATURE_LEVELS, record.level, 'level', 'feature');
  }
  if (write('parentId')) {
    input.parentId =
      record.parentId === null || record.parentId === undefined
        ? null
        : readId(record.parentId, 'parentId');
  }
  if (write('ownerId')) {
    input.ownerId = readNullableString(record.ownerId, 'ownerId', 64);
  }
  if (write('owner')) {
    input.owner = readNullableString(record.owner, 'owner', 100);
  }
  if (write('skillsStatus')) {
    input.skillsStatus = readEnum(
      AVAILABILITY_STATUSES,
      record.skillsStatus,
      'skillsStatus',
      'unspecified',
    );
  }
  if (write('docsStatus')) {
    input.docsStatus = readEnum(
      AVAILABILITY_STATUSES,
      record.docsStatus,
      'docsStatus',
      'unspecified',
    );
  }
  if (write('exampleExists')) {
    input.exampleExists = readEnum(
      EXAMPLE_EXISTS_STATUSES,
      record.exampleExists,
      'exampleExists',
      'unspecified',
    );
  }
  if (write('exampleExpected')) {
    input.exampleExpected = readNullableString(
      record.exampleExpected,
      'exampleExpected',
      10000,
    );
  }
  if (write('exampleCurrent')) {
    input.exampleCurrent = readNullableString(
      record.exampleCurrent,
      'exampleCurrent',
      10000,
    );
  }
  if (write('status')) {
    input.status = readEnum(
      FEATURE_STATUSES,
      record.status,
      'status',
      'unspecified',
    );
  }
  if (write('designScore')) {
    input.designScore = readScore(record.designScore, 'designScore');
  }
  if (write('designNote')) {
    input.designNote = readNullableString(
      record.designNote,
      'designNote',
      10000,
    );
  }
  if (write('developmentScore')) {
    input.developmentScore = readScore(
      record.developmentScore,
      'developmentScore',
    );
  }
  if (write('developmentNote')) {
    input.developmentNote = readNullableString(
      record.developmentNote,
      'developmentNote',
      10000,
    );
  }
  if (write('agentFriendlinessScore')) {
    input.agentFriendlinessScore = readScore(
      record.agentFriendlinessScore,
      'agentFriendlinessScore',
    );
  }
  if (write('agentFriendlinessNote')) {
    input.agentFriendlinessNote = readNullableString(
      record.agentFriendlinessNote,
      'agentFriendlinessNote',
      10000,
    );
  }
  if (write('outputQualityScore')) {
    input.outputQualityScore = readScore(
      record.outputQualityScore,
      'outputQualityScore',
    );
  }
  if (write('outputQualityNote')) {
    input.outputQualityNote = readNullableString(
      record.outputQualityNote,
      'outputQualityNote',
      10000,
    );
  }
  if (write('remark')) {
    input.remark = readNullableString(record.remark, 'remark', 10000);
  }

  return input;
}

/** Validates one problem payload. */
export function parseProblemInput(
  payload: unknown,
  options: { partial: boolean },
): ProblemInput {
  const record = requireRecord(payload);
  const input: ProblemInput = {};
  const write = (key: keyof ProblemInput): boolean =>
    !options.partial || key in record;

  if (write('title')) {
    input.title = readRequiredString(record.title, 'title', 2000);
  }
  if (write('description')) {
    input.description = readNullableString(
      record.description,
      'description',
      10000,
    );
  }
  if (write('featurePointId')) {
    input.featurePointId = readId(record.featurePointId, 'featurePointId');
  }
  if (write('type')) {
    input.type = readEnum(PROBLEM_TYPES, record.type, 'type', 'manual');
  }
  if (write('status')) {
    input.status = readEnum(
      PROBLEM_STATUSES,
      record.status,
      'status',
      'pending',
    );
  }
  if (write('ownerId')) {
    input.ownerId = readNullableString(record.ownerId, 'ownerId', 64);
  }
  if (write('owner')) {
    input.owner = readNullableString(record.owner, 'owner', 100);
  }

  return input;
}

/** Validates one comment payload; the author always comes from the session. */
export function parseProblemCommentInput(payload: unknown): ProblemCommentInput {
  const record = requireRecord(payload);
  return {
    content: readRequiredString(record.content, 'content', 20000),
  };
}

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyProblemCounts(): ProblemCounts {
  return { total: 0, open: 0 };
}

function emptyProblemCountsByType(): Record<ProblemType, ProblemCounts> {
  return {
    skills: emptyProblemCounts(),
    docs: emptyProblemCounts(),
    example: emptyProblemCounts(),
    automation: emptyProblemCounts(),
    manual: emptyProblemCounts(),
  };
}

/** Groups problem rows by type; `open` is everything not yet verified. */
function countProblems(
  rows: readonly Row[],
): Record<ProblemType, ProblemCounts> {
  const counts = emptyProblemCountsByType();
  for (const row of rows) {
    const type = readEnum(PROBLEM_TYPES, row.type, 'type', 'manual');
    const status = readEnum(PROBLEM_STATUSES, row.status, 'status', 'pending');
    counts[type].total += 1;
    if (!CLOSED_PROBLEM_STATUSES.includes(status)) {
      counts[type].open += 1;
    }
  }

  return counts;
}

function sumProblemCounts(
  counts: Readonly<Record<ProblemType, ProblemCounts>>,
): ProblemCounts {
  const total: ProblemCounts = emptyProblemCounts();
  for (const count of Object.values(counts)) {
    total.total += count.total;
    total.open += count.open;
  }

  return total;
}

function emptyStatusCounts(): Record<FeatureStatus, number> {
  return {
    testable: 0,
    developed: 0,
    testCompleted: 0,
    refactoring: 0,
    inProgress: 0,
    deferred: 0,
    unspecified: 0,
  };
}

function emptyCriteria(): CriteriaBreakdown {
  return { unspecified: 0, missing: 0, complete: 0, hasGaps: 0 };
}

/**
 * A criteria cell: recorded problems win over the flag, because they are evidence
 * the material exists with gaps; the flag only decides the no-problem states.
 */
function criteriaState(
  flag: AvailabilityStatus | ExampleExistsStatus,
  openProblems: number,
): keyof CriteriaBreakdown {
  if (openProblems > 0) return 'hasGaps';
  if (flag === 'unspecified') return 'unspecified';
  if (flag === 'missing' || flag === 'no') return 'missing';

  return 'complete';
}

function emptyExampleExists(): ExampleExistsBreakdown {
  return { yes: 0, no: 0, unspecified: 0 };
}

/**
 * Owner display name: the associated account's name when `ownerId` resolves,
 * otherwise the legacy `owner` text (environments without accounts yet).
 */
function resolveOwnerName(
  row: Row,
  ownerNames: ReadonlyMap<string, string>,
): string | null {
  const ownerId = asOptionalText(row.ownerId);
  if (ownerId !== null) {
    return ownerNames.get(ownerId) ?? asOptionalText(row.owner);
  }

  return asOptionalText(row.owner);
}

function toFeaturePointRecord(
  row: Row,
  parentName: string | null,
  problems: Readonly<Record<ProblemType, ProblemCounts>>,
  ownerNames: ReadonlyMap<string, string>,
): FeaturePointRecord {
  return {
    id: Number(row.id),
    name: asText(row.name),
    level: readEnum(FEATURE_LEVELS, row.level, 'level', 'feature'),
    parentId:
      row.parentId === null || row.parentId === undefined
        ? null
        : Number(row.parentId),
    parentName,
    owner: resolveOwnerName(row, ownerNames),
    ownerId: asOptionalText(row.ownerId),
    skillsStatus: readEnum(
      AVAILABILITY_STATUSES,
      row.skillsStatus,
      'skillsStatus',
      'unspecified',
    ),
    docsStatus: readEnum(
      AVAILABILITY_STATUSES,
      row.docsStatus,
      'docsStatus',
      'unspecified',
    ),
    exampleExists: readEnum(
      EXAMPLE_EXISTS_STATUSES,
      row.exampleExists,
      'exampleExists',
      'unspecified',
    ),
    exampleExpected: asOptionalText(row.exampleExpected),
    exampleCurrent: asOptionalText(row.exampleCurrent),
    status: readEnum(FEATURE_STATUSES, row.status, 'status', 'unspecified'),
    designScore: asOptionalNumber(row.designScore),
    designNote: asOptionalText(row.designNote),
    developmentScore: asOptionalNumber(row.developmentScore),
    developmentNote: asOptionalText(row.developmentNote),
    agentFriendlinessScore: asOptionalNumber(row.agentFriendlinessScore),
    agentFriendlinessNote: asOptionalText(row.agentFriendlinessNote),
    outputQualityScore: asOptionalNumber(row.outputQualityScore),
    outputQualityNote: asOptionalText(row.outputQualityNote),
    remark: asOptionalText(row.remark),
    sortOrder: Number(row.sortOrder ?? 0),
    problems,
  };
}

function toProblemRecord(
  row: Row,
  featurePointName: string | null,
  ownerNames: ReadonlyMap<string, string>,
): ProblemRecord {
  return {
    id: Number(row.id),
    title: asText(row.title),
    description: asOptionalText(row.description),
    featurePointId: Number(row.featurePointId),
    featurePointName,
    type: readEnum(PROBLEM_TYPES, row.type, 'type', 'manual'),
    status: readEnum(PROBLEM_STATUSES, row.status, 'status', 'pending'),
    owner: resolveOwnerName(row, ownerNames),
    ownerId: asOptionalText(row.ownerId),
  };
}

/** Datetimes come back as ISO text; normalize whatever the driver returns. */
function toIsoDateTime(value: unknown): string {
  const text = asOptionalText(value);
  if (text === null) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

const SYSTEM_ACTOR: ProblemActor = { id: null, name: 'system' };

function toProblemActivityRecord(row: Row): ProblemActivityRecord {
  return {
    id: Number(row.id),
    problemId: Number(row.problemId),
    actorId: asOptionalText(row.actorId),
    actorName: asText(row.actorName),
    kind: readEnum(
      PROBLEM_ACTIVITY_KINDS,
      row.kind,
      'kind',
      'created',
    ),
    fromStatus:
      row.fromStatus === null || row.fromStatus === undefined
        ? null
        : readEnum(PROBLEM_STATUSES, row.fromStatus, 'fromStatus', 'pending'),
    toStatus:
      row.toStatus === null || row.toStatus === undefined
        ? null
        : readEnum(PROBLEM_STATUSES, row.toStatus, 'toStatus', 'pending'),
    createdAt: toIsoDateTime(row.createdAt),
  };
}

function toProblemCommentRecord(row: Row): ProblemCommentRecord {
  return {
    id: Number(row.id),
    problemId: Number(row.problemId),
    authorId: asOptionalText(row.authorId),
    authorName: asText(row.authorName),
    content: asText(row.content),
    createdAt: toIsoDateTime(row.createdAt),
  };
}

class DefaultTestProgressService implements TestProgressService {
  public constructor(private readonly database: DatabaseManager) {}

  public async listFeaturePoints(): Promise<FeaturePointRecord[]> {
    const rows = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(FEATURE_POINT_SELECTION)
      .orderBy('sortOrder', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const problemRows = await this.database
      .query()
      .selectFrom('issues')
      .select(['featurePointId', 'type', 'status'])
      .execute();
    const problemsByFeaturePoint = new Map<
      number,
      Record<ProblemType, ProblemCounts>
    >();
    for (const problem of problemRows) {
      const key = Number(problem.featurePointId);
      const grouped = problemsByFeaturePoint.get(key) ?? emptyProblemCountsByType();
      const type = readEnum(PROBLEM_TYPES, problem.type, 'type', 'manual');
      const status = readEnum(
        PROBLEM_STATUSES,
        problem.status,
        'status',
        'pending',
      );
      grouped[type].total += 1;
      if (!CLOSED_PROBLEM_STATUSES.includes(status)) {
        grouped[type].open += 1;
      }
      problemsByFeaturePoint.set(key, grouped);
    }
    const nameById = new Map(
      rows.map((row) => [Number(row.id), asText(row.name)]),
    );
    const ownerNames = await this.ownerNames();

    return rows.map((row) =>
      toFeaturePointRecord(
        row,
        row.parentId === null || row.parentId === undefined
          ? null
          : (nameById.get(Number(row.parentId)) ?? null),
        problemsByFeaturePoint.get(Number(row.id)) ??
          emptyProblemCountsByType(),
        ownerNames,
      ),
    );
  }

  public async getFeaturePoint(id: number): Promise<FeaturePointRecord> {
    const row = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(FEATURE_POINT_SELECTION)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new TestProgressNotFoundError(`Feature point ${id} was not found.`);
    }

    let parentName: string | null = null;
    if (row.parentId !== null && row.parentId !== undefined) {
      const parent = await this.database
        .query()
        .selectFrom('featurePoints')
        .select(['name'])
        .where('id', '=', Number(row.parentId))
        .executeTakeFirst();
      parentName = parent ? asText(parent.name) : null;
    }

    const problems = await this.database
      .query()
      .selectFrom('issues')
      .select(['type', 'status'])
      .where('featurePointId', '=', id)
      .execute();

    return toFeaturePointRecord(
      row,
      parentName,
      countProblems(problems),
      await this.ownerNames(),
    );
  }

  public async createFeaturePoint(
    input: FeaturePointInput,
  ): Promise<FeaturePointRecord> {
    const name = input.name;
    if (!name) {
      throw new TestProgressValidationError('name is required.');
    }

    const level = input.level ?? 'feature';
    const parentId = await this.resolveParentId(
      level,
      input.parentId ?? null,
      null,
    );
    const last = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['sortOrder'])
      .orderBy('sortOrder', 'desc')
      .limit(1)
      .executeTakeFirst();
    const now = new Date();
    const owner = await this.resolveOwnerFields(input);

    const result = await this.database
      .query()
      .insertInto('featurePoints')
      .values({
        name,
        level,
        parentId,
        owner: owner.owner,
        ownerId: owner.ownerId,
        skillsStatus: input.skillsStatus ?? 'unspecified',
        docsStatus: input.docsStatus ?? 'unspecified',
        exampleExists: input.exampleExists ?? 'unspecified',
        exampleExpected: input.exampleExpected ?? null,
        exampleCurrent: input.exampleCurrent ?? null,
        status: input.status ?? 'unspecified',
        designScore: input.designScore ?? null,
        designNote: input.designNote ?? null,
        developmentScore: input.developmentScore ?? null,
        developmentNote: input.developmentNote ?? null,
        agentFriendlinessScore: input.agentFriendlinessScore ?? null,
        agentFriendlinessNote: input.agentFriendlinessNote ?? null,
        outputQualityScore: input.outputQualityScore ?? null,
        outputQualityNote: input.outputQualityNote ?? null,
        remark: input.remark ?? null,
        sortOrder: Number(last?.sortOrder ?? 0) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const id = Number(result.insertId);
    if (!Number.isInteger(id)) {
      throw new Error('Insert did not return an id.');
    }

    return this.getFeaturePoint(id);
  }

  public async updateFeaturePoint(
    id: number,
    patch: FeaturePointInput,
  ): Promise<FeaturePointRecord> {
    const existing = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id', 'level', 'parentId'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new TestProgressNotFoundError(`Feature point ${id} was not found.`);
    }

    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.ownerId !== undefined || patch.owner !== undefined) {
      const owner = await this.resolveOwnerFields(patch);
      set.owner = owner.owner;
      set.ownerId = owner.ownerId;
    }
    if (patch.skillsStatus !== undefined) set.skillsStatus = patch.skillsStatus;
    if (patch.docsStatus !== undefined) set.docsStatus = patch.docsStatus;
    if (patch.exampleExists !== undefined) {
      set.exampleExists = patch.exampleExists;
    }
    if (patch.exampleExpected !== undefined) {
      set.exampleExpected = patch.exampleExpected;
    }
    if (patch.exampleCurrent !== undefined) {
      set.exampleCurrent = patch.exampleCurrent;
    }
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.designScore !== undefined) set.designScore = patch.designScore;
    if (patch.designNote !== undefined) set.designNote = patch.designNote;
    if (patch.developmentScore !== undefined) {
      set.developmentScore = patch.developmentScore;
    }
    if (patch.developmentNote !== undefined) {
      set.developmentNote = patch.developmentNote;
    }
    if (patch.agentFriendlinessScore !== undefined) {
      set.agentFriendlinessScore = patch.agentFriendlinessScore;
    }
    if (patch.agentFriendlinessNote !== undefined) {
      set.agentFriendlinessNote = patch.agentFriendlinessNote;
    }
    if (patch.outputQualityScore !== undefined) {
      set.outputQualityScore = patch.outputQualityScore;
    }
    if (patch.outputQualityNote !== undefined) {
      set.outputQualityNote = patch.outputQualityNote;
    }
    if (patch.remark !== undefined) set.remark = patch.remark;

    if (patch.level !== undefined || 'parentId' in patch) {
      const level =
        patch.level ??
        readEnum(FEATURE_LEVELS, existing.level, 'level', 'feature');
      const parentId =
        'parentId' in patch
          ? (patch.parentId ?? null)
          : existing.parentId === null || existing.parentId === undefined
            ? null
            : Number(existing.parentId);
      set.level = level;
      set.parentId = await this.resolveParentId(level, parentId, id);
    }

    set.updatedAt = new Date();
    await this.database
      .query()
      .updateTable('featurePoints')
      .set(set)
      .where('id', '=', id)
      .execute();

    return this.getFeaturePoint(id);
  }

  public async deleteFeaturePoint(id: number): Promise<void> {
    const existing = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new TestProgressNotFoundError(`Feature point ${id} was not found.`);
    }

    const child = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id'])
      .where('parentId', '=', id)
      .limit(1)
      .executeTakeFirst();

    if (child) {
      throw new TestProgressConflictError(
        'This dimension still has feature points; delete or move them first.',
      );
    }

    await this.database.transaction(async (connection) => {
      await connection.query
        .deleteFrom('missingItems')
        .where('featurePointId', '=', id)
        .execute();
      await connection.query
        .deleteFrom('featurePoints')
        .where('id', '=', id)
        .execute();
    });
  }

  public async listProblems(
    filter: ProblemFilter = {},
  ): Promise<ProblemRecord[]> {
    let query = this.database
      .query()
      .selectFrom('issues')
      .select([
        'id',
        'title',
        'description',
        'featurePointId',
        'type',
        'status',
        'owner',
        'ownerId',
      ]);

    if (filter.featurePointId !== undefined) {
      query = query.where('featurePointId', '=', filter.featurePointId);
    }
    if (filter.type !== undefined) {
      query = query.where('type', '=', filter.type);
    }
    if (filter.status !== undefined) {
      query = query.where('status', '=', filter.status);
    }
    if (filter.open === true) {
      query = query.where('status', 'not in', [...CLOSED_PROBLEM_STATUSES]);
    }
    if (filter.owner !== undefined) {
      query = query.where('owner', '=', filter.owner);
    }
    if (filter.ownerId !== undefined) {
      query = query.where('ownerId', '=', filter.ownerId);
    }

    const rows = await query.orderBy('id', 'asc').execute();
    const names = await this.featurePointNames();
    const ownerNames = await this.ownerNames();
    return rows.map((row) =>
      toProblemRecord(
        row,
        names.get(Number(row.featurePointId)) ?? null,
        ownerNames,
      ),
    );
  }

  public async getProblem(id: number): Promise<ProblemRecord> {
    const row = await this.database
      .query()
      .selectFrom('issues')
      .select([
        'id',
        'title',
        'description',
        'featurePointId',
        'type',
        'status',
        'owner',
        'ownerId',
      ])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new TestProgressNotFoundError(`Problem ${id} was not found.`);
    }

    const names = await this.featurePointNames();
    return toProblemRecord(
      row,
      names.get(Number(row.featurePointId)) ?? null,
      await this.ownerNames(),
    );
  }

  public async createProblem(
    input: ProblemInput,
    actor: ProblemActor = SYSTEM_ACTOR,
  ): Promise<ProblemRecord> {
    const title = input.title;
    const featurePointId = input.featurePointId;
    if (!title) {
      throw new TestProgressValidationError('title is required.');
    }
    if (featurePointId === undefined) {
      throw new TestProgressValidationError('featurePointId is required.');
    }

    await this.requireFeaturePoint(featurePointId);
    const now = new Date();
    const owner = await this.resolveOwnerFields(input);
    const result = await this.database
      .query()
      .insertInto('issues')
      .values({
        title,
        description: input.description ?? null,
        featurePointId,
        type: input.type ?? 'manual',
        status: input.status ?? 'pending',
        owner: owner.owner,
        ownerId: owner.ownerId,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const id = Number(result.insertId);
    if (!Number.isInteger(id)) {
      throw new Error('Insert did not return an id.');
    }

    await this.recordProblemActivity(
      {
        problemId: id,
        actor,
        kind: 'created',
        fromStatus: null,
        toStatus: input.status ?? 'pending',
      },
      now,
    );

    return this.getProblem(id);
  }

  public async updateProblem(
    id: number,
    patch: ProblemInput,
    actor: ProblemActor = SYSTEM_ACTOR,
  ): Promise<ProblemRecord> {
    const existing = await this.database
      .query()
      .selectFrom('issues')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new TestProgressNotFoundError(`Problem ${id} was not found.`);
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.ownerId !== undefined || patch.owner !== undefined) {
      const owner = await this.resolveOwnerFields(patch);
      set.owner = owner.owner;
      set.ownerId = owner.ownerId;
    }
    if (patch.featurePointId !== undefined) {
      await this.requireFeaturePoint(patch.featurePointId);
      set.featurePointId = patch.featurePointId;
    }

    const now = new Date();
    await this.database
      .query()
      .updateTable('issues')
      .set({ ...set, updatedAt: now })
      .where('id', '=', id)
      .execute();

    const previousStatus = readEnum(
      PROBLEM_STATUSES,
      existing.status,
      'status',
      'pending',
    );
    if (patch.status !== undefined && patch.status !== previousStatus) {
      await this.recordProblemActivity(
        {
          problemId: id,
          actor,
          kind: 'status',
          fromStatus: previousStatus,
          toStatus: patch.status,
        },
        now,
      );
    }

    return this.getProblem(id);
  }

  public async listMembers(): Promise<readonly ProblemMemberRecord[]> {
    const rows = await this.database
      .query()
      .selectFrom('user')
      .select(['id', 'name', 'username'])
      .where('disabledAt', 'is', null)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    return rows.map((row) => ({
      id: String(row.id),
      name: asText(row.name),
      username: asOptionalText(row.username),
    }));
  }

  public async listProblemActivities(
    problemId: number,
  ): Promise<ProblemActivityRecord[]> {
    await this.requireProblem(problemId);
    const rows = await this.database
      .query()
      .selectFrom('problemActivities')
      .select([
        'id',
        'problemId',
        'actorId',
        'actorName',
        'kind',
        'fromStatus',
        'toStatus',
        'createdAt',
      ])
      .where('problemId', '=', problemId)
      .orderBy('id', 'asc')
      .execute();

    return rows.map(toProblemActivityRecord);
  }

  private async recordProblemActivity(
    input: {
      readonly problemId: number;
      readonly actor: ProblemActor;
      readonly kind: ProblemActivityKind;
      readonly fromStatus: ProblemStatus | null;
      readonly toStatus: ProblemStatus | null;
    },
    now: Date,
  ): Promise<void> {
    await this.database
      .query()
      .insertInto('problemActivities')
      .values({
        problemId: input.problemId,
        actorId: input.actor.id,
        actorName: input.actor.name,
        kind: input.kind,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        createdAt: now,
      })
      .execute();
  }

  public async deleteProblem(id: number): Promise<void> {
    const result = await this.database
      .query()
      .deleteFrom('issues')
      .where('id', '=', id)
      .execute();

    if (Number(result.deletedCount ?? 0) === 0) {
      throw new TestProgressNotFoundError(`Problem ${id} was not found.`);
    }

    // Comments and timeline entries carry a plain problem id, not a foreign key,
    // so they go explicitly.
    await this.database
      .query()
      .deleteFrom('problemComments')
      .where('problemId', '=', id)
      .execute();
    await this.database
      .query()
      .deleteFrom('problemActivities')
      .where('problemId', '=', id)
      .execute();
  }

  public async listProblemComments(
    problemId: number,
  ): Promise<ProblemCommentRecord[]> {
    await this.requireProblem(problemId);
    const rows = await this.database
      .query()
      .selectFrom('problemComments')
      .select([
        'id',
        'problemId',
        'authorId',
        'authorName',
        'content',
        'createdAt',
      ])
      .where('problemId', '=', problemId)
      .orderBy('id', 'asc')
      .execute();

    return rows.map(toProblemCommentRecord);
  }

  public async createProblemComment(
    problemId: number,
    input: ProblemCommentInput,
    author: ProblemActor,
  ): Promise<ProblemCommentRecord> {
    const content = input.content;
    if (!content) {
      throw new TestProgressValidationError('content is required.');
    }

    await this.requireProblem(problemId);
    const now = new Date();
    const result = await this.database
      .query()
      .insertInto('problemComments')
      .values({
        problemId,
        authorId: author.id,
        authorName: author.name,
        content,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const id = Number(result.insertId);
    if (!Number.isInteger(id)) {
      throw new Error('Insert did not return an id.');
    }

    return this.getProblemComment(id);
  }

  public async deleteProblemComment(
    id: number,
    author: ProblemActor,
  ): Promise<void> {
    const row = await this.database
      .query()
      .selectFrom('problemComments')
      .select(['id', 'authorId'])
      .where('id', '=', id)
      .executeTakeFirst();

    // Only the author may delete a comment; anyone else sees "not found" so the
    // response does not reveal that the comment exists.
    if (!row || (asOptionalText(row.authorId) ?? null) !== author.id) {
      throw new TestProgressNotFoundError(`Comment ${id} was not found.`);
    }

    await this.database
      .query()
      .deleteFrom('problemComments')
      .where('id', '=', id)
      .execute();
  }

  private async getProblemComment(id: number): Promise<ProblemCommentRecord> {
    const row = await this.database
      .query()
      .selectFrom('problemComments')
      .select([
        'id',
        'problemId',
        'authorId',
        'authorName',
        'content',
        'createdAt',
      ])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new TestProgressNotFoundError(`Comment ${id} was not found.`);
    }

    return toProblemCommentRecord(row);
  }

  private async requireProblem(id: number): Promise<void> {
    const row = await this.database
      .query()
      .selectFrom('issues')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new TestProgressNotFoundError(`Problem ${id} was not found.`);
    }
  }

  public async getSummary(): Promise<ProgressSummary> {
    const featurePoints = await this.database
      .query()
      .selectFrom('featurePoints')
      .select([
        'id',
        'name',
        'level',
        'parentId',
        'status',
        'skillsStatus',
        'docsStatus',
        'exampleExists',
      ])
      .orderBy('sortOrder', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const problems = await this.database
      .query()
      .selectFrom('issues')
      .select(['featurePointId', 'type', 'status'])
      .execute();

    const problemsByFeaturePoint = new Map<
      number,
      Record<ProblemType, ProblemCounts>
    >();
    for (const problem of problems) {
      const key = Number(problem.featurePointId);
      const grouped =
        problemsByFeaturePoint.get(key) ?? emptyProblemCountsByType();
      const type = readEnum(PROBLEM_TYPES, problem.type, 'type', 'manual');
      const status = readEnum(
        PROBLEM_STATUSES,
        problem.status,
        'status',
        'pending',
      );
      grouped[type].total += 1;
      if (!CLOSED_PROBLEM_STATUSES.includes(status)) {
        grouped[type].open += 1;
      }
      problemsByFeaturePoint.set(key, grouped);
    }

    const statusCounts = emptyStatusCounts();
    const readiness = {
      skills: emptyCriteria(),
      docs: emptyCriteria(),
      example: emptyCriteria(),
    };
    const exampleExists = emptyExampleExists();
    const dimensions: DimensionSummary[] = [];
    const dimensionById = new Map<
      number,
      {
        id: number;
        name: string;
        status: FeatureStatus;
        counts: Record<FeatureStatus, number>;
        problems: ProblemCounts;
      }
    >();

    for (const row of featurePoints) {
      const level = readEnum(FEATURE_LEVELS, row.level, 'level', 'feature');
      const status = readEnum(
        FEATURE_STATUSES,
        row.status,
        'status',
        'unspecified',
      );
      const grouped =
        problemsByFeaturePoint.get(Number(row.id)) ?? emptyProblemCountsByType();

      if (level === 'dimension') {
        dimensionById.set(Number(row.id), {
          id: Number(row.id),
          name: asText(row.name),
          status,
          counts: emptyStatusCounts(),
          // A dimension row carries its own problems as well as its feature points'.
          problems: sumProblemCounts(grouped),
        });
        continue;
      }

      statusCounts[status] += 1;

      const skills = readEnum(
        AVAILABILITY_STATUSES,
        row.skillsStatus,
        'skillsStatus',
        'unspecified',
      );
      const docs = readEnum(
        AVAILABILITY_STATUSES,
        row.docsStatus,
        'docsStatus',
        'unspecified',
      );
      const example = readEnum(
        EXAMPLE_EXISTS_STATUSES,
        row.exampleExists,
        'exampleExists',
        'unspecified',
      );
      readiness.skills[criteriaState(skills, grouped.skills.open)] += 1;
      readiness.docs[criteriaState(docs, grouped.docs.open)] += 1;
      readiness.example[criteriaState(example, grouped.example.open)] += 1;
      exampleExists[example] += 1;

      const dimension =
        row.parentId === null || row.parentId === undefined
          ? undefined
          : dimensionById.get(Number(row.parentId));
      if (dimension) {
        dimension.counts[status] += 1;
        const summed = sumProblemCounts(grouped);
        dimension.problems.total += summed.total;
        dimension.problems.open += summed.open;
      }
    }

    for (const dimension of dimensionById.values()) {
      dimensions.push({
        id: dimension.id,
        name: dimension.name,
        status: dimension.status,
        featureCount: Object.values(dimension.counts).reduce(
          (sum, count) => sum + count,
          0,
        ),
        statusCounts: dimension.counts,
        problems: dimension.problems,
      });
    }

    const problemsByType = countProblems(problems);
    const totals = {
      dimensions: dimensions.length,
      features: featurePoints.length - dimensions.length,
      materialProblems:
        problemsByType.skills.total +
        problemsByType.docs.total +
        problemsByType.example.total,
      openMaterialProblems:
        problemsByType.skills.open +
        problemsByType.docs.open +
        problemsByType.example.open,
      testProblems:
        problemsByType.automation.total + problemsByType.manual.total,
      openTestProblems:
        problemsByType.automation.open + problemsByType.manual.open,
    };

    return {
      totals,
      statusCounts,
      readiness,
      exampleExists,
      problems: problemsByType,
      dimensions,
    };
  }

  private async featurePointNames(): Promise<Map<number, string>> {
    const rows = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id', 'name'])
      .execute();
    return new Map(rows.map((row) => [Number(row.id), asText(row.name)]));
  }

  /** Accounts by id, for resolving owner associations to display names. */
  private async ownerNames(): Promise<Map<string, string>> {
    const rows = await this.database
      .query()
      .selectFrom('user')
      .select(['id', 'name'])
      .execute();
    return new Map(rows.map((row) => [String(row.id), asText(row.name)]));
  }

  /**
   * Owner writes are account associations: `ownerId` is authoritative and also
   * refreshes the legacy `owner` text. A name-only write (scripts, older clients)
   * resolves to an account when the display name is unique, and stays text
   * otherwise so an environment without accounts keeps working.
   */
  private async resolveOwnerFields(input: {
    readonly ownerId?: string | null;
    readonly owner?: string | null;
  }): Promise<{ owner: string | null; ownerId: string | null }> {
    if (input.ownerId !== undefined) {
      if (input.ownerId === null) {
        return { owner: null, ownerId: null };
      }

      const user = await this.database
        .query()
        .selectFrom('user')
        .select(['id', 'name'])
        .where('id', '=', input.ownerId)
        .executeTakeFirst();
      if (!user) {
        throw new TestProgressValidationError(
          `ownerId does not match a user: ${input.ownerId}.`,
        );
      }

      return { owner: asText(user.name), ownerId: String(user.id) };
    }

    const owner = input.owner;
    if (owner === undefined || owner === null) {
      return { owner: null, ownerId: null };
    }

    const matches = await this.database
      .query()
      .selectFrom('user')
      .select(['id', 'name'])
      .where('name', '=', owner)
      .limit(2)
      .execute();
    if (matches.length !== 1) {
      return { owner, ownerId: null };
    }

    return { owner: asText(matches[0].name), ownerId: String(matches[0].id) };
  }

  private async requireFeaturePoint(id: number): Promise<void> {
    const row = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new TestProgressNotFoundError(`Feature point ${id} was not found.`);
    }
  }

  /**
   * Enforces the two-level tree the tracker uses: a dimension has no parent, a feature point
   * belongs to a dimension. Deeper nesting would make the overview grouping meaningless.
   */
  private async resolveParentId(
    level: FeatureLevel,
    parentId: number | null,
    selfId: number | null,
  ): Promise<number | null> {
    if (level === 'dimension') {
      if (parentId !== null) {
        throw new TestProgressValidationError(
          'A dimension cannot have a parent.',
        );
      }

      return null;
    }

    if (parentId === null) {
      throw new TestProgressValidationError(
        'A feature point must belong to a dimension.',
      );
    }
    if (selfId !== null && parentId === selfId) {
      throw new TestProgressValidationError(
        'A feature point cannot be its own parent.',
      );
    }

    const parent = await this.database
      .query()
      .selectFrom('featurePoints')
      .select(['id', 'level'])
      .where('id', '=', parentId)
      .executeTakeFirst();

    if (!parent) {
      throw new TestProgressNotFoundError(
        `Parent feature point ${parentId} was not found.`,
      );
    }
    if (
      readEnum(FEATURE_LEVELS, parent.level, 'level', 'feature') !== 'dimension'
    ) {
      throw new TestProgressValidationError(
        'A feature point can only belong to a dimension.',
      );
    }

    return parentId;
  }
}

export function createTestProgressService(
  database: DatabaseManager,
): TestProgressService {
  return new DefaultTestProgressService(database);
}

export default class TestProgressProvider extends ServiceProvider<Application> {
  public readonly name: string = 'app/test-progress-provider';

  public override register(): void {
    this.app.container.singleton(testProgressServiceToken, () => {
      const database = this.app.container.resolve(databaseManagerToken);
      return createTestProgressService(database);
    });
  }
}
