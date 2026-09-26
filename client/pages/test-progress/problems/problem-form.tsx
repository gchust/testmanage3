import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Loading } from '@/components/loading';
import { RouteDialog } from '@/components/route-dialog';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  createProblem,
  deleteProblem,
  describeApiError,
  fetchFeaturePoints,
  fetchMembers,
  fetchProblem,
  updateProblem,
  type FeaturePoint,
  type Problem,
  type ProblemMember,
  type ProblemStatus,
  type ProblemType,
} from '../api.js';
import { PROBLEM_STATUSES, PROBLEM_TYPES } from '../constants.js';
import { MarkdownEditor } from '../markdown.js';
import { ErrorPanel, FormSelect } from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';

interface ProblemFormData {
  readonly featurePoints: FeaturePoint[];
  readonly current: Problem | undefined;
  readonly members: ProblemMember[];
}

interface FormValues {
  title: string;
  description: string;
  featurePointId: string;
  type: ProblemType;
  status: ProblemStatus;
  ownerId: string;
}

export default function ProblemFormOverlay(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const rawId = params.problemId;
  const id =
    rawId === undefined || rawId === ''
      ? undefined
      : Number.isInteger(Number(rawId)) && Number(rawId) > 0
        ? Number(rawId)
        : undefined;
  const title =
    id === undefined
      ? t('testProgress.createProblemTitle')
      : t('testProgress.editProblemTitle');

  return (
    <RouteDialog title={title}>
      <ProblemForm problemId={id} />
    </RouteDialog>
  );
}

function ProblemForm({
  problemId,
}: {
  readonly problemId?: number;
}): ReactElement {
  const api = useApiClient();
  const resource = useAsyncResource<ProblemFormData>(
    `problem-form|${problemId === undefined ? 'new' : String(problemId)}`,
    async (signal) => {
      const [featurePoints, current, members] = await Promise.all([
        fetchFeaturePoints(api, signal),
        problemId === undefined
          ? Promise.resolve(undefined)
          : fetchProblem(api, problemId, signal),
        fetchMembers(api, signal),
      ]);
      return { featurePoints, current, members };
    },
  );

  if (resource.loading) return <Loading />;
  if (resource.error !== undefined) {
    return (
      <ErrorPanel
        message={describeApiError(resource.error)}
        onRetry={resource.reload}
      />
    );
  }
  if (resource.data === undefined) return <Loading />;

  return (
    <ProblemFormFields
      featurePoints={resource.data.featurePoints}
      initial={resource.data.current}
      members={resource.data.members}
      problemId={problemId}
    />
  );
}

function ProblemFormFields({
  featurePoints,
  initial,
  members,
  problemId,
}: {
  readonly featurePoints: FeaturePoint[];
  readonly initial?: Problem;
  readonly members: readonly ProblemMember[];
  readonly problemId?: number;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [searchParams] = useSearchParams();
  const { close, isClosing } = useRouteOverlay();
  const [values, setValues] = useState<FormValues>(() => {
    if (initial !== undefined) {
      return {
        title: initial.title,
        description: initial.description ?? '',
        featurePointId:
          initial.featurePointId == null ? '' : String(initial.featurePointId),
        type: initial.type,
        status: initial.status,
        // Rows written before the account association carry a name only;
        // preselect the matching account so saving upgrades them to an id.
        ownerId:
          initial.ownerId ??
          members.find((member) => member.name === initial.owner)?.id ??
          '',
      };
    }

    const type = searchParams.get('type');
    return {
      title: '',
      description: '',
      featurePointId: searchParams.get('featurePointId') ?? '',
      type: (PROBLEM_TYPES as readonly string[]).includes(type ?? '')
        ? (type as ProblemType)
        : 'manual',
      status: 'pending',
      ownerId: '',
    };
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function update<K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ): void {
    setValues((existing) => ({ ...existing, [key]: value }));
  }

  async function save(): Promise<void> {
    const title = values.title.trim();
    if (title === '') {
      setSaveError(t('testProgress.problemTitleRequired'));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title,
        description:
          values.description.trim() === '' ? null : values.description,
        featurePointId:
          values.featurePointId === '' ? null : Number(values.featurePointId),
        type: values.type,
        status: values.status,
        ownerId: values.ownerId.trim() === '' ? null : values.ownerId.trim(),
      };
      if (problemId === undefined) {
        await createProblem(api, payload);
      } else {
        await updateProblem(api, problemId, payload);
      }
      toast.success(t('testProgress.saved'));
      await close();
    } catch (error) {
      setSaveError(describeApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (problemId === undefined) return;
    if (!window.confirm(t('testProgress.confirmDeleteProblem'))) return;

    setDeleting(true);
    setSaveError(null);
    try {
      await deleteProblem(api, problemId);
      toast.success(t('testProgress.deleted'));
      await close();
    } catch (error) {
      setSaveError(describeApiError(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form
      className='space-y-4'
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className='space-y-2'>
        <Label>
          {t('testProgress.fieldProblemTitle')}
          <span className='text-destructive'> *</span>
        </Label>
        <Textarea
          required
          rows={2}
          value={values.title}
          onChange={(event) => update('title', event.target.value)}
        />
      </div>

      <div className='space-y-2'>
        <Label>{t('testProgress.fieldProblemDescription')}</Label>
        <MarkdownEditor
          placeholder={t('testProgress.descriptionPlaceholder')}
          value={values.description}
          onChange={(value) => update('description', value)}
        />
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label>{t('testProgress.fieldFeaturePoint')}</Label>
          <FormSelect
            options={[
              { value: '', label: t('testProgress.uncategorized') },
              ...featurePoints.map((feature) => ({
                value: String(feature.id),
                label:
                  feature.level === 'dimension'
                    ? feature.name
                    : `— ${feature.name}`,
              })),
            ]}
            placeholder={t('testProgress.selectPlaceholder')}
            value={values.featurePointId}
            onValueChange={(value) => update('featurePointId', value)}
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('testProgress.fieldProblemType')}</Label>
          <FormSelect
            options={PROBLEM_TYPES.map((type) => ({
              value: type,
              label: t(`testProgress.problemType.${type}`),
            }))}
            value={values.type}
            onValueChange={(value) => update('type', value)}
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('testProgress.fieldProblemStatus')}</Label>
          <FormSelect
            options={PROBLEM_STATUSES.map((status) => ({
              value: status,
              label: t(`testProgress.problemStatus.${status}`),
            }))}
            value={values.status}
            onValueChange={(value) => update('status', value)}
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('testProgress.fieldOwner')}</Label>
          <FormSelect
            options={[
              { value: '', label: t('testProgress.ownerNone') },
              ...members.map((member) => ({
                value: member.id,
                label: member.name,
              })),
            ]}
            value={values.ownerId}
            onValueChange={(value) => update('ownerId', value)}
          />
        </div>
      </div>

      {saveError !== null ? (
        <p className='text-sm text-destructive' role='alert'>
          {t('testProgress.saveFailed', { message: saveError })}
        </p>
      ) : null}

      <div className='flex flex-wrap justify-end gap-2 border-t border-border pt-4'>
        {problemId === undefined ? null : (
          <Button
            disabled={deleting || saving || isClosing}
            type='button'
            variant='destructive'
            onClick={() => {
              void remove();
            }}
          >
            {deleting ? t('testProgress.deleting') : t('testProgress.delete')}
          </Button>
        )}
        <Button
          disabled={isClosing}
          type='button'
          variant='outline'
          onClick={() => {
            void close().catch((error: unknown) => {
              console.error('Failed to close problem form', error);
            });
          }}
        >
          {t('testProgress.cancel')}
        </Button>
        <Button disabled={saving || deleting || isClosing} type='submit'>
          {saving ? t('testProgress.saving') : t('testProgress.save')}
        </Button>
      </div>
    </form>
  );
}
