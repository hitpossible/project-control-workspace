'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setLocale } from '@/i18n/actions';
import { LOCALE_NAMES, locales } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/shared/Tip';

/** TH / EN toggle — saves the choice in a cookie; the page re-renders with the new messages */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const current = useLocale();
  const [pending, start] = useTransition();

  const change = (l: string) => {
    if (l === current) return;
    // setting the cookie in a Server Action re-renders the page with the new messages
    start(() => setLocale(l));
  };

  return (
    <Tip title={t('language')}>
      <div role="group" aria-label={t('language')} className={cn('flex items-center gap-0.5 rounded-full border bg-white p-0.5 text-xs', pending && 'opacity-60', className)}>
        <Languages className="mx-1 size-3.5 text-muted-foreground" />
        {locales.map((l) => (
          <button key={l} type="button" onClick={() => change(l)} disabled={pending} aria-pressed={l === current} title={LOCALE_NAMES[l]}
            className={cn('rounded-full px-2 py-0.5 font-medium uppercase transition-colors', l === current ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
            {l}
          </button>
        ))}
      </div>
    </Tip>
  );
}
