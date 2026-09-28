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
vi.mock('../../client/pages/test-progress/markdown', () => ({
  MarkdownEditor: () => null,
}));
vi.mock('../../client/components/use-route-overlay', () => ({
  useRouteOverlay: () => ({ close: async () => {}, isClosing: false }),
}));
// A native select keeps the form's own state and payload under test.
vi.mock('../../client/pages/test-progress/shared', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../client/pages/test-progress/shared.js')
    >();
  return {
    ...actual,
    FormSelect: ({
      value,
      options,
      onValueChange,
    }: {
      readonly value: string;
      readonly options: readonly { value: string; label: string }[];
      readonly onValueChange: (value: string) => void;
    }) => (
      <select
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

const uncategorized = {
  id: 9,
  title: 'Waiting for a person',
  description: null,
  featurePointId: null,
  featurePointName: null,
  type: 'automation',
  status: 'pending',
  owner: null,
  ownerId: null,
  classification: null,
};

async function mount(entry: string) {
  const runtime = new I18nRuntime({
    applicationNamespace: 'app',
    defaultLocale: 'zh-CN',
    locales: ['en-US', 'zh-CN'],
  });
  runtime.registerApplicationNamespace('app', locales);
  await runtime.init('zh-CN');
  return render(
    <I18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={<ProblemFormOverlay />}
            path='/progress/problems/new'
          />
          <Route
            element={<ProblemFormOverlay />}
            path='/progress/problems/:problemId/edit'
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function selectOf(optionName: string): Promise<HTMLSelectElement> {
  const option = await screen.findByRole('option', { name: optionName });
  return option.closest('select') as HTMLSelectElement;
}

function sent(method: string): Record<string, unknown> {
  const call = mocks.api.request.mock.calls.find(
    ([request]) => request.method === method,
  );
  return (call![0] as { json: Record<string, unknown> }).json;
}

beforeEach(() => {
  mocks.api.request.mockReset();
  mocks.api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST' || method === 'PATCH')
        return { data: uncategorized };
      if (path === 'test-progress/feature-points')
        return {
          data: [
            {
              id: 37,
              name: '应用搭建',
              level: 'dimension',
              parentId: null,
              owner: null,
              ownerId: null,
            },
            {
              id: 47,
              name: '数据库',
              level: 'feature',
              parentId: 37,
              owner: '陈霖',
              ownerId: null,
            },
          ],
        };
      if (path === 'test-progress/members')
        return { data: [{ id: 'admin', name: 'Admin', username: 'admin' }] };
      return { data: uncategorized };
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe('problem form feature point and owner', () => {
  it('files a new problem with its feature point owner unless one is chosen', async () => {
    await mount('/progress/problems/new?featurePointId=47');

    const owner = await selectOf('跟随功能点负责人（陈霖）');
    expect(owner.value).toBe('__feature-point-owner__');
    // Uncategorized is not offered for a new problem.
    expect(screen.queryByRole('option', { name: '待归类' })).toBeNull();
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Filed by staff' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(sent('POST')).toMatchObject({ featurePointId: 47 });
    expect(sent('POST')).not.toHaveProperty('ownerId');
    expect(sent('POST')).not.toHaveProperty('owner');
  });

  it('keeps an explicit "no owner" and requires a feature point', async () => {
    await mount('/progress/problems/new');

    fireEvent.change((await screen.findAllByRole('textbox'))[0], {
      target: { value: 'Unassigned on purpose' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(
      await screen.findByText(/请选择该缺失项所属的功能点/u),
    ).toBeVisible();
    expect(mocks.api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.change(await selectOf('— 数据库'), { target: { value: '47' } });
    fireEvent.change(await selectOf('未指定'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(sent('POST')).toMatchObject({ featurePointId: 47, ownerId: null });
  });

  it('proposes the new point owner when staff classify an ownerless problem', async () => {
    await mount('/progress/problems/9/edit');

    const featurePoint = await selectOf('待归类');
    expect(featurePoint.value).toBe('');
    // Nothing to follow until the problem moves.
    expect(
      screen.queryByRole('option', { name: '跟随功能点负责人（陈霖）' }),
    ).toBeNull();

    fireEvent.change(featurePoint, { target: { value: '47' } });
    expect((await selectOf('跟随功能点负责人（陈霖）')).value).toBe(
      '__feature-point-owner__',
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(sent('PATCH')).toMatchObject({ featurePointId: 47 });
    expect(sent('PATCH')).not.toHaveProperty('ownerId');
  });

  it('leaves an uncategorized problem there when only its status changes', async () => {
    await mount('/progress/problems/9/edit');

    fireEvent.change(await selectOf('待确认'), {
      target: { value: 'cancelled' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(sent('PATCH')).toMatchObject({ status: 'cancelled', ownerId: null });
    expect(sent('PATCH')).not.toHaveProperty('featurePointId');
  });
});
