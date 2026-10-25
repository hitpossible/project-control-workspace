'use client';

import { Bug, ClipboardList, CornerDownLeft, LayoutDashboard, ListChecks, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BUG_STATUSES, PROJECT_STATUSES, REQUEST_STATUSES, TASK_STATUSES, type OptList } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/labels';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

type Hit = { type: 'project' | 'request' | 'task' | 'bug'; id: number; title: string; code: string | null; subtitle: string | null; status: string; link: string };
export type QuickLink = { href: string; label: string; icon: React.ReactNode };

/** headings: search.group.<type> */
const GROUPS: { type: Hit['type']; icon: React.ReactNode; statuses: OptList }[] = [
  { type: 'project', icon: <LayoutDashboard />, statuses: PROJECT_STATUSES },
  { type: 'request', icon: <ClipboardList />, statuses: REQUEST_STATUSES },
  { type: 'task', icon: <ListChecks />, statuses: TASK_STATUSES },
  { type: 'bug', icon: <Bug />, statuses: BUG_STATUSES },
];

/** Header search button + Ctrl/⌘ K palette: projects, requests, tasks, bugs (server-side, permission filtered) and pages */
export default function GlobalSearch({ pages }: { pages: QuickLink[] }) {
  const t = useTranslations('search');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // debounced server search; stale responses are ignored
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const { data } = await dbClient().rpc<Hit[]>('global_search', { q: text });
      if (!live) return;
      setHits(data ?? []);
      setLoading(false);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    setHits([]);
    router.push(href);
  };

  const text = q.trim();
  const shownHits = text.length >= 2 ? hits : [];
  const shownPages = pages.filter((p) => !text || p.label.toLowerCase().includes(text.toLowerCase()));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-white px-3 text-sm text-muted-foreground hover:border-primary/40"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">{t('button')}</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }} title={t('title')} description={t('description')} className="sm:max-w-2xl">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('placeholder')} />
          <CommandList className="max-h-[60vh]">
            {text.length >= 2 && !loading && shownHits.length === 0 && shownPages.length === 0 && <CommandEmpty>{t('noResults', { text })}</CommandEmpty>}
            {text.length >= 2 && loading && shownHits.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">{t('searching')}</div>}
            {GROUPS.map((g) => {
              const items = shownHits.filter((h) => h.type === g.type);
              if (!items.length) return null;
              return (
                <CommandGroup key={g.type} heading={t(`group.${g.type}`)}>
                  {items.map((h) => (
                    <CommandItem key={h.id} value={`${h.type}:${h.id}`} onSelect={() => go(h.link)} className="gap-3 [&_svg]:text-muted-foreground">
                      {g.icon}
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {h.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{h.code}</span>}
                          {h.title}
                        </div>
                        {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                      </div>
                      <StatusChip list={g.statuses} value={h.status} className="h-6 min-w-24 text-xs" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {shownPages.length > 0 && (
              <CommandGroup heading={t('goToPage')}>
                {shownPages.map((p) => (
                  <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)} className="gap-3 [&_svg]:text-muted-foreground">
                    {p.icon}<span className="flex-1">{p.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className={cn('flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground')}>
            <span><kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> {t('keyMove')}</span>
            <span className="flex items-center gap-1"><kbd className="rounded border px-1"><CornerDownLeft className="inline size-3" /></kbd> {t('keyOpen')}</span>
            <span><kbd className="rounded border px-1">Esc</kbd> {t('keyClose')}</span>
            <span className="ml-auto">{t('permissionNote')}</span>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
