import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface ReleaseRunLabels {
  readonly trigger: string;
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly busy: string;
  readonly cancel: string;
  readonly success: string;
  readonly error: string;
}

/**
 * Releases a factory run that holds its task or problem, after an explicit
 * confirmation. Build tasks and problem fixes share it; each passes its own
 * translated wording and release call.
 */
export function ReleaseRunButton({
  labels,
  onRelease,
}: {
  readonly labels: ReleaseRunLabels;
  /** Resolves once the server released the run; rejects when it refused. */
  readonly onRelease: () => Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function release(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await onRelease();
      setOpen(false);
      toast.success(labels.success);
    } catch {
      toast.error(labels.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size='sm'
        type='button'
        variant='outline'
        onClick={() => setOpen(true)}
      >
        {labels.trigger}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              variant='destructive'
              onClick={() => void release()}
            >
              {busy ? labels.busy : labels.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
