'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { SelectField, TextField } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import { fmtDateTime } from '@/lib/format';

type Token = { id: number; name: string; scope: 'read' | 'write'; token_prefix: string; expires_at: string | null; last_used_at: string | null; created_at: string };

/** Personal access tokens for the user's own tools (e.g. the AI assistant's MCP server) */
export default function ApiTokens() {
  const t = useTranslations('profile.tokens');
  const { notify } = useApp();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState('90');
  const [scope, setScope] = useState('read');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/me/tokens', { cache: 'no-store' }).then((r) => r.json()).then((j) => setTokens(j.data ?? []));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/me/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope, days: days === 'never' ? null : Number(days) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return notify(j.error?.message ?? r.statusText, 'error');
      setCreated(j.data.token);
      setCopied(false);
      setName('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (tk: Token) => {
    if (!(await confirmDialog({ title: t('revokeConfirm', { name: tk.name }), description: t('revokeHint'), confirmText: t('revoke'), destructive: true }))) return;
    const r = await fetch(`/api/me/tokens/${tk.id}`, { method: 'DELETE' });
    if (!r.ok) return notify(r.statusText, 'error');
    notify(t('revoked'), 'success');
    setCreated(null);
    load();
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      {created && (
        <div className="rounded-md border border-[#00c875] bg-[#e5f9ef] p-3">
          <div className="mb-2 text-sm font-medium">{t('createdNote')}</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 font-mono text-xs">{created}</code>
            <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? t('copied') : t('copy')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>{t('done')}</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <TextField className="min-w-48 flex-1" label={t('name')} value={name} onChange={setName} placeholder={t('namePlaceholder')} />
        <SelectField className="sm:w-36" label={t('scope')} value={scope} onChange={setScope}
          options={[{ value: 'read', label: t('scopeRead') }, { value: 'write', label: t('scopeWrite') }]} />
        <SelectField className="sm:w-28" label={t('expires')} value={days} onChange={setDays}
          options={[['30', t('days', { count: 30 })], ['90', t('days', { count: 90 })], ['365', t('days', { count: 365 })], ['never', t('never')]].map(([value, label]) => ({ value, label }))} />
        <Button disabled={busy || !name.trim()} onClick={create}><KeyRound />{t('create')}</Button>
      </div>

      {tokens.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : (
        <ul className="divide-y rounded-md border">
          {tokens.map((tk) => (
            <li key={tk.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{tk.name} <span className="font-mono text-xs text-muted-foreground">{tk.token_prefix}…</span>
                  {tk.scope === 'write' && <span className="ml-2 rounded bg-[#fdab3d]/20 px-1.5 py-0.5 text-[11px] font-medium text-[#b86e00]">{t('scopeWrite')}</span>}</div>
                <div className="text-xs text-muted-foreground">
                  {t('createdAt', { date: fmtDateTime(tk.created_at) })}
                  {' · '}{tk.last_used_at ? t('lastUsed', { date: fmtDateTime(tk.last_used_at) }) : t('neverUsed')}
                  {' · '}{tk.expires_at ? t('expiresAt', { date: fmtDateTime(tk.expires_at) }) : t('noExpiry')}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(tk)}>{t('revoke')}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
