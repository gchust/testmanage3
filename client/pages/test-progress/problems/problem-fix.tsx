import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Bot, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import { Loading } from '@/components/loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';

import { EmptyPanel, ErrorPanel } from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';
import {
  listFixRuns,
  refreshFixRun,
  triggerFix,
  type FixRun,
} from './problem-fix-api.js';

const useFixPermission = (action: 'read' | 'run') =>
  useCan({ resource: { type: 'resource', id: 'problemFixes' }, action });

/**
 * Sends the problem to the factory's Claude Code workflow and shows its runs.
 * The result arrives as a problem comment (and a status change when a PR is
 * opened), so `onSettled` lets the page reload those when a run finishes.
 */
export function ProblemFixSection({
  problemId,
  onSettled,
}: {
  readonly problemId: number;
  readonly onSettled: () => void;
}): ReactElement | null {
  const read = useFixPermission('read');
  if (!read.can) return null;
  return <ProblemFixCard problemId={problemId} onSettled={onSettled} />;
}

function ProblemFixCard({
  problemId,
  onSettled,
}: {
  readonly problemId: number;
  readonly onSettled: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const run = useFixPermission('run');
  const resource = useAsyncResource(`problem-fixes|${problemId}`, (signal) =>
    listFixRuns(api, problemId, signal),
  );
  const { data, mutate } = resource;
  const activeId = data?.runs.find((r) => r.active)?.id ?? null;
  const [refreshing, setRefreshing] = useState(false);
  const previousActiveRef = useRef<string | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    if (previousActiveRef.current !== null && activeId === null) onSettled();
    previousActiveRef.current = activeId;
  }, [activeId, data, onSettled]);

  useEffect(() => {
    if (activeId === null) return;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const request = run.can
        ? refreshFixRun(api, problemId, activeId)
        : Promise.resolve();
      void request
        .then(() => listFixRuns(api, problemId))
        .then((next) => mutate(() => next))
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 20000);
    return () => clearInterval(timer);
  }, [activeId, api, mutate, problemId, run.can]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      if (activeId !== null && run.can)
        await refreshFixRun(api, problemId, activeId);
      resource.reload();
    } catch {
      toast.error(t('problemFixes.refreshError'));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('problemFixes.sectionTitle')}</CardTitle>
          <p className='max-w-3xl text-sm text-muted-foreground'>
            {t('problemFixes.description')}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {activeId !== null ? (
            <Button
              disabled={refreshing}
              size='sm'
              type='button'
              variant='outline'
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden='true' />
              {t('problemFixes.refresh')}
            </Button>
          ) : null}
          {data !== undefined ? (
            <FixRunButton
              active={activeId !== null}
              configured={data.configured}
              problemId={problemId}
              onRun={resource.reload}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {resource.loading ? <Loading /> : null}
        {resource.error !== undefined ? (
          <ErrorPanel
            message={t('problemFixes.loadError')}
            onRetry={resource.reload}
          />
        ) : null}
        {data !== undefined ? (
          <>
            {!data.configured ? (
              <p
                className='rounded-lg border border-border bg-muted p-4 text-sm'
                role='status'
              >
                {t('problemFixes.notConfigured')}
              </p>
            ) : activeId !== null ? (
              <p className='text-sm text-muted-foreground' role='status'>
                {t('problemFixes.activeHint')}
              </p>
            ) : null}
            {data.runs.length === 0 ? (
              <EmptyPanel message={t('problemFixes.noRuns')} />
            ) : (
              <ul className='space-y-3'>
                {data.runs.map((r) => (
                  <FixRunItem key={r.id} run={r} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FixRunItem({ run }: { readonly run: FixRun }): ReactElement {
  const { t } = useTranslation();
  return (
    <li className='space-y-2 rounded-lg border border-border p-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Badge
          variant={
            run.status === 'failed' || run.status === 'dispatch_failed'
              ? 'destructive'
              : 'secondary'
          }
        >
          {t(`problemFixes.status.${run.status}`)}
        </Badge>
        {run.result ? (
          <Badge variant='outline'>
            {t(`problemFixes.verdict.${run.result.verdict}`)}
          </Badge>
        ) : null}
        <time
          className='text-sm text-muted-foreground'
          dateTime={run.createdAt}
        >
          {new Date(run.createdAt).toLocaleString()}
        </time>
        <span className='text-sm'>
          {run.origin === 'github'
            ? t('problemFixes.fromGitHub')
            : run.requestedByName}
        </span>
      </div>
      {run.error ? (
        <p className='text-sm text-destructive' role='alert'>
          {t(
            run.status === 'dispatch_unknown'
              ? 'problemFixes.dispatchUnknown'
              : 'problemFixes.dispatchFailed',
          )}{' '}
          <code>{run.error}</code>
        </p>
      ) : null}
      {run.result ? (
        <p className='whitespace-pre-wrap break-words text-sm'>
          {run.result.summary}
        </p>
      ) : null}
      <div className='flex flex-wrap items-center gap-4 text-sm'>
        <ExternalLink url={run.result?.pullRequestUrl}>
          {t('problemFixes.pullRequest')}
        </ExternalLink>
        <ExternalLink url={run.workflowRunUrl}>
          {t('problemFixes.actionsRun')}
        </ExternalLink>
      </div>
    </li>
  );
}

export function FixRunButton({
  problemId,
  active,
  configured,
  onRun,
}: {
  readonly problemId: number;
  readonly active: boolean;
  readonly configured: boolean;
  readonly onRun: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const permission = useFixPermission('run');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // One key per confirmed click, kept until the server answers, so a retry of
  // an uncertain submission cannot start a second run.
  const requestKeyRef = useRef<string | null>(null);
  if (!permission.can) return null;
  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    requestKeyRef.current ??= crypto.randomUUID();
    try {
      const result = await triggerFix(api, problemId, requestKeyRef.current);
      requestKeyRef.current = null;
      setOpen(false);
      onRun();
      if (result.status === 'dispatch_failed')
        toast.error(t('problemFixes.dispatchFailed'));
      else if (result.status === 'dispatch_unknown')
        toast.warning(t('problemFixes.dispatchUnknown'));
      else toast.success(t('problemFixes.submitted'));
    } catch {
      toast.error(t('problemFixes.submitError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={active || !configured || busy}
        size='sm'
        type='button'
        onClick={() => setOpen(true)}
      >
        <Bot aria-hidden='true' />
        {t(active ? 'problemFixes.running' : 'problemFixes.run')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('problemFixes.confirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('problemFixes.confirmDescription')}
          </DialogDescription>
          <DialogFooter>
            <Button
              disabled={busy}
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              {t('problemFixes.cancel')}
            </Button>
            <Button disabled={busy} type='button' onClick={() => void submit()}>
              {t(busy ? 'problemFixes.submitting' : 'problemFixes.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExternalLink({
  url,
  children,
}: {
  readonly url?: string | null;
  readonly children: React.ReactNode;
}): ReactElement | null {
  if (!url || !/^https:\/\//.test(url)) return null;
  return (
    <a
      className='text-primary underline underline-offset-4'
      href={url}
      rel='noopener noreferrer'
      target='_blank'
    >
      {children}
    </a>
  );
}
