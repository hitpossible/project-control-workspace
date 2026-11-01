import { Check, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Section } from '@/components/shared/layout';
import type { ProjectData } from './types';

/** What is still open on a new project, in the order the work usually goes. Everything is read from data already on the page. */
type Step = { key: 'team' | 'meeting' | 'requirements' | 'tasks' | 'baseline'; tab: string; done: boolean };
export function startSteps(data: ProjectData, internal: boolean): Step[] {
  const approved = data.reqs.filter((r) => r.status === 'approved' && r.priority !== 'wont');
  const steps: Step[] = [
    { key: 'team', tab: 'team', done: data.members.some((m) => ['developer', 'qa', 'support'].includes(m.member_role)) },
    { key: 'meeting', tab: 'meetings', done: data.meetings.some((m) => m.status === 'held') },
    { key: 'requirements', tab: 'requirements', done: approved.length > 0 },
    ...(internal ? [{ key: 'tasks' as const, tab: 'requirements', done: approved.length > 0 && approved.every((r) => data.tasks.some((x) => x.requirement_id === r.id)) }] : []),
    { key: 'baseline', tab: 'baseline', done: data.baselines.length > 0 },
  ];
  return steps;
}

/** Getting-started checklist on the Overview of a project the leader has not finished setting up */
export default function GettingStarted({ data, internal }: { data: ProjectData; internal: boolean }) {
  const t = useTranslations('project.gettingStarted');
  const steps = startSteps(data, internal);
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  return (
    <Section title={t('title')} actions={<span className="text-xs text-muted-foreground">{t('progress', { done: steps.filter((s) => s.done).length, total: steps.length })}</span>}>
      <p className="mb-2 text-xs text-muted-foreground">{t('intro')}</p>
      <ol className="divide-y rounded-lg border">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 px-3 py-2">
            {s.done ? <Check className="size-4 text-green-600" /> : <Circle className="size-4 text-muted-foreground/60" />}
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${s.done ? 'text-muted-foreground line-through' : 'font-medium'}`}>{i + 1}. {t(`${s.key}.title`)}</div>
              {!s.done && <div className="text-xs text-muted-foreground">{t(`${s.key}.hint`)}</div>}
            </div>
            {!s.done && <Link href={`/projects/${data.project.id}?tab=${s.tab}`} className={`text-xs font-semibold text-primary ${s === next ? '' : 'opacity-70'}`}>{t('open')}</Link>}
          </li>
        ))}
      </ol>
    </Section>
  );
}
