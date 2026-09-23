import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import locales from '../../client/locales/index.js';
import {
  CriteriaBadge,
  ExampleExistsBadge,
  FeatureStatusBadge,
  ProblemStatusBadge,
  ScoreValue,
} from '../../client/pages/test-progress/shared.js';

async function runtime(): Promise<I18nRuntime> {
  const value = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
  });
  value.registerApplicationNamespace('app', locales);
  await value.init('en-US');
  return value;
}

describe('test progress badges', () => {
  it('translates statuses, criteria, problems and scores in both languages', async () => {
    const value = await runtime();
    render(
      <I18nProvider runtime={value}>
        <FeatureStatusBadge status='testable' />
        <ProblemStatusBadge status='regression' />
        <CriteriaBadge state='hasGaps' openProblems={3} />
        <CriteriaBadge state='missing' />
        <CriteriaBadge state='complete' />
        <ExampleExistsBadge value='no' />
        <ScoreValue score={null} />
      </I18nProvider>,
    );

    expect(screen.getByText('Ready to test')).toBeVisible();
    expect(screen.getByText('Awaiting regression')).toBeVisible();
    expect(screen.getByText('3 gaps')).toBeVisible();
    // Both the missing criteria state and the example flag read "Missing"/"No".
    expect(screen.getByText('Missing')).toBeVisible();
    expect(screen.getByText('Complete')).toBeVisible();
    expect(screen.getByText('No')).toBeVisible();
    expect(screen.getByText('—')).toBeVisible();

    await act(() => value.changeLanguage('zh-CN'));

    expect(screen.getByText('可以测试')).toBeVisible();
    expect(screen.getByText('待回归')).toBeVisible();
    expect(screen.getByText('缺失 3')).toBeVisible();
    expect(screen.getByText('没有')).toBeVisible();
    expect(screen.getByText('完整')).toBeVisible();
    expect(screen.getByText('无')).toBeVisible();
  });
});
