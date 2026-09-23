import { useTranslation } from '@nocobase/i18n/client';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import { Loading } from '@/components/loading';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { apiGuideUrl, writeClipboard } from './agent-prompt.js';
import { describeApiError } from '../api.js';
import { MarkdownContent } from '../markdown.js';
import { CopyForAiButton, ErrorPanel } from '../shared.js';
import { useAsyncResource } from '../use-async-resource.js';

/**
 * The API reference. The page renders the Markdown an Agent reads at
 * `/api-guide.md`, and the button copies a short prompt: connection details plus
 * that URL, so the Agent always reads the current document instead of a snapshot.
 */
export default function ApiGuidePage(): ReactElement {
  const { t } = useTranslation();
  const [urlCopied, setUrlCopied] = useState(false);
  const guide = useAsyncResource<string>('api-guide', async () => {
    const response = await fetch(apiGuideUrl());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  });

  async function copyText(text: string): Promise<boolean> {
    try {
      await writeClipboard(text);
      return true;
    } catch (error) {
      toast.error(
        t('testProgress.apiCopyFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  async function copyUrl(): Promise<void> {
    if (!(await copyText(apiGuideUrl()))) return;
    setUrlCopied(true);
    toast.success(t('testProgress.apiUrlCopied'));
    window.setTimeout(() => setUrlCopied(false), 2000);
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('testProgress.apiTitle')}
        description={t('testProgress.apiDescription')}
        actions={<CopyForAiButton />}
      />

      <Card>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm'>
            <span className='text-muted-foreground'>
              {t('testProgress.apiDocUrl')}
            </span>
            <code className='min-w-0 flex-1 truncate'>{apiGuideUrl()}</code>
            <Button
              size='sm'
              type='button'
              variant='outline'
              onClick={() => {
                void copyUrl();
              }}
            >
              {urlCopied ? (
                <Check aria-hidden='true' className='size-3.5' />
              ) : (
                <Copy aria-hidden='true' className='size-3.5' />
              )}
              {t('testProgress.apiCopyUrl')}
            </Button>
          </div>
          {guide.loading ? <Loading /> : null}
          {guide.error !== undefined ? (
            <ErrorPanel
              message={describeApiError(guide.error)}
              onRetry={guide.reload}
            />
          ) : null}
          {guide.data !== undefined ? (
            <MarkdownContent content={guide.data} />
          ) : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
