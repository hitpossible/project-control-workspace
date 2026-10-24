'use client';

import { useLocale } from 'next-intl';
import { setFormatLocale } from '@/lib/format';

/** Keeps the plain date / number formatters (src/lib/format.ts) on the current UI language. */
export function LocaleSync() {
  // set during render so children rendered in the same pass already format in the new language
  setFormatLocale(useLocale());
  return null;
}
