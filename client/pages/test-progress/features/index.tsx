import { useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { ChevronRight, CornerDownRight } from 'lucide-react';
import { Fragment, useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  criteriaState,
  describeApiError,
  fetchFeaturePoints,
  type FeaturePoint,
  type ProblemType,
} from '../api.js';
import {
  CRITERIA_CELL_CLASS,
  FEATURE_STATUSES,
  FEATURE_STATUS_CELL_CLASS,
} from '../constants.js';
import {
  CopyForAiButton,
  CriteriaBadge,
  EmptyPanel,
  ErrorPanel,
  FeatureStatusBadge,
  FieldHint,
  FormSelect,
  ScoreValue,
} from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';
import { useRefetchOnReturn } from '../use-refetch-on-return.js';

const ALL = 'all';
const MINE = 'me';

export default function FeaturePointsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuthentication();
  const currentUserId = session?.user?.id ?? null;
  const [search, setSearch] = useState('');

  const dimensionFilter = searchParams.get('dimension') ?? ALL;
  const statusFilter = searchParams.get('status') ?? ALL;
  const onlyMine = searchParams.get('owner') === MINE && currentUserId !== null;

  const resource = useAsyncResource('feature-points', (signal) =>
    fetchFeaturePoints(api, signal),
  );
  useRefetchOnReturn(resource.reload);

  const all: FeaturePoint[] = resource.data ?? [];
  const dimensions = all.filter((item) => item.level === 'dimension');
  const features = all.filter((item) => item.level === 'feature');
  const query = search.trim().toLocaleLowerCase();
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const filtersActive =
    dimensionFilter !== ALL || statusFilter !== ALL || onlyMine || query !== '';

  const matchesFilters = (feature: FeaturePoint): boolean => {
    if (
      dimensionFilter !== ALL &&
      String(feature.parentId) !== dimensionFilter
    ) {
      return false;
    }
    if (statusFilter !== ALL && feature.status !== statusFilter) {
      return false;
    }
    if (onlyMine && feature.ownerId !== currentUserId) {
      return false;
    }
    if (query === '') {
      return true;
    }

    return [feature.name, feature.owner ?? '']
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  };

  const groups = dimensions
    .map((dimension) => {
      const children = features.filter(
        (item) => item.parentId === dimension.id,
      );
      return {
        dimension,
        children,
        matched: children.filter(matchesFilters),
      };
    })
    .filter(
      (group) =>
        group.matched.length > 0 ||
        (dimensionFilter !== ALL &&
          String(group.dimension.id) === dimensionFilter),
    );

  function toggleDimension(id: number): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleOnlyMine(): void {
    const next = new URLSearchParams(searchParams);
    if (onlyMine) {
      next.delete('owner');
    } else {
      next.set('owner', MINE);
    }
    setSearchParams(next, { replace: true });
  }

  function updateFilter(key: 'dimension' | 'status', value: string): void {
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
        title={t('testProgress.featuresTitle')}
        description={t('testProgress.featuresDescription')}
        actions={<CopyForAiButton />}
      />

      <Card>
        <CardContent className='flex flex-col gap-3 md:flex-row md:items-center'>
          <FormSelect
            className='md:w-56'
            options={[
              { value: ALL, label: t('testProgress.allDimensions') },
              ...dimensions.map((dimension) => ({
                value: String(dimension.id),
                label: dimension.name,
              })),
            ]}
            value={dimensionFilter}
            onValueChange={(value) => updateFilter('dimension', value)}
          />
          <FormSelect
            className='md:w-48'
            options={[
              { value: ALL, label: t('testProgress.allStatuses') },
              ...FEATURE_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.status.${status}`),
              })),
            ]}
            value={statusFilter}
            onValueChange={(value) => updateFilter('status', value)}
          />
          <Input
            className='md:w-64'
            placeholder={t('testProgress.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
        groups.length === 0 ? (
          <EmptyPanel message={t('testProgress.emptyFeatures')} />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('testProgress.columnDimensionFeature')}
                    </TableHead>
                    <TableHead>{t('testProgress.columnOwner')}</TableHead>
                    <TableHead>
                      <span className='inline-flex items-center gap-1'>
                        {t('testProgress.columnSkills')}
                        <FieldHint
                          hint={t('testProgress.hint.skills')}
                          label={t('testProgress.fieldSkills')}
                        />
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className='inline-flex items-center gap-1'>
                        {t('testProgress.columnDocs')}
                        <FieldHint
                          hint={t('testProgress.hint.docs')}
                          label={t('testProgress.fieldDocs')}
                        />
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className='inline-flex items-center gap-1'>
                        {t('testProgress.columnExample')}
                        <FieldHint
                          hint={t('testProgress.hint.example')}
                          label={t('testProgress.fieldExampleExists')}
                        />
                      </span>
                    </TableHead>
                    <TableHead>{t('testProgress.columnStatus')}</TableHead>
                    <TableHead>
                      <span className='inline-flex items-center gap-1'>
                        {t('testProgress.columnScores')}
                        <FieldHint
                          hint={t('testProgress.hint.scores')}
                          label={t('testProgress.columnScores')}
                        />
                      </span>
                    </TableHead>
                    <TableHead>{t('testProgress.columnProblems')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(({ dimension, children, matched }) => {
                    const expanded =
                      filtersActive || !collapsed.has(dimension.id);
                    const rows = filtersActive ? matched : children;

                    return (
                      <Fragment key={dimension.id}>
                        <TableRow className='bg-muted/40 hover:bg-muted/60'>
                          <TableCell className='max-w-72 whitespace-normal'>
                            <span className='flex items-center gap-2'>
                              <button
                                aria-expanded={expanded}
                                aria-label={t('testProgress.toggleGroup', {
                                  name: dimension.name,
                                })}
                                className='flex min-w-0 items-center gap-2 text-left'
                                type='button'
                                onClick={() => toggleDimension(dimension.id)}
                              >
                                <ChevronRight
                                  aria-hidden='true'
                                  className={cn(
                                    'size-4 shrink-0 text-muted-foreground transition-transform',
                                    expanded && 'rotate-90',
                                  )}
                                />
                                <span className='font-heading font-semibold'>
                                  {dimension.name}
                                </span>
                                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                                  {filtersActive
                                    ? t('testProgress.groupMatchCount', {
                                        matched: matched.length,
                                        total: children.length,
                                      })
                                    : t('testProgress.groupFeatureCount', {
                                        count: children.length,
                                      })}
                                </span>
                              </button>
                              <Link
                                className='shrink-0 text-xs text-primary underline-offset-4 hover:underline'
                                to={`/progress/features/${dimension.id}`}
                              >
                                {t('testProgress.viewDetail')}
                              </Link>
                            </span>
                          </TableCell>
                          <TableCell className='text-muted-foreground'>
                            {dimension.owner ?? '—'}
                          </TableCell>
                          <TableCell
                            className={
                              CRITERIA_CELL_CLASS[
                                criteriaState(
                                  dimension.skillsStatus,
                                  dimension.problems.skills.open,
                                )
                              ]
                            }
                          >
                            <CriteriaCell
                              feature={dimension}
                              kind='skills'
                              label={t('testProgress.fieldSkills')}
                            />
                          </TableCell>
                          <TableCell
                            className={
                              CRITERIA_CELL_CLASS[
                                criteriaState(
                                  dimension.docsStatus,
                                  dimension.problems.docs.open,
                                )
                              ]
                            }
                          >
                            <CriteriaCell
                              feature={dimension}
                              kind='docs'
                              label={t('testProgress.fieldDocs')}
                            />
                          </TableCell>
                          <TableCell
                            className={
                              CRITERIA_CELL_CLASS[
                                criteriaState(
                                  dimension.exampleExists,
                                  dimension.problems.example.open,
                                )
                              ]
                            }
                          >
                            <CriteriaCell
                              feature={dimension}
                              kind='example'
                              label={t('testProgress.fieldExampleExists')}
                            />
                          </TableCell>
                          <TableCell
                            className={
                              FEATURE_STATUS_CELL_CLASS[dimension.status]
                            }
                          >
                            <FeatureStatusBadge status={dimension.status} />
                          </TableCell>
                          <TableCell>
                            <ScoreGrid feature={dimension} />
                          </TableCell>
                          <TableCell className='tabular-nums'>
                            <ProblemCountLink feature={dimension} />
                          </TableCell>
                        </TableRow>
                        {expanded
                          ? rows.map((feature) => (
                              <TableRow key={feature.id}>
                                <TableCell className='max-w-72 whitespace-normal'>
                                  <span className='flex items-center gap-2 pl-6'>
                                    <CornerDownRight
                                      aria-hidden='true'
                                      className='size-3.5 shrink-0 text-muted-foreground/60'
                                    />
                                    <Link
                                      className='text-primary underline-offset-4 hover:underline'
                                      to={String(feature.id)}
                                    >
                                      {feature.name}
                                    </Link>
                                  </span>
                                </TableCell>
                                <TableCell className='text-muted-foreground'>
                                  {feature.owner ?? '—'}
                                </TableCell>
                                <TableCell
                                  className={
                                    CRITERIA_CELL_CLASS[
                                      criteriaState(
                                        feature.skillsStatus,
                                        feature.problems.skills.open,
                                      )
                                    ]
                                  }
                                >
                                  <CriteriaCell
                                    feature={feature}
                                    kind='skills'
                                    label={t('testProgress.fieldSkills')}
                                  />
                                </TableCell>
                                <TableCell
                                  className={
                                    CRITERIA_CELL_CLASS[
                                      criteriaState(
                                        feature.docsStatus,
                                        feature.problems.docs.open,
                                      )
                                    ]
                                  }
                                >
                                  <CriteriaCell
                                    feature={feature}
                                    kind='docs'
                                    label={t('testProgress.fieldDocs')}
                                  />
                                </TableCell>
                                <TableCell
                                  className={
                                    CRITERIA_CELL_CLASS[
                                      criteriaState(
                                        feature.exampleExists,
                                        feature.problems.example.open,
                                      )
                                    ]
                                  }
                                >
                                  <CriteriaCell
                                    feature={feature}
                                    kind='example'
                                    label={t('testProgress.fieldExampleExists')}
                                  />
                                </TableCell>
                                <TableCell
                                  className={
                                    FEATURE_STATUS_CELL_CLASS[feature.status]
                                  }
                                >
                                  <FeatureStatusBadge status={feature.status} />
                                </TableCell>
                                <TableCell>
                                  <ScoreGrid feature={feature} />
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  <ProblemCountLink feature={feature} />
                                </TableCell>
                              </TableRow>
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
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

function ScoreGrid({
  feature,
}: {
  readonly feature: FeaturePoint;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span className='grid grid-cols-2 gap-x-3 text-xs'>
      <span className='text-muted-foreground'>
        {t('testProgress.scoreDesignShort')}{' '}
        <ScoreValue score={feature.designScore} />
      </span>
      <span className='text-muted-foreground'>
        {t('testProgress.scoreDevelopmentShort')}{' '}
        <ScoreValue score={feature.developmentScore} />
      </span>
      <span className='text-muted-foreground'>
        {t('testProgress.scoreAgentFriendlinessShort')}{' '}
        <ScoreValue score={feature.agentFriendlinessScore} />
      </span>
      <span className='text-muted-foreground'>
        {t('testProgress.scoreOutputQualityShort')}{' '}
        <ScoreValue score={feature.outputQualityScore} />
      </span>
    </span>
  );
}

/**
 * A criteria cell is a view of the problem list: the flag and the open problems of
 * the matching type decide what it says, and clicking it opens those problems
 * filtered. Editing the flag itself lives in the feature form.
 */
function CriteriaCell({
  feature,
  kind,
  label,
}: {
  readonly feature: FeaturePoint;
  readonly kind: ProblemType;
  readonly label: string;
}): ReactElement {
  const { t } = useTranslation();
  const flag =
    kind === 'skills'
      ? feature.skillsStatus
      : kind === 'docs'
        ? feature.docsStatus
        : feature.exampleExists;
  const open = feature.problems[kind].open;
  const state = criteriaState(flag, open);
  const badge = <CriteriaBadge openProblems={open} state={state} />;

  // Only a gap count has a list behind it; the other states just report a fact.
  if (state !== 'hasGaps') {
    return badge;
  }

  return (
    <Link
      aria-label={t('testProgress.viewProblems', { field: label })}
      className='inline-flex rounded-4xl outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50'
      to={`/progress/problems?featurePointId=${feature.id}&type=${kind}&status=open`}
    >
      {badge}
    </Link>
  );
}

/** All open problems of a feature point, whichever type they are. */
function ProblemCountLink({
  feature,
}: {
  readonly feature: FeaturePoint;
}): ReactElement {
  const { t } = useTranslation();
  const counts = Object.values(feature.problems);
  const total = counts.reduce((sum, count) => sum + count.total, 0);
  const open = counts.reduce((sum, count) => sum + count.open, 0);

  if (total === 0) {
    return <span className='text-muted-foreground'>0</span>;
  }

  return (
    <Link
      className='text-primary underline-offset-4 hover:underline'
      to={`/progress/problems?featurePointId=${feature.id}&status=open`}
    >
      {t('testProgress.problemCountValue', { open, total })}
    </Link>
  );
}
