import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { Opt, OptList, OptNs } from '@/lib/constants';

/**
 * Labels for the option lists in src/lib/constants.ts (and other enum values) in the current UI language.
 * Messages: enums.<ns>.<value>; unknown values fall back to the raw value.
 */
export function useOptions() {
  const t = useTranslations('enums');
  return useMemo(() => {
    const text = (ns: OptNs, value: string | null | undefined) => {
      if (!value) return '-';
      const key = `${ns}.${value}` as Parameters<typeof t>[0];
      return t.has(key) ? t(key) : value;
    };
    const label = (list: OptList, value: string | null | undefined) => text(list.ns, value);
    /** list with labels — for selects, legends and filters */
    const options = (list: OptList): (Opt & { label: string })[] => list.map((o) => ({ ...o, label: text(list.ns, o.value) }));
    return { text, label, options };
  }, [t]);
}

export type OptionLabels = ReturnType<typeof useOptions>;
