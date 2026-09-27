import type { BuildTasksConfig } from '../../config/build-tasks.js';
import { BuildTaskError } from './model.js';

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  display_title: string;
  created_at: string;
}
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
    if (!text.includes('factory:external') || !text.includes('external_run_id'))
      throw new BuildTaskError('NOT_CONFIGURED', 'FACTORY_ENTRY_NOT_READY');
    // The Issue guard depends on a real repository label, not a requested name
    // that GitHub could omit when the label has not been provisioned.
    await this.api('/labels/factory%3Aexternal');
  }
  async saveIssue(number: number | null, title: string, body: string) {
    if (number) {
      const issue = await this.api(`/issues/${number}`);
      if (issue?.pull_request)
        throw new BuildTaskError('CONFLICT', 'FACTORY_ISSUE_INVALID');
      const labels = Array.isArray(issue?.labels)
        ? issue.labels.flatMap((label: unknown) => {
            if (typeof label === 'string') return [label];
            if (
              label &&
              typeof label === 'object' &&
              'name' in label &&
              typeof label.name === 'string'
            )
              return [label.name];
            return [];
          })
        : [];
      await this.api(`/issues/${number}`, 'PATCH', {
        title,
        body,
        state: 'open',
        labels: [...new Set([...labels, 'factory:external'])],
      });
      return number;
    }
    const issue = await this.api('/issues', 'POST', {
      title,
      body,
      labels: ['factory:external'],
    });
    return Number(issue?.number);
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
