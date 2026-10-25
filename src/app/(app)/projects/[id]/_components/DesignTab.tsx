'use client';

import '@xyflow/react/dist/style.css';
import { ReactFlowProvider } from '@xyflow/react';
import { ChevronDown, PenTool, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { EmptyState } from '@/components/shared/common';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dbClient } from '@/lib/db/client';
import { type ProjectDiagram, emptyContent } from '@/lib/diagram';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';
import { Editor } from './design/Editor';

export default function DesignTab({ data, perm }: TabProps) {
  const t = useTranslations('design');
  const db = dbClient();
  const { me, notify } = useApp();
  const projectId = data.project.id;
  const [list, setList] = useState<ProjectDiagram[] | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const { data: rows } = await db.from('project_diagrams').select('*').eq('project_id', projectId).order('updated_at', { ascending: false });
    const all = (rows ?? []) as ProjectDiagram[];
    setList(all);
    return all;
  }, [db, projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load().then((all) => setSelId((s) => s ?? all[0]?.id ?? null));
  }, [load]);

  const leave = async () => !dirty || confirmDialog({
    title: t('discard.title'), description: t('discard.description', { title: list?.find((d) => d.id === selId)?.title ?? '' }),
    confirmText: t('discard.confirm'), destructive: true,
  });
  const open = async (id: number) => {
    if (id === selId || !(await leave())) return;
    setDirty(false);
    setSelId(id);
  };
  const create = async () => {
    if (!(await leave())) return;
    const { data: row, error } = await db.from('project_diagrams')
      .insert({ project_id: projectId, title: t('untitled'), content: emptyContent() }).select('*').single();
    if (error) return notify(error.message, 'error');
    await load();
    setDirty(false);
    setSelId((row as ProjectDiagram).id);
  };

  const current = list?.find((d) => d.id === selId) ?? null;
  if (!list) return null;

  if (!current) {
    return (
      <div className="rounded-lg border border-dashed border-grid py-6">
        <EmptyState text={t('empty')} />
        <div className="flex justify-center">
          <Button variant="outline" onClick={create}><Plus /> {t('newDiagram')}</Button>
        </div>
      </div>
    );
  }

  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('diagrams')}><PenTool className="text-[#0073ea]" /> {t('diagrams')} ({list.length})<ChevronDown /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {list.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => open(d.id)} className={cn(d.id === selId && 'bg-selected')}>
            <PenTool className="text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.title}{d.id === selId && dirty ? ' •' : ''}</span>
              <span className="block truncate text-xs text-muted-foreground">{fmtDateTime(d.updated_at)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={create}><Plus /> {t('newDiagram')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ReactFlowProvider key={current.id}>
      <Editor
        diagram={current}
        picker={picker}
        canDelete={current.created_by === me?.id || perm.manage}
        onDirty={setDirty}
        // keep the list in step with what is saved, so reopening this diagram shows the latest version
        onSaved={(sv) => setList((l) => l?.map((d) => (d.id === current.id ? { ...d, ...sv } : d)) ?? l)}
        onDeleted={async () => {
          setDirty(false);
          const all = await load();
          setSelId(all[0]?.id ?? null);
        }}
      />
    </ReactFlowProvider>
  );
}
