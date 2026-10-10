'use client';

import { Bell, CalendarDays, ClipboardList, FileBarChart, Gauge, Home, LayoutDashboard, Lightbulb, LineChart, ListChecks, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { Person, Tip } from './common';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';

/** Three-dot product mark */
export function BrandMark({ size = 26 }: { size?: number }) {
  const d = size / 3.2;
  return (
    <span className="flex items-end" style={{ gap: d * 0.25, height: size }}>
      {['#e2445c', '#fdab3d', '#00c875'].map((c, i) => (
        <span key={c} style={{ width: d, height: i === 2 ? d : d * 1.9, background: c, borderRadius: d, transform: i < 2 ? 'skewX(-24deg)' : undefined }} />
      ))}
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <BrandMark />
      <span className="font-heading text-lg font-bold tracking-tight text-foreground">TBKK <span className="font-normal">project control</span></span>
    </Link>
  );
}

type NavItem = { href: string; label: string; icon: React.ReactNode; show: boolean; count?: number };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { me, hasRole, isStaff, unread, signOut } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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
    { href: '/', label: 'Home', icon: <Home />, show: true },
    { href: '/my-tasks', label: 'My work', icon: <ListChecks />, show: isStaff },
    { href: '/notifications', label: 'Notifications', icon: <Bell />, show: true, count: unread },
  ];
  const workspace: NavItem[] = [
    { href: '/requests', label: 'Project Requests', icon: <ClipboardList />, show: true },
    { href: '/projects', label: 'Projects', icon: <LayoutDashboard />, show: true },
    { href: '/management', label: 'Management View', icon: <LineChart />, show: isStaff || hasRole('management_view') },
    { href: '/workforce', label: 'Workforce Plan', icon: <CalendarDays />, show: isStaff },
  ];
  const intelligence: NavItem[] = [
    { href: '/kpi', label: 'KPI', icon: <Gauge />, show: isStaff || hasRole('management_view') },
    { href: '/insights', label: 'Smart Insights', icon: <Lightbulb />, show: true },
    { href: '/reports', label: 'Reports', icon: <FileBarChart />, show: true },
    { href: '/admin', label: 'Administration', icon: <ShieldCheck />, show: hasRole('admin') },
  ];
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const item = (n: NavItem, mini: boolean) => {
    const link = (
      <Link
        key={n.href}
        href={n.href}
        onClick={() => setOpen(false)}
        aria-label={n.label}
        className={cn(
          'relative flex items-center gap-2.5 rounded py-1.5 text-sm text-foreground transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          mini ? 'justify-center px-0' : 'px-2.5',
          isActive(n.href) ? 'bg-selected' : 'hover:bg-sidebar-accent',
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
      <nav className="flex h-full flex-col overflow-x-hidden overflow-y-auto">
        <div className={cn('space-y-0.5', mini ? 'px-2' : 'px-3')}>{main.filter((n) => n.show).map((n) => item(n, mini))}</div>
        {group('System Service workspace', workspace)}
        {group('Management intelligence', intelligence)}
        <div className="flex-1" />
        {!mini && <div className="px-4 pb-2 text-xs text-muted-foreground">Phase 1–3 · Project Control Workspace</div>}
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-app">
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-3 bg-app px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu /></Button>
        <Brand />
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="relative rounded-full" onClick={() => router.push('/notifications')}>
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
                {me?.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{ROLE_LABELS[r]}</span>)}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}><LogOut /> Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-white pt-12">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {nav(false)}
        </SheetContent>
      </Sheet>

      <div className="flex">
        <aside className={cn('no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col lg:flex', animate && 'transition-[width] duration-200', collapsed ? 'w-14' : 'w-62')}>
          <div className="min-h-0 flex-1">{nav(collapsed)}</div>
          <div className={cn('pb-3', collapsed ? 'px-2' : 'px-3')}>
            <Tip side="right" title={collapsed ? 'Expand sidebar' : ''}>
              <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={cn('flex w-full items-center gap-2.5 rounded py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4',
                  collapsed ? 'justify-center' : 'px-2.5')}>
                {collapsed ? <PanelLeftOpen /> : <><PanelLeftClose /> Collapse</>}
              </button>
            </Tip>
          </div>
        </aside>
        <main className="min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 bg-white p-3 shadow-[0_0_0_1px_#e1e4ef] md:p-7 lg:rounded-tl-2xl">
          {children}
        </main>
      </div>
    </div>
  );
}
