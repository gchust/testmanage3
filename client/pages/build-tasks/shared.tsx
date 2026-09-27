import { useApiClient } from '@nocobase/app-client';
import { useTaskPermission } from './use-task-permission.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { triggerTask } from './api.js';

export function TaskStatus({ status }: { status?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={
        status === 'failed' || status === 'dispatch_failed'
          ? 'destructive'
          : 'secondary'
      }
    >
      {t(`buildTasks.status.${status || 'draft'}`)}
    </Badge>
  );
}
export function RunButton({
  taskId,
  active,
  configured,
  onRun,
}: {
  taskId: string;
  active: boolean;
  configured: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const permission = useTaskPermission('run');
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const requestKeyRef = useRef<string | null>(null);
  if (!permission.can) return null;
  async function run() {
    if (busy) return;
    setBusy(true);
    requestKeyRef.current ??= crypto.randomUUID();
    try {
      const result = await triggerTask(api, taskId, requestKeyRef.current);
      requestKeyRef.current = null;
      setOpen(false);
      onRun();
      if (result.status === 'dispatch_failed')
        toast.error(t('buildTasks.dispatchFailed'));
      else if (result.status === 'dispatch_unknown')
        toast.warning(t('buildTasks.dispatchUnknown'));
      else toast.success(t('buildTasks.submitted'));
    } catch {
      toast.error(t('buildTasks.submitError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size='sm'
        disabled={active || !configured || busy}
        onClick={() => setOpen(true)}
      >
        <Play aria-hidden='true' />
        {t(active ? 'buildTasks.running' : 'buildTasks.run')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('buildTasks.confirmRun')}</DialogTitle>
          <DialogDescription>
            {t('buildTasks.runDescription')}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t('buildTasks.cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void run()}>
              {t(busy ? 'buildTasks.submitting' : 'buildTasks.run')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SafeLink({
  url,
  children,
}: {
  url?: string | null;
  children: React.ReactNode;
}) {
  if (!url || !/^https:\/\//.test(url)) return null;
  return (
    <a
      className='text-primary underline underline-offset-4'
      href={url}
      target='_blank'
      rel='noopener noreferrer'
    >
      {children}
    </a>
  );
}
