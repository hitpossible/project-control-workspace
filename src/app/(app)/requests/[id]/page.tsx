'use client';

import dayjs from 'dayjs';
import { ArrowRight, Ban, CalendarClock, CalendarDays, Check, ChevronRight, CircleHelp, Hourglass, ListChecks, Mail, MessageCircleQuestion, Mic, Phone, Rocket, Send, Sparkles, Undo2, Users, X, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import AiAnalysisCard from '@/components/AiAnalysisCard';
import { CoverageIcon } from '@/components/AiClarifyDialog';
import AuditHistory from '@/components/AuditHistory';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { ActionButton, CommentDialog, DateField, Field, PageHeader, PriorityChip, Section, SelectField, StatusChip, TextField, UserSelect } from '@/components/common';
import EvidencePanel from '@/components/EvidencePanel';
import { celebrate } from '@/components/motion';
import RequestForm, { REDUCTION_ROWS } from '@/components/RequestForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTypes } from '@/components/useDocumentTypes';
import { coverageCount } from '@/lib/clarify';
import { canActOnStep, canConvertRequest, stepAudience, stepGroup, stepStage } from '@/lib/approval';
import { useOptions } from '@/i18n/useOptions';
import { REQUEST_STATUSES, ROLES } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ApprovalAction, ApprovalStep, ProjectRequest, ProjectTemplate, ProjectType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/ConfirmDialog';

type Act = 'approve' | 'reject' | 'send_back' | 'request_more_info';
/** labels: requestDetail.act.<act>.label / .short */
const ACT_META: Record<Act, { icon: LucideIcon; tone: 'success' | 'destructive' | 'warning' | 'secondary'; required: boolean }> = {
  approve: { icon: Check, tone: 'success', required: false },
  reject: { icon: X, tone: 'destructive', required: true },
  send_back: { icon: Undo2, tone: 'warning', required: true },
  request_more_info: { icon: MessageCircleQuestion, tone: 'secondary', required: true },
};

/** step status labels: requestDetail.stepStatus.<status> */
type Tone = { icon: LucideIcon; fg: string; bg: string };
const STEP_META: Record<string, Tone> = {
  approved: { icon: Check, fg: '#00854d', bg: '#e3f8ee' },
  waiting: { icon: Hourglass, fg: '#b45309', bg: '#fff1d6' },
  rejected: { icon: X, fg: '#d83a52', bg: '#fdebee' },
  sent_back: { icon: Undo2, fg: '#b45309', bg: '#fff1d6' },
  more_info: { icon: MessageCircleQuestion, fg: '#784bd1', bg: '#f1eafc' },
};
const HISTORY_META: Record<string, Tone> = {
  submit: { icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  resubmit: { icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  approve: STEP_META.approved,
  reject: STEP_META.rejected,
  send_back: STEP_META.sent_back,
  request_more_info: STEP_META.more_info,
  cancel: { icon: Ban, fg: '#676879', bg: '#eef0f4' },
  convert: { icon: Rocket, fg: '#00854d', bg: '#e3f8ee' },
};

function Bubble({ tone, children }: { tone: Pick<Tone, 'fg' | 'bg'>; children: React.ReactNode }) {
  return (
    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-card" style={{ background: tone.bg, color: tone.fg }}>
      {children}
    </span>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm break-words whitespace-pre-wrap">{children || <span className="text-muted-foreground">-</span>}</div>
    </div>
  );
}

export default function RequestDetailPage() {
  const t = useTranslations('requestDetail');
  const tf = useTranslations('requestForm.field');
  const te = useTranslations('enums');
  const { label: optLabel, text: enumText } = useOptions();
  const { id } = useParams<{ id: string }>();
  const db = dbClient();
  const router = useRouter();
  const { me, hasRole, profileName, notify, refreshUnread } = useApp();
  const [r, setR] = useState<ProjectRequest | null>(null);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [actions, setActions] = useState<ApprovalAction[]>([]);
  const [types, setTypes] = useState<ProjectType[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [dialog, setDialog] = useState<Act | null>(null);
  const [review, setReview] = useState({ project_type_id: '', template_id: '', proposed_leader_id: null as number | null, authority_approver_id: null as number | null, scope_assessment: '', estimated_md: '' });
  const [conv, setConv] = useState({ start: dayjs().format('YYYY-MM-DD'), target: '', sponsor: '' });
  const [notFound, setNotFound] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [tab, setTab] = useState('details');
  const [convertCard, setConvertCard] = useState<HTMLDivElement | null>(null);
  const docType = useDocumentTypes().find((x) => x.id === r?.document_type_id);

  const load = useCallback(async () => {
    const { data, error } = await db.from('project_requests').select('*').eq('id', id).maybeSingle();
    if (error || !data) return setNotFound(true);
    setR(data);
    setReview({
      project_type_id: data.project_type_id?.toString() ?? '', template_id: data.template_id?.toString() ?? '',
      proposed_leader_id: data.proposed_leader_id, authority_approver_id: data.authority_approver_id, scope_assessment: data.scope_assessment ?? '',
      estimated_md: data.estimated_md?.toString() ?? '',
    });
    setConv((c) => ({ ...c, target: c.target || data.date_required || '' }));
    const [s, a] = await Promise.all([
      db.from('approval_steps').select('*').eq('request_id', id).order('cycle').order('step_no'),
      db.from('approval_actions').select('*').eq('request_id', id).order('created_at'),
    ]);
    setSteps((s.data ?? []) as ApprovalStep[]);
    setActions((a.data ?? []) as ApprovalAction[]);
  }, [db, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
    db.from('project_types').select('*').eq('is_active', true).order('name').then(({ data }) => setTypes(data ?? []));
    db.from('project_templates').select('*').eq('is_active', true).order('name').then(({ data }) => setTemplates(data ?? []));
  }, [load, db]);

  if (notFound) return <Alert><AlertDescription>{t('notFound')}</AlertDescription></Alert>;
  if (!r || !me) return null;

  const mine = r.requestor_id === me.id;
  const editable = mine && ['draft', 'need_more_information'].includes(r.status);
  const cycle = Math.max(0, ...steps.map((s) => s.cycle));
  const current = steps.filter((s) => s.cycle === cycle);
  const waiting = current.find((s) => s.status === 'waiting');
  const approvedCount = current.filter((s) => s.status === 'approved').length;
  const canAct = !!waiting && canActOnStep(waiting, me, r.requestor_id);
  const isReview = canAct && !!waiting && stepStage(waiting) === 'receive';
  const legacyReview = waiting?.step_code === 'system_review';
  const canConvert = canConvertRequest(r, me);
  const hasClarify = !!r.ai_clarifications?.length || !!r.ai_coverage || !!r.ai_chat?.length;
  const coverage = r.ai_coverage ? coverageCount(r.ai_coverage) : null;
  const daysLeft = r.date_required ? dayjs(r.date_required).startOf('day').diff(dayjs().startOf('day'), 'day') : null;
  const levelAudience = (s: ApprovalStep) => {
    const a = stepAudience(s);
    const level = enumText('positionLevel', a.level);
    const who = a.andUp ? t('audience.levelUp', { level }) : level;
    return a.department ? `${who} · ${a.department}` : who;
  };
  const audience = (s: ApprovalStep) =>
    s.approver_levels ? levelAudience(s) : s.approver_ids?.length ? s.approver_ids.map(profileName).join(' / ') : s.approver_id ? profileName(s.approver_id) : t('audience.anyRole', { role: optLabel(ROLES, s.approver_role) });

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) { notify(errMsg(error), 'error'); return null; }
    notify(ok);
    dispatchEmails();
    refreshUnread();
    await load();
    setFormKey((k) => k + 1);
    return data;
  };

  const saveReview = async () =>
    rpc('save_review', {
      p_request_id: r.id,
      p_project_type_id: review.project_type_id ? Number(review.project_type_id) : null,
      p_template_id: review.template_id ? Number(review.template_id) : null,
      p_proposed_leader_id: review.proposed_leader_id,
      p_authority_approver_id: review.authority_approver_id,
      p_scope_assessment: review.scope_assessment || null,
      p_estimated_md: review.estimated_md.trim() || null,
    }, t('toast.reviewSaved'));

  const go = async (a: Act) => {
    if (a === 'approve' && isReview) {
      const saved = await saveReview();
      if (!saved) return;
    }
    setDialog(a);
  };
  const otherActs = (Object.keys(ACT_META) as Act[]).filter((a) => a !== 'approve');
  const convert = async () => {
    const p = await rpc('convert_request_to_project', { p_request_id: r.id, p_start_date: conv.start, p_target_date: conv.target, p_sponsor: conv.sponsor || null }, t('toast.projectCreated'));
    if (p) router.push(`/projects/${(p as { id: number }).id}`);
  };
  const floating = canAct && waiting ? 'approval' : canConvert ? 'convert' : null;

  return (
    <>
      <PageHeader
        title={<>{r.request_no ?? t('draftRequest')} — {r.project_name}</>}
        subtitle={<div className="flex flex-wrap items-center gap-2">
          {docType && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{docType.name}</span>}
          <StatusChip list={REQUEST_STATUSES} value={r.status} /> <PriorityChip value={r.priority} />
          <span className="text-xs">{t('requestedBy', { name: r.req_full_name ?? '', department: r.req_department ?? '' })}</span>
        </div>}
        actions={<>
          {r.project_id && <Button asChild><Link href={`/projects/${r.project_id}`}>{t('openProject')}</Link></Button>}
          {mine && ['draft', 'need_more_information', 'waiting_requestor_approval'].includes(r.status) && r.request_no && (
            <Button variant="destructive" onClick={async () => { if (await confirmDialog({ title: t('cancel.title'), description: t('cancel.description'), confirmText: t('cancel.confirm'), cancelText: t('cancel.keep'), destructive: true })) await rpc('cancel_request', { p_request_id: r.id, p_comment: null }, t('toast.cancelled')); }}>{t('cancel.confirm')}</Button>
          )}
          {mine && r.status === 'draft' && !r.request_no && (
            <Button variant="destructive" onClick={async () => {
              if (!(await confirmDialog({ title: t('deleteDraft.title'), description: t('deleteDraft.description'), confirmText: t('deleteDraft.confirm'), destructive: true }))) return;
              const { error } = await db.from('project_requests').delete().eq('id', r.id);
              if (error) return notify(errMsg(error), 'error');
              router.replace('/requests');
            }}>{t('deleteDraft.button')}</Button>
          )}
        </>}
      />

      {r.status === 'need_more_information' && mine && (
        <Alert className="mb-4 border-[#a25ddc] bg-[#f6effc]"><CircleHelp /><AlertDescription>
          {t.rich('moreInfoAlert', { comment: current.find((s) => s.status === 'more_info')?.comment ?? '', b: (c) => <b>{c}</b> })}
        </AlertDescription></Alert>
      )}
      {r.status === 'draft' && r.request_no && mine && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]"><Undo2 /><AlertDescription>
          {t.rich('sentBackAlert', { comment: [...actions].reverse().find((a) => a.action === 'send_back')?.comment ?? '', b: (c) => <b>{c}</b> })}
        </AlertDescription></Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border lg:grid-cols-4">
        <Stat icon={CalendarDays} label={tf('dateSubmitted')} value={fmtDate(r.date_submitted)} />
        <Stat icon={CalendarClock} label={tf('dateRequired')} value={fmtDate(r.date_required)}
          hint={daysLeft == null || ['converted', 'cancelled', 'rejected'].includes(r.status) ? null
            : <span className={cn(daysLeft < 0 ? 'text-[#d83a52]' : daysLeft <= 7 && 'text-[#b45309]')}>{daysLeft < 0 ? t('daysOverdue', { count: -daysLeft }) : daysLeft === 0 ? t('dueToday') : t('daysLeft', { count: daysLeft })}</span>} />
        <Stat icon={Hourglass} label={t('currentStep')} value={waiting?.step_name ?? optLabel(REQUEST_STATUSES, r.status)}
          hint={waiting && (canAct ? <span className="font-medium text-primary">{t('yourTurn')}</span> : audience(waiting))} />
        <Stat icon={ListChecks} label={t('approvalProgress')} value={current.length ? t('stepsProgress', { done: approvedCount, total: current.length }) : t('notSubmitted')}
          hint={current.length > 0 && (
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-[#00c875] transition-all" style={{ width: `${(approvedCount / current.length) * 100}%` }} />
            </span>
          )} />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 min-w-0 xl:col-span-8">
          <Tabs value={tab} onValueChange={setTab} className="mb-4">
            <TabsList variant="line" className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-grid">
              <TabsTrigger value="details" className="flex-none px-3">{t('tab.details')}</TabsTrigger>
              {hasClarify && (
                <TabsTrigger value="clarify" className="flex-none gap-1.5 px-3">
                  <Sparkles className="size-3.5" /> {t('tab.clarify')}
                  {coverage && <span className={cn('rounded-full px-1.5 text-[11px] font-medium', coverage.missing.length ? 'bg-[#fff1d6] text-[#b45309]' : 'bg-[#e3f8ee] text-[#00854d]')}>{coverage.covered}/{coverage.total}</span>}
                </TabsTrigger>
              )}
              <TabsTrigger value="attachments" className="flex-none px-3">{t('tab.attachments')}</TabsTrigger>
              <TabsTrigger value="history" className="flex-none gap-1.5 px-3">
                {t('tab.history')} {actions.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium">{actions.length}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'details' && (editable ? (
            <RequestForm
              key={formKey}
              initial={r}
              onSaved={() => load()}
              onSubmit={async (saved) => {
                if (await rpc('submit_request', { p_request_id: saved.id }, t('toast.submitted')) !== null) celebrate(t('celebrate.submitted'), t('celebrate.submittedHint'));
              }}
            />
          ) : (
            <>
              <Section title={t('section.info')}>
                <p className="mb-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{r.description || <span className="text-muted-foreground">{t('noDescription')}</span>}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBlock label={tf('reason')}>{r.reason}</InfoBlock>
                  <InfoBlock label={tf('expectation')}>{r.expectation}</InfoBlock>
                </div>
                {r.requestor_approver_id && (
                  <div className="mt-3 text-xs text-muted-foreground">{t('requestorApprover')} · <span className="font-medium text-foreground">{profileName(r.requestor_approver_id)}</span></div>
                )}
              </Section>
              {REDUCTION_ROWS.some((row) => r[row.from] != null || r[row.to] != null) && (
                <Section title={t('section.reduction')}>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground">
                        <tr><th className="px-3 py-2 text-left font-medium">{t('reduction.item')}</th><th className="px-3 py-2 text-right font-medium">{t('reduction.current')}</th><th className="w-8" /><th className="px-3 py-2 text-right font-medium">{t('reduction.target')}</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {REDUCTION_ROWS.filter((row) => r[row.from] != null || r[row.to] != null).map((row) => (
                          <tr key={row.key}>
                            <td className="px-3 py-2">{te(`reduction.${row.key}`)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r[row.from])}</td>
                            <td className="text-center text-muted-foreground"><ArrowRight className="mx-auto size-3.5" /></td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(r[row.to])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}
              {(r.project_type_id || r.scope_assessment || r.estimated_md != null) && (
                <Section title={t('section.received')}>
                  <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
                    <Field label={t('review.projectType')}>{types.find((x) => x.id === r.project_type_id)?.name}</Field>
                    <Field label={t('review.template')}>{templates.find((x) => x.id === r.template_id)?.name}</Field>
                    <Field label={t('review.projectLeader')}>{profileName(r.proposed_leader_id)}</Field>
                    {r.authority_approver_id && <Field label={t('review.authorityApprover')}>{profileName(r.authority_approver_id)}</Field>}
                    {r.estimated_md != null && <Field label={t('review.estimatedEffort')}>{t('review.md', { md: fmtNum(r.estimated_md) })}</Field>}
                  </div>
                  {r.scope_assessment && <InfoBlock label={t('review.scope')}>{r.scope_assessment}</InfoBlock>}
                </Section>
              )}
            </>
          ))}

          {tab === 'clarify' && hasClarify && (
            <Section
              title={t('clarify.title')}
              actions={r.ai_coverage && <span className="text-xs text-muted-foreground">{t('clarify.checked', { at: fmtDateTime(r.ai_coverage.checked_at) })}</span>}
            >
              <p className="mb-3 text-xs text-muted-foreground">{t('clarify.note')}</p>
              {coverage && coverage.missing.length > 0 && (
                <Alert className="mb-3 border-[#fdab3d] bg-[#fff6e5]"><CircleHelp /><AlertDescription>
                  {t.rich('clarify.missing', { items: coverage.missing.map((m) => m.label).join(', '), b: (c) => <b>{c}</b> })}
                </AlertDescription></Alert>
              )}
              {r.ai_coverage && (() => {
                const applicable = r.ai_coverage.criteria.filter((c) => c.status !== 'not_applicable');
                const na = r.ai_coverage.criteria.filter((c) => c.status === 'not_applicable');
                return (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {applicable.map((c) => (
                        <div key={c.key} className={cn('rounded-lg border p-3', c.status === 'missing' && 'border-[#fdab3d]/60 bg-[#fff8eb]')}>
                          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                            <CoverageIcon c={c} />
                            <span className="flex-1">{c.label}</span>
                            {c.required && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground uppercase">{t('clarify.required')}</span>}
                          </div>
                          <div className="text-sm break-words whitespace-pre-wrap text-muted-foreground" title={c.note ?? undefined}>
                            {c.summary || (c.status === 'missing' ? <i>{t('clarify.notCovered')}</i> : c.note)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {na.length > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">{t('clarify.notApplicable', { items: na.map((c) => c.label).join(', ') })}</p>
                    )}
                  </>
                );
              })()}
              {!!r.ai_clarifications?.length && (
                <ol className="mt-4 space-y-3 border-t pt-4">
                  {r.ai_clarifications.map((c, i) => (
                    <li key={i} className="text-sm">
                      <div className="font-medium">{i + 1}. {c.question}</div>
                      {c.answer
                        ? <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{c.answer}</div>
                        : <div className="mt-0.5 text-xs text-muted-foreground italic">{t('clarify.skipped')}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {!!r.ai_chat?.length && (
                <details className="group mt-4 rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none">
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> {t('clarify.conversation')}
                    <span className="text-xs font-normal text-muted-foreground">· {t('clarify.messages', { count: r.ai_chat.length })}</span>
                  </summary>
                  <div className="max-h-[32rem] space-y-2 overflow-y-auto border-t px-3 py-3">
                    {r.ai_chat.map((m, i) => (
                      <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}>
                        <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
                          m.role === 'user' ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-muted')}>
                          {m.content}
                          {/* a speech-to-text transcript: words may be misheard */}
                          {m.voice && <span className="mt-1 flex items-center gap-1 text-[10px] opacity-70"><Mic className="size-3" /> {t('clarify.spoken')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Section>
          )}

          {tab === 'attachments' && (
            <Section title={t('tab.attachments')}>
              <EvidencePanel entityType="request" entityId={r.id} requestId={r.id} canAdd={editable || (mine && !['converted', 'cancelled', 'rejected'].includes(r.status)) || hasRole('system_reviewer')} defaultInternal={false} />
            </Section>
          )}

          {tab === 'history' && (
            <>
              <Section title={t('section.approvalHistory')}>
                {actions.length === 0 ? <p className="text-sm text-muted-foreground">{t('noActions')}</p> : (
                  <ol>
                    {[...actions].reverse().map((a, i, all) => {
                      const meta = HISTORY_META[a.action] ?? HISTORY_META.cancel;
                      return (
                        <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {i < all.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-0.5 bg-border" />}
                          <Bubble tone={meta}><meta.icon className="size-3.5" strokeWidth={2.5} /></Bubble>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="text-sm">
                              <span className="font-semibold" style={{ color: meta.fg }}>{enumText('approvalAction', a.action)}</span>
                              {a.step_code && <span className="text-xs text-muted-foreground"> · {steps.find((s) => s.id === a.step_id)?.step_name ?? a.step_code.replace('_', ' ')}</span>}
                            </div>
                            <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{profileName(a.action_by)}</span> · {fmtDateTime(a.created_at)}</div>
                            {a.comment && <div className="mt-1.5 rounded-md border-l-2 bg-muted/60 px-2.5 py-1.5 text-xs italic" style={{ borderColor: meta.fg }}>“{a.comment}”</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
              <Section title={t('section.changeHistory')}>
                <AuditHistory requestId={r.id} entity={{ table: 'project_requests', id: r.id }} />
              </Section>
            </>
          )}
        </div>

        <div className="col-span-12 xl:col-span-4">
          {r.submitted_at && (r.ai_analysis || hasRole('system_reviewer')) && (
            <AiAnalysisCard
              requestId={r.id} initial={r.ai_analysis} reviewerMd={r.estimated_md} canRun={mine || hasRole('system_reviewer')} reviewer={hasRole('system_reviewer')}
              onApply={isReview ? (typeId, tplId) => setReview((v) => ({ ...v, project_type_id: typeId?.toString() ?? v.project_type_id, template_id: tplId?.toString() ?? v.template_id })) : undefined}
              onError={(m) => notify(m, 'error')}
            />
          )}
          {isReview && (
            <Section title={t('review.title', { step: waiting?.step_name ?? '' })} className="ring-2 ring-[#fdab3d]">
              <div className="space-y-3">
                <SelectField label={t('review.projectType')} required value={review.project_type_id} onChange={(v) => {
                  const tpl = templates.find((x) => x.project_type_id === Number(v));
                  setReview({ ...review, project_type_id: v, template_id: review.template_id || tpl?.id.toString() || '' });
                }} options={types.map((x) => ({ value: x.id.toString(), label: x.name }))} />
                <SelectField label={t('review.projectTemplate')} allowEmpty value={review.template_id} onChange={(v) => setReview({ ...review, template_id: v })} options={templates.map((x) => ({ value: x.id.toString(), label: x.name }))} />
                <UserSelect label={t('review.projectLeader')} required roles={['project_leader']} value={review.proposed_leader_id} onChange={(v) => setReview({ ...review, proposed_leader_id: v })} />
                {legacyReview && <UserSelect label={t('review.authorityApprover')} required roles={['authority_approver']} value={review.authority_approver_id} onChange={(v) => setReview({ ...review, authority_approver_id: v })} />}
                <TextField label={t('review.estimatedEffortMd')} type="number" value={review.estimated_md} onChange={(v) => setReview({ ...review, estimated_md: v })}
                  placeholder={r.ai_analysis?.status === 'done' ? t('review.aiRange', { min: r.ai_analysis.effort_min ?? '', max: r.ai_analysis.effort_max ?? '' }) : t('review.manDays')}
                  helperText={t('review.estimateHelp')} />
                <TextField label={t('review.scope')} multiline value={review.scope_assessment} onChange={(v) => setReview({ ...review, scope_assessment: v })} />
                <Button variant="outline" className="w-full" onClick={saveReview}>{t('review.save')}</Button>
              </div>
            </Section>
          )}

          {canConvert && (
            <div ref={setConvertCard} className="scroll-mt-4">
              <Section title={t('convert.title')} className="ring-2 ring-[#00c875]">
                <p className="mb-3 text-sm text-muted-foreground">{t('convert.note')}</p>
                <div className="space-y-3">
                  <DateField label={t('convert.startDate')} required value={conv.start} onChange={(v) => setConv({ ...conv, start: v })} />
                  <DateField label={t('convert.targetDate')} required value={conv.target} onChange={(v) => setConv({ ...conv, target: v })} />
                  <TextField label={t('convert.sponsor')} value={conv.sponsor} onChange={(v) => setConv({ ...conv, sponsor: v })} />
                </div>
              </Section>
            </div>
          )}

          <Section title={t('section.route')}>
            {current.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('notSubmittedYet')}</p>
            ) : (
              <ol>
                {current.map((s, i) => {
                  const meta = STEP_META[s.status];
                  const group = stepGroup(s);
                  const newGroup = i === 0 || group !== stepGroup(current[i - 1]);
                  const isWaiting = s.status === 'waiting';
                  return (
                    <Fragment key={s.id}>
                      {newGroup && (
                        <li className={cn('relative pb-2 pl-10', i > 0 && 'pt-1')}>
                          {i > 0 && <span className={cn('absolute inset-y-0 left-[13px] w-0.5', current[i - 1].status === 'approved' ? 'bg-[#00c875]' : 'bg-border')} />}
                          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{te(`routeGroup.${group}`)}</span>
                        </li>
                      )}
                      <li className="relative flex gap-3 pb-4 last:pb-0">
                        {i < current.length - 1 && (
                          <span className={cn('absolute top-7 bottom-0 left-[13px] w-0.5', s.status === 'approved' ? 'bg-[#00c875]' : 'bg-border')} />
                        )}
                        <Bubble tone={meta ?? { fg: '#676879', bg: '#eef0f4' }}>
                          {meta ? <meta.icon className="size-3.5" strokeWidth={2.5} /> : s.step_no}
                        </Bubble>
                        <div className={cn('min-w-0 flex-1', isWaiting && '-mt-1 rounded-lg border border-[#fdab3d]/60 bg-[#fff8eb] px-3 py-2')}>
                          <div className="flex items-start gap-2">
                            <span className={cn('flex-1 pt-1 text-sm font-semibold', !meta && 'text-muted-foreground')}>{s.step_name}</span>
                            <span
                              className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', isWaiting && canAct && 'motion-pulse')}
                              style={meta ? { background: meta.bg, color: meta.fg } : { background: '#eef0f4', color: '#676879' }}
                            >
                              {isWaiting && canAct ? t('yourTurn') : t.has(`stepStatus.${s.status}` as 'stepStatus.waiting') ? t(`stepStatus.${s.status}` as 'stepStatus.waiting') : s.status.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="size-3 shrink-0" />
                            <span className="truncate">{audience(s)}</span>
                          </div>
                          {s.acted_at && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {t.rich('actedBy', { name: profileName(s.acted_by), at: fmtDateTime(s.acted_at), b: (c) => <span className="font-medium text-foreground">{c}</span> })}
                            </div>
                          )}
                          {s.comment && <div className="mt-1.5 rounded-md border-l-2 bg-muted/60 px-2.5 py-1.5 text-xs italic" style={{ borderColor: meta?.fg }}>“{s.comment}”</div>}
                        </div>
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title={t('section.requestor')}>
            <div className="mb-3 flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6f1fd] text-sm font-semibold text-[#0073ea]">
                {(r.req_full_name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{r.req_full_name}</div>
                <div className="truncate text-xs text-muted-foreground">{[r.req_employee_id, r.req_department, r.req_section].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              {r.req_email && <a href={`mailto:${r.req_email}`} className="flex items-center gap-2 truncate text-primary hover:underline"><Mail className="size-3.5 shrink-0 text-muted-foreground" />{r.req_email}</a>}
              {(r.req_telephone || r.req_extension) && <div className="flex items-center gap-2"><Phone className="size-3.5 shrink-0 text-muted-foreground" />{[r.req_telephone, r.req_extension && t('ext', { ext: r.req_extension })].filter(Boolean).join(' · ')}</div>}
            </div>
          </Section>
        </div>
      </div>

      {floating && (
        // The decision lives here rather than in a card, so it stays on screen however far the details run.
        // It sits in the page flow, so at the very bottom it settles below the content instead of covering it.
        <div className={cn(
          'sticky bottom-4 z-30 mt-5 flex items-center gap-3 rounded-xl border bg-white/95 p-2.5 pl-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 backdrop-blur animate-in fade-in slide-in-from-bottom-4',
          floating === 'approval' ? 'ring-primary/40' : 'ring-[#00c875]/40',
        )}>
          {floating === 'approval' && waiting ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Hourglass className="size-3.5" /></span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-primary">{t('bar.actionRequired', { step: current.indexOf(waiting) + 1, total: current.length })}</span>
                <span className="block truncate text-sm font-semibold">{waiting.step_name}</span>
              </span>
            </div>
          ) : (
            <button type="button" title={t('bar.editDates')} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => convertCard?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#00c875] text-white"><Rocket className="size-3.5" /></span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-[#00854d]">{t('bar.readyToConvert')}</span>
                <span className="block truncate text-sm font-semibold">{conv.start && conv.target ? `${fmtDate(conv.start)} → ${fmtDate(conv.target)}` : t('bar.setDates')}</span>
              </span>
            </button>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {floating === 'approval' ? (
              <>
                {otherActs.map((a) => {
                  const Icon = ACT_META[a].icon;
                  return (
                    <ActionButton key={a} tone={ACT_META[a].tone} outline title={t(`act.${a}.label`)} aria-label={t(`act.${a}.label`)} className="h-9 gap-1.5 px-2.5 text-xs" onClick={() => go(a)}>
                      <Icon className="size-4" /><span className="hidden lg:inline">{t(`act.${a}.short`)}</span>
                    </ActionButton>
                  );
                })}
                <ActionButton tone="success" className="h-9 gap-1.5 px-4 text-sm shadow-sm" onClick={() => go('approve')}>
                  <Check className="size-4" strokeWidth={3} /> {t('act.approve.label')}
                </ActionButton>
              </>
            ) : (
              <ActionButton tone="success" className="h-9 gap-1.5 px-4 text-sm shadow-sm" onClick={async () => {
                // Dates live in the card, so send the user there when they are missing; otherwise confirm what will be created.
                if (!conv.start || !conv.target) return convertCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (await confirmDialog({ title: t('convert.confirmTitle'), description: conv.sponsor ? t('convert.confirmWithSponsor', { from: fmtDate(conv.start), to: fmtDate(conv.target), sponsor: conv.sponsor }) : t('convert.confirmText', { from: fmtDate(conv.start), to: fmtDate(conv.target) }), confirmText: t('convert.confirm') })) await convert();
              }}>
                <Rocket className="size-4" /> {t('convert.button')}<span className="hidden sm:inline"> {t('convert.buttonSuffix')}</span>
              </ActionButton>
            )}
          </div>
        </div>
      )}

      {dialog && waiting && (
        <CommentDialog
          open
          title={`${t(`act.${dialog}.label`)} — ${waiting.step_name}`}
          description={`${r.request_no} · ${r.project_name}`}
          confirmLabel={t(`act.${dialog}.label`)}
          variant={ACT_META[dialog].tone}
          required={ACT_META[dialog].required}
          onClose={() => setDialog(null)}
          onConfirm={async (comment) => {
            const ok = await rpc('act_on_approval', { p_step_id: waiting.id, p_action: dialog, p_comment: comment || null }, t('toast.actDone', { action: t(`act.${dialog}.label`) }));
            if (!ok) return;
            setDialog(null);
            if (dialog === 'approve') celebrate(t('celebrate.approved'), waiting.step_name);
          }}
        />
      )}
    </>
  );
}
