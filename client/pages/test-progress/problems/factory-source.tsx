import { useTranslation } from '@nocobase/i18n/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from '../../evaluations/shared.js';
import type { Problem } from '../api.js';

export function FactorySource({
  source,
  problemId,
}: {
  source: NonNullable<Problem['factorySource']>;
  problemId: number;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('testProgress.factorySourceTitle')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-muted-foreground'>{source.taskTitle}</p>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            render={
              <a href={source.issueUrl} target='_blank' rel='noreferrer' />
            }
          >
            {t('testProgress.factoryIssue')}
          </Button>
          {source.pullRequestUrl ? (
            <Button
              variant='outline'
              size='sm'
              render={
                <a
                  href={source.pullRequestUrl}
                  target='_blank'
                  rel='noreferrer'
                />
              }
            >
              {t('testProgress.factoryPullRequest')}
            </Button>
          ) : (
            <span className='text-sm text-muted-foreground'>
              {t('testProgress.factoryNoPullRequest')}
            </span>
          )}
          <Button
            variant='outline'
            size='sm'
            render={<a href={source.runUrl} target='_blank' rel='noreferrer' />}
          >
            {t('testProgress.factoryRun')}
          </Button>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Download
            problemId={problemId}
            reportId={source.reportId}
            file='bundle.zip'
          >
            {t('evaluations.downloadBundle')}
          </Download>
          {source.files.includes('report.html') && (
            <Download
              problemId={problemId}
              reportId={source.reportId}
              file='report.html'
            >
              {t('evaluations.downloadHtml')}
            </Download>
          )}
          <Download
            problemId={problemId}
            reportId={source.reportId}
            file='evaluation.json'
          >
            {t('evaluations.downloadJson')}
          </Download>
        </div>
      </CardContent>
    </Card>
  );
}
