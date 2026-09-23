import { useTranslation } from '@nocobase/i18n/client';
import { Check, CircleHelp, Sparkles } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { buildAgentPrompt, writeClipboard } from './api/agent-prompt.js';
import type {
  AvailabilityStatus,
  CriteriaState,
  ExampleExistsStatus,
  FeatureStatus,
  ProblemStatus,
} from './api.js';
import {
  AVAILABILITY_DOT_CLASS,
  AVAILABILITY_TEXT_CLASS,
  CRITERIA_DOT_CLASS,
  CRITERIA_TEXT_CLASS,
  EXAMPLE_EXISTS_DOT_CLASS,
  EXAMPLE_EXISTS_TEXT_CLASS,
  FEATURE_STATUS_DOT_CLASS,
  FEATURE_STATUS_TEXT_CLASS,
  PROBLEM_STATUS_DOT_CLASS,
  PROBLEM_STATUS_TEXT_CLASS,
  scoreClass,
} from './constants.js';

export function FeatureStatusBadge({
  status,
}: {
  readonly status: FeatureStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DotLabel
      dotClass={FEATURE_STATUS_DOT_CLASS[status]}
      label={t(`testProgress.status.${status}`)}
      textClass={FEATURE_STATUS_TEXT_CLASS[status]}
    />
  );
}

/** Dot + colored text: no background, so the tinted cell stays the only fill. */
function DotLabel({
  dotClass,
  textClass,
  label,
}: {
  readonly dotClass: string;
  readonly textClass: string;
  readonly label: string;
}): ReactElement {
  return (
    <span className='inline-flex items-center gap-1.5 text-xs font-medium'>
      <span
        aria-hidden='true'
        className={cn('size-1.5 rounded-full', dotClass)}
      />
      <span className={textClass}>{label}</span>
    </span>
  );
}

/**
 * The derived criteria cell: availability/gaps come from the stored flag plus open
 * problems of the matching type, never from a manual completeness judgement.
 */
export function CriteriaBadge({
  openProblems = 0,
  state,
}: {
  readonly openProblems?: number;
  readonly state: CriteriaState;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DotLabel
      dotClass={CRITERIA_DOT_CLASS[state]}
      label={
        state === 'hasGaps'
          ? openProblems > 0
            ? t('testProgress.criteria.hasGapsCount', { count: openProblems })
            : t('testProgress.criteria.hasGaps')
          : t(`testProgress.criteria.${state}`)
      }
      textClass={CRITERIA_TEXT_CLASS[state]}
    />
  );
}

export function AvailabilityBadge({
  value,
}: {
  readonly value: AvailabilityStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DotLabel
      dotClass={AVAILABILITY_DOT_CLASS[value]}
      label={t(`testProgress.availability.${value}`)}
      textClass={AVAILABILITY_TEXT_CLASS[value]}
    />
  );
}

export function ExampleExistsBadge({
  value,
}: {
  readonly value: ExampleExistsStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DotLabel
      dotClass={EXAMPLE_EXISTS_DOT_CLASS[value]}
      label={t(`testProgress.exampleExists.${value}`)}
      textClass={EXAMPLE_EXISTS_TEXT_CLASS[value]}
    />
  );
}

export function ProblemStatusBadge({
  status,
}: {
  readonly status: ProblemStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DotLabel
      dotClass={PROBLEM_STATUS_DOT_CLASS[status]}
      label={t(`testProgress.problemStatus.${status}`)}
      textClass={PROBLEM_STATUS_TEXT_CLASS[status]}
    />
  );
}

export function ScoreValue({
  score,
}: {
  readonly score: number | null;
}): ReactElement {
  return (
    <span className={cn('font-semibold tabular-nums', scoreClass(score))}>
      {score === null ? '—' : score}
    </span>
  );
}

export interface FormSelectOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

export function FormSelect<TValue extends string>({
  id,
  value,
  options,
  onValueChange,
  placeholder,
  disabled,
  className,
}: {
  readonly id?: string;
  readonly value: TValue;
  readonly options: readonly FormSelectOption<TValue>[];
  readonly onValueChange: (value: TValue) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}): ReactElement {
  return (
    <Select
      disabled={disabled}
      items={[...options]}
      value={value}
      onValueChange={(next: TValue | null) => {
        if (typeof next === 'string') onValueChange(next);
      }}
    >
      <SelectTrigger className={cn('w-full', className)} id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ErrorPanel({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className='flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm'
      role='alert'
    >
      <p className='text-destructive'>
        {t('testProgress.loadFailed', { message })}
      </p>
      <Button size='sm' variant='outline' onClick={onRetry}>
        {t('testProgress.retry')}
      </Button>
    </div>
  );
}

export function EmptyPanel({
  message,
  children,
}: {
  readonly message: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className='flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground'>
      <p>{message}</p>
      {children}
    </div>
  );
}

export function DefinitionItem({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className='space-y-1'>
      <dt className='text-xs font-medium text-muted-foreground'>{label}</dt>
      <dd className='text-sm'>{children}</dd>
    </div>
  );
}

/**
 * Copies the Agent prompt (site, API base, authentication, the guide URL) so a
 * page's first action can be "hand this to an Agent" instead of a manual create
 * form. The tracker's pages are operated through the API by Agents; the create
 * routes stay reachable by URL for whoever needs them.
 */
export function CopyForAiButton(): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await writeClipboard(buildAgentPrompt());
      setCopied(true);
      toast.success(t('testProgress.apiCopied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error(
        t('testProgress.apiCopyFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return (
    <Button
      type='button'
      onClick={() => {
        void copy();
      }}
    >
      {copied ? (
        <Check aria-hidden='true' />
      ) : (
        <Sparkles aria-hidden='true' />
      )}
      {t('testProgress.interactWithAi')}
    </Button>
  );
}

/**
 * A help marker next to a field label or table header. It states the judgement
 * standard for the value, so everyone filling the field sees the same bar
 * (testing-statistics/field-rubric.md) instead of guessing what "有" means.
 */
export function FieldHint({
  label,
  hint,
}: {
  readonly label: string;
  readonly hint: string;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className='inline-flex cursor-help items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'
            type='button'
          />
        }
      >
        <CircleHelp aria-hidden='true' className='size-3.5' />
      </TooltipTrigger>
      <TooltipContent
        className='block max-w-80 text-left leading-5'
        role='tooltip'
      >
        <span className='block whitespace-pre-line'>{hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}
