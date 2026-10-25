import { FileQuestion, Home } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Unknown URLs and notFound() — rendered in the root layout, outside the app shell */
export default async function NotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileQuestion className="size-6" /></span>
      <h1 className="mb-1 text-lg font-semibold">{t('title')}</h1>
      <p className="mb-5 max-w-md text-sm text-muted-foreground">{t('text')}</p>
      <Button asChild><Link href="/"><Home /> {t('home')}</Link></Button>
    </main>
  );
}
