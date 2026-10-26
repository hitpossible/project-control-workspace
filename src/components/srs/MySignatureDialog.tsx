'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MySignature from './MySignature';

/** "My signature" in a dialog, for when signing an SRS needs one first (the profile page has the same editor) */
export default function MySignatureDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations('srs.signature');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <MySignature active={open}
          onSaved={() => { onSaved?.(); onClose(); }}
          actions={<Button variant="outline" onClick={onClose}>{t('close')}</Button>} />
      </DialogContent>
    </Dialog>
  );
}
