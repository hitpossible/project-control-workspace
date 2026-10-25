'use client';

import { Bell, CalendarDays, Award, ClipboardList, FileBarChart, Gauge, Home, LayoutDashboard, Lightbulb, LineChart, ListChecks, LogOut, Menu, MonitorX, PanelLeftClose, PanelLeftOpen, ShieldCheck, Signature } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { ROLES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useApp } from '@/providers/AppProvider';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import GlobalSearch from './GlobalSearch';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SuccessBurst } from '@/components/shared/motion';
import { Person } from '@/components/shared/labels';
import { Tip } from '@/components/shared/Tip';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import MySignatureDialog from '@/components/srs/MySignatureDialog';

/** Product logo (public/brand/logo.png, 841 × 530 — keep this ratio) */
export function BrandMark({ size = 26 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- small static logo, no optimisation needed
  return <img src="/brand/logo.png" alt="Project Control" width={Math.round((size * 841) / 530)} height={size} className="max-w-none shrink-0" style={{ height: size, width: 'auto' }} />;
}

export function Brand() {
  const t = useTranslations('nav');
  return (
    <Link href="/" className="flex items-center gap-2" aria-label={t('homeAria')}>
      <BrandMark />
      <span className="font-heading text-lg tracking-tight text-foreground">project control</span>
    </Link>
  );
}

type NavItem = { href: string; label: string; icon: React.ReactNode; show: boolean; count?: number };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const { label } = useOptions();
  const { me, hasRole, isStaff, unread, pendingApprovals, signOut } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signature, setSignature] = useState(false);
  const [animate, setAnimate] = useState(false); // only animate user toggles, not the restore on load

  // remember the sidebar state per browser
  useEffect(() => {
    setCollapsed(localStorage.getItem('pcw.sidebar') === 'collapsed');
  }, []);
  const toggle = () => {
    setAnimate(true);
    setCollapsed((c) => {
      localStorage.setItem('pcw.sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };

  const main: NavItem[] = [
    { href: '/', label: t('home'), icon: <Home />, show: true },
    { href: '/my-tasks', label: t('myWork'), icon: <ListChecks />, show: isStaff },
    { href: '/notifications', label: t('notifications'), icon: <Bell />, show: true, count: unread },
  ];
  const workspace: NavItem[] = [
    { href: '/requests', label: t('requests'), icon: <ClipboardList />, show: true, count: pendingApprovals },
    { href: '/projects', label: t('projects'), icon: <LayoutDashboard />, show: true },
    { href: '/management', label: t('management'), icon: <LineChart />, show: isStaff || hasRole('management_view') },
    { href: '/workforce', label: t('workforce'), icon: <CalendarDays />, show: isStaff },
    { href: '/skills', label: t('skills'), icon: <Award />, show: isStaff },
  ];
  const intelligence: NavItem[] = [
    { href: '/kpi', label: t('kpi'), icon: <Gauge />, show: isStaff || hasRole('management_view') },
    { href: '/insights', label: t('insights'), icon: <Lightbulb />, show: true },
    { href: '/reports', label: t('reports'), icon: <FileBarChart />, show: true },
    { href: '/admin', label: t('admin'), icon: <ShieldCheck />, show: hasRole('admin') },
  ];
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  // page content eases in on every route change (not on first load)
  const content = useRef<HTMLDivElement>(null);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    content.current?.animate(
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
  }, [pathname]);

  const item = (n: NavItem, mini: boolean) => {
    const link = (
      <Link
        key={n.href}
        href={n.href}
        onClick={() => setOpen(false)}
        aria-label={n.label}
        aria-current={isActive(n.href) ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-2.5 rounded py-1.5 text-sm text-foreground transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          mini ? 'justify-center px-0' : 'px-2.5',
          // the active background is the sliding <NavIndicator>
          isActive(n.href) ? 'font-medium' : 'hover:bg-sidebar-accent',
        )}
      >
        {n.icon}
        {!mini && <span className="flex-1 truncate">{n.label}</span>}
        {!!n.count && (mini
          ? <span className="absolute top-0.5 right-1.5 size-2 rounded-full bg-[#e2445c]" />
          : <span className="rounded-full bg-[#e2445c] px-1.5 text-[11px] leading-[18px] font-semibold text-white">{n.count > 99 ? '99+' : n.count}</span>)}
      </Link>
    );
    return mini ? <Tip key={n.href} side="right" title={n.count ? `${n.label} (${n.count})` : n.label}>{link}</Tip> : link;
  };

  const nav = (mini: boolean) => {
    const group = (title: string, items: NavItem[]) => (
      <>
        <div className={cn('my-2 border-t border-border', mini ? 'mx-3' : 'mx-4')} />
        {!mini && <div className="truncate px-5 pb-1 text-[13px] text-muted-foreground">{title}</div>}
        <div className={cn('space-y-0.5', mini ? 'px-2' : 'px-3')}>{items.filter((n) => n.show).map((n) => item(n, mini))}</div>
      </>
    );
    return (
      <nav className="relative flex h-full flex-col overflow-x-hidden overflow-y-auto">
        <NavIndicator active={pathname} mini={mini} />
        <div className={cn('space-y-0.5', mini ? 'px-2' : 'px-3')}>{main.filter((n) => n.show).map((n) => item(n, mini))}</div>
        {group(t('groupWorkspace'), workspace)}
        {group(t('groupIntelligence'), intelligence)}
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-app">
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-3 bg-app px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu /></Button>
        <div className="lg:hidden"><Brand /></div>
        {collapsed ? (
          <Tip side="right" title={t('expandSidebar')}>
            <button type="button" onClick={toggle} aria-label={t('expandSidebar')}
              className="group relative hidden h-9 w-10 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent lg:flex">
              <span className="transition-opacity group-hover:opacity-0"><BrandMark size={22} /></span>
              <PanelLeftOpen className="absolute size-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </Tip>
        ) : (
          <div className="hidden w-[14.5rem] shrink-0 items-center justify-between gap-2 lg:flex">
            <Brand />
            <Tip side="bottom" title={t('collapseSidebar')}>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={toggle} aria-label={t('collapseSidebar')}>
                <PanelLeftClose className="size-4.5" />
              </Button>
            </Tip>
          </div>
        )}
        <div className="flex flex-1 justify-center px-2 md:px-6">
          <GlobalSearch pages={[...main, ...workspace, ...intelligence].filter((n) => n.show).map(({ href, label, icon }) => ({ href, label, icon }))} />
        </div>
        <LanguageSwitcher className="hidden sm:flex" />
        <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={t('notifications')} onClick={() => router.push('/notifications')}>
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-[#e2445c] px-1 text-[10px] leading-4 font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full p-0.5 outline-none hover:bg-sidebar-accent">
            <Person name={me?.full_name} showName={false} size={32} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="font-normal">
              <div className="font-semibold">{me?.full_name}</div>
              <div className="text-xs text-muted-foreground">{me?.email} · {me?.department}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {me?.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{label(ROLES, r)}</span>)}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <LanguageSwitcher className="mx-2 my-1 w-fit sm:hidden" />
            <DropdownMenuItem onClick={() => setSignature(true)}><Signature /> {t('mySignature')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => signOut()}><LogOut /> {t('logout')}</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              if (await confirmDialog({ title: t('logoutAll.title'), description: t('logoutAll.text'), confirmText: t('logoutAll.confirm') })) await signOut(true);
            }}><MonitorX /> {t('logoutAll.menu')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <MySignatureDialog open={signature} onClose={() => setSignature(false)} />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-white pt-12">
          <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
          {nav(false)}
        </SheetContent>
      </Sheet>

      <div className="flex">
        <aside className={cn('no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col lg:flex', animate && 'transition-[width] duration-200', collapsed ? 'w-14' : 'w-62')}>
          <div className="min-h-0 flex-1">{nav(collapsed)}</div>
        </aside>
        <main className="min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 bg-white p-3 shadow-[0_0_0_1px_#e1e4ef] md:p-7 lg:rounded-tl-2xl">
          <div ref={content}>{children}</div>
        </main>
      </div>
      <SuccessBurst />
    </div>
  );
}

/** "You are here" highlight that slides to the active link (the link carries aria-current). */
function NavIndicator({ active, mini }: { active: string; mini: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    const nav = el?.parentElement;
    if (!el || !nav) return;
    const place = (animate: boolean) => {
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      el.style.opacity = link ? '1' : '0';
      if (!link) return;
      const n = nav.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      if (!animate) el.style.transition = 'none';
      el.style.transform = `translate(${l.left - n.left + nav.scrollLeft}px, ${l.top - n.top + nav.scrollTop}px)`;
      el.style.width = `${l.width}px`;
      el.style.height = `${l.height}px`;
      if (!animate) {
        void el.offsetWidth; // commit the jump before transitions come back
        el.style.transition = '';
      }
    };
    // first placement jumps; later route changes slide
    place(shown.current);
    shown.current = true;
    // the sidebar resizing (collapse / expand) re-places it without sliding
    let initial = true;
    const ro = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      place(false);
    });
    ro.observe(nav);
    // items appearing later (role-based links once the profile loads, badges) shift the
    // active link without resizing the nav
    const mo = new MutationObserver(() => place(false));
    mo.observe(nav, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [active, mini]);

  return (
    <span ref={ref} aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded bg-selected opacity-0 transition-[transform,width,height] duration-300 ease-[cubic-bezier(.2,.7,.3,1)] motion-reduce:transition-none" />
  );
}
