import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EvaluationReport } from '../../server-contracts/evaluations.js';

export function LoadState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <p role='status' className='text-muted-foreground'>
        {t('status.loading')}
      </p>
    );
  if (error)
    return (
      <p role='alert' className='text-destructive'>
        {t('evaluations.loadError')}
      </p>
    );
  return <>{children}</>;
}
export function Status({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  return (
    <Badge variant='outline'>
      {value
        ? t('evaluations.states.' + value, { defaultValue: value })
        : t('evaluations.unknown')}
    </Badge>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className='w-full'>
        <SelectValue>
          {options.find((o) => o.value === value)?.label ?? label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Download({
  reportId,
  file,
  children,
}: {
  reportId: string;
  file: string;
  children: ReactNode;
}) {
  const api = useApiClient(),
    { t } = useTranslation();
  async function download() {
    try {
      const stream = await api.stream({
        path: 'evaluations/reports/' + encodeURIComponent(reportId) + '/file',
        query: { path: file },
      });
      const blob = await new Response(stream).blob();
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = file.split('/').at(-1) ?? 'evaluation';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t('evaluations.loadError'));
    }
  }
  return (
    <Button variant='outline' size='sm' onClick={() => void download()}>
      {children}
    </Button>
  );
}
export type ReportSummary = {
  id: string;
  title: string | null;
  sourceInstance: string;
  subjectKey: string;
  revision: number;
  createdAt: string;
  receivedAt: string;
  outcome: {
    execution: string;
    acceptance: string | null;
    delivery: string | null;
  };
  review: string | null;
  tokens: EvaluationReport['metrics']['usage']['totals'] | null;
};
export type Capability = { read: boolean; review: boolean; manage: boolean };
export type Mapping = {
  id: string;
  sourceInstance: string;
  subjectKey: string;
  featurePointId: number;
};
export type FindingState = {
  id: string;
  findingId: string;
  problemId: number | null;
  status: string;
  note: string | null;
};
