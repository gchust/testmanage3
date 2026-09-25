import { reportPreviewDocument } from '../../client/pages/test-progress/problems/report-preview-document.js';
import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import locales from '../../client/locales/index.js';
import {
  FactoryLinks,
  FactorySource,
} from '../../client/pages/test-progress/problems/factory-source.js';
import { ReportPreview } from '../../client/pages/test-progress/problems/report-preview.js';

const { api } = vi.hoisted(() => ({ api: { stream: vi.fn() } }));
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => api }));
const html =
  '<html><head><style>h1{color:blue}</style></head><body><h1>Full report</h1><p>Complete evidence</p></body></html>';
const source = {
  reportId: 'stored-report',
  taskTitle: 'Factory task',
  issueUrl: 'https://github.com/owner/repo/issues/12',
  pullRequestUrl: 'https://github.com/owner/repo/pull/13',
  environmentUrl: 'https://nb3-13.nfvd.net/main/',
  runUrl: 'https://github.com/owner/repo/actions/runs/14',
  files: ['report.html', 'evaluation.json'],
};
async function runtime() {
  const value = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'zh-CN',
    locales: ['en-US', 'zh-CN'],
  });
  value.registerApplicationNamespace('app', locales);
  await value.init('zh-CN');
  return value;
}
beforeEach(() => {
  api.stream.mockImplementation(async () => new Response(html).body);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.stream.mockReset();
});

describe('factory problem source', () => {
  it('embeds the source report link and offers opening it without requesting archive bytes', async () => {
    const r = await runtime();
    const url =
      'https://owner.github.io/repo/reports/issues/12/runs/14/attempt-1/index.html';
    render(
      <I18nProvider runtime={r}>
        <FactorySource
          problemId={12}
          source={{
            ...source,
            reportUrl: url,
            hasArchive: false,
            files: ['evaluation.json'],
          }}
        />
      </I18nProvider>,
    );
    const frame = screen.getByTitle('在线阅读 HTML 报告');
    expect(frame).toHaveAttribute('src', url);
    expect(frame).toHaveAttribute('sandbox', '');
    expect(screen.getByRole('link', { name: '打开原始报告' })).toHaveAttribute(
      'href',
      url,
    );
    expect(api.stream).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '下载原始报告包', hidden: true }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: '下载 HTML 报告', hidden: true }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '扩大阅读区' }));
    expect(frame).toHaveClass('h-[85vh]');
    await act(() => r.changeLanguage('en-US'));
    expect(
      screen.getByRole('link', { name: 'Open original report' }),
    ).toHaveAttribute('href', url);
  });

  it('separates clickable Issue, code PR and preview environment from report downloads', async () => {
    const r = await runtime();
    const { rerender } = render(
      <I18nProvider runtime={r}>
        <FactoryLinks source={source} />
      </I18nProvider>,
    );
    for (const [label, url] of [
      ['来源 Issue', source.issueUrl],
      ['代码 PR', source.pullRequestUrl],
      ['PR 预览环境', source.environmentUrl],
    ])
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        url,
      );
    rerender(
      <I18nProvider runtime={r}>
        <FactoryLinks
          source={{ ...source, pullRequestUrl: null, environmentUrl: null }}
          compact
        />
      </I18nProvider>,
    );
    expect(screen.getByText('代码 PR · 暂无 PR 记录')).toBeVisible();
    expect(screen.getByText('PR 预览环境 · 暂无环境地址')).toBeVisible();
  });

  it('opens the complete HTML automatically and leaves file downloads optional', async () => {
    const r = await runtime();
    render(
      <I18nProvider runtime={r}>
        <FactorySource problemId={12} source={source} />
      </I18nProvider>,
    );
    const frame = await screen.findByTitle('在线阅读 HTML 报告');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('Complete evidence');
    expect(api.stream).toHaveBeenCalledWith({
      path: 'test-progress/problems/12/report',
      query: { path: 'report.html' },
      signal: expect.any(AbortSignal),
    });
    expect(
      screen.getByRole('button', { name: '下载原始报告包', hidden: true }),
    ).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '扩大阅读区' }));
    expect(frame).toHaveClass('h-[85vh]');
    fireEvent.click(screen.getByText('下载报告文件（可选）'));
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
    fireEvent.click(screen.getByRole('button', { name: '下载原始报告包' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.stream).toHaveBeenCalledWith({
      path: 'test-progress/problems/12/report',
      query: { path: 'bundle.zip' },
    });
    await act(() => r.changeLanguage('en-US'));
    expect(screen.getByTitle('Read HTML report')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Download HTML report' }),
    ).toBeVisible();
  });

  it('shows a reload action when the authenticated report fetch fails', async () => {
    api.stream.mockRejectedValueOnce(new Error('403'));
    const r = await runtime();
    render(
      <I18nProvider runtime={r}>
        <ReportPreview problemId={12} reportId='report' />
      </I18nProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('报告加载失败');
    expect(screen.queryByTitle('在线阅读 HTML 报告')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByTitle('在线阅读 HTML 报告')).toBeVisible();
  });

  it('does not request HTML when the original archive has none', async () => {
    const r = await runtime();
    render(
      <I18nProvider runtime={r}>
        <FactorySource
          problemId={12}
          source={{ ...source, files: ['evaluation.json'] }}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText('此报告未包含 HTML，可在下方下载完整报告包。'),
    ).toBeVisible();
    expect(api.stream).not.toHaveBeenCalled();
  });

  it('cancels a previous problem fetch and prevents its late response replacing the current report', async () => {
    let finish!: (stream: ReadableStream<Uint8Array>) => void;
    api.stream.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const r = await runtime();
    const { rerender } = render(
      <I18nProvider runtime={r}>
        <ReportPreview problemId={12} reportId='old' />
      </I18nProvider>,
    );
    const signal = api.stream.mock.calls[0]![0].signal as AbortSignal;
    rerender(
      <I18nProvider runtime={r}>
        <ReportPreview problemId={13} reportId='new' />
      </I18nProvider>,
    );
    expect(signal.aborted).toBe(true);
    await screen.findByTitle('在线阅读 HTML 报告');
    await act(async () => {
      finish(new Response('<h1>Old content</h1>').body!);
    });
    expect(
      screen.getByTitle('在线阅读 HTML 报告').getAttribute('srcdoc'),
    ).toContain('Complete evidence');
    expect(
      screen.getByTitle('在线阅读 HTML 报告').getAttribute('srcdoc'),
    ).not.toContain('Old content');
  });

  it('removes active report content and inserts a restrictive preview policy while preserving readable layout', () => {
    const rendered = reportPreviewDocument(
      '<html><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"><style>p{font-size:16px}</style></head><body onload="attack()"><h1>Evidence</h1><script>attack()</script><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input></form><img src="data:image/png;base64,AA" onerror="attack()"><details><summary>Details</summary>Proof</details></body></html>',
    );
    const document = new DOMParser().parseFromString(rendered, 'text/html');
    expect(
      document.querySelector('script,iframe,form,base,[onload],[onerror]'),
    ).toBeNull();
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(document.querySelector('meta')?.getAttribute('content')).toContain(
      "script-src 'none'",
    );
    expect(document.querySelector('meta')?.getAttribute('content')).toContain(
      "connect-src 'none'",
    );
    expect(document.querySelector('h1')?.textContent).toBe('Evidence');
    expect(document.querySelector('style')?.textContent).toContain(
      'font-size:16px',
    );
    expect(document.querySelector('details')?.textContent).toContain('Proof');
  });
});
