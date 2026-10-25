'use client';

import { BarChart3, ClipboardCheck, FileText, Presentation, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader, PeriodPicker, SelectField, periodFor, type Period } from '@/components/shared/common';
import { useReport } from '@/components/shared/ReportButton';
import { Button } from '@/components/ui/button';
import { dbClient } from '@/lib/db/client';
import type { ProjectView } from '@/lib/types';
import type { ReportType } from '@/lib/pdf/data';

/** text: reports.type.<type>.title / .desc */
const CARDS: { type: ReportType; icon: React.ReactNode; color: string }[] = [
  { type: 'management', icon: <BarChart3 />, color: '#0073ea' },
  { type: 'status', icon: <FileText />, color: '#00c875' },
  { type: 'meeting', icon: <Users />, color: '#a25ddc' },
  { type: 'closure', icon: <ClipboardCheck />, color: '#fdab3d' },
];

export default function ReportsPage() {
  const t = useTranslations('reports');
  const db = dbClient();
  const { generate, busy } = useReport();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [project, setProject] = useState('');
  const [period, setPeriod] = useState<Period>(() => periodFor('month'));

  useEffect(() => {
    db.from('v_projects').select('*').order('project_code').then(({ data }) => setProjects((data ?? []) as ProjectView[]));
  }, [db]);

  const sel = projects.find((p) => p.id === Number(project));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map((c) => (
          <div key={c.type} className="rounded-lg border p-5" style={{ borderTop: `4px solid ${c.color}` }}>
            <div className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold [&_svg]:size-5" style={{ color: c.color }}>{c.icon}{t(`type.${c.type}.title`)}</div>
            <p className="mb-4 text-sm text-muted-foreground">{t(`type.${c.type}.desc`)}</p>
            <div className="flex flex-wrap items-end gap-3">
              {c.type === 'management'
                ? <PeriodPicker value={period} onChange={setPeriod} />
                : <SelectField className="w-80" label={t('project')} value={project} onChange={setProject} placeholder={t('chooseProject')}
                    options={projects.map((p) => ({ value: String(p.id), label: `${p.project_code} — ${p.project_name}` }))} />}
              <Button disabled={busy || (c.type !== 'management' && !project)} className="h-9"
                onClick={() => generate(c.type, c.type === 'management' ? { from: period.from, to: period.to } : { projectId: Number(project), code: sel?.project_code })}>
                <Presentation /> {busy ? t('generating') : t('generate')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
