import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import locales from '../../client/locales/index.js';
import { ProblemFixSection } from '../../client/pages/test-progress/problems/problem-fix.js';
import type { FixRun } from '../../client/pages/test-progress/problems/problem-fix-api.js';

const mocks = vi.hoisted(() => ({ api: { request: vi.fn() }, allowed: true }));
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => mocks.api }));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: mocks.allowed, isPending: false }),
}));

const finished: FixRun = {
  id: 'r1',
  problemId: 7,
  origin: 'testmanage',
  status: 'completed',
  active: false,
  requestedByName: 'Cheng',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:10:00Z',
  workflowRunId: '100',
  workflowRunUrl: 'https://github.com/owner/factory/actions/runs/100',
  error: null,
  result: {
    verdict: 'confirmed',
    summary: '筛选状态在刷新后丢失。',
    pullRequestUrl: 'https://github.com/nocobase/nocobase3/pull/12',
    branch: 'claude/problem-7',
  },
};
function runs(list: FixRun[], configured = true) {
  return { data: { runs: list, configured, repository: 'owner/factory' } };
}
async function mount(onSettled = () => {}) {
  const runtime = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'zh-CN',
    locales: ['en-US', 'zh-CN'],
  });
  runtime.registerApplicationNamespace('app', locales);
  await runtime.init('zh-CN');
  return render(
    <I18nProvider runtime={runtime}>
      <ProblemFixSection problemId={7} onSettled={onSettled} />
    </I18nProvider>,
  );
}
beforeEach(() => {
  mocks.allowed = true;
  mocks.api.request.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('Claude Code problem fix section', () => {
  it('shows the verdict, summary, PR and Actions links of a finished run', async () => {
    mocks.api.request.mockResolvedValue(runs([finished]));
    await mount();
    expect(await screen.findByText('确认存在')).toBeInTheDocument();
    expect(screen.getByText('筛选状态在刷新后丢失。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft PR' })).toHaveAttribute(
      'href',
      'https://github.com/nocobase/nocobase3/pull/12',
    );
    expect(screen.getByRole('link', { name: 'Actions 运行' })).toHaveAttribute(
      'href',
      'https://github.com/owner/factory/actions/runs/100',
    );
  });
  it('requires an explicit confirmation and submits one idempotent request', async () => {
    mocks.api.request.mockImplementation(
      async (request: { method?: string }) =>
        request.method === 'POST'
          ? {
              data: {
                ...finished,
                status: 'queued',
                active: true,
                result: null,
              },
            }
          : runs([]),
    );
    await mount();
    fireEvent.click(
      await screen.findByRole('button', { name: '交给 Claude Code 复核修复' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/订阅额度/)).toBeInTheDocument();
    expect(within(dialog).getByText(/draft PR/)).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: '开始复核修复' }),
    );
    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'problem-fixes/problems/7/runs',
          method: 'POST',
          headers: { 'Idempotency-Key': expect.any(String) },
        }),
      ),
    );
    expect(
      mocks.api.request.mock.calls.filter(([r]) => r.method === 'POST'),
    ).toHaveLength(1);
  });
  it('disables the button while a run is active or the integration is missing', async () => {
    mocks.api.request.mockResolvedValue(
      runs([{ ...finished, status: 'running', active: true, result: null }]),
    );
    const view = await mount();
    expect(
      await screen.findByRole('button', { name: '正在复核修复' }),
    ).toBeDisabled();
    view.unmount();
    mocks.api.request.mockResolvedValue(runs([], false));
    await mount();
    expect(
      await screen.findByRole('button', { name: '交给 Claude Code 复核修复' }),
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('管理员');
  });
  it('reloads the page data once an active run settles', async () => {
    const active = {
      ...finished,
      status: 'running',
      active: true,
      result: null,
    };
    let settled = false;
    mocks.api.request.mockImplementation(async (request: { path: string }) => {
      if (request.path.endsWith('/refresh')) {
        settled = true;
        return { data: finished };
      }
      return runs([settled ? finished : active]);
    });
    const onSettled = vi.fn();
    await mount(onSettled);
    fireEvent.click(await screen.findByRole('button', { name: '刷新状态' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('确认存在')).toBeInTheDocument();
  });
  it('is hidden without the read permission', async () => {
    mocks.allowed = false;
    const view = await mount();
    expect(view.container).toBeEmptyDOMElement();
    expect(mocks.api.request).not.toHaveBeenCalled();
  });
});
