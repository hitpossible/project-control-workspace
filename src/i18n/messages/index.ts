import type { Locale } from '../config';
import type en from './en';

export type Messages = typeof en;

const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import('./en'),
  th: () => import('./th'),
};

export const loadMessages = async (locale: Locale) => (await loaders[locale]()).default;
