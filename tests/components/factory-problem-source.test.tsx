import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import locales from '../../client/locales/index.js';
import { FactorySource } from '../../client/pages/test-progress/problems/factory-source.js';

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => ({ stream }) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stream.mockReset();
});

describe('factory problem source', () => {
  it('shows Issue, PR and report links and downloads the attached original through the authenticated client', async () => {
    const runtime = new I18nRuntime({
      applicationNamespace: 'app',
      defaultLocale: 'zh-CN',
      locales: ['en-US', 'zh-CN'],
    });
    runtime.registerApplicationNamespace('app', locales);
    await runtime.init('zh-CN');
    const source = {
      reportId: 'stored-report',
      taskTitle: 'Factory task',
      issueUrl: 'https://github.com/owner/repo/issues/12',
      pullRequestUrl: 'https://github.com/owner/repo/pull/13',
      runUrl: 'https://github.com/owner/repo/actions/runs/14',
      files: ['report.html', 'evaluation.json'],
    };
    const ui = (pr: string | null) => (
      <I18nProvider runtime={runtime}>
        <MemoryRouter>
          <FactorySource
            problemId={12}
            source={{ ...source, pullRequestUrl: pr }}
          />
        </MemoryRouter>
      </I18nProvider>
    );
    const { rerender } = render(ui(source.pullRequestUrl));
    expect(screen.getByRole('link', { name: 'GitHub Issue' })).toHaveAttribute(
      'href',
      source.issueUrl,
    );
    expect(screen.getByRole('link', { name: 'GitHub PR' })).toHaveAttribute(
      'href',
      source.pullRequestUrl,
    );

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:report'),
        revokeObjectURL: vi.fn(),
      }),
    );
    stream.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([80, 75]));
          controller.close();
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '下载原始报告包' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(stream).toHaveBeenCalledWith({
      path: 'test-progress/problems/12/report',
      query: { path: 'bundle.zip' },
    });
    await act(() => runtime.changeLanguage('en-US'));
    expect(
      screen.getByRole('button', { name: 'Download HTML report' }),
    ).toBeVisible();
    rerender(ui(null));
    expect(
      screen.queryByRole('link', { name: 'GitHub PR' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('No PR recorded')).toBeVisible();
  });
});
