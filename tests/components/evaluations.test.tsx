import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import locales from '../../client/locales/index.js';
import { LoadState, Status } from '../../client/pages/evaluations/shared.js';

describe('evaluation presentation', () => {
  it('distinguishes not executed, not received and unknown results in both languages', async () => {
    const runtime = new I18nRuntime({
      applicationNamespace: 'app',
      defaultLocale: 'en-US',
      locales: ['en-US', 'zh-CN'],
    });
    runtime.registerApplicationNamespace('app', locales);
    await runtime.init('en-US');
    render(
      <I18nProvider runtime={runtime}>
        <Status value='not-executed' />
        <Status value='not-received' />
        <Status value={null} />
      </I18nProvider>,
    );
    const english = screen
      .getAllByText(/not|unknown/i)
      .map((e) => e.textContent);
    expect(new Set(english).size).toBe(3);
    await act(() => runtime.changeLanguage('zh-CN'));
    expect(screen.getByText('尚未执行')).toBeVisible();
    expect(screen.getByText('尚未接收')).toBeVisible();
  });
  it('hides stale protected content during loading and on errors', async () => {
    const runtime = new I18nRuntime({
      applicationNamespace: 'app',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    });
    runtime.registerApplicationNamespace('app', locales);
    await runtime.init('en-US');
    const { rerender } = render(
      <I18nProvider runtime={runtime}>
        <LoadState loading error={null}>
          Secret report
        </LoadState>
      </I18nProvider>,
    );
    expect(screen.queryByText('Secret report')).not.toBeInTheDocument();
    rerender(
      <I18nProvider runtime={runtime}>
        <LoadState loading={false} error={new Error('denied')}>
          Secret report
        </LoadState>
      </I18nProvider>,
    );
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByText('Secret report')).not.toBeInTheDocument();
  });
});
