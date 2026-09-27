import { z } from 'zod';

/** The factory workflow must advertise this marker before a run is dispatched. */
export const PROBLEM_FIX_MARKER = 'testmanage:problem-fix-v1';
export const FIX_VERDICTS = [
  'confirmed',
  'not_reproducible',
  'already_fixed',
  'not_framework',
  'needs_info',
  'error',
] as const;
export type FixVerdict = (typeof FIX_VERDICTS)[number];
/** The system author of result comments; there is no user behind it. */
export const FIX_ACTOR = { id: null, name: 'Claude Code' } as const;
/** Same limit the ordinary problem comment input enforces. */
export const COMMENT_LIMIT = 20000;
// A snapshot is a prompt input, not an archive: keep the newest comments.
export const SNAPSHOT_COMMENT_LIMIT = 200;
export const SNAPSHOT_COMMENT_BYTES = 200 * 1024;

export class ProblemFixError extends Error {
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

export interface Actor {
  id: string;
  name: string;
}

const repository = '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+';
export const WORKFLOW_RUN_URL = new RegExp(
  `^https://github\\.com/(${repository})/actions/runs/(\\d{1,20})(?:/attempts/\\d{1,4})?$`,
);
const PULL_REQUEST_URL = new RegExp(
  `^https://github\\.com/${repository}/pull/\\d{1,10}$`,
);
const workflowRunId = z.string().regex(/^\d{1,20}$/);

export const claimInput = z
  .object({
    problemId: z.number().int().positive(),
    externalRunId: z.string().uuid().nullable(),
    workflowRunId,
    workflowRunAttempt: z.number().int().min(1).max(1000),
  })
  .strict();
export type ClaimInput = z.infer<typeof claimInput>;

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
// Labels reach a Markdown comment, so they cannot carry markup.
const label = z
  .string()
  .regex(/^[\w.:@/-]{1,100}$/)
  .nullable();
/**
 * What the one Claude Code invocation used, as the factory measured it.
 * Unknown values are null rather than 0; `costUsd` is a list-price estimate.
 */
export const fixUsage = z
  .object({
    engine: label,
    model: label,
    durationMs: counter,
    turns: counter,
    costUsd: z.number().min(0).max(1_000_000).nullable(),
    tokens: z
      .object({
        input: counter,
        output: counter,
        cacheRead: counter,
        cacheWrite: counter,
        total: counter,
      })
      .strict(),
    complete: z.boolean(),
  })
  .strict();
export type FixUsage = z.infer<typeof fixUsage>;

export const resultInput = z
  .object({
    workflowRunId,
    workflowRunUrl: z.string().max(300).regex(WORKFLOW_RUN_URL),
    verdict: z.enum(FIX_VERDICTS),
    summary: z.string().trim().min(1).max(2000),
    analysis: z.string().max(20000).default(''),
    pullRequestUrl: z
      .string()
      .max(300)
      .regex(PULL_REQUEST_URL)
      .nullable()
      .default(null),
    branch: z
      .string()
      .max(255)
      .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/)
      .nullable()
      .default(null),
    baseSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable()
      .default(null),
    usage: fixUsage.nullable().default(null),
  })
  .strict()
  // Only a confirmed problem is fixed; any other verdict with a PR is a protocol error.
  .refine((r) => r.pullRequestUrl === null || r.verdict === 'confirmed', {
    message: 'PULL_REQUEST_REQUIRES_CONFIRMED',
  });
export type ResultInput = z.infer<typeof resultInput>;

export interface FixSnapshot {
  version: 1;
  capturedAt: string;
  problemUrl: string | null;
  problem: {
    id: number;
    title: string;
    description: string | null;
    type: string;
    status: string;
    featurePointName: string | null;
    owner: string | null;
    factorySource: {
      reportId: string;
      taskTitle: string;
      reportUrl: string | null;
      issueUrl: string;
      pullRequestUrl: string | null;
      runUrl: string;
      environmentUrl: string | null;
    } | null;
  };
  comments: Array<{ authorName: string; content: string; createdAt: string }>;
  /** Older comments left out by the count/size cap; 0 when all are present. */
  commentsOmitted: number;
}

const LABELS: Record<FixVerdict, string> = {
  confirmed: '确认存在（未自动修复）',
  not_reproducible: '无法复现',
  already_fixed: '最新源码已修复',
  not_framework: '非框架问题',
  needs_info: '需要更多信息',
  error: '执行失败',
};

const grouped = (value: number | null) =>
  value === null ? '未知' : value.toLocaleString('en-US');
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  return `${h ? `${h} 小时 ` : ''}${h || m ? `${m} 分 ` : ''}${seconds % 60} 秒`;
}
/** One comment line: tokens first, then the session, turns and cost. */
function usageLine(usage: FixUsage): string {
  const { tokens } = usage;
  return (
    [
      `${grouped(tokens.total)} tokens（输入 ${grouped(tokens.input)} · 输出 ${grouped(tokens.output)} · 缓存写入 ${grouped(tokens.cacheWrite)} · 缓存读取 ${grouped(tokens.cacheRead)}）`,
      usage.durationMs !== null && `会话 ${formatDuration(usage.durationMs)}`,
      usage.turns !== null && `${usage.turns} 轮`,
      usage.costUsd !== null && `按标价约 $${usage.costUsd.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join(' · ') + (usage.complete ? '' : '（用量报告不完整）')
  );
}

/** The single problem comment a result produces, within the comment limit. */
export function resultComment(
  result: ResultInput,
  { elapsedMs = null }: { elapsedMs?: number | null } = {},
): string {
  const label =
    result.verdict === 'confirmed' && result.pullRequestUrl
      ? '确认存在并已提交修复 PR'
      : LABELS[result.verdict];
  const head = `**Claude Code 复核结论：${label}**\n\n${result.summary}`;
  const links = [
    result.pullRequestUrl && `- 修复 PR：${result.pullRequestUrl}`,
    result.branch && `- 分支：\`${result.branch}\``,
    result.baseSha && `- 复核源码提交：\`${result.baseSha}\``,
    result.usage && `- 用量：${usageLine(result.usage)}`,
    elapsedMs !== null &&
      elapsedMs >= 0 &&
      `- 总耗时：${formatDuration(elapsedMs)}（从发起到回传结论）`,
    `- GitHub Actions：${result.workflowRunUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  const notice = '\n\n…（分析过长已截断，完整内容见 GitHub Actions 运行记录）';
  const budget = COMMENT_LIMIT - head.length - links.length - 8;
  let analysis = result.analysis.trim();
  if (analysis.length > budget)
    analysis =
      analysis.slice(0, Math.max(0, budget - notice.length)).trimEnd() + notice;
  return [head, analysis, links].filter(Boolean).join('\n\n');
}
