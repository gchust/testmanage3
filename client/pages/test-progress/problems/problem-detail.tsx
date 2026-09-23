import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Check, Copy, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { toast } from 'sonner';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
  createProblemComment,
  deleteProblemComment,
  describeApiError,
  fetchProblem,
  fetchProblemActivities,
  fetchProblemComments,
  type Problem,
  type ProblemActivity,
  type ProblemComment,
} from '../api.js';
import { PROBLEM_ACTIVITY_DOT_CLASS } from '../constants.js';
import { MarkdownContent, MarkdownEditor } from '../markdown.js';
import {
  DefinitionItem,
  EmptyPanel,
  ErrorPanel,
  ProblemStatusBadge,
} from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';
import { useRefetchOnReturn } from '../use-refetch-on-return.js';

export default function ProblemDetailPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const params = useParams();
  const id = Number(params.problemId);
  const validId = Number.isInteger(id) && id > 0;
  const resource = useAsyncResource<Problem>(
    `problem|${String(params.problemId)}`,
    (signal) => fetchProblem(api, id, signal),
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
              <EmptyPanel message={t('testProgress.problemNotFound')}>
                <Button
                  render={<Link to='/progress/problems' />}
                  variant='outline'
                >
                  {t('testProgress.backToProblems')}
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
            <>
              <ProblemDetail problem={resource.data} />
              <div className='space-y-6'>
                <ProblemComments problemId={resource.data.id} />
                <ProblemTimeline problemId={resource.data.id} />
              </div>
            </>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}

function ProblemDetail({
  problem,
}: {
  readonly problem: Problem;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div className='mb-6 space-y-6'>
      <PageHeader
        title={problem.title}
        description={<ProblemStatusBadge status={problem.status} />}
        actions={
          <Button render={<Link to='edit' />} variant='outline'>
            <Pencil aria-hidden='true' />
            {t('testProgress.edit')}
          </Button>
        }
      />

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('testProgress.basicInfo')}</CardTitle>
          <CopyForAgentButton problem={problem} />
        </CardHeader>
        <CardContent className='space-y-5'>
          <dl className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <DefinitionItem label={t('testProgress.fieldProblemType')}>
              <span>{t(`testProgress.problemType.${problem.type}`)}</span>
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.fieldProblemStatus')}>
              <ProblemStatusBadge status={problem.status} />
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.fieldFeaturePoint')}>
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={`/progress/features/${problem.featurePointId}`}
              >
                {problem.featurePointName ?? '—'}
              </Link>
            </DefinitionItem>
            <DefinitionItem label={t('testProgress.fieldOwner')}>
              <span>{problem.owner ?? '—'}</span>
            </DefinitionItem>
          </dl>
          <DefinitionItem label={t('testProgress.fieldProblemTitle')}>
            <p className='whitespace-pre-wrap'>{problem.title}</p>
          </DefinitionItem>
          <DefinitionItem label={t('testProgress.fieldProblemDescription')}>
            {problem.description === null || problem.description.trim() === '' ? (
              <p className='text-muted-foreground'>{t('testProgress.noNote')}</p>
            ) : (
              <MarkdownContent content={problem.description} />
            )}
          </DefinitionItem>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Copies the problem as a ready-to-paste prompt. The description is the body, so
 * an Agent receives the same Markdown the page renders instead of a screenshot.
 */
function CopyForAgentButton({
  problem,
}: {
  readonly problem: Problem;
}): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const description = problem.description ?? '';
    // Images are rewritten to absolute URLs and listed again, so an Agent that
    // reads the text outside the app can still fetch them.
    const images: string[] = [];
    const resolvedDescription = description.replace(
      IMAGE_PATTERN,
      (match, alt: string, url: string) => {
        const absolute = absoluteUrl(url);
        if (absolute === null) return match;
        if (!images.includes(absolute)) images.push(absolute);
        return `![${alt}](${absolute})`;
      },
    );

    const lines = [
      `# ${problem.title}`,
      '',
      `- ${t('testProgress.fieldProblemType')}: ${t(
        `testProgress.problemType.${problem.type}`,
      )}`,
      `- ${t('testProgress.fieldFeaturePoint')}: ${
        problem.featurePointName ?? '—'
      }`,
      `- ${t('testProgress.fieldProblemStatus')}: ${t(
        `testProgress.problemStatus.${problem.status}`,
      )}`,
      `- ${t('testProgress.fieldOwner')}: ${problem.owner ?? '—'}`,
      '',
      `## ${t('testProgress.fieldProblemDescription')}`,
      description.trim() === '' ? t('testProgress.noNote') : resolvedDescription,
    ];

    if (images.length > 0) {
      lines.push(
        '',
        `## ${t('testProgress.copyForAgentImages')}`,
        ...images.map((url) => `- ${url}`),
      );
    }

    try {
      await writeClipboard(lines.join('\n'));
      setCopied(true);
      toast.success(t('testProgress.copyForAgentDone'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error(
        t('testProgress.copyForAgentFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return (
    <Button
      size='sm'
      type='button'
      variant='outline'
      onClick={() => {
        void copy();
      }}
    >
      {copied ? (
        <Check aria-hidden='true' className='size-3.5' />
      ) : (
        <Copy aria-hidden='true' className='size-3.5' />
      )}
      {t('testProgress.copyForAgent')}
    </Button>
  );
}

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Absolute form of a Markdown image URL; data URLs and unparsable values stay put. */
function absoluteUrl(url: string): string | null {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

/** Clipboard API where available, with a selection fallback for plain HTTP hosts. */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(area);
  if (!copied) {
    throw new Error('Copy failed');
  }
}

function ProblemTimeline({
  problemId,
}: {
  readonly problemId: number;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const activities = useAsyncResource<ProblemActivity[]>(
    `problem-activities|${problemId}`,
    (signal) => fetchProblemActivities(api, problemId, signal),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('testProgress.timeline')}</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.loading ? <Loading /> : null}
        {activities.error !== undefined ? (
          <ErrorPanel
            message={describeApiError(activities.error)}
            onRetry={activities.reload}
          />
        ) : null}
        {activities.data !== undefined ? (
          <ol className='flex items-start overflow-x-auto pb-2'>
            {activities.data.map((activity, index) => (
              <li
                className='flex min-w-48 flex-1 shrink-0 flex-col'
                key={activity.id}
              >
                <span aria-hidden='true' className='flex items-center'>
                  <span
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      activity.kind === 'created'
                        ? PROBLEM_ACTIVITY_DOT_CLASS.created
                        : PROBLEM_ACTIVITY_DOT_CLASS[
                            activity.toStatus ?? 'pending'
                          ],
                    )}
                  />
                  {index === activities.data!.length - 1 ? null : (
                    <span className='h-px flex-1 bg-border' />
                  )}
                </span>
                <p className='mt-2 pr-4 text-sm'>
                  {activity.kind === 'created'
                    ? t('testProgress.timelineCreated', {
                        actor: activity.actorName,
                      })
                    : t('testProgress.timelineStatus', {
                        actor: activity.actorName,
                        from:
                          activity.fromStatus === null
                            ? ''
                            : t(
                                `testProgress.problemStatus.${activity.fromStatus}`,
                              ),
                        to:
                          activity.toStatus === null
                            ? ''
                            : t(
                                `testProgress.problemStatus.${activity.toStatus}`,
                              ),
                      })}
                </p>
                <time
                  className='mt-0.5 text-xs text-muted-foreground'
                  dateTime={activity.createdAt}
                >
                  {formatDateTime(activity.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProblemComments({
  problemId,
}: {
  readonly problemId: number;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const currentUserId = session?.user?.id ?? null;
  const comments = useAsyncResource<ProblemComment[]>(
    `problem-comments|${problemId}`,
    (signal) => fetchProblemComments(api, problemId, signal),
  );
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content === '') return;

    setSubmitting(true);
    setError(null);
    try {
      await createProblemComment(api, problemId, { content: draft });
      setDraft('');
      comments.reload();
      toast.success(t('testProgress.commentAdded'));
    } catch (submitError) {
      setError(describeApiError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(comment: ProblemComment): Promise<void> {
    if (!window.confirm(t('testProgress.commentDeleteConfirm'))) return;
    try {
      await deleteProblemComment(api, comment.id);
      comments.reload();
      toast.success(t('testProgress.deleted'));
    } catch (removeError) {
      toast.error(
        t('testProgress.commentFailed', {
          message: describeApiError(removeError),
        }),
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('testProgress.comments')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-5'>
        {comments.loading ? <Loading /> : null}
        {comments.error !== undefined ? (
          <ErrorPanel
            message={describeApiError(comments.error)}
            onRetry={comments.reload}
          />
        ) : null}
        {comments.data !== undefined ? (
          comments.data.length === 0 ? (
            <EmptyPanel message={t('testProgress.commentEmpty')} />
          ) : (
            <ul className='space-y-4'>
              {comments.data.map((comment) => (
                <li
                  className='rounded-lg border border-border p-3'
                  key={comment.id}
                >
                  <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                    <span className='font-medium text-foreground'>
                      {comment.authorName}
                    </span>
                    <time dateTime={comment.createdAt}>
                      {formatDateTime(comment.createdAt)}
                    </time>
                    {currentUserId !== null &&
                    comment.authorId === currentUserId ? (
                      <Button
                        aria-label={t('testProgress.commentDelete')}
                        className='ml-auto'
                        size='icon-sm'
                        title={t('testProgress.commentDelete')}
                        type='button'
                        variant='ghost'
                        onClick={() => {
                          void remove(comment);
                        }}
                      >
                        <Trash2 aria-hidden='true' className='size-3.5' />
                      </Button>
                    ) : null}
                  </div>
                  <MarkdownContent content={comment.content} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        <div className='space-y-3 border-t border-border pt-4'>
          <MarkdownEditor
            placeholder={t('testProgress.commentPlaceholder')}
            rows={4}
            value={draft}
            onChange={setDraft}
          />
          {error !== null ? (
            <p className='text-sm text-destructive' role='alert'>
              {t('testProgress.commentFailed', { message: error })}
            </p>
          ) : null}
          <div className='flex justify-end'>
            <Button
              disabled={submitting || draft.trim() === ''}
              type='button'
              onClick={() => {
                void submit();
              }}
            >
              {submitting
                ? t('testProgress.commentSubmitting')
                : t('testProgress.commentSubmit')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
