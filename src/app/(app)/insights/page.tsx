'use client';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BoardGroup, EmptyState, PageHeader, SelectField, StatCard } from '@/components/common';
import { InsightRow, useInsights } from '@/components/InsightList';
import { Button } from '@/components/ui/button';
import { INSIGHT_SEVERITIES } from '@/lib/constants';
import { exportInsightsExcel } from '@/lib/exportExcel';
import { GROUP_COLORS } from '@/lib/constants';

export default function InsightsPage() {
  const rows = useInsights(null);
  const [sev, setSev] = useState('');
  const [rule, setRule] = useState('');
  const list = (rows ?? []).filter((r) => (!sev || r.severity === sev) && (!rule || r.rule_code === rule));
  const rules = useMemo(() => [...new Map((rows ?? []).map((r) => [r.rule_code, r.rule_code.replace(/_/g, ' ')])).entries()], [rows]);
  const groups = [...new Map(list.map((r) => [r.project_code ?? 'Team', r.project_code ?? 'Team'])).keys()];
  const count = (s: string) => (rows ?? []).filter((r) => r.severity === s).length;

  return (
    <>
      <PageHeader
        title="Smart Insights"
        subtitle="Rule-based analysis of every active project (PRD §22). Thresholds are configurable in Administration → Insight Rules."
        actions={<Button variant="outline" onClick={() => exportInsightsExcel(list)}><Download /> Export Excel</Button>}
      />
      <div className="mb-5 grid grid-cols-3 gap-3 md:max-w-2xl">
        <StatCard label="Critical" value={count('critical')} color="#e2445c" onClick={() => setSev(sev === 'critical' ? '' : 'critical')} />
        <StatCard label="Warning" value={count('warning')} color="#fdab3d" onClick={() => setSev(sev === 'warning' ? '' : 'warning')} />
        <StatCard label="Info" value={count('info')} color="#579bfc" onClick={() => setSev(sev === 'info' ? '' : 'info')} />
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-3 border-b border-grid pb-4">
        <SelectField className="w-40" label="Severity" value={sev} allowEmpty placeholder="All" onChange={setSev} options={INSIGHT_SEVERITIES} />
        <SelectField className="w-60" label="Rule" value={rule} allowEmpty placeholder="All rules" onChange={setRule}
          options={rules.map(([v, l]) => ({ value: v, label: l.charAt(0).toUpperCase() + l.slice(1) }))} />
      </div>
      {rows === null ? <EmptyState text="Analysing…" /> : list.length === 0 ? <EmptyState text="No insights — everything looks on track 🎉" /> : groups.map((g, i) => {
        const items = list.filter((r) => (r.project_code ?? 'Team') === g);
        return (
          <BoardGroup key={g} title={g === 'Team' ? 'Team / Resources' : g} color={GROUP_COLORS[i % GROUP_COLORS.length]} count={items.length}>
            <div className="divide-y divide-grid">
              {items.map((r, n) => <InsightRow key={`${r.rule_code}-${r.entity_id}-${n}`} i={r} showProject={false} />)}
            </div>
          </BoardGroup>
        );
      })}
    </>
  );
}
