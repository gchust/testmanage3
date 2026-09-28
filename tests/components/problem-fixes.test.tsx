import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import {
  act,
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
  released: null,
  result: {
    verdict: 'confirmed',
    summary: '筛选状态在刷新后丢失。',
    pullRequestUrl: 'https://github.com/nocobase/nocobase3/pull/12',
    branch: 'claude/problem-7',
    usage: null,
    elapsedMs: null,
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
  it('shows how long a finished run took and what it used', async () => {
    mocks.api.request.mockResolvedValue(
      runs([
        {
          ...finished,
          result: {
            ...finished.result!,
            elapsedMs: 803_000,
            usage: {
              engine: 'claude-code',
              model: 'opus',
              durationMs: 718_517,
              turns: 67,
              costUsd: 3.7372,
              tokens: {
                input: 110,
                output: 36_580,
                cacheRead: 3_760_135,
                cacheWrite: 94_205,
                total: 3_891_030,
              },
              complete: true,
            },
          },
        },
      ]),
    );
    await mount();
    const usage = await screen.findByRole('region', { name: '用量' });
    const value = (name: string) =>
      within(usage).getByText(name).nextElementSibling?.textContent;
    expect(value('总耗时')).toBe('13 分 23 秒');
    expect(value('Claude Code 会话')).toBe('11 分 59 秒 · 67 轮 · opus');
    expect(value('Token（含缓存）')).toBe((3_891_030).toLocaleString());
    expect(value('按标价估算')).toBe('$3.74');
    expect(usage).toHaveTextContent(
      `输出 ${(36_580).toLocaleString()} · 缓存写入 ${(94_205).toLocaleString()}`,
    );
    expect(usage).not.toHaveTextContent('不完整');
  });
  it('shows no usage for a result reported without it', async () => {
    mocks.api.request.mockResolvedValue(runs([finished]));
    await mount();
    await screen.findByText('确认存在');
    expect(screen.queryByRole('region', { name: '用量' })).toBeNull();
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
  it('disables the button while a run is active', async () => {
    mocks.api.request.mockResolvedValue(
      runs([{ ...finished, status: 'running', active: true, result: null }]),
    );
    await mount();
    expect(
      await screen.findByRole('button', { name: '正在复核修复' }),
    ).toBeDisabled();
  });
  it('shows nothing where fixes are not enabled, and only history once there is some', async () => {
    mocks.api.request.mockResolvedValue(runs([], false));
    const view = await mount();
    await waitFor(() => expect(mocks.api.request).toHaveBeenCalled());
    // Let the answer render before asserting that nothing did.
    await act(async () => {
      await mocks.api.request.mock.results[0]?.value;
    });
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    mocks.api.request.mockResolvedValue(runs([finished], false));
    await mount();
    expect(await screen.findByText('确认存在')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('未启用');
    expect(
      screen.queryByRole('button', { name: '交给 Claude Code 复核修复' }),
    ).toBeNull();
  });
  it('releases a stuck run only after confirmation', async () => {
    const stuck: FixRun = {
      ...finished,
      status: 'dispatch_unknown',
      active: true,
      error: 'GITHUB_CONNECTION_ERROR',
      result: null,
    };
    let released = false;
    mocks.api.request.mockImplementation(
      async (request: { path: string; method?: string }) => {
        if (request.path.endsWith('/release')) {
          released = true;
          return {
            data: {
              ...stuck,
              status: 'abandoned',
              active: false,
              error: 'RELEASED',
              released: { byName: 'Lead', at: '2026-09-28T02:00:00Z' },
            },
          };
        }
        return runs([
          released
            ? {
                ...stuck,
                status: 'abandoned',
                active: false,
                error: 'RELEASED',
                released: { byName: 'Lead', at: '2026-09-28T02:00:00Z' },
              }
            : stuck,
        ]);
      },
    );
    const onSettled = vi.fn();
    await mount(onSettled);
    fireEvent.click(await screen.findByRole('button', { name: '释放' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/从未启动/)).toBeInTheDocument();
    expect(released).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '释放运行' }));
    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'problem-fixes/problems/7/runs/r1/release',
          method: 'POST',
        }),
      ),
    );
    expect(await screen.findByText('已释放')).toBeInTheDocument();
    expect(screen.getByText(/^Lead 于 .+ 释放$/)).toBeInTheDocument();
    expect(screen.queryByText('RELEASED')).toBeNull();
    expect(screen.queryByRole('button', { name: '释放' })).toBeNull();
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });
  it('marks the status as stale while polling fails and clears it once polling recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const active = {
        ...finished,
        status: 'running',
        active: true,
        result: null,
      };
      let failing = true;
      mocks.api.request.mockImplementation(
        async (request: { path: string }) => {
          if (request.path.endsWith('/refresh')) {
            if (failing) throw new Error('offline');
            return { data: active };
          }
          return runs([active]);
        },
      );
      await mount();
      await screen.findByRole('button', { name: '正在复核修复' });
      await vi.advanceTimersByTimeAsync(20000);
      expect(await screen.findByText(/正在自动重试/)).toBeInTheDocument();
      failing = false;
      await vi.advanceTimersByTimeAsync(20000);
      await waitFor(() =>
        expect(screen.queryByText(/正在自动重试/)).toBeNull(),
      );
    } finally {
      vi.useRealTimers();
    }
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
