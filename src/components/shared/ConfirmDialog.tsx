'use client';

import { AlertTriangleIcon, HelpCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** red styling for deletes / cancellations */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

/** Styled replacement for window.confirm — resolves true when the user confirms. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(opts.title));
    show({ ...opts, resolve });
  });
}

/** Mount once near the app root. */
export function ConfirmDialogHost() {
  const t = useTranslations('common');
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    show = (p) => {
      setPending((prev) => { prev?.resolve(false); return p; });
      setOpen(true);
    };
    return () => { show = null; };
  }, []);

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    // keep content until the close animation finishes
    setPending((p) => (p ? { ...p, resolve: () => {} } : p));
    setOpen(false);
  };

  const Icon = pending?.destructive ? AlertTriangleIcon : HelpCircleIcon;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className={cn(pending?.destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            <Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.description && <AlertDialogDescription>{pending.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{pending?.cancelText ?? t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={pending?.destructive ? 'destructive' : 'default'}
            onClick={() => settle(true)}
          >
            {pending?.confirmText ?? t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
