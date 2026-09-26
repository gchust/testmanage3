import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function LinkedReportPreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label={t('testProgress.reportPreview')} className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h3 className='font-heading font-medium'>
            {t('testProgress.reportPreview')}
          </h3>
          <p className='text-sm text-muted-foreground'>
            {t('testProgress.reportLinkHint')}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <a
            href={url}
            target='_blank'
            rel='noreferrer'
            className='inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline'
          >
            <ExternalLink aria-hidden='true' className='size-4' />
            {t('testProgress.reportOpenOriginal')}
          </a>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 aria-hidden='true' />
            ) : (
              <Maximize2 aria-hidden='true' />
            )}
            {t(
              expanded
                ? 'testProgress.reportReduce'
                : 'testProgress.reportExpand',
            )}
          </Button>
        </div>
      </div>
      <iframe
        title={t('testProgress.reportPreview')}
        src={url}
        sandbox=''
        referrerPolicy='no-referrer'
        className={cn(
          'w-full rounded-lg border border-border bg-background',
          expanded ? 'h-[85vh]' : 'h-[65vh]',
        )}
      />
    </section>
  );
}
