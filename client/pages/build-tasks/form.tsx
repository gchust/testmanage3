import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { RouteDialog } from '@/components/route-dialog';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Loading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ErrorPanel } from '../test-progress/shared.js';
import { useAsyncResource } from '../test-progress/use-async-resource.js';
import { getTask, saveTask, type TaskInput } from './api.js';

export default function TaskForm() {
  const { t } = useTranslation(),
    { taskId } = useParams();
  return (
    <RouteDialog title={t(taskId ? 'buildTasks.edit' : 'buildTasks.create')}>
      <LoadForm taskId={taskId} />
    </RouteDialog>
  );
}
function LoadForm({ taskId }: { taskId?: string }) {
  const api = useApiClient(),
    { t } = useTranslation();
  const resource = useAsyncResource(
    `build-task-edit-${taskId ?? 'new'}`,
    async (signal) =>
      taskId ? (await getTask(api, taskId, signal)).task : null,
  );
  if (resource.loading) return <Loading />;
  if (resource.error)
    return (
      <ErrorPanel
        message={t('buildTasks.loadError')}
        onRetry={resource.reload}
      />
    );
  return <Fields taskId={taskId} initial={resource.data ?? undefined} />;
}
function Fields({
  initial,
  taskId,
}: {
  initial?: TaskInput & { issueNumber?: number | null };
  taskId?: string;
}) {
  const api = useApiClient(),
    { t } = useTranslation(),
    overlay = useRouteOverlay();
  const [values, setValues] = useState<TaskInput>({
    title: initial?.title ?? '',
    requirements: initial?.requirements ?? '',
    acceptanceCriteria: initial?.acceptanceCriteria ?? '',
    targetBranch: initial?.targetBranch ?? '',
    taskType: initial?.taskType ?? 'create',
    sampleData: initial?.sampleData ?? true,
    buildReview: initial?.buildReview ?? 'auto',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  function update<K extends keyof TaskInput>(key: K, value: TaskInput[K]) {
    setValues((s) => ({ ...s, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await saveTask(api, values, taskId);
      toast.success(t('buildTasks.saved'));
      await overlay.close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='task-title'>{t('buildTasks.taskTitle')}</Label>
        <Input
          id='task-title'
          value={values.title}
          onChange={(e) => update('title', e.target.value)}
          required
          maxLength={200}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='task-type'>{t('buildTasks.taskType')}</Label>
        <Select
          value={values.taskType}
          onValueChange={(value) =>
            update('taskType', value as TaskInput['taskType'])
          }
        >
          <SelectTrigger id='task-type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['create', 'improve', 'fix'].map((v) => (
              <SelectItem key={v} value={v}>
                {t(`buildTasks.types.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='task-branch'>{t('buildTasks.branch')}</Label>
        <Input
          id='task-branch'
          value={values.targetBranch}
          onChange={(e) => update('targetBranch', e.target.value)}
          maxLength={120}
          disabled={!!initial?.issueNumber}
        />
        <p className='text-sm text-muted-foreground'>
          {t('buildTasks.branchHint')}
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='task-requirements'>
          {t('buildTasks.requirements')}
        </Label>
        <Textarea
          id='task-requirements'
          className='min-h-40'
          value={values.requirements}
          onChange={(e) => update('requirements', e.target.value)}
          required
          maxLength={24000}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='task-acceptance'>{t('buildTasks.acceptance')}</Label>
        <Textarea
          id='task-acceptance'
          className='min-h-24'
          value={values.acceptanceCriteria}
          onChange={(e) => update('acceptanceCriteria', e.target.value)}
          maxLength={12000}
        />
        <p className='text-sm text-muted-foreground'>
          {t('buildTasks.acceptanceHint')}
        </p>
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='task-sample'>{t('buildTasks.sampleData')}</Label>
          <Select
            value={values.sampleData ? 'yes' : 'no'}
            onValueChange={(v) => update('sampleData', v === 'yes')}
          >
            <SelectTrigger id='task-sample'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='yes'>{t('buildTasks.yes')}</SelectItem>
              <SelectItem value='no'>{t('buildTasks.no')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='task-review'>{t('buildTasks.review')}</Label>
          <Select
            value={values.buildReview}
            onValueChange={(v) =>
              update('buildReview', v as TaskInput['buildReview'])
            }
          >
            <SelectTrigger id='task-review'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['auto', 'off', 'full'].map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`buildTasks.reviews.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {t('buildTasks.saveError')}
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={() => void overlay.close()}
        >
          {t('buildTasks.cancel')}
        </Button>
        <Button type='submit' disabled={busy}>
          {t(busy ? 'buildTasks.saving' : 'buildTasks.save')}
        </Button>
      </div>
    </form>
  );
}
