'use client';

import { BarChart3, ClipboardCheck, FileText, Presentation, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader, PeriodPicker, SelectField, periodFor, type Period } from '@/components/common';
import { useReport } from '@/components/ReportButton';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ProjectView } from '@/lib/types';
import type { ReportType } from '@/lib/pdf/data';

const CARDS: { type: ReportType; title: string; desc: string; icon: React.ReactNode; color: string }[] = [
  { type: 'management', title: 'Management Report', desc: 'Portfolio status, team KPI and projects needing attention for a period.', icon: <BarChart3 />, color: '#0073ea' },
  { type: 'status', title: 'Project Status Report', desc: 'Status, KPI, User Control Plan timeline, delay & recovery, issues.', icon: <FileText />, color: '#00c875' },
  { type: 'meeting', title: 'User Meeting Report', desc: 'Agenda for the user progress meeting: progress, user actions, milestones, decisions.', icon: <Users />, color: '#a25ddc' },
  { type: 'closure', title: 'Project Closure Report', desc: 'Baseline vs actual, evidence checklist, quality summary and sign-off.', icon: <ClipboardCheck />, color: '#fdab3d' },
];

export default function ReportsPage() {
  const supabase = supabaseBrowser();
  const { generate, busy } = useReport();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [project, setProject] = useState('');
  const [period, setPeriod] = useState<Period>(() => periodFor('month'));

  useEffect(() => {
    supabase.from('v_projects').select('*').order('project_code').then(({ data }) => setProjects((data ?? []) as ProjectView[]));
  }, [supabase]);

  const sel = projects.find((p) => p.id === project);

  return (
    <>
      <PageHeader title="Reports" subtitle="PDF reports generated from the Workspace (master data) — PRD §25.2" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map((c) => (
          <div key={c.type} className="rounded-lg border p-5" style={{ borderTop: `4px solid ${c.color}` }}>
            <div className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold [&_svg]:size-5" style={{ color: c.color }}>{c.icon}{c.title}</div>
            <p className="mb-4 text-sm text-muted-foreground">{c.desc}</p>
            <div className="flex flex-wrap items-end gap-3">
              {c.type === 'management'
                ? <PeriodPicker value={period} onChange={setPeriod} />
                : <SelectField className="w-80" label="Project" value={project} onChange={setProject} placeholder="Choose project…"
                    options={projects.map((p) => ({ value: p.id, label: `${p.project_code} — ${p.project_name}` }))} />}
              <Button disabled={busy || (c.type !== 'management' && !project)} className="h-9"
                onClick={() => generate(c.type, c.type === 'management' ? { from: period.from, to: period.to } : { projectId: project, code: sel?.project_code })}>
                <Presentation /> {busy ? 'Generating…' : 'Generate PDF'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
