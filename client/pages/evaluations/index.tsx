import { useEvaluationData } from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useSearchParams } from 'react-router';
import { PageContainer } from '@/components/page-container';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Choice,
  LoadState,
  Status,
  type Capability,
  type Mapping,
  type ReportSummary,
} from './shared.js';
import {
  SourcesPanel,
  MappingForm,
  TrackerOptionsProvider,
} from './actions.js';
import { ReportDetail } from './detail.js';
import type { Comparison } from '../../server-contracts/comparison.js';

export default function EvaluationsPage() {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams();
  const caps = useEvaluationData<Capability>('capabilities');
  const view = params.get('view') ?? 'reports',
    reportId = params.get('report');
  function change(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }
  const open = (id: string) => change({ report: id });
  return (
    <TrackerOptionsProvider enabled={caps.data?.review ?? false}>
      <PageContainer>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-semibold'>{t('evaluations.title')}</h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              {t('evaluations.description')}
            </p>
          </div>
          {reportId && (
            <Button variant='outline' onClick={() => change({ report: null })}>
              {t('evaluations.back')}
            </Button>
          )}
        </div>
        <LoadState loading={caps.loading} error={caps.error}>
          {caps.data &&
            (reportId ? (
              <ReportDetail
                key={reportId}
                id={reportId}
                capabilities={caps.data}
                select={open}
              />
            ) : (
              <>
                <Tabs
                  value={view}
                  onValueChange={(v) =>
                    change({ view: String(v), offset: null })
                  }
                >
                  <TabsList className='flex h-auto flex-wrap'>
                    {[
                      'reports',
                      'batches',
                      'mappings',
                      'comparison',
                      ...(caps.data.manage ? ['sources'] : []),
                    ].map((key) => (
                      <TabsTrigger key={key} value={key}>
                        {t('evaluations.' + key)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {view === 'sources' && caps.data.manage ? (
                  <SourcesPanel />
                ) : view === 'mappings' ? (
                  <MappingsPanel canReview={caps.data.review} open={open} />
                ) : view === 'comparison' ? (
                  <ComparisonPanel
                    left={params.get('left') ?? ''}
                    right={params.get('right') ?? ''}
                    change={change}
                  />
                ) : (
                  <ReportList
                    type={
                      view === 'batches'
                        ? 'evaluation-batch'
                        : 'evaluation-report'
                    }
                    offset={Number(params.get('offset') ?? 0)}
                    page={(offset) => change({ offset: String(offset) })}
                    open={open}
                    compare={(id) =>
                      params.get('left')
                        ? change({ right: id, view: 'comparison' })
                        : change({ left: id })
                    }
                    left={params.get('left')}
                  />
                )}
              </>
            ))}
        </LoadState>
      </PageContainer>
    </TrackerOptionsProvider>
  );
}

function ReportList({
  type,
  offset,
  page,
  open,
  compare,
  left,
}: {
  type: string;
  offset: number;
  page: (offset: number) => void;
  open: (id: string) => void;
  compare: (id: string) => void;
  left: string | null;
}) {
  const { t } = useTranslation(),
    data = useEvaluationData<{ items: ReportSummary[]; hasMore: boolean }>(
      'reports?type=' + type + '&offset=' + offset,
    );
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <p className='text-sm text-muted-foreground'>
          {left ? t('evaluations.chooseSecond') : t('evaluations.currentHint')}
        </p>
        <Button variant='outline' onClick={data.reload}>
          {t('evaluations.refresh')}
        </Button>
      </div>
      <LoadState loading={data.loading} error={data.error}>
        {data.data?.items.length === 0 ? (
          <Card>
            <CardContent className='py-12 text-center text-muted-foreground'>
              {t('evaluations.empty')}
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  'name',
                  'execution',
                  'acceptance',
                  'review',
                  'revision',
                  'received',
                  'actions',
                ].map((key) => (
                  <TableHead key={key}>{t('evaluations.' + key)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      className='text-left font-medium text-primary underline'
                      onClick={() => open(r.id)}
                    >
                      {r.title ?? r.subjectKey}
                    </button>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {r.sourceInstance}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Status value={r.outcome.execution} />
                  </TableCell>
                  <TableCell>
                    <Status value={r.outcome.acceptance} />
                  </TableCell>
                  <TableCell>
                    <Status value={r.review} />
                  </TableCell>
                  <TableCell>{r.revision}</TableCell>
                  <TableCell>
                    {new Date(r.receivedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {type === 'evaluation-report' && (
                      <Button
                        variant={left === r.id ? 'secondary' : 'outline'}
                        size='sm'
                        onClick={() => compare(r.id)}
                      >
                        {t('evaluations.compare')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </LoadState>
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          disabled={offset <= 0}
          onClick={() => page(Math.max(0, offset - 50))}
        >
          {t('evaluations.previous')}
        </Button>
        <Button
          variant='outline'
          disabled={!data.data?.hasMore}
          onClick={() => page(offset + 50)}
        >
          {t('evaluations.next')}
        </Button>
      </div>
    </div>
  );
}

function ComparisonPanel({
  left,
  right,
  change,
}: {
  left: string;
  right: string;
  change: (values: Record<string, string | null>) => void;
}) {
  const { t } = useTranslation(),
    reports = useEvaluationData<{ items: ReportSummary[] }>('reports');
  const options = (reports.data?.items ?? []).map((r) => ({
    value: r.id,
    label: (r.title ?? r.subjectKey) + ' · r' + r.revision,
  }));
  for (const value of [left, right])
    if (value && !options.some((o) => o.value === value))
      options.push({ value, label: value });
  return (
    <div className='space-y-6'>
      <div className='grid gap-3 md:grid-cols-2'>
        <Choice
          label={t('evaluations.before')}
          value={left}
          onChange={(v) => change({ left: v })}
          options={options}
        />
        <Choice
          label={t('evaluations.after')}
          value={right}
          onChange={(v) => change({ right: v })}
          options={options}
        />
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('evaluations.comparisonHint')}
      </p>
      {left && right && <ComparisonResult left={left} right={right} />}
    </div>
  );
}
function ComparisonResult({ left, right }: { left: string; right: string }) {
  const { t } = useTranslation(),
    comparison = useEvaluationData<Comparison>(
      'compare?left=' +
        encodeURIComponent(left) +
        '&right=' +
        encodeURIComponent(right),
    );
  return (
    <LoadState loading={comparison.loading} error={comparison.error}>
      {comparison.data && (
        <div className='space-y-4'>
          <Status
            value={comparison.data.comparable ? 'comparable' : 'not-comparable'}
          />
          {comparison.data.reasons.length > 0 && (
            <p className='text-sm text-muted-foreground'>
              {comparison.data.reasons
                .map((r) => {
                  const [field, reason] = r.split(':');
                  return (
                    t('evaluations.comparisonFields.' + field, {
                      defaultValue: field,
                    }) +
                    (reason
                      ? ': ' +
                        t('evaluations.states.' + reason, {
                          defaultValue: reason,
                        })
                      : '')
                  );
                })
                .join(' · ')}
            </p>
          )}
          {comparison.data.modules.map((m) => (
            <Card key={m.key}>
              <CardHeader>
                <CardTitle>{m.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['dimension', 'before', 'after', 'delta'].map((key) => (
                        <TableHead key={key}>
                          {t('evaluations.' + key)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.scores.map((s) => (
                      <TableRow key={s.dimension}>
                        <TableCell>
                          {t('evaluations.dimensions.' + s.dimension, {
                            defaultValue: s.dimension,
                          })}
                        </TableCell>
                        <TableCell>
                          {s.before ?? t('evaluations.notEvaluated')}
                        </TableCell>
                        <TableCell>
                          {s.after ?? t('evaluations.notEvaluated')}
                        </TableCell>
                        <TableCell>
                          {s.delta === null
                            ? t('evaluations.notComparable')
                            : (s.delta > 0 ? '+' : '') + s.delta}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          <div className='grid gap-4 md:grid-cols-3'>
            {(['added', 'repeated', 'notObserved'] as const).map((key) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle>
                    {t('evaluations.' + key)} ·{' '}
                    {comparison.data!.findings[key].length}
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {comparison.data!.findings[key].map((f) => (
                    <p key={f.id} className='text-sm'>
                      {f.title}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </LoadState>
  );
}

type ModuleItem = {
  reportId: string;
  sourceInstance: string;
  key: string;
  name: string;
  subjectKeys: string[];
  mapped: Mapping[];
};
function MappingsPanel({
  canReview,
  open,
}: {
  canReview: boolean;
  open: (id: string) => void;
}) {
  const { t } = useTranslation(),
    [params, setParams] = useSearchParams();
  const offset = Number(params.get('offset') ?? 0),
    data = useEvaluationData<{ items: ModuleItem[]; hasMore: boolean }>(
      'modules?offset=' + offset,
    );
  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>
        {t('evaluations.mappingHint')}
      </p>
      <LoadState loading={data.loading} error={data.error}>
        {data.data?.items.length === 0 && <p>{t('evaluations.empty')}</p>}
        {data.data?.items.map((m) => (
          <Card key={m.reportId + m.key}>
            <CardHeader>
              <CardTitle>{m.name}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              {m.subjectKeys.length === 0 && (
                <p>{t('evaluations.pendingMapping')}</p>
              )}
              {m.subjectKeys.map((key) => (
                <div className='space-y-2' key={key}>
                  <p className='break-all font-mono text-xs'>{key}</p>
                  {canReview ? (
                    <MappingForm
                      source={m.sourceInstance}
                      subjectKey={key}
                      mapping={m.mapped.find((v) => v.subjectKey === key)}
                      reload={data.reload}
                    />
                  ) : (
                    <Status
                      value={
                        m.mapped.some((v) => v.subjectKey === key)
                          ? 'mapped'
                          : 'pending-mapping'
                      }
                    />
                  )}
                </div>
              ))}
              <Button
                variant='outline'
                size='sm'
                onClick={() => open(m.reportId)}
              >
                {t('evaluations.openReport')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </LoadState>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          disabled={!offset}
          onClick={() =>
            setParams({
              view: 'mappings',
              offset: String(Math.max(0, offset - 50)),
            })
          }
        >
          {t('evaluations.previous')}
        </Button>
        <Button
          variant='outline'
          disabled={!data.data?.hasMore}
          onClick={() =>
            setParams({ view: 'mappings', offset: String(offset + 50) })
          }
        >
          {t('evaluations.next')}
        </Button>
      </div>
    </div>
  );
}
