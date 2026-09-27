import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import locales from '../../client/locales/index.js';
import BuildTasksPage from '../../client/pages/build-tasks/index.js';
import TaskDetailPage from '../../client/pages/build-tasks/detail.js';
import { RunButton } from '../../client/pages/build-tasks/shared.js';
const mocks = vi.hoisted(() => ({ api: { request: vi.fn() }, allowed: true }));
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => mocks.api }));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: mocks.allowed, isPending: false }),
}));
vi.mock('../../client/components/route-child-page', () => ({
  RouteChildPage: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../../client/components/breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));
const task = {
  id: 't1',
  title: '售后工单系统',
  requirements: '员工提交工单',
  acceptanceCriteria: '',
  targetBranch: 'apps/service',
  taskType: 'create',
  sampleData: true,
  buildReview: 'auto',
  repository: 'owner/factory',
  issueNumber: 146,
  createdByName: 'Cheng',
  updatedAt: '2026-09-27T00:00:00Z',
};
const detail = {
  task,
  configured: true,
  comments: [],
  runs: [],
  repository: 'owner/factory',
};
async function mount(element: React.ReactNode, url = '/') {
  const runtime = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'zh-CN',
    locales: ['en-US', 'zh-CN'],
  });
  runtime.registerApplicationNamespace('app', locales);
  await runtime.init('zh-CN');
  return render(
    <I18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[url]}>{element}</MemoryRouter>
    </I18nProvider>,
  );
}
beforeEach(() => {
  mocks.allowed = true;
  mocks.api.request.mockReset();
});
afterEach(() => vi.restoreAllMocks());
describe('build task UI', () => {
  it('lists tasks and does not start builds while viewing or searching', async () => {
    mocks.api.request.mockResolvedValue({
      data: { tasks: [task], configured: true, repository: 'owner/factory' },
    });
    await mount(<BuildTasksPage />);
    expect(
      await screen.findByRole('link', { name: task.title }),
    ).toHaveAttribute('href', '/t1');
    fireEvent.change(screen.getByLabelText('搜索搭建任务'), {
      target: { value: 'absent' },
    });
    expect(
      screen.getByText('暂无匹配的任务，可以新建一个搭建任务。'),
    ).toBeInTheDocument();
    expect(
      mocks.api.request.mock.calls.every(
        ([request]) => request.method === undefined,
      ),
    ).toBe(true);
  });
  it('requires an explicit run confirmation and submits one idempotent request', async () => {
    mocks.api.request.mockResolvedValue({
      data: { id: 'r1', status: 'queued' },
    });
    const onRun = vi.fn();
    await mount(
      <RunButton taskId='t1' active={false} configured onRun={onRun} />,
    );
    expect(mocks.api.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '运行一次' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/模型额度/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '运行一次' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(mocks.api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'build-tasks/t1/runs',
        method: 'POST',
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    );
  });
  it('disables another run while a task is active and hides it without permission', async () => {
    const view = await mount(
      <RunButton taskId='t1' active configured onRun={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '正在运行' })).toBeDisabled();
    view.unmount();
    mocks.allowed = false;
    await mount(
      <RunButton taskId='t1' active={false} configured onRun={() => {}} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('appends a comment without triggering GitHub and preserves the task discussion', async () => {
    mocks.api.request.mockImplementation(async ({ method }) => ({
      data: method === 'POST' ? { id: 'c1' } : detail,
    }));
    await mount(
      <Routes>
        <Route path='/build-tasks/:taskId' element={<TaskDetailPage />} />
      </Routes>,
      '/build-tasks/t1',
    );
    await screen.findByRole('heading', { name: task.title });
    fireEvent.change(screen.getByLabelText('追加评论'), {
      target: { value: '增加超时提醒' },
    });
    fireEvent.click(screen.getByRole('button', { name: '追加评论' }));
    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'build-tasks/t1/comments',
          method: 'POST',
          json: { content: '增加超时提醒' },
        }),
      ),
    );
    expect(
      mocks.api.request.mock.calls.some(([request]) =>
        request.path.endsWith('/runs'),
      ),
    ).toBe(false);
  });
  it('shows separate acceptance and delivery outcomes and links to the returned report', async () => {
    mocks.api.request.mockResolvedValue({
      data: {
        ...detail,
        runs: [
          {
            id: 'r1',
            status: 'completed',
            active: false,
            createdAt: task.updatedAt,
            requestedByName: 'Cheng',
            result: {
              execution: 'completed',
              acceptance: 'passed',
              delivery: 'published',
              reportUrl: 'https://owner.github.io/factory/report.html',
              pullRequestUrl: 'https://github.com/owner/factory/pull/150',
              runUrl: 'https://github.com/owner/factory/actions/runs/100',
            },
          },
        ],
      },
    });
    await mount(
      <Routes>
        <Route path='/build-tasks/:taskId' element={<TaskDetailPage />} />
      </Routes>,
      '/build-tasks/t1',
    );
    expect(await screen.findByText('PR 已发布')).toBeInTheDocument();
    expect(screen.getByText('通过')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '原始报告' })).toHaveAttribute(
      'href',
      'https://owner.github.io/factory/report.html',
    );
  });
});
