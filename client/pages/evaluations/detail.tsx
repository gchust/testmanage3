import { useEvaluationData } from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  EvaluationReport,
  EvaluationBatch,
} from '../../server-contracts/evaluations.js';
import {
  Choice,
  Download,
  LoadState,
  Status,
  type Capability,
  type FindingState,
  type Mapping,
} from './shared.js';
import { FindingForm, MappingForm, RegressionForm } from './actions.js';

type Stored = {
  id: string;
  document: EvaluationReport | EvaluationBatch;
  bundleSha256: string;
  receivedAt: string;
  files: string[];
};
export function ReportDetail({
  id,
  capabilities,
  select,
}: {
  id: string;
  capabilities: Capability;
  select: (id: string) => void;
}) {
  const { t } = useTranslation(),
    data = useEvaluationData<Stored>('reports/' + id);
  const history = useEvaluationData<
    Array<{ id: string; revision: number; current: boolean }>
  >('reports/' + id + '/history');
  return (
    <LoadState loading={data.loading} error={data.error}>
      {data.data && (
        <div className='space-y-6'>
          <div className='flex flex-wrap items-center gap-3'>
            <div className='min-w-48'>
              <Choice
                label={t('evaluations.history')}
                value={id}
                onChange={select}
                options={(history.data ?? []).map((h) => ({
                  value: h.id,
                  label:
                    t('evaluations.revision') +
                    ' ' +
                    h.revision +
                    (h.current ? ' · ' + t('evaluations.current') : ''),
                }))}
              />
            </div>
            <Download reportId={id} file='bundle.zip'>
              {t('evaluations.downloadBundle')}
            </Download>
            {data.data.files.includes('report.html') && (
              <Download reportId={id} file='report.html'>
                {t('evaluations.downloadHtml')}
              </Download>
            )}
            <Download reportId={id} file='evaluation.json'>
              {t('evaluations.downloadJson')}
            </Download>
          </div>
          <p className='break-all font-mono text-xs text-muted-foreground'>
            {data.data.bundleSha256}
          </p>
          {data.data.document.type === 'evaluation-report' ? (
            <ReportBody
              key={id}
              reportId={id}
              report={data.data.document}
              canReview={capabilities.review}
            />
          ) : (
            <BatchBody id={id} batch={data.data.document} select={select} />
          )}
        </div>
      )}
    </LoadState>
  );
}

function ReportBody({
  reportId,
  report,
  canReview,
}: {
  reportId: string;
  report: EvaluationReport;
  canReview: boolean;
}) {
  const { t } = useTranslation(),
    mappings = useEvaluationData<Mapping[]>('mappings'),
    findings = useEvaluationData<FindingState[]>(
      'reports/' + reportId + '/findings',
    );
  const regressions = useEvaluationData<
    Array<{
      id: string;
      reportId: string;
      problemId: number;
      verdict: string;
      note: string;
    }>
  >('regressions');
  const selected = report.reviews.filter((r) => r.selected),
    other = report.reviews.filter((r) => !r.selected);
  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-xl font-semibold'>
          {report.run.task.title ?? report.run.key}
        </h2>
        <p className='break-all text-sm text-muted-foreground'>
          {report.run.key}
        </p>
      </div>
      <div className='grid gap-4 md:grid-cols-3'>
        {[
          ['execution', report.outcome.execution],
          ['acceptance', report.outcome.acceptance],
          ['delivery', report.outcome.delivery],
        ].map(([key, value]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className='text-sm'>
                {t('evaluations.' + key)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Status value={value} />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations.qa')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap gap-4 text-sm'>
            <span>
              {t('evaluations.coverage')}: <Status value={report.qa.coverage} />
            </span>
            <span>
              {t('evaluations.firstPass')}:{' '}
              <Status value={report.qa.firstPassWithoutRepair} />
            </span>
            <span>
              {t('evaluations.repairs')}:{' '}
              {report.qa.counts.chain.repairAttempts ??
                t('evaluations.unknown')}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('evaluations.criterion')}</TableHead>
                <TableHead>{t('evaluations.firstFull')}</TableHead>
                <TableHead>{t('evaluations.finalFull')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.qa.criteria.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.id} · {c.text}
                  </TableCell>
                  <TableCell>
                    <Status value={c.firstFull} />
                  </TableCell>
                  <TableCell>
                    <Status value={c.finalFull} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className='text-sm text-muted-foreground'>{report.qa.note}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations.usage')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          <p className='text-2xl font-semibold'>
            {report.metrics.usage.totals.total?.toLocaleString() ??
              t('evaluations.unknown')}
          </p>
          <Status
            value={
              report.metrics.usage.totals.complete ? 'complete' : 'partial'
            }
          />
          <p className='text-sm text-muted-foreground'>
            {t('evaluations.usageHint')}
          </p>
          <p className='text-sm'>
            {t('evaluations.executionSeconds')}:{' '}
            {report.metrics.time.executionSeconds ?? t('evaluations.unknown')} ·{' '}
            {t('evaluations.endToEndSeconds')}:{' '}
            {report.metrics.time.endToEndSeconds ?? t('evaluations.unknown')}
          </p>
        </CardContent>
      </Card>
      {[...selected, ...other].map((review) => (
        <div className='space-y-4' key={review.key}>
          <div className='flex flex-wrap items-center gap-3'>
            <h3 className='text-lg font-semibold'>
              {t(
                review.selected
                  ? 'evaluations.selectedReview'
                  : 'evaluations.historicalReview',
              )}
            </h3>
            <Status value={review.state} />
            <span className='text-sm text-muted-foreground'>
              {review.rubric?.id} v{review.rubric?.version ?? '—'} ·{' '}
              {review.reviewer?.engine} / {review.reviewer?.model}
            </span>
          </div>
          <p className='whitespace-pre-wrap text-sm'>
            {review.summary ?? review.reason}
          </p>
          {review.modules.map((module) => (
            <Card key={module.key}>
              <CardHeader>
                <CardTitle>{module.name}</CardTitle>
                <p className='text-sm text-muted-foreground'>{module.scope}</p>
              </CardHeader>
              <CardContent className='space-y-4'>
                {!module.subjectKeys.length && (
                  <p className='text-sm text-muted-foreground'>
                    {t('evaluations.pendingMapping')}
                  </p>
                )}
                {module.subjectKeys.map((key) => {
                  const mapping = mappings.data?.find(
                    (m) =>
                      m.sourceInstance === report.source.instance &&
                      m.subjectKey === key,
                  );
                  return (
                    <div
                      key={key}
                      className='space-y-2 rounded-lg border border-border p-3'
                    >
                      <p className='break-all font-mono text-xs'>{key}</p>
                      {mapping ? (
                        <Link
                          to={'/progress/features/' + mapping.featurePointId}
                          className='text-sm text-primary underline'
                        >
                          {t('evaluations.featurePoint')} #
                          {mapping.featurePointId}
                        </Link>
                      ) : (
                        <Status value='pending-mapping' />
                      )}
                      {canReview && (
                        <MappingForm
                          key={key + (mapping?.featurePointId ?? '')}
                          source={report.source.instance}
                          subjectKey={key}
                          mapping={mapping}
                          reload={mappings.reload}
                        />
                      )}
                    </div>
                  );
                })}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('evaluations.dimension')}</TableHead>
                      <TableHead>{t('evaluations.machineScore')}</TableHead>
                      <TableHead>{t('evaluations.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {review.rubric?.dimensions.map((d) => (
                      <TableRow key={d.key}>
                        <TableCell>{d.label}</TableCell>
                        <TableCell className='font-semibold'>
                          {module.scores[d.key]?.score ??
                            t('evaluations.notEvaluated')}
                        </TableCell>
                        <TableCell className='whitespace-normal'>
                          {module.scores[d.key]?.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {module.requirements.map((r) => (
                  <details
                    key={r.need}
                    className='rounded-lg border border-border p-3'
                  >
                    <summary className='cursor-pointer text-sm font-medium'>
                      {r.need}
                    </summary>
                    <div className='mt-3 space-y-2 text-sm'>
                      <p>{r.responsibility}</p>
                      <p>
                        {t('evaluations.recommendedUsage')}:{' '}
                        {r.recommendedUsage}
                      </p>
                      <p>
                        {t('evaluations.actualUsage')}: {r.actualUsage}
                      </p>
                    </div>
                  </details>
                ))}
                <p className='text-sm text-muted-foreground'>
                  {module.limitations}
                </p>
              </CardContent>
            </Card>
          ))}
          <h3 className='text-lg font-semibold'>{t('evaluations.findings')}</h3>
          {review.findings.map((finding) => {
            const state = findings.data?.find(
              (f) => f.findingId === finding.id,
            );
            return (
              <Card key={finding.id}>
                <CardHeader>
                  <div className='flex flex-wrap gap-2'>
                    <Status value={finding.kind} />
                    <Status value={finding.severity} />
                    <Status value={finding.confidence} />
                  </div>
                  <CardTitle>{finding.title}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <p className='whitespace-pre-wrap text-sm'>
                    {finding.detail}
                  </p>
                  <p className='text-sm'>{finding.impact}</p>
                  {finding.claimed && (
                    <p className='text-sm'>
                      {t('evaluations.claimed')}: {finding.claimed}
                    </p>
                  )}
                  {finding.observed && (
                    <p className='text-sm'>
                      {t('evaluations.observed')}: {finding.observed}
                    </p>
                  )}
                  <p className='text-sm'>
                    {t('evaluations.suggestion')}: {finding.suggestedChange}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {t('evaluations.reviewerOnly')} · {finding.owner} ·{' '}
                    {finding.reviewerStatus}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {finding.evidence.map((id) => (
                      <a
                        key={id}
                        className='text-xs text-primary underline'
                        href={'#' + encodeURIComponent('evidence-' + id)}
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                  {state?.problemId && (
                    <Link
                      to={'/progress/problems/' + state.problemId}
                      className='text-sm text-primary underline'
                    >
                      {t('evaluations.linkProblem')} #{state.problemId}
                    </Link>
                  )}
                  {state && canReview && (
                    <FindingForm
                      key={state.id + state.status + state.problemId}
                      state={state}
                      reload={findings.reload}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations.evidence')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {report.evidence.map((e) => (
            <details
              key={e.id}
              id={'evidence-' + e.id}
              className='rounded-lg border border-border p-3'
            >
              <summary className='cursor-pointer break-all text-sm'>
                {e.id} · {e.path}
              </summary>
              <div className='mt-3 space-y-3'>
                <Status value={e.availability} />
                <p className='text-sm'>{e.observation}</p>
                {e.lines && (
                  <p className='text-xs'>
                    {t('evaluations.lines')}: {e.lines.join('–')}
                  </p>
                )}
                {e.excerpt && (
                  <pre className='overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs'>
                    {e.excerpt}
                  </pre>
                )}
                {e.note && (
                  <p className='text-sm text-muted-foreground'>{e.note}</p>
                )}
                {e.attachment && e.availability === 'attached' && (
                  <Download reportId={reportId} file={e.attachment}>
                    {t('evaluations.downloadEvidence')}
                  </Download>
                )}
                <p className='break-all font-mono text-xs text-muted-foreground'>
                  {e.sha256}
                </p>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
      {canReview && (
        <RegressionForm
          reportId={reportId}
          evidenceIds={report.evidence.map((e) => e.id)}
          reload={regressions.reload}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations.regressions')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(regressions.data ?? [])
            .filter((r) => r.reportId === reportId)
            .map((r) => (
              <div
                key={r.id}
                className='flex flex-wrap items-center gap-3 border-b border-border py-3'
              >
                <Link
                  className='text-primary underline'
                  to={'/progress/problems/' + r.problemId}
                >
                  #{r.problemId}
                </Link>
                <Status value={r.verdict} />
                <p className='text-sm'>{r.note}</p>
              </div>
            ))}
        </CardContent>
      </Card>
      <details className='rounded-lg border border-border p-4'>
        <summary className='cursor-pointer font-medium'>
          {t('evaluations.baseline')}
        </summary>
        <pre className='mt-4 max-h-96 overflow-auto whitespace-pre-wrap text-xs'>
          {JSON.stringify(report.baseline, null, 2)}
        </pre>
      </details>
      <details className='rounded-lg border border-border p-4'>
        <summary className='cursor-pointer font-medium'>
          {t('evaluations.executions')}
        </summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('evaluations.name')}</TableHead>
              <TableHead>{t('evaluations.execution')}</TableHead>
              <TableHead>{t('evaluations.executionSeconds')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.executions.map((e) => (
              <TableRow key={e.key}>
                <TableCell>{e.key}</TableCell>
                <TableCell>
                  {e.kind} · {e.conclusion}
                </TableCell>
                <TableCell>
                  {e.jobSeconds ?? t('evaluations.unknown')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
      {report.limitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('evaluations.limitations')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {report.limitations.map((l) => (
              <p
                key={l.code + l.detail}
                className='text-sm text-muted-foreground'
              >
                {l.code}: {l.detail}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type Sample = EvaluationBatch['samples'][number] & {
  localReportId: string | null;
  reception: string;
};
function BatchBody({
  id,
  batch,
  select,
}: {
  id: string;
  batch: EvaluationBatch;
  select: (id: string) => void;
}) {
  const { t } = useTranslation(),
    samples = useEvaluationData<Sample[]>('reports/' + id + '/samples');
  return (
    <div className='space-y-6'>
      <h2 className='text-xl font-semibold'>{batch.batch.key}</h2>
      <p className='break-all text-sm text-muted-foreground'>
        {batch.batch.subjectKey}
      </p>
      <div className='flex flex-wrap items-center gap-4'>
        <Status value={batch.state} />
        <span>
          {t('evaluations.planned')}: {batch.summary.planned}
        </span>
        <span>
          {t('evaluations.acceptance')}: {batch.summary.acceptance.passed} /{' '}
          {batch.summary.planned}
        </span>
        <Status
          value={batch.summary.comparable ? 'comparable' : 'not-comparable'}
        />
      </div>
      <LoadState loading={samples.loading} error={samples.error}>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'sample',
                'execution',
                'acceptance',
                'reception',
                'comparison',
              ].map((key) => (
                <TableHead key={key}>{t('evaluations.' + key)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.data?.map((s) => (
              <TableRow key={s.key}>
                <TableCell>
                  {s.localReportId ? (
                    <button
                      className='text-primary underline'
                      onClick={() => select(s.localReportId!)}
                    >
                      {s.caseKey} / {s.sampleIndex}
                    </button>
                  ) : (
                    s.caseKey + ' / ' + s.sampleIndex
                  )}
                </TableCell>
                <TableCell>
                  <Status value={s.state} />
                </TableCell>
                <TableCell>
                  <Status value={s.report.acceptance} />
                </TableCell>
                <TableCell>
                  <Status value={s.reception} />
                </TableCell>
                <TableCell>
                  <Status
                    value={
                      s.comparable === null
                        ? 'unknown'
                        : s.comparable
                          ? 'comparable'
                          : 'not-comparable'
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </LoadState>
      <p className='text-sm text-muted-foreground'>
        {t('evaluations.batchHint')}
      </p>
      {batch.limitations.map((l) => (
        <p key={l.code + l.detail} className='text-sm text-muted-foreground'>
          {l.code}: {l.detail}
        </p>
      ))}
      <details className='rounded-lg border border-border p-4'>
        <summary className='cursor-pointer font-medium'>
          {t('evaluations.baseline')}
        </summary>
        <pre className='mt-4 overflow-auto whitespace-pre-wrap text-xs'>
          {JSON.stringify(batch.baseline, null, 2)}
        </pre>
      </details>
    </div>
  );
}
