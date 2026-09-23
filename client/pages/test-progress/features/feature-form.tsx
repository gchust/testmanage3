import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Loading } from '@/components/loading';
import { RouteDialog } from '@/components/route-dialog';
import { RouteDrawer } from '@/components/route-drawer';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  createFeaturePoint,
  describeApiError,
  deleteFeaturePoint,
  fetchFeaturePoint,
  fetchFeaturePoints,
  fetchMembers,
  updateFeaturePoint,
  type AvailabilityStatus,
  type ExampleExistsStatus,
  type FeatureLevel,
  type FeaturePoint,
  type FeaturePointPayload,
  type ProblemMember,
  type FeatureStatus,
} from '../api.js';
import {
  AVAILABILITY_STATUSES,
  EXAMPLE_EXISTS_STATUSES,
  FEATURE_STATUSES,
} from '../constants.js';
import { ErrorPanel, FieldHint, FormSelect } from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';

interface FormValues {
  name: string;
  level: FeatureLevel;
  parentId: string;
  ownerId: string;
  status: FeatureStatus;
  skillsStatus: AvailabilityStatus;
  docsStatus: AvailabilityStatus;
  exampleExists: ExampleExistsStatus;
  exampleExpected: string;
  exampleCurrent: string;
  designScore: string;
  designNote: string;
  developmentScore: string;
  developmentNote: string;
  agentFriendlinessScore: string;
  agentFriendlinessNote: string;
  outputQualityScore: string;
  outputQualityNote: string;
  remark: string;
}

function emptyValues(): FormValues {
  return {
    name: '',
    level: 'feature',
    parentId: '',
    ownerId: '',
    status: 'unspecified',
    skillsStatus: 'unspecified',
    docsStatus: 'unspecified',
    exampleExists: 'unspecified',
    exampleExpected: '',
    exampleCurrent: '',
    designScore: '',
    designNote: '',
    developmentScore: '',
    developmentNote: '',
    agentFriendlinessScore: '',
    agentFriendlinessNote: '',
    outputQualityScore: '',
    outputQualityNote: '',
    remark: '',
  };
}

function valuesFrom(
  feature: FeaturePoint,
  members: readonly ProblemMember[],
): FormValues {
  return {
    name: feature.name,
    level: feature.level,
    parentId: feature.parentId === null ? '' : String(feature.parentId),
    // Rows written before the account association carry a name only; preselect
    // the matching account so saving upgrades them to an id.
    ownerId:
      feature.ownerId ??
      members.find((member) => member.name === feature.owner)?.id ??
      '',
    status: feature.status,
    skillsStatus: feature.skillsStatus,
    docsStatus: feature.docsStatus,
    exampleExists: feature.exampleExists,
    exampleExpected: feature.exampleExpected ?? '',
    exampleCurrent: feature.exampleCurrent ?? '',
    designScore:
      feature.designScore === null ? '' : String(feature.designScore),
    designNote: feature.designNote ?? '',
    developmentScore:
      feature.developmentScore === null ? '' : String(feature.developmentScore),
    developmentNote: feature.developmentNote ?? '',
    agentFriendlinessScore:
      feature.agentFriendlinessScore === null
        ? ''
        : String(feature.agentFriendlinessScore),
    agentFriendlinessNote: feature.agentFriendlinessNote ?? '',
    outputQualityScore:
      feature.outputQualityScore === null
        ? ''
        : String(feature.outputQualityScore),
    outputQualityNote: feature.outputQualityNote ?? '',
    remark: feature.remark ?? '',
  };
}

function toScore(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableText(value: string): string | null {
  return value.trim() === '' ? null : value;
}

export default function FeatureFormOverlay(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const rawId = params.featurePointId;
  const id =
    rawId === undefined || rawId === ''
      ? undefined
      : Number.isInteger(Number(rawId)) && Number(rawId) > 0
        ? Number(rawId)
        : undefined;
  const title =
    id === undefined
      ? t('testProgress.createFeatureTitle')
      : t('testProgress.editFeatureTitle');

  if (id === undefined) {
    return (
      <RouteDialog title={title}>
        <FeatureForm />
      </RouteDialog>
    );
  }

  return (
    <RouteDrawer title={title}>
      <FeatureForm featurePointId={id} />
    </RouteDrawer>
  );
}

interface FeatureFormData {
  readonly dimensions: FeaturePoint[];
  readonly current: FeaturePoint | undefined;
  readonly members: ProblemMember[];
}

function FeatureForm({
  featurePointId,
}: {
  readonly featurePointId?: number;
}): ReactElement {
  const api = useApiClient();
  const resource = useAsyncResource<FeatureFormData>(
    `feature-form|${featurePointId === undefined ? 'new' : String(featurePointId)}`,
    async (signal) => {
      const [all, current, members] = await Promise.all([
        fetchFeaturePoints(api, signal),
        featurePointId === undefined
          ? Promise.resolve(undefined)
          : fetchFeaturePoint(api, featurePointId, signal),
        fetchMembers(api, signal),
      ]);
      return {
        dimensions: all.filter((item) => item.level === 'dimension'),
        current,
        members,
      };
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
    <FeatureFormFields
      dimensions={resource.data.dimensions}
      featurePointId={featurePointId}
      initial={resource.data.current}
      members={resource.data.members}
    />
  );
}

function FeatureFormFields({
  dimensions,
  featurePointId,
  initial,
  members,
}: {
  readonly dimensions: FeaturePoint[];
  readonly featurePointId?: number;
  readonly initial?: FeaturePoint;
  readonly members: readonly ProblemMember[];
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { close, isClosing } = useRouteOverlay();
  const [values, setValues] = useState<FormValues>(() => {
    if (initial !== undefined) {
      return valuesFrom(initial, members);
    }

    const created = emptyValues();
    const preset = searchParams.get('dimension');
    if (preset !== null && preset !== '') {
      created.parentId = preset;
    }
    return created;
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function update<K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(): Promise<void> {
    const name = values.name.trim();
    if (name === '') {
      setSaveError(t('testProgress.nameRequired'));
      return;
    }
    if (values.level === 'feature' && values.parentId === '') {
      setSaveError(t('testProgress.parentRequired'));
      return;
    }

    const payload: FeaturePointPayload = {
      name,
      ownerId: toNullableText(values.ownerId),
      status: values.status,
      skillsStatus: values.skillsStatus,
      docsStatus: values.docsStatus,
      exampleExists: values.exampleExists,
      exampleExpected: toNullableText(values.exampleExpected),
      exampleCurrent: toNullableText(values.exampleCurrent),
      designScore: toScore(values.designScore),
      designNote: toNullableText(values.designNote),
      developmentScore: toScore(values.developmentScore),
      developmentNote: toNullableText(values.developmentNote),
      agentFriendlinessScore: toScore(values.agentFriendlinessScore),
      agentFriendlinessNote: toNullableText(values.agentFriendlinessNote),
      outputQualityScore: toScore(values.outputQualityScore),
      outputQualityNote: toNullableText(values.outputQualityNote),
      remark: toNullableText(values.remark),
    };
    payload.parentId =
      values.level === 'dimension' ? null : Number(values.parentId);
    if (featurePointId === undefined) {
      payload.level = values.level;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (featurePointId === undefined) {
        await createFeaturePoint(api, payload);
      } else {
        await updateFeaturePoint(api, featurePointId, payload);
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
    if (featurePointId === undefined) return;
    if (!window.confirm(t('testProgress.confirmDeleteFeature'))) return;

    setDeleting(true);
    setSaveError(null);
    try {
      await deleteFeaturePoint(api, featurePointId);
      toast.success(t('testProgress.deleted'));
      await close();
      void navigate('/progress/features', { replace: true });
    } catch (error) {
      setSaveError(describeApiError(error));
    } finally {
      setDeleting(false);
    }
  }

  const dimensionOptions = dimensions.map((dimension) => ({
    value: String(dimension.id),
    label: dimension.name,
  }));

  return (
    <form
      className='space-y-6'
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className='space-y-4'>
        <h3 className='font-heading text-base font-semibold'>
          {t('testProgress.basicInfo')}
        </h3>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field label={t('testProgress.fieldName')} required>
            <Input
              required
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>
          {featurePointId === undefined ? (
            <Field label={t('testProgress.fieldLevel')}>
              <FormSelect
                options={[
                  { value: 'feature', label: t('testProgress.levelFeature') },
                  {
                    value: 'dimension',
                    label: t('testProgress.levelDimension'),
                  },
                ]}
                value={values.level}
                onValueChange={(value) => update('level', value)}
              />
            </Field>
          ) : null}
          <Field label={t('testProgress.fieldParent')}>
            <FormSelect
              disabled={values.level === 'dimension'}
              options={dimensionOptions}
              placeholder={t('testProgress.selectPlaceholder')}
              value={values.parentId}
              onValueChange={(value) => update('parentId', value)}
            />
          </Field>
          <Field label={t('testProgress.fieldOwner')}>
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
          </Field>
          <Field label={t('testProgress.fieldStatus')}>
            <FormSelect
              options={FEATURE_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.status.${status}`),
              }))}
              value={values.status}
              onValueChange={(value) => update('status', value)}
            />
          </Field>
        </div>
      </section>

      <section className='space-y-4'>
        <h3 className='font-heading text-base font-semibold'>
          {t('testProgress.entryCriteria')}
        </h3>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field
            hint={t('testProgress.hint.skills')}
            label={t('testProgress.fieldSkills')}
          >
            <FormSelect
              options={AVAILABILITY_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.availability.${status}`),
              }))}
              value={values.skillsStatus}
              onValueChange={(value) => update('skillsStatus', value)}
            />
          </Field>
          <Field
            hint={t('testProgress.hint.docs')}
            label={t('testProgress.fieldDocs')}
          >
            <FormSelect
              options={AVAILABILITY_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.availability.${status}`),
              }))}
              value={values.docsStatus}
              onValueChange={(value) => update('docsStatus', value)}
            />
          </Field>
          <Field label={t('testProgress.fieldExampleExists')}>
            <FormSelect
              options={EXAMPLE_EXISTS_STATUSES.map((status) => ({
                value: status,
                label: t(`testProgress.exampleExists.${status}`),
              }))}
              value={values.exampleExists}
              onValueChange={(value) => update('exampleExists', value)}
            />
          </Field>
        </div>
        <Field label={t('testProgress.fieldExampleExpected')}>
          <Textarea
            rows={3}
            value={values.exampleExpected}
            onChange={(event) => update('exampleExpected', event.target.value)}
          />
        </Field>
        <Field label={t('testProgress.fieldExampleCurrent')}>
          <Textarea
            rows={3}
            value={values.exampleCurrent}
            onChange={(event) => update('exampleCurrent', event.target.value)}
          />
        </Field>
      </section>

      <section className='space-y-4'>
        <h3 className='font-heading text-base font-semibold'>
          {t('testProgress.qualityScores')}
        </h3>
        <div className='grid gap-4 sm:grid-cols-2'>
          <ScoreField
            label={t('testProgress.scoreDesign')}
            note={values.designNote}
            score={values.designScore}
            onNoteChange={(value) => update('designNote', value)}
            onScoreChange={(value) => update('designScore', value)}
          />
          <ScoreField
            label={t('testProgress.scoreDevelopment')}
            note={values.developmentNote}
            score={values.developmentScore}
            onNoteChange={(value) => update('developmentNote', value)}
            onScoreChange={(value) => update('developmentScore', value)}
          />
          <ScoreField
            label={t('testProgress.scoreAgentFriendliness')}
            note={values.agentFriendlinessNote}
            score={values.agentFriendlinessScore}
            onNoteChange={(value) => update('agentFriendlinessNote', value)}
            onScoreChange={(value) => update('agentFriendlinessScore', value)}
          />
          <ScoreField
            label={t('testProgress.scoreOutputQuality')}
            note={values.outputQualityNote}
            score={values.outputQualityScore}
            onNoteChange={(value) => update('outputQualityNote', value)}
            onScoreChange={(value) => update('outputQualityScore', value)}
          />
        </div>
      </section>

      <section className='space-y-4'>
        <Field label={t('testProgress.fieldRemark')}>
          <Textarea
            rows={2}
            value={values.remark}
            onChange={(event) => update('remark', event.target.value)}
          />
        </Field>
      </section>

      {saveError !== null ? (
        <p className='text-sm text-destructive' role='alert'>
          {t('testProgress.saveFailed', { message: saveError })}
        </p>
      ) : null}

      <div className='flex flex-wrap justify-end gap-2 border-t border-border pt-4'>
        {featurePointId === undefined ? null : (
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
              console.error('Failed to close feature form', error);
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

function Field({
  hint,
  label,
  required,
  children,
}: {
  readonly hint?: string;
  readonly label: string;
  readonly required?: boolean;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <div className='space-y-2'>
      <Label>
        {label}
        {required ? <span className='text-destructive'> *</span> : null}
        {hint ? <FieldHint hint={hint} label={label} /> : null}
      </Label>
      {children}
    </div>
  );
}

function ScoreField({
  label,
  score,
  note,
  onScoreChange,
  onNoteChange,
}: {
  readonly label: string;
  readonly score: string;
  readonly note: string;
  readonly onScoreChange: (value: string) => void;
  readonly onNoteChange: (value: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='space-y-2 rounded-lg border border-border p-4'>
      <div className='flex items-center justify-between gap-3'>
        <Label>{label}</Label>
        <Input
          className='w-24'
          max={10}
          min={0}
          placeholder={t('testProgress.scorePlaceholder')}
          step={0.1}
          type='number'
          value={score}
          onChange={(event) => onScoreChange(event.target.value)}
        />
      </div>
      <Textarea
        placeholder={t('testProgress.notePlaceholder')}
        rows={3}
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
      />
    </div>
  );
}
