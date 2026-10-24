'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BrandMark } from '@/components/AppShell';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** seeded usernames (scripts/seed.ts); button text: login.demo.<username with . → _> */
const DEMO_ACCOUNTS = ['requestor', 'req.manager', 'ss.manager', 'reviewer', 'authority', 'leader', 'dev1', 'qa', 'mgmt', 'admin'] as const;

function LoginForm() {
  const t = useTranslations('login');
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) return setError(json?.error?.message ?? t('unreachable'));
    router.replace(params.get('next') || '/');
    router.refresh();
  };

  return (
    <div className="grid min-h-screen place-items-center bg-app p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,.08)]">
        <div className="mb-6 flex items-center gap-2">
          <BrandMark size={30} />
          <span className="flex-1 font-heading text-lg">project control</span>
          <LanguageSwitcher />
        </div>
        <h1 className="font-heading text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">{t('subtitle')}</p>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">{t('username')}</Label>
            <Input id="username" autoComplete="username" className="h-10" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" type="password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="h-10 w-full" disabled={loading}>{loading ? t('submitting') : t('submit')}</Button>
        </form>
        {process.env.NODE_ENV !== 'production' && (
          <div className="mt-6">
            <p className="text-xs text-muted-foreground">{t('demoHint')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((u) => (
                <button key={u} type="button" onClick={() => setUsername(u)}
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">{t(`demo.${u.replace(".", "_") as "req_manager" | "ss_manager"}`)}</button>
              ))}
            </div>
          </div>
        )}
      </div>
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
