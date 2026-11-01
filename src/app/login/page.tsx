'use client';

import { AlertCircle, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandMark } from '@/components/layout/AppShell';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** seeded usernames (scripts/seed.ts); button text: login.demo.<username with . → _> */
const DEMO_ACCOUNTS = ['requestor', 'req.manager', 'ss.manager', 'reviewer', 'authority', 'leader', 'dev1', 'qa', 'mgmt', 'admin'] as const;

function MicrosoftLogo() {
  return (
    <svg aria-hidden viewBox="0 0 21 21" className="size-5"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
  );
}

function LoginForm() {
  const t = useTranslations('login');
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [missing, setMissing] = useState<{ username?: boolean; password?: boolean }>({});
  const [microsoft, setMicrosoft] = useState(false);
  const urlError = params.get('error');

  useEffect(() => {
    fetch('/api/auth/providers').then((r) => r.json()).then((j) => setMicrosoft(!!j.microsoft)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = { username: !username.trim(), password: !password };
    setMissing(m);
    if (m.username || m.password) return;
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) return setError(res?.status === 401 ? t('errors.invalid') : json?.error?.message ?? t('unreachable'));
    router.replace(params.get('next') || '/');
    router.refresh();
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      {/* soft colour wash behind the card */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[12%] -left-[8%] size-[34rem] rounded-full bg-[#0073ea]/15 blur-[110px]" />
        <div className="absolute -right-[6%] bottom-[8%] size-[32rem] rounded-full bg-[#7c5cff]/15 blur-[110px]" />
        <div className="absolute top-[-10%] right-[30%] size-[22rem] rounded-full bg-[#00c2a8]/10 blur-[100px]" />
      </div>

      <header className="relative flex justify-end p-4 sm:p-6"><LanguageSwitcher /></header>

      <main className="relative m-auto w-full max-w-[28rem] px-4 pb-10">
        <div className="rounded-[2rem] border border-white bg-white/85 p-8 shadow-[0_20px_60px_-15px_rgba(16,40,100,.18)] ring-1 ring-black/[.04] backdrop-blur sm:p-10">
          <div className="flex flex-col items-center text-center">
            <BrandMark size={44} />
            <div className="mt-3 font-heading text-xl tracking-tight">project control</div>
            <p className="mt-1 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          <h1 className="mt-8 mb-6 text-center font-heading text-lg font-medium">{t('title')}</h1>
          <form onSubmit={submit} noValidate className="space-y-4">
            {!error && urlError && (
              <Alert variant="destructive"><AlertCircle /><AlertDescription>{t.has(`errors.${urlError}` as 'errors.ms_failed') ? t(`errors.${urlError}` as 'errors.ms_failed') : t('errors.ms_failed')}</AlertDescription></Alert>
            )}
            <div>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="username" aria-label={t('username')} placeholder={t('username')} autoComplete="username" className="h-12 rounded-xl bg-white pl-11" value={username} onChange={(e) => { setUsername(e.target.value); setError(null); setMissing((m) => ({ ...m, username: false })); }} aria-invalid={missing.username || !!error} autoFocus />
            </div>
            {missing.username && <p role="alert" className="mt-1.5 pl-1 text-sm text-destructive">{t('errors.usernameRequired')}</p>}
            </div>
            <div>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="password" aria-label={t('password')} placeholder={t('password')} type={show ? 'text' : 'password'} autoComplete="current-password" className="h-12 rounded-xl bg-white pr-11 pl-11" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); setMissing((m) => ({ ...m, password: false })); }} aria-invalid={missing.password || !!error} />
              <button type="button" onClick={() => setShow(!show)} aria-label={t(show ? 'hidePassword' : 'showPassword')}
                className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {(missing.password || error) && <p role="alert" className="mt-1.5 pl-1 text-sm text-destructive">{missing.password ? t('errors.passwordRequired') : error}</p>}
            </div>
            <Button type="submit" className="h-12 w-full rounded-full text-base font-medium shadow-[0_8px_20px_-6px_rgba(0,115,234,.55)]" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}{loading ? t('submitting') : t('submit')}
            </Button>
          </form>

          {microsoft && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t('or')}<span className="h-px flex-1 bg-border" /></div>
              <Button asChild variant="outline" className="h-12 w-full rounded-full bg-white text-base font-medium">
                <a href={`/api/auth/microsoft${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>
                  <MicrosoftLogo />{t('microsoft')}
                </a>
              </Button>
            </>
          )}

          {process.env.NODE_ENV !== 'production' && (
            <div className="mt-7 border-t pt-5">
              <p className="text-center text-xs text-muted-foreground">{t('demoHint')}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {DEMO_ACCOUNTS.map((u) => (
                  <button key={u} type="button" onClick={() => setUsername(u)}
                    className="rounded-full border bg-white px-2.5 py-0.5 text-xs transition-colors hover:border-primary hover:text-primary">{t(`demo.${u.replace(".", "_") as "req_manager" | "ss_manager"}`)}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="relative flex items-center justify-between gap-4 px-4 py-4 text-xs text-muted-foreground sm:px-8">
        <span>© {new Date().getFullYear()} TBKK Co., Ltd. All rights reserved.</span>
        <span className="hidden items-center gap-1.5 sm:flex">{t('poweredBy')} <BrandMark size={16} /></span>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
