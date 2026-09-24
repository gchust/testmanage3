import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Pencil } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, Outlet, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  criteriaState,
  describeApiError,
  fetchFeaturePoint,
  fetchFeaturePoints,
  fetchProblems,
  type AvailabilityStatus,
  type ExampleExistsStatus,
  type FeaturePoint,
  type Problem,
  type ProblemType,
} from '../api.js';
import {
  CriteriaBadge,
  DefinitionItem,
  EmptyPanel,
  ErrorPanel,
  FeatureStatusBadge,
  FieldHint,
  ProblemStatusBadge,
  ScoreValue,
} from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';
import { useRefetchOnReturn } from '../use-refetch-on-return.js';

interface FeaturePointDetailData {
  readonly data: FeaturePoint;
  readonly all: FeaturePoint[];
  readonly problems: Problem[];
}

export default function FeaturePointDetailPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const params = useParams();
  const id = Number(params.featurePointId);
  const validId = Number.isInteger(id) && id > 0;
  const resource = useAsyncResource<FeaturePointDetailData>(
    `feature-point|${String(params.featurePointId)}`,
    async (signal) => {
      const [data, all, problems] = await Promise.all([
        fetchFeaturePoint(api, id, signal),
        fetchFeaturePoints(api, signal),
        fetchProblems(api, { featurePointId: id }, signal),
      ]);
      return { data, all, problems };
    },
  );
  useRefetchOnReturn(resource.reload);

  const notFound =
    !validId ||
    (resource.error instanceof ApiClientError && resource.error.status === 404);

  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <Breadcrumbs />
          {resource.loading ? <Loading /> : null}
          {resource.error !== undefined ? (
            notFound ? (
              <EmptyPanel message={t('testProgress.notFound')}>
                <Button
                  render={<Link to='/progress/features' />}
                  variant='outline'
                >
                  {t('testProgress.backToFeatures')}
                </Button>
              </EmptyPanel>
            ) : (
              <ErrorPanel
                message={describeApiError(resource.error)}
                onRetry={resource.reload}
              />
            )
          ) : null}
          {resource.data !== undefined ? (
            <FeaturePointDetail
              all={resource.data.all}
              data={resource.data.data}
              problems={resource.data.problems}
            />
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}

function FeaturePointDetail({
  data,
  all,
  problems,
}: {
  readonly data: FeaturePoint;
  readonly all: FeaturePoint[];
  readonly problems: Problem[];
}): ReactElement {
  const { t } = useTranslation();
  const children = all.filter((item) => item.parentId === data.id);
  const totals = Object.values(data.problems).reduce(
    (sum, count) => ({
      total: sum.total + count.total,
      open: sum.open + count.open,
    }),
    { total: 0, open: 0 },
  );

  return (
    <div className='space-y-6'>
      <PageHeader
        title={data.name}
        description={
          <span className='inline-flex flex-wrap items-center gap-2'>
            <FeatureStatusBadge status={data.status} />
            {data.parentId === null ? null : (
              <span>
                {t('testProgress.parent')}:{' '}
                <Link
                  className='text-primary underline-offset-4 hover:underline'
                  to={`/progress/features/${data.parentId}`}
                >
                  {data.parentName ?? '—'}
                </Link>
              </span>
            )}
          </span>
        }
        actions={
          <Button render={<Link to='edit' />} variant='outline'>
            <Pencil aria-hidden='true' />
            {t('testProgress.edit')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('testProgress.basicInfo')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <DefinitionItem label={t('testProgress.level')}>
              {data.level === 'dimension'
                ? t('testProgress.levelDimension')
                : t('testProgress.levelFeature')}
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.owner')}>
              {data.owner ?? '—'}
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.columnProblems')}>
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={`/progress/problems?featurePointId=${data.id}&status=open`}
              >
                {t('testProgress.problemCountValue', {
                  open: totals.open,
                  total: totals.total,
                })}
              </Link>
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.remark')}>
              <span className='whitespace-pre-wrap'>{data.remark ?? '—'}</span>
            </DefinitionItem>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('testProgress.entryCriteria')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-5'>
          <dl className='grid gap-4 sm:grid-cols-3'>
            <DefinitionItem label={t('testProgress.columnSkills')}>
              <CriteriaItem
                flag={data.skillsStatus}
                kind='skills'
                label={t('testProgress.fieldSkills')}
                openProblems={data.problems.skills.open}
                problemId={data.id}
              />
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.columnDocs')}>
              <CriteriaItem
                flag={data.docsStatus}
                kind='docs'
                label={t('testProgress.fieldDocs')}
                openProblems={data.problems.docs.open}
                problemId={data.id}
              />
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.columnExample')}>
              <CriteriaItem
                flag={data.exampleExists}
                kind='example'
                label={t('testProgress.fieldExampleExists')}
                openProblems={data.problems.example.open}
                problemId={data.id}
              />
            </DefinitionItem>
          </dl>
          <DefinitionItem
            label={
              <span className='inline-flex items-center gap-1'>
                {t('testProgress.exampleExpected')}
                <FieldHint
                  hint={t('testProgress.hint.example')}
                  label={t('testProgress.fieldExampleExists')}
                />
              </span>
            }
          >
            <p className='whitespace-pre-wrap'>{data.exampleExpected ?? '—'}</p>
          </DefinitionItem>
          <DefinitionItem label={t('testProgress.exampleCurrent')}>
            <p className='whitespace-pre-wrap'>{data.exampleCurrent ?? '—'}</p>
          </DefinitionItem>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('testProgress.qualityScores')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 md:grid-cols-2'>
            <ScoreCard
              label={t('testProgress.scoreDesign')}
              hint={t('testProgress.hint.designScore')}
              note={data.designNote}
              score={data.designScore}
            />
            <ScoreCard
              label={t('testProgress.scoreDevelopment')}
              hint={t('testProgress.hint.developmentScore')}
              note={data.developmentNote}
              score={data.developmentScore}
            />
            <ScoreCard
              label={t('testProgress.scoreAgentFriendliness')}
              hint={t('testProgress.hint.agentFriendlinessScore')}
              note={data.agentFriendlinessNote}
              score={data.agentFriendlinessScore}
            />
            <ScoreCard
              label={t('testProgress.scoreOutputQuality')}
              hint={t('testProgress.hint.outputQualityScore')}
              note={data.outputQualityNote}
              score={data.outputQualityScore}
            />
          </div>
        </CardContent>
      </Card>

      {children.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('testProgress.childFeatures')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testProgress.columnFeature')}</TableHead>
                  <TableHead>{t('testProgress.columnOwner')}</TableHead>
                  <TableHead>{t('testProgress.columnStatus')}</TableHead>
                  <TableHead>{t('testProgress.columnProblems')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {children.map((child) => {
                  const childTotals = Object.values(child.problems).reduce(
                    (sum, count) => ({
                      total: sum.total + count.total,
                      open: sum.open + count.open,
                    }),
                    { total: 0, open: 0 },
                  );
                  return (
                    <TableRow key={child.id}>
                      <TableCell className='font-medium'>
                        <Link
                          className='text-primary underline-offset-4 hover:underline'
                          to={`/progress/features/${child.id}`}
                        >
                          {child.name}
                        </Link>
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {child.owner ?? '—'}
                      </TableCell>
                      <TableCell>
                        <FeatureStatusBadge status={child.status} />
                      </TableCell>
                      <TableCell className='tabular-nums'>
                        <Link
                          className='text-primary underline-offset-4 hover:underline'
                          to={`/progress/problems?featurePointId=${child.id}&status=open`}
                        >
                          {t('testProgress.problemCountValue', {
                            open: childTotals.open,
                            total: childTotals.total,
                          })}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('testProgress.relatedProblems')}</CardTitle>
          <Link
            className='text-sm text-primary underline-offset-4 hover:underline'
            to={`/progress/problems?featurePointId=${data.id}`}
          >
            {t('testProgress.viewAllProblems')}
          </Link>
        </CardHeader>
        <CardContent>
          {problems.length === 0 ? (
            <EmptyPanel message={t('testProgress.noProblems')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testProgress.columnProblem')}</TableHead>
                  <TableHead>{t('testProgress.columnType')}</TableHead>
                  <TableHead>{t('testProgress.columnStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {problems.map((problem) => (
                  <TableRow key={problem.id}>
                    <TableCell className='max-w-xl whitespace-normal'>
                      <Link
                        className='block font-medium text-primary underline-offset-4 hover:underline'
                        to={`/progress/problems/${problem.id}`}
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
                    <TableCell>
                      <ProblemStatusBadge status={problem.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One criteria cell. Only a gap count opens the filtered problem list; the other
 * states report a fact and stay plain text, matching the feature list.
 */
function CriteriaItem({
  flag,
  kind,
  label,
  openProblems,
  problemId,
}: {
  readonly flag: AvailabilityStatus | ExampleExistsStatus;
  readonly kind: ProblemType;
  readonly label: string;
  readonly openProblems: number;
  readonly problemId: number;
}): ReactElement {
  const { t } = useTranslation();
  const state = criteriaState(flag, openProblems);
  const badge = <CriteriaBadge openProblems={openProblems} state={state} />;

  if (state !== 'hasGaps') {
    return badge;
  }

  return (
    <Link
      aria-label={t('testProgress.viewProblems', { field: label })}
      className='inline-flex rounded-4xl outline-none transition-opacity hover:opacity-80'
      to={`/progress/problems?featurePointId=${problemId}&type=${kind}&status=open`}
    >
      {badge}
    </Link>
  );
}

function ScoreCard({
  label,
  hint,
  score,
  note,
}: {
  readonly label: string;
  readonly hint: string;
  readonly score: number | null;
  readonly note: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='rounded-lg border border-border p-4'>
      <div className='flex items-baseline justify-between gap-2'>
        <p className='inline-flex items-center gap-1 text-sm font-medium'>
          {label}
          <FieldHint hint={hint} label={label} />
        </p>
        <p className='font-heading text-2xl font-semibold tabular-nums'>
          <ScoreValue score={score} />
        </p>
      </div>
      <p className='mt-2 whitespace-pre-wrap text-sm text-muted-foreground'>
        {note ?? t('testProgress.noNote')}
      </p>
    </div>
  );
}
