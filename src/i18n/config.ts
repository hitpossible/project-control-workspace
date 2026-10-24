export const locales = ['en', 'th'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** The chosen language is kept per browser in this cookie (no locale prefix in URLs) */
export const LOCALE_COOKIE = 'pcw.locale';

export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', th: 'ไทย' };

export const isLocale = (v: string | null | undefined): v is Locale => locales.includes(v as Locale);
