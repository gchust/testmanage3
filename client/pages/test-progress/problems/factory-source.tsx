import { useTranslation } from '@nocobase/i18n/client';
import { ExternalLink, FileDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportDownload } from './report-download.js';
import type { Problem } from '../api.js';
import { ReportPreview } from './report-preview.js';
import { LinkedReportPreview } from './linked-report-preview.js';

type Source = NonNullable<Problem['factorySource']>;

export function FactoryLinks({
  source,
  compact = false,
}: {
  source: Source;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const links = [
    { label: t('testProgress.factoryIssue'), url: source.issueUrl, empty: '' },
    {
      label: t('testProgress.factoryPullRequest'),
      url: source.pullRequestUrl,
      empty: t('testProgress.factoryNoPullRequest'),
    },
    {
      label: t('testProgress.factoryEnvironment'),
      url: source.environmentUrl,
      empty: t('testProgress.factoryNoEnvironment'),
    },
  ];
  return (
    <div
      className={
        compact
          ? 'mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm'
          : 'grid gap-4 border-t border-border pt-4 sm:grid-cols-3'
      }
    >
      {links.map(({ label, url, empty }) => (
        <div key={label} className='min-w-0'>
          {!compact && (
            <p className='mb-1 text-sm text-muted-foreground'>{label}</p>
          )}
          {url ? (
            <a
              aria-label={label}
              href={url}
              title={url}
              target='_blank'
              rel='noreferrer'
              className='inline-flex max-w-full items-center gap-1.5 break-all text-sm font-medium text-primary underline-offset-4 hover:underline'
            >
              <ExternalLink aria-hidden='true' className='size-3.5 shrink-0' />
              {compact ? label : url.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className='text-sm text-muted-foreground'>
              {compact ? label + ' · ' + empty : empty}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function FactorySource({
  source,
  problemId,
}: {
  source: Source;
  problemId: number;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('testProgress.factorySourceTitle')}</CardTitle>
        <p className='text-sm text-muted-foreground'>{source.taskTitle}</p>
      </CardHeader>
      <CardContent className='space-y-5'>
        {source.reportUrl ? (
          <LinkedReportPreview url={source.reportUrl} />
        ) : source.files.includes('report.html') ? (
          <ReportPreview problemId={problemId} reportId={source.reportId} />
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('testProgress.reportNoHtml')}
          </p>
        )}
        <div className='flex flex-wrap items-center gap-4 border-t border-border pt-4'>
          <a
            href={source.runUrl}
            target='_blank'
            rel='noreferrer'
            className='inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline'
          >
            <ExternalLink aria-hidden='true' className='size-4' />
            {t('testProgress.factoryRun')}
          </a>
          <details className='w-full'>
            <summary className='flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground'>
              <FileDown aria-hidden='true' className='size-4' />
              {t('testProgress.reportDownloads')}
            </summary>
            <div className='mt-3 flex flex-wrap gap-2'>
              {source.hasArchive !== false && (
                <ReportDownload problemId={problemId} file='bundle.zip'>
                  {t('testProgress.downloadBundle')}
                </ReportDownload>
              )}
              {source.files.includes('report.html') && (
                <ReportDownload problemId={problemId} file='report.html'>
                  {t('testProgress.downloadHtml')}
                </ReportDownload>
              )}
              <ReportDownload problemId={problemId} file='evaluation.json'>
                {t('testProgress.downloadJson')}
              </ReportDownload>
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
