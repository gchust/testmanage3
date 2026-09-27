import type { ProblemFixesConfig } from '../../config/problem-fixes.js';
import type { WorkflowRun } from '../build-tasks/github.js';
import { PROBLEM_FIX_MARKER, ProblemFixError } from './model.js';

/**
 * The factory entry for problem fixes. Kept apart from GitHubBuildClient: the
 * two workflows have different entry guards and inputs, and neither creates the
 * other's side effects (no Issue is created for a fix).
 */
export class ProblemFixGitHubClient {
  constructor(
    readonly config: ProblemFixesConfig,
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
      throw new ProblemFixError('NOT_CONFIGURED', 'FACTORY_NOT_CONFIGURED');
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
      throw new ProblemFixError(
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
    if (!text.includes(PROBLEM_FIX_MARKER) || !text.includes('external_run_id'))
      throw new ProblemFixError('NOT_CONFIGURED', 'FACTORY_ENTRY_NOT_READY');
  }
  async dispatch(problemId: number, runId: string) {
    const result = await this.api(
      `/actions/workflows/${this.config.workflow}/dispatches`,
      'POST',
      {
        ref: this.config.ref,
        inputs: { problem_id: String(problemId), external_run_id: runId },
      },
    );
    return typeof result?.workflow_run_id === 'number'
      ? String(result.workflow_run_id)
      : null;
  }
  async run(id: string): Promise<WorkflowRun> {
    return (await this.api(
      `/actions/runs/${encodeURIComponent(id)}`,
    )) as unknown as WorkflowRun;
  }
  async findRun(id: string, since: string): Promise<WorkflowRun | null> {
    const result = await this.api(
      `/actions/workflows/${this.config.workflow}/runs?event=workflow_dispatch&per_page=100&created=${encodeURIComponent('>=' + since)}`,
    );
    return (
      ((result?.workflow_runs ?? []) as WorkflowRun[]).find((r) =>
        r.display_title.endsWith(`request ${id}`),
      ) ?? null
    );
  }
}
