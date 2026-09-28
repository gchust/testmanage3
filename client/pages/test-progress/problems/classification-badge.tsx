import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { Problem } from '../api.js';

/**
 * Marks a feature point the factory chose before delivery (or its reason for
 * choosing none). It disappears once someone sets the feature point themselves.
 */
export function ClassificationBadge({
  classification,
}: {
  readonly classification: NonNullable<Problem['classification']>;
}): ReactElement {
  const { t } = useTranslation();
  const label = t(`testProgress.autoClassification.${classification.source}`);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={
              classification.note ? `${label}: ${classification.note}` : label
            }
            className='inline-flex cursor-help rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
            type='button'
          />
        }
      >
        <Badge variant='secondary'>{label}</Badge>
      </TooltipTrigger>
      <TooltipContent
        className='block max-w-80 text-left leading-5'
        role='tooltip'
      >
        <span className='block whitespace-pre-line'>
          {classification.note ?? t('testProgress.autoClassification.noNote')}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
