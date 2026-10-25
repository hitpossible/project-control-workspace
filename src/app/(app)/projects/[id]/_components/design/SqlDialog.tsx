'use client';

import { Copy, Database, FileInput, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { type DiagramContent, type DiagramDraft } from '@/lib/diagram';
import { fromSql, toSql } from '@/lib/diagramSql';

/** ER ↔ SQL: export shows the CREATE TABLE script (copy / download), import reads pasted DDL into tables */
export function SqlDialog({ mode, onClose, title, content, onImport }: {
  mode: 'export' | 'import' | null; onClose: () => void; title: string; content: DiagramContent;
  onImport: (draft: DiagramDraft, replaceTables: boolean) => void;
}) {
  const t = useTranslations('design.sql');
  const tc = useTranslations('common');
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [replaceTables, setReplaceTables] = useState(false);
  const sql = useMemo(() => (mode === 'export' ? toSql(content, title) : ''), [mode, content, title]);
  const hasTables = content.nodes.some((n) => n.type === 'entity');

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    notify(t('copied'));
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sql], { type: 'application/sql' }));
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const runImport = () => {
    const draft = fromSql(text);
    if (!draft.nodes.length) return notify(t('noTables'), 'warning');
    onImport(draft, replaceTables);
    notify(t('imported', { n: draft.nodes.length }));
    setText('');
    onClose();
  };

  return (
    <Dialog open={!!mode} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Database className="size-4 text-[#0073ea]" /> {mode === 'import' ? t('import') : t('export')}</DialogTitle>
          <DialogDescription>{mode === 'import' ? t('importHint') : t('exportHint')}</DialogDescription>
        </DialogHeader>
        {mode === 'export' ? (
          <Textarea readOnly value={sql} rows={18} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        ) : (
          <div className="space-y-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="font-mono text-xs" placeholder={'CREATE TABLE customers (\n  id INT PRIMARY KEY,\n  name VARCHAR(100)\n);'} />
            {hasTables && (
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={replaceTables} onCheckedChange={(v) => setReplaceTables(!!v)} /> {t('replace')}</label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          {mode === 'export' ? (
            <>
              <Button variant="outline" onClick={copy}><Copy /> {t('copy')}</Button>
              <Button onClick={download}><Download /> {t('download')}</Button>
            </>
          ) : (
            <Button disabled={!text.trim()} onClick={runImport}><FileInput /> {t('run')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
