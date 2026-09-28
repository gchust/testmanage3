import { z } from 'zod';
import type { BuildTasksConfig } from '../../config/build-tasks.js';
import { BuildTaskError } from './model.js';

/**
 * The workflow-run fields read here, as GitHub's REST schema declares them:
 * `status` and `conclusion` are nullable. `display_title` is required there but
 * modelled as nullable so an unexpected null misses a match instead of throwing.
 */
export const workflowRunSchema = z.object({
  id: z.number().int().positive(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  display_title: z.string().nullable(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export const workflowRunPageSchema = z.object({
  total_count: z.number().int().min(0),
  workflow_runs: z.array(workflowRunSchema),
});
/** GitHub returns at most 1,000 runs for a filtered listing: ten pages of 100. */
export const WORKFLOW_RUN_PAGE_SIZE = 100;
export const WORKFLOW_RUN_PAGE_LIMIT = 10;
/** The run name factory entries end with, so an unconfirmed dispatch is found. */
export const isRequestRun = (run: WorkflowRun, requestId: string) =>
  run.display_title?.endsWith(`request ${requestId}`) === true;
export class GitHubBuildClient {
  constructor(
    readonly config: BuildTasksConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  get configured() {
    return (
      this.config.enabled &&
      !!this.config.token &&
      /^[\w.-]+\/[\w.-]+$/.test(this.config.repository) &&
      /^[\w.-]+\.ya?ml$/.test(this.config.workflow) &&
      !!this.config.ref
    );
  }
  private async api(path: string, method = 'GET', body?: unknown) {
    if (!this.configured)
      throw new BuildTaskError('NOT_CONFIGURED', 'FACTORY_NOT_CONFIGURED');
    const response = await this.request(
      `https://api.github.com/repos/${this.config.repository}${path}`,
      {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok)
      throw new BuildTaskError(
        'GITHUB_ERROR',
        `GITHUB_HTTP_${response.status}`,
      );
    return response.status === 204
      ? null
      : (response.json() as Promise<Record<string, unknown>>);
  }
  async verifyWorkflow() {
    const file = await this.api(
      `/contents/.github/workflows/${this.config.workflow}?ref=${encodeURIComponent(this.config.ref)}`,
    );
    const text = Buffer.from(
      typeof file?.content === 'string' ? file.content : '',
      'base64',
    ).toString('utf8');
    if (
      !text.includes('factory:external-closed-v1') ||
      !text.includes('external_run_id')
    )
      throw new BuildTaskError('NOT_CONFIGURED', 'FACTORY_ENTRY_NOT_READY');
    // The Issue guard depends on a real repository label, not a requested name
    // that GitHub could omit when the label has not been provisioned.
    await this.api('/labels/factory%3Aexternal');
  }
  async createIssue(title: string, body: string) {
    const issue = await this.api('/issues', 'POST', {
      title,
      body,
      labels: ['factory:external'],
    });
    const number = Number(issue?.number);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new BuildTaskError('GITHUB_ERROR', 'FACTORY_ISSUE_INVALID');
    return number;
  }
  async closeIssue(number: number) {
    // The Issue archives this submission. Build status belongs to the run.
    const issue = await this.api(`/issues/${number}`, 'PATCH', {
      state: 'closed',
    });
    if (issue?.state !== 'closed')
      throw new BuildTaskError('GITHUB_ERROR', 'FACTORY_ISSUE_NOT_CLOSED');
  }
  async dispatch(issue: number, runId: string) {
    const result = await this.api(
      `/actions/workflows/${this.config.workflow}/dispatches`,
      'POST',
      {
        ref: this.config.ref,
        inputs: { issue_number: String(issue), external_run_id: runId },
      },
    );
    return typeof result?.workflow_run_id === 'number'
      ? String(result.workflow_run_id)
      : null;
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new BuildTaskError('GITHUB_ERROR', 'GITHUB_RESPONSE_INVALID');
    return parsed.data;
  }
  async run(id: string): Promise<WorkflowRun> {
    return this.parse(
      workflowRunSchema,
      await this.api(`/actions/runs/${encodeURIComponent(id)}`),
    );
  }
  /** Pages through dispatches created since the request until its run appears. */
  async findRun(id: string, since: string): Promise<WorkflowRun | null> {
    for (let page = 1; page <= WORKFLOW_RUN_PAGE_LIMIT; page++) {
      const result = this.parse(
        workflowRunPageSchema,
        await this.api(
          `/actions/workflows/${this.config.workflow}/runs?event=workflow_dispatch&per_page=${WORKFLOW_RUN_PAGE_SIZE}&page=${page}&created=${encodeURIComponent('>=' + since)}`,
        ),
      );
      const run = result.workflow_runs.find((r) => isRequestRun(r, id));
      if (run) return run;
      if (page * WORKFLOW_RUN_PAGE_SIZE >= result.total_count) break;
    }
    return null;
  }
}
