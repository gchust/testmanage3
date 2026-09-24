import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import {
  describeApiError,
  fetchSummary,
  type OwnerWorkload,
  type ProgressSummary,
} from './api.js';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import {
  CRITERIA_STATES,
  FEATURE_STATUS_BAR_CLASS,
  FEATURE_STATUSES,
} from './constants.js';
import {
  CriteriaBadge,
  EmptyPanel,
  ErrorPanel,
  FeatureStatusBadge,
  FieldHint,
} from './shared.js';
import { useAsyncResource } from './use-async-resource.js';

export default function TestProgressOverviewPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const summary = useAsyncResource('summary', (signal) =>
    fetchSummary(api, signal),
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('testProgress.overviewTitle')}
        description={t('testProgress.overviewDescription')}
      />
      {summary.loading ? <Loading /> : null}
      {summary.error !== undefined ? (
        <ErrorPanel
          message={describeApiError(summary.error)}
          onRetry={summary.reload}
        />
      ) : null}
      {summary.data !== undefined ? <Overview summary={summary.data} /> : null}
    </PageContainer>
  );
}

function Overview({
  summary,
}: {
  readonly summary: ProgressSummary;
}): ReactElement {
  const { t } = useTranslation();
  const totalFeatures = summary.totals.features;

  return (
    <>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
        <MetricCard
          label={t('testProgress.dimensions')}
          value={summary.totals.dimensions}
        />
        <MetricCard
          label={t('testProgress.features')}
          value={summary.totals.features}
        />
        <MetricCard
          label={t('testProgress.openMaterialProblems')}
          value={summary.totals.openMaterialProblems}
        />
        <MetricCard
          label={t('testProgress.openTestProblems')}
          value={summary.totals.openTestProblems}
        />
        <MetricCard
          label={t('testProgress.completedTests')}
          value={summary.statusCounts.testCompleted}
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('testProgress.statusDistribution')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {FEATURE_STATUSES.map((status) => {
              const count = summary.statusCounts[status];
              const percent =
                totalFeatures === 0
                  ? 0
                  : Math.round((count / totalFeatures) * 100);
              return (
                <div className='flex items-center gap-3' key={status}>
                  <span className='w-28 shrink-0'>
                    <FeatureStatusBadge status={status} />
                  </span>
                  <span className='w-8 shrink-0 text-right text-sm tabular-nums'>
                    {count}
                  </span>
                  <span className='h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted'>
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        FEATURE_STATUS_BAR_CLASS[status],
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('testProgress.entryCriteria')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {(
              [
                ['skills', t('testProgress.columnSkills')],
                ['docs', t('testProgress.columnDocs')],
                ['example', t('testProgress.columnExample')],
              ] as const
            ).map(([kind, label]) => (
              <CriteriaRow key={kind} label={label}>
                {CRITERIA_STATES.map((state) => (
                  <BreakdownEntry
                    count={summary.readiness[kind][state]}
                    key={state}
                  >
                    <CriteriaBadge state={state} />
                  </BreakdownEntry>
                ))}
              </CriteriaRow>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-1.5'>
            {t('testProgress.ownerWorkload')}
            <FieldHint
              hint={t('testProgress.ownerWorkloadHint')}
              label={t('testProgress.ownerWorkload')}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          {summary.owners.length === 0 ? (
            <EmptyPanel message={t('testProgress.noOwnerData')} />
          ) : (
            <>
              <OwnerWorkloadChart owners={summary.owners} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testProgress.columnOwner')}</TableHead>
                    <TableHead className='text-right'>
                      {t('testProgress.columnOpenCount')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('testProgress.columnTotalCount')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.owners.map((entry) => (
                    <TableRow
                      key={
                        entry.ownerId ?? `name:${entry.owner ?? 'unassigned'}`
                      }
                    >
                      <TableCell className='font-medium'>
                        {entry.owner ?? t('testProgress.ownerNone')}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {entry.open}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-muted-foreground'>
                        {entry.total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('testProgress.dimensionProgress')}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.dimensions.length === 0 ? (
            <EmptyPanel message={t('testProgress.noDimensions')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testProgress.columnDimension')}</TableHead>
                  <TableHead>{t('testProgress.featureCount')}</TableHead>
                  <TableHead>{t('testProgress.columnStatus')}</TableHead>
                  <TableHead>{t('testProgress.columnProblems')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.dimensions.map((dimension) => (
                  <TableRow key={dimension.id}>
                    <TableCell className='font-medium'>
                      <Link
                        className='text-primary underline-offset-4 hover:underline'
                        to={`/progress/features/${dimension.id}`}
                      >
                        {dimension.name}
                      </Link>
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {dimension.featureCount}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1'>
                        {FEATURE_STATUSES.filter(
                          (status) => dimension.statusCounts[status] > 0,
                        ).map((status) => (
                          <span
                            className='inline-flex items-center gap-1'
                            key={status}
                          >
                            <FeatureStatusBadge status={status} />
                            <span className='text-xs tabular-nums text-muted-foreground'>
                              {dimension.statusCounts[status]}
                            </span>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      <Link
                        className='text-primary underline-offset-4 hover:underline'
                        to={`/progress/problems?featurePointId=${dimension.id}&status=open`}
                      >
                        {t('testProgress.problemCountValue', {
                          open: dimension.problems.open,
                          total: dimension.problems.total,
                        })}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Horizontal bars, largest first: the API already sorts by open problems and a
 * vertical Recharts layout draws the first data entry at the top, so the order is
 * passed through unchanged.
 */
function OwnerWorkloadChart({
  owners,
}: {
  readonly owners: readonly OwnerWorkload[];
}): ReactElement {
  const { t } = useTranslation();
  const data = owners.map((entry) => ({
    name: entry.owner ?? t('testProgress.ownerNone'),
    open: entry.open,
    total: entry.total,
  }));
  const config = {
    open: {
      label: t('testProgress.openProblemCount'),
      color: 'var(--chart-1)',
    },
  } satisfies ChartConfig;

  return (
    <ChartContainer
      className='w-full'
      config={config}
      style={{ height: `${Math.max(200, owners.length * 36)}px` }}
    >
      <BarChart
        barCategoryGap={6}
        data={data}
        layout='vertical'
        margin={{ bottom: 4, left: 8, right: 16, top: 4 }}
      >
        <XAxis allowDecimals={false} axisLine={false} tickLine={false} type='number' />
        <YAxis
          axisLine={false}
          dataKey='name'
          tickLine={false}
          type='category'
          width={96}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey='open' fill='var(--color-open)' radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function MetricCard({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-sm font-medium text-muted-foreground'>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className='font-heading text-3xl font-semibold tabular-nums'>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function CriteriaRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement[];
}): ReactElement {
  return (
    <div className='space-y-2'>
      <p className='text-xs font-medium text-muted-foreground'>{label}</p>
      <div className='flex flex-wrap gap-3'>{children}</div>
    </div>
  );
}

function BreakdownEntry({
  count,
  children,
}: {
  readonly count: number;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <span className='inline-flex items-center gap-1'>
      {children}
      <span className='text-xs tabular-nums text-muted-foreground'>
        {count}
      </span>
    </span>
  );
}
