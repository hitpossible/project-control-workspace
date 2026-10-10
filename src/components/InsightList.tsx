'use client';

import { CircleAlert, Info, Lightbulb, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errMsg } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Insight } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { EmptyState } from './common';

const ICON = {
  critical: <CircleAlert className="size-4 shrink-0 text-[#e2445c]" />,
  warning: <TriangleAlert className="size-4 shrink-0 text-[#d97706]" />,
  info: <Info className="size-4 shrink-0 text-[#579bfc]" />,
};

export function useInsights(projectId?: string | null) {
  const supabase = supabaseBrowser();
  const { notify } = useApp();
  const [rows, setRows] = useState<Insight[] | null>(null);
  useEffect(() => {
    supabase.rpc('smart_insights', { p_project_id: projectId ?? null }).then(({ data, error }) => {
      if (error) notify(errMsg(error), 'error');
      setRows((data ?? []) as Insight[]);
    });
  }, [supabase, projectId, notify]);
  return rows;
}

export function InsightRow({ i, showProject = true }: { i: Insight; showProject?: boolean }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push(i.link)}
      className={cn('flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted', i.severity === 'critical' && 'bg-[#fff5f6]')}>
      {ICON[i.severity]}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {showProject && <span className="mr-1.5 text-xs font-semibold text-muted-foreground">{i.project_code ?? 'Team'}</span>}
          {i.title}
        </div>
        <div className="text-xs text-muted-foreground">{i.detail}</div>
      </div>
    </button>
  );
}

/** Compact insight list for dashboards / project overview */
export default function InsightList({ projectId, limit, showProject = true }: { projectId?: string | null; limit?: number; showProject?: boolean }) {
  const rows = useInsights(projectId);
  if (rows === null) return <EmptyState text="Analysing…" />;
  if (rows.length === 0) return <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Lightbulb className="size-4" /> No insights — everything looks on track</div>;
  const list = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="divide-y divide-grid">
      {list.map((i, n) => <InsightRow key={`${i.rule_code}-${i.entity_id}-${n}`} i={i} showProject={showProject} />)}
      {limit && rows.length > limit && <div className="px-3 py-2 text-xs text-muted-foreground">+ {rows.length - limit} more insight(s)</div>}
    </div>
  );
}
