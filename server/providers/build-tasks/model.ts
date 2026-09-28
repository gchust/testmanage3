import { z } from 'zod';

const TASK_TYPES = ['create', 'improve', 'fix'] as const;
const BUILD_REVIEWS = ['auto', 'off', 'full'] as const;

/** A branch name git accepts, or blank for the task's own branch. */
function isTargetBranch(s: string): boolean {
  return (
    !s ||
    (/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(s) &&
      s !== 'HEAD' &&
      !s.includes('..') &&
      s
        .split('/')
        .every(
          (p) =>
            p && !p.startsWith('.') && !p.endsWith('.') && !p.endsWith('.lock'),
        ))
  );
}

export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    requirements: z.string().trim().min(1).max(24000),
    acceptanceCriteria: z.string().trim().max(12000).default(''),
    taskType: z.enum(TASK_TYPES).default('create'),
    targetBranch: z.string().trim().max(120).default('').refine(isTargetBranch),
    sampleData: z.boolean().default(true),
    buildReview: z.enum(BUILD_REVIEWS).default('auto'),
  })
  .strict();
/**
 * An edit names only the fields it changes. Unlike `taskInput` it applies no
 * defaults, so a field the edit leaves out keeps its stored value.
 */
export const taskPatch = z
  .object({
    title: z.string().trim().min(1).max(200),
    requirements: z.string().trim().min(1).max(24000),
    acceptanceCriteria: z.string().trim().max(12000),
    taskType: z.enum(TASK_TYPES),
    targetBranch: z.string().trim().max(120).refine(isTargetBranch),
    sampleData: z.boolean(),
    buildReview: z.enum(BUILD_REVIEWS),
  })
  .partial()
  .strict();
export type TaskInput = z.infer<typeof taskInput>;
export interface Actor {
  id: string;
  name: string;
}
export interface TaskSnapshot extends TaskInput {
  comments: Array<{
    id: string;
    authorName: string;
    content: string;
    createdAt: string;
  }>;
}
export class BuildTaskError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'ACTIVE_RUN'
      | 'NOT_CONFIGURED'
      | 'GITHUB_ERROR'
      | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
// Issue Form headings are protocol delimiters. User Markdown cannot introduce
// another control field or move requirements into the QA-only field.
const markdown = (s: string) => s.replace(/^###(?=\s)/gm, '####');
export function issueBody(
  snapshot: TaskSnapshot,
  taskId: string,
  runId: string,
) {
  const requirements = [
    snapshot.requirements,
    ...snapshot.comments.map(
      (c) => `追加需求 · ${c.authorName} · ${c.createdAt}\n\n${c.content}`,
    ),
  ].join('\n\n---\n\n');
  const body = [
    `<!-- testmanage3-task:${taskId} run:${runId} -->`,
    '### 目标分支',
    snapshot.targetBranch,
    '### 任务类型',
    { create: '创建新系统', improve: '继续完善现有系统', fix: '修复已有系统' }[
      snapshot.taskType
    ],
    '### 框架评测',
    { auto: '自动', off: '轻量', full: '完整' }[snapshot.buildReview],
    '### 业务需求',
    markdown(requirements),
    '### 验收要求',
    markdown(snapshot.acceptanceCriteria),
    '### 示例数据',
    snapshot.sampleData ? '是' : '否',
  ].join('\n\n');
  if (Buffer.byteLength(body) > 60000)
    throw new BuildTaskError('INVALID_INPUT', 'TASK_TOO_LARGE');
  return body;
}
