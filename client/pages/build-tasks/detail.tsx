import { useTaskPermission } from './use-task-permission.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { toast } from 'sonner';
import { Pencil, RefreshCw } from 'lucide-react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Loading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '../test-progress/markdown.js';
import { EmptyPanel, ErrorPanel } from '../test-progress/shared.js';
import { useAsyncResource } from '../test-progress/use-async-resource.js';
import { useRefetchOnReturn } from '../test-progress/use-refetch-on-return.js';
import { commentTask, getTask, refreshRun, type TaskDetail } from './api.js';
import { RunButton, SafeLink, TaskStatus } from './shared.js';

export default function TaskDetailPage() {
  const { taskId = '' } = useParams(),
    api = useApiClient(),
    { t } = useTranslation();
  const resource = useAsyncResource(`build-task-${taskId}`, (signal) =>
    getTask(api, taskId, signal),
  );
  useRefetchOnReturn(resource.reload);
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <Breadcrumbs />
          {resource.loading ? (
            <Loading />
          ) : resource.error ? (
            <ErrorPanel
              message={t('buildTasks.loadError')}
              onRetry={resource.reload}
            />
          ) : (
            resource.data && (
              <TaskContent
                data={resource.data}
                reload={resource.reload}
                mutate={resource.mutate}
              />
            )
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
function TaskContent({
  data,
  reload,
  mutate,
}: {
  data: TaskDetail;
  reload: () => void;
  mutate: (update: (current: TaskDetail) => TaskDetail) => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient();
  const manage = useTaskPermission('manage'),
    comment = useTaskPermission('comment'),
    run = useTaskPermission('run');
  const [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(
    null,
  );
  const active = data.runs.find((r) => r.active);
  useEffect(() => {
    if (!active) return;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const request = run.can
        ? refreshRun(api, data.task.id, active.id)
        : Promise.resolve();
      void request
        .then(() => getTask(api, data.task.id))
        .then((next) => mutate(() => next))
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 20000);
    return () => clearInterval(timer);
  }, [active, api, data.task.id, mutate, run.can]);
  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (busy || !content.trim()) return;
    setBusy(true);
    try {
      await commentTask(api, data.task.id, content);
      setContent('');
      reload();
      toast.success(t('buildTasks.commentAdded'));
    } catch {
      toast.error(t('buildTasks.commentError'));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    try {
      if (active && run.can) await refreshRun(api, data.task.id, active.id);
      reload();
    } catch {
      toast.error(t('buildTasks.refreshError'));
    } finally {
      setRefreshing(false);
    }
  }
  async function readSnapshot(id: string) {
    try {
      const response = await api.request<{ data: Record<string, unknown> }>({
        path: `build-tasks/${data.task.id}/runs/${id}/snapshot`,
      });
      setSnapshot(response.data);
    } catch {
      toast.error(t('buildTasks.loadError'));
    }
  }
  return (
    <div className='space-y-6'>
      <PageHeader
        title={data.task.title}
        description={t('buildTasks.detailDescription')}
        actions={
          <>
            {manage.can && !active && (
              <Button variant='outline' render={<Link to='edit' />}>
                <Pencil aria-hidden='true' />
                {t('buildTasks.edit')}
              </Button>
            )}
            <RunButton
              taskId={data.task.id}
              active={!!active}
              configured={data.configured}
              onRun={reload}
            />
          </>
        }
      />
      {!data.configured && (
        <p
          role='status'
          className='rounded-lg border border-border bg-muted p-4 text-sm'
        >
          {t('buildTasks.notConfigured')}
        </p>
      )}
      <div className='flex flex-wrap items-center gap-4 text-sm'>
        <TaskStatus status={data.runs[0]?.status} />
        <span className='break-all font-mono'>{data.task.targetBranch}</span>
        <SafeLink
          url={
            data.task.issueNumber
              ? `https://github.com/${data.task.repository}/issues/${data.task.issueNumber}`
              : null
          }
        >
          {t('buildTasks.issue')}
        </SafeLink>
      </div>
      <div className='grid items-start gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('buildTasks.requirements')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownContent content={data.task.requirements} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('buildTasks.acceptance')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.task.acceptanceCriteria ? (
              <MarkdownContent content={data.task.acceptanceCriteria} />
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('buildTasks.defaultAcceptance')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('buildTasks.comments')}</CardTitle>
          <p className='text-sm text-muted-foreground'>
            {t('buildTasks.commentsHint')}
          </p>
        </CardHeader>
        <CardContent className='space-y-6'>
          {data.comments.length ? (
            data.comments.map((c) => (
              <article
                key={c.id}
                className='space-y-3 border-b border-border pb-5'
              >
                <div className='flex flex-wrap gap-3 text-sm'>
                  <span className='font-medium'>{c.authorName}</span>
                  <time className='text-muted-foreground'>
                    {new Date(c.createdAt).toLocaleString()}
                  </time>
                </div>
                <MarkdownContent content={c.content} />
              </article>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('buildTasks.noComments')}
            </p>
          )}
          {comment.can && (
            <form onSubmit={(e) => void addComment(e)} className='space-y-3'>
              <Label htmlFor='task-comment'>{t('buildTasks.addComment')}</Label>
              <Textarea
                id='task-comment'
                className='min-h-28'
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={12000}
                required
              />
              <Button disabled={busy || !content.trim()} type='submit'>
                {t(busy ? 'buildTasks.saving' : 'buildTasks.addComment')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('buildTasks.history')}</CardTitle>
          <Button
            size='sm'
            variant='outline'
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden='true' />
            {t('buildTasks.refresh')}
          </Button>
        </CardHeader>
        <CardContent className='space-y-5'>
          {!data.runs.length && <EmptyPanel message={t('buildTasks.noRuns')} />}
          {data.runs.map((r) => (
            <article
              key={r.id}
              className='space-y-3 rounded-lg border border-border p-4'
            >
              <div className='flex flex-wrap items-center gap-3'>
                <TaskStatus status={r.status} />
                <time className='text-sm text-muted-foreground'>
                  {new Date(r.createdAt).toLocaleString()}
                </time>
                <span className='text-sm'>{r.requestedByName}</span>
              </div>
              {r.error && (
                <p role='alert' className='text-sm text-destructive'>
                  {t(
                    r.status === 'dispatch_unknown'
                      ? 'buildTasks.dispatchUnknown'
                      : 'buildTasks.dispatchFailed',
                  )}{' '}
                  <code>{r.error}</code>
                </p>
              )}
              {r.result && (
                <dl className='grid gap-3 text-sm sm:grid-cols-3'>
                  {[
                    ['execution', r.result.execution],
                    ['acceptanceResult', r.result.acceptance],
                    ['delivery', r.result.delivery],
                  ].map(([key, value]) => (
                    <div key={key}>
                      <dt className='text-muted-foreground'>
                        {t(`buildTasks.${key}`)}
                      </dt>
                      <dd className='mt-1 font-medium'>
                        {t(`buildTasks.result.${value}`)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className='flex flex-wrap items-center gap-4 text-sm'>
                <SafeLink
                  url={
                    r.result?.runUrl ||
                    (r.workflowRunId
                      ? `https://github.com/${data.task.repository}/actions/runs/${r.workflowRunId}`
                      : null)
                  }
                >
                  {t('buildTasks.actionsRun')}
                </SafeLink>
                <SafeLink url={r.result?.pullRequestUrl}>
                  {t('buildTasks.pullRequest')}
                </SafeLink>
                <SafeLink url={r.result?.reportUrl}>
                  {t('buildTasks.report')}
                </SafeLink>
                <SafeLink url={r.result?.environmentUrl}>
                  {t('buildTasks.preview')}
                </SafeLink>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => void readSnapshot(r.id)}
                >
                  {t('buildTasks.snapshot')}
                </Button>
              </div>
            </article>
          ))}
          {snapshot && (
            <div className='space-y-3 rounded-lg border border-border p-4'>
              <div className='flex items-center justify-between'>
                <h3 className='font-medium'>{t('buildTasks.snapshot')}</h3>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => setSnapshot(null)}
                >
                  {t('buildTasks.close')}
                </Button>
              </div>
              <pre className='max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs'>
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
