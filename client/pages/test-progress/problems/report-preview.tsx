import { reportPreviewDocument } from './report-preview-document.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { useAsyncResource } from '../use-async-resource.js';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Loading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ReportPreview({
  problemId,
  reportId,
}: {
  problemId: number;
  reportId: string;
}) {
  const api = useApiClient();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const resource = useAsyncResource<string>(
    'problem-report|' + problemId + '|' + reportId,
    async (signal) => {
      const stream = await api.stream({
        path: 'test-progress/problems/' + problemId + '/report',
        query: { path: 'report.html' },
        signal,
      });
      const html = await new Response(stream).text();
      return reportPreviewDocument(html);
    },
  );

  return (
    <section aria-label={t('testProgress.reportPreview')} className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h3 className='font-heading font-medium'>
            {t('testProgress.reportPreview')}
          </h3>
          <p className='text-sm text-muted-foreground'>
            {t('testProgress.reportPreviewHint')}
          </p>
        </div>
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
      {resource.error !== undefined ? (
        <div
          role='alert'
          className='space-y-3 rounded-lg border border-border p-4'
        >
          <p>{t('testProgress.reportPreviewError')}</p>
          <Button variant='outline' onClick={resource.reload}>
            {t('testProgress.reportRetry')}
          </Button>
        </div>
      ) : resource.data === undefined ? (
        <Loading />
      ) : (
        <iframe
          title={t('testProgress.reportPreview')}
          sandbox=''
          referrerPolicy='no-referrer'
          srcDoc={resource.data}
          className={cn(
            'w-full rounded-lg border border-border bg-background',
            expanded ? 'h-[85vh]' : 'h-[65vh]',
          )}
        />
      )}
    </section>
  );
}
