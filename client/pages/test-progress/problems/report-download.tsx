import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ReportDownload({
  problemId,
  file,
  children,
}: {
  problemId: number;
  file: string;
  children: ReactNode;
}) {
  const api = useApiClient(),
    { t } = useTranslation();
  async function download() {
    try {
      const stream = await api.stream({
        path: 'test-progress/problems/' + problemId + '/report',
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
      toast.error(t('testProgress.reportPreviewError'));
    }
  }
  return (
    <Button variant='outline' size='sm' onClick={() => void download()}>
      {children}
    </Button>
  );
}
