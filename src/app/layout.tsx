import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Figtree, Poppins, Sarabun } from 'next/font/google';
import { LocaleSync } from '@/i18n/LocaleSync';
import { ConfirmDialogHost } from '@/components/shared/ConfirmDialog';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree' });
const poppins = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-poppins' });
// Thai glyphs (Figtree / Poppins have none) — fallback after the Latin fonts in globals.css
const sarabun = Sarabun({ subsets: ['thai'], weight: ['400', '500', '600', '700'], variable: '--font-sarabun' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${figtree.variable} ${poppins.variable} ${sarabun.variable}`}>
      <body className="bg-app font-sans antialiased">
        {/* locale + messages come from src/i18n/request.ts */}
        <NextIntlClientProvider>
          <LocaleSync />
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <ConfirmDialogHost />
          <Toaster theme="light" position="bottom-center" richColors />
          {/* live notifications (useLiveNotifications): top-right, below the 56px header, plain white */}
          <Toaster id="live" theme="light" position="top-right" offset={{ top: 64, right: 16 }} visibleToasts={4} closeButton />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
