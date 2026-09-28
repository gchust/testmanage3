import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import ProblemFormOverlay from '../../client/pages/test-progress/problems/problem-form.js';

const mocks = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => mocks.api }));
vi.mock('../../client/components/route-dialog', () => ({
  RouteDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The rich editor needs the file service; this test is about the owner field.
vi.mock('../../client/pages/test-progress/markdown', () => ({
  MarkdownEditor: () => null,
}));
vi.mock('../../client/components/use-route-overlay', () => ({
  useRouteOverlay: () => ({ close: async () => {}, isClosing: false }),
}));

const problem = {
  id: 7,
  title: 'Factory problem',
  description: null,
  featurePointId: 47,
  featurePointName: '数据库',
  type: 'automation',
  status: 'pending',
  // A feature point owner handed over by name, with no account.
  owner: '陈霖',
  ownerId: null,
  classification: null,
};

async function mount() {
  const runtime = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'zh-CN',
    locales: ['en-US', 'zh-CN'],
  });
  runtime.registerApplicationNamespace('app', locales);
  await runtime.init('zh-CN');
  return render(
    <I18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={['/progress/problems/7/edit']}>
        <Routes>
          <Route
            element={<ProblemFormOverlay />}
            path='/progress/problems/:problemId/edit'
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.api.request.mockReset();
  mocks.api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'PATCH') return { data: problem };
      if (path === 'test-progress/feature-points')
        return {
          data: [
            { id: 37, name: '应用搭建', level: 'dimension', parentId: null },
            { id: 47, name: '数据库', level: 'feature', parentId: 37 },
          ],
        };
      if (path === 'test-progress/members')
        return { data: [{ id: 'admin', name: 'Admin', username: 'admin' }] };
      return { data: problem };
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe('problem form', () => {
  it('keeps an owner who has only a name when the problem is saved', async () => {
    await mount();

    expect(await screen.findByText('陈霖（未关联账号）')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const patch = mocks.api.request.mock.calls.find(
      ([request]) => request.method === 'PATCH',
    )![0] as { json: Record<string, unknown> };
    expect(patch.json).toMatchObject({ title: 'Factory problem' });
    expect(patch.json).not.toHaveProperty('ownerId');
  });
});
