'use client';

import { AlertCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BrandMark } from '@/components/AppShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEMO_ACCOUNTS = [
  ['requestor', 'Requestor'],
  ['req.manager', 'Requestor Approver'],
  ['reviewer', 'System Reviewer / Supervisor'],
  ['authority', 'Authority / Manager'],
  ['leader', 'Project Leader'],
  ['dev1', 'Developer'],
  ['qa', 'QA'],
  ['mgmt', 'Management View'],
  ['admin', 'Admin'],
];

function LoginForm() {
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
    if (!res?.ok) return setError(json?.error?.message ?? 'Cannot reach the server');
    router.replace(params.get('next') || '/');
    router.refresh();
  };

  return (
    <div className="grid min-h-screen place-items-center bg-app p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,.08)]">
        <div className="mb-6 flex items-center gap-2">
          <BrandMark />
          <span className="font-heading text-lg font-bold">TBKK <span className="font-normal">project control</span></span>
        </div>
        <h1 className="font-heading text-2xl font-semibold">Log in to your account</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">Sign in with your company (AD) account</p>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" className="h-10" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="h-10 w-full" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</Button>
        </form>
        {process.env.NODE_ENV !== 'production' && (
          <div className="mt-6">
            <p className="text-xs text-muted-foreground">Demo accounts (local login, password in scripts/seed.ts):</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map(([u, label]) => (
                <button key={u} type="button" onClick={() => setUsername(u)}
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">{label}</button>
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
