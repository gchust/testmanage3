import { useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  describeApiError,
  fetchFeaturePoints,
  fetchProblems,
  type FeaturePoint,
  type Problem,
  type ProblemStatus,
  type ProblemType,
} from '../api.js';
import {
  PROBLEM_STATUS_CELL_CLASS,
  PROBLEM_STATUSES,
  PROBLEM_TYPES,
} from '../constants.js';
import {
  CopyForAiButton,
  EmptyPanel,
  ErrorPanel,
  FormSelect,
  ProblemStatusBadge,
} from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';
import { useRefetchOnReturn } from '../use-refetch-on-return.js';

interface ProblemsData {
  readonly problems: Problem[];
}

const ALL = 'all';
const OPEN = 'open';
const MINE = 'me';

/**
 * One problem list for material gaps and test findings alike: the type filter is
 * what used to be two pages (field-rubric §5).
 */
export default function ProblemsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuthentication();
  const currentUserId = session?.user?.id ?? null;

  const featurePointFilter = searchParams.get('featurePointId') ?? ALL;
  const typeFilter = searchParams.get('type') ?? ALL;
  const statusFilter = searchParams.get('status') ?? ALL;
  const onlyMine = searchParams.get('owner') === MINE && currentUserId !== null;

  // The option list is its own resource on purpose: derived from the filtered
  // list, every filter change would collapse the options to "all" while the list
  // reloads, and the next click would land on that only remaining option.
  const featurePoints = useAsyncResource<FeaturePoint[]>(
    'feature-points',
    (signal) => fetchFeaturePoints(api, signal),
  );
  const resource = useAsyncResource<ProblemsData>(
    `problems|${featurePointFilter}|${typeFilter}|${statusFilter}|${onlyMine ? currentUserId : ''}`,
    async (signal) => {
      const filter: {
        featurePointId?: number;
        type?: ProblemType;
        status?: ProblemStatus;
        open?: boolean;
        ownerId?: string;
      } = {};
      if (featurePointFilter !== ALL) {
        filter.featurePointId = Number(featurePointFilter);
      }
      if (typeFilter !== ALL) {
        filter.type = typeFilter as ProblemType;
      }
      if (statusFilter === OPEN) {
        filter.open = true;
      } else if (statusFilter !== ALL) {
        filter.status = statusFilter as ProblemStatus;
      }
      if (onlyMine && currentUserId !== null) {
        filter.ownerId = currentUserId;
      }

      return { problems: await fetchProblems(api, filter, signal) };
    },
  );
  useRefetchOnReturn(() => {
    featurePoints.reload();
    resource.reload();
  });

  function toggleOnlyMine(): void {
    const next = new URLSearchParams(searchParams);
    if (onlyMine) {
      next.delete('owner');
    } else {
      next.set('owner', MINE);
    }
    setSearchParams(next, { replace: true });
  }

  function updateFilter(
    key: 'featurePointId' | 'type' | 'status',
    value: string,
  ): void {
    const next = new URLSearchParams(searchParams);
    if (value === ALL) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('testProgress.problemsTitle')}
        description={t('testProgress.problemsDescription')}
        actions={<CopyForAiButton />}
      />

      <Card>
        <CardContent className='flex flex-col gap-3 md:flex-row md:items-center'>
          <FormSelect
            className='md:w-72'
            options={[
              { value: ALL, label: t('testProgress.allFeaturePoints') },
              ...(featurePoints.data ?? []).map((feature) => ({
                value: String(feature.id),
                label:
                  feature.level === 'dimension'
                    ? feature.name
                    : `— ${feature.name}`,
              })),
            ]}
            value={featurePointFilter}
            onValueChange={(value) => updateFilter('featurePointId', value)}
          />
          <FormSelect
            className='md:w-44'
            options={[
              { value: ALL, label: t('testProgress.allProblemTypes') },
              ...PROBLEM_TYPES.map((type) => ({
                value: type,
                label: t(`testProgress.problemType.${type}`),
              })),
            ]}
            value={typeFilter}
            onValueChange={(value) => updateFilter('type', value)}
          />
          <FormSelect
            className='md:w-44'
            options={[
              { value: ALL, label: t('testProgress.allStatuses') },
              { value: OPEN, label: t('testProgress.problemOpen') },
              ...PROBLEM_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.problemStatus.${status}`),
              })),
            ]}
            value={statusFilter}
            onValueChange={(value) => updateFilter('status', value)}
          />
          <Button
            aria-pressed={onlyMine}
            className='md:ml-auto'
            type='button'
            variant={onlyMine ? 'secondary' : 'outline'}
            onClick={toggleOnlyMine}
          >
            {t('testProgress.onlyMine')}
          </Button>
        </CardContent>
      </Card>

      {resource.loading ? <Loading /> : null}
      {resource.error !== undefined ? (
        <ErrorPanel
          message={describeApiError(resource.error)}
          onRetry={resource.reload}
        />
      ) : null}
      {resource.data !== undefined ? (
        resource.data.problems.length === 0 ? (
          <EmptyPanel message={t('testProgress.emptyProblems')} />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testProgress.columnProblem')}</TableHead>
                    <TableHead>{t('testProgress.columnType')}</TableHead>
                    <TableHead>{t('testProgress.columnOwner')}</TableHead>
                    <TableHead>
                      {t('testProgress.columnFeaturePoint')}
                    </TableHead>
                    <TableHead>{t('testProgress.columnStatus')}</TableHead>
                    <TableHead>{t('testProgress.columnActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resource.data.problems.map((problem) => (
                    <TableRow key={problem.id}>
                      <TableCell className='max-w-xl whitespace-normal'>
                        <Link
                          className='block font-medium text-primary underline-offset-4 hover:underline'
                          to={String(problem.id)}
                        >
                          {problem.title}
                        </Link>
                        {problem.description === null ? null : (
                          <span className='mt-0.5 block text-xs text-muted-foreground'>
                            {problem.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-muted-foreground'>
                        {t(`testProgress.problemType.${problem.type}`)}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-muted-foreground'>
                        {problem.owner ?? '—'}
                      </TableCell>
                      <TableCell>
                        {problem.featurePointId == null ? (
                          <span className='text-muted-foreground'>
                            {t('testProgress.uncategorized')}
                          </span>
                        ) : (
                          <Link
                            className='text-primary underline-offset-4 hover:underline'
                            to={`/progress/features/${problem.featurePointId}`}
                          >
                            {problem.featurePointName ?? '—'}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell
                        className={PROBLEM_STATUS_CELL_CLASS[problem.status]}
                      >
                        <ProblemStatusBadge status={problem.status} />
                      </TableCell>
                      <TableCell>
                        <Link
                          className='text-primary underline-offset-4 hover:underline'
                          to={`${problem.id}/edit`}
                        >
                          {t('testProgress.edit')}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      ) : null}

      <Outlet />
    </PageContainer>
  );
}
