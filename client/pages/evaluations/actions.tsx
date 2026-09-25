import { useAction, useEvaluationData } from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactNode } from 'react';
import {
  TrackerOptionsContext,
  useTrackerOptions,
  useTrackerOptionsResource,
} from './tracker-options.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Choice,
  LoadState,
  type FindingState,
  type Mapping,
} from './shared.js';

export function MappingForm({
  source,
  subjectKey,
  mapping,
  reload,
}: {
  source: string;
  subjectKey: string;
  mapping?: Mapping;
  reload: () => void;
}) {
  const { t } = useTranslation(),
    options = useTrackerOptions(),
    action = useAction(reload);
  const [feature, setFeature] = useState(
    mapping ? String(mapping.featurePointId) : '',
  );
  return (
    <form
      className='flex flex-wrap items-end gap-2'
      onSubmit={(e) => {
        e.preventDefault();
        void action.submit('mappings', {
          sourceInstance: source,
          subjectKey,
          featurePointId: Number(feature),
        });
      }}
    >
      <div className='min-w-48 flex-1'>
        <Choice
          label={t('evaluations.featurePoint')}
          value={feature}
          onChange={setFeature}
          disabled={options.loading || action.busy}
          options={(options.data?.features ?? []).map((f) => ({
            value: String(f.id),
            label: f.name,
          }))}
        />
      </div>
      <Button size='sm' disabled={!feature || action.busy} type='submit'>
        {t('evaluations.map')}
      </Button>
      {options.error ? (
        <span role='alert'>{t('evaluations.loadError')}</span>
      ) : null}
    </form>
  );
}

export function FindingForm({
  state,
  reload,
}: {
  state: FindingState;
  reload: () => void;
}) {
  const { t } = useTranslation(),
    options = useTrackerOptions(),
    action = useAction(reload);
  const [problem, setProblem] = useState(
    state.problemId === null ? 'none' : String(state.problemId),
  );
  const [status, setStatus] = useState(state.status),
    [note, setNote] = useState(state.note ?? '');
  return (
    <form
      className='space-y-3 border-t border-border pt-4'
      onSubmit={(e) => {
        e.preventDefault();
        void action.submit(
          'findings/' + state.id,
          {
            problemId: problem === 'none' ? null : Number(problem),
            status,
            note,
          },
          'PATCH',
        );
      }}
    >
      <div className='grid gap-3 md:grid-cols-2'>
        <Choice
          label={t('evaluations.linkProblem')}
          value={problem}
          onChange={setProblem}
          disabled={action.busy || options.loading}
          options={[
            { value: 'none', label: t('evaluations.unlinked') },
            ...(options.data?.problems ?? []).map((p) => ({
              value: String(p.id),
              label: '#' + p.id + ' ' + p.title,
            })),
          ]}
        />
        <Choice
          label={t('evaluations.disposition')}
          value={status}
          onChange={setStatus}
          disabled={action.busy}
          options={['new', 'confirmed', 'ignored'].map((value) => ({
            value,
            label: t('evaluations.states.' + value),
          }))}
        />
      </div>
      <Textarea
        aria-label={t('evaluations.humanNote')}
        placeholder={t('evaluations.humanNote')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={10000}
      />
      <Button size='sm' type='submit' disabled={action.busy}>
        {t('evaluations.saveReview')}
      </Button>
    </form>
  );
}

export function RegressionForm({
  reportId,
  evidenceIds,
  reload,
}: {
  reportId: string;
  evidenceIds: string[];
  reload: () => void;
}) {
  const { t } = useTranslation(),
    options = useTrackerOptions(),
    action = useAction(reload);
  const [problem, setProblem] = useState(''),
    [verdict, setVerdict] = useState('inconclusive'),
    [evidence, setEvidence] = useState(''),
    [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('evaluations.recordRegression')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-3'
          onSubmit={(e) => {
            e.preventDefault();
            void action.submit('regressions', {
              problemId: Number(problem),
              reportId,
              verdict,
              evidenceIds: evidence ? [evidence] : [],
              note,
            });
          }}
        >
          <p className='text-sm text-muted-foreground'>
            {t('evaluations.regressionHint')}
          </p>
          <div className='grid gap-3 md:grid-cols-3'>
            <Choice
              label={t('evaluations.linkProblem')}
              value={problem}
              onChange={setProblem}
              options={(options.data?.problems ?? []).map((p) => ({
                value: String(p.id),
                label: '#' + p.id + ' ' + p.title,
              }))}
            />
            <Choice
              label={t('evaluations.verdict')}
              value={verdict}
              onChange={setVerdict}
              options={['passed', 'failed', 'inconclusive'].map((value) => ({
                value,
                label: t('evaluations.states.' + value),
              }))}
            />
            <Choice
              label={t('evaluations.evidence')}
              value={evidence}
              onChange={setEvidence}
              options={evidenceIds.map((value) => ({ value, label: value }))}
            />
          </div>
          <Textarea
            aria-label={t('evaluations.humanNote')}
            placeholder={t('evaluations.humanNote')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={10000}
            required
          />
          <Button
            type='submit'
            disabled={action.busy || !problem || !note.trim()}
          >
            {t('evaluations.recordRegression')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface Source {
  id: string;
  name: string;
  sourceInstance: string;
  project: string;
  enabled: boolean;
}
export function SourcesPanel() {
  const { t } = useTranslation(),
    resource = useEvaluationData<Source[]>('sources'),
    action = useAction(resource.reload);
  const [name, setName] = useState('nb3-factory'),
    [source, setSource] = useState('gchust/nb3-factory'),
    [project, setProject] = useState('gchust/nb3-factory'),
    [token, setToken] = useState('');
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations.createSource')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='mb-4 text-sm text-muted-foreground'>
            {t('evaluations.sourceHint')}
          </p>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              void action
                .submit<Source & { token: string }>('sources', {
                  name,
                  sourceInstance: source,
                  project,
                })
                .then((result) => {
                  if (result) setToken(result.token);
                });
            }}
          >
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label htmlFor='integration-name'>
                  {t('evaluations.name')}
                </Label>
                <Input
                  id='integration-name'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='integration-source'>
                  {t('evaluations.source')}
                </Label>
                <Input
                  id='integration-source'
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  required
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='integration-project'>
                  {t('evaluations.project')}
                </Label>
                <Input
                  id='integration-project'
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type='submit' disabled={action.busy}>
              {t('evaluations.createSource')}
            </Button>
          </form>
          {token && (
            <div className='mt-4 space-y-2'>
              <Label htmlFor='integration-token'>
                {t('evaluations.tokenOnce')}
              </Label>
              <Input id='integration-token' readOnly value={token} />
              <Button variant='outline' onClick={() => setToken('')}>
                {t('evaluations.dismissToken')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <LoadState loading={resource.loading} error={resource.error}>
        {resource.data?.map((s) => (
          <Card key={s.id}>
            <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-6'>
              <div>
                <p className='font-medium'>{s.name}</p>
                <p className='text-sm text-muted-foreground'>
                  {s.sourceInstance} · {s.project}
                </p>
              </div>
              <Button
                variant='outline'
                disabled={!s.enabled || action.busy}
                onClick={() =>
                  void action.submit('sources/' + s.id, undefined, 'DELETE')
                }
              >
                {t(s.enabled ? 'evaluations.revoke' : 'evaluations.revoked')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </LoadState>
    </div>
  );
}

export function TrackerOptionsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const options = useTrackerOptionsResource(enabled);
  return (
    <TrackerOptionsContext.Provider value={options}>
      {children}
    </TrackerOptionsContext.Provider>
  );
}
