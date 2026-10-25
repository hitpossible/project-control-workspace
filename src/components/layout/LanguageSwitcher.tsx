'use client';

import { ChevronDown, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setLocale } from '@/i18n/actions';
import { LOCALE_NAMES, isLocale, locales } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/shared/Tip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Current locale + a change handler that saves the choice in a cookie; the page re-renders with the new messages */
function useLocaleChange() {
  const current = useLocale();
  const [pending, start] = useTransition();
  const change = (l: string) => {
    if (l === current) return;
    // setting the cookie in a Server Action re-renders the page with the new messages
    start(() => setLocale(l));
  };
  return { current, pending, change };
}

function LocaleOptions({ current, pending, change }: ReturnType<typeof useLocaleChange>) {
  return (
    <DropdownMenuRadioGroup value={current} onValueChange={change}>
      {locales.map((l) => (
        <DropdownMenuRadioItem key={l} value={l} disabled={pending}>
          <span className="w-6 text-xs font-medium text-muted-foreground uppercase">{l}</span>
          {LOCALE_NAMES[l]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Language dropdown — a compact pill showing the current language that opens a list of choices */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const state = useLocaleChange();

  return (
    <DropdownMenu>
      <Tip title={t('language')}>
        <DropdownMenuTrigger aria-label={t('language')} disabled={state.pending}
          className={cn('flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-muted', state.pending && 'opacity-60', className)}>
          <Languages className="size-3.5 text-muted-foreground" />
          <span className="uppercase">{state.current}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-40">
        <LocaleOptions {...state} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same choices as a submenu, for use inside another dropdown (e.g. the user menu on small screens) */
export function LanguageSubmenu({ className }: { className?: string }) {
  const t = useTranslations('common');
  const state = useLocaleChange();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={className}>
        <Languages /> {t('language')}
        <span className="flex-1 text-right text-xs text-muted-foreground">{isLocale(state.current) ? LOCALE_NAMES[state.current] : state.current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-40">
        <LocaleOptions {...state} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
