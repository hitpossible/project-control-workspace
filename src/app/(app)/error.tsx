'use client';

import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Catches render errors in a page so the app shell (menu, header) stays usable */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('common.error');
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String(error.digest) : null;
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-[#fdebee] text-[#d83a52]"><AlertTriangle className="size-6" /></span>
      <h1 className="mb-1 text-lg font-semibold">{t('title')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('text')}</p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}><RotateCcw /> {t('retry')}</Button>
        <Button variant="outline" asChild><Link href="/"><Home /> {t('home')}</Link></Button>
      </div>
      {digest && <p className="mt-4 font-mono text-xs text-muted-foreground">{digest}</p>}
    </div>
  );
}
