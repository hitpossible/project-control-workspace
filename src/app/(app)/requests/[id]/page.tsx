'use client';

import dayjs from 'dayjs';
import { ArrowRight, Ban, CalendarClock, CalendarDays, Check, ChevronRight, CircleHelp, Hourglass, ListChecks, Mail, MessageCircleQuestion, Phone, Rocket, Send, Sparkles, Undo2, Users, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
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
import { APPROVAL_ACTION_LABELS, optLabel, REQUEST_STATUSES, ROLE_LABELS } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ApprovalAction, ApprovalStep, ProjectRequest, ProjectTemplate, ProjectType, Role } from '@/lib/types';
import { cn } from '@/lib/utils';

type Act = 'approve' | 'reject' | 'send_back' | 'request_more_info';
const ACT_META: Record<Act, { label: string; short: string; icon: LucideIcon; tone: 'success' | 'destructive' | 'warning' | 'secondary'; required: boolean }> = {
  approve: { label: 'Approve', short: 'Approve', icon: Check, tone: 'success', required: false },
  reject: { label: 'Reject', short: 'Reject', icon: X, tone: 'destructive', required: true },
  send_back: { label: 'Send Back', short: 'Send Back', icon: Undo2, tone: 'warning', required: true },
  request_more_info: { label: 'Request More Information', short: 'Ask for Info', icon: MessageCircleQuestion, tone: 'secondary', required: true },
};

type Tone = { label: string; icon: LucideIcon; fg: string; bg: string };
const STEP_META: Record<string, Tone> = {
  approved: { label: 'Approved', icon: Check, fg: '#00854d', bg: '#e3f8ee' },
  waiting: { label: 'Waiting', icon: Hourglass, fg: '#b45309', bg: '#fff1d6' },
  rejected: { label: 'Rejected', icon: X, fg: '#d83a52', bg: '#fdebee' },
  sent_back: { label: 'Sent Back', icon: Undo2, fg: '#b45309', bg: '#fff1d6' },
  more_info: { label: 'More Info', icon: MessageCircleQuestion, fg: '#784bd1', bg: '#f1eafc' },
};
const HISTORY_META: Record<string, Tone> = {
  submit: { label: '', icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  resubmit: { label: '', icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  approve: STEP_META.approved,
  reject: STEP_META.rejected,
  send_back: STEP_META.sent_back,
  request_more_info: STEP_META.more_info,
  cancel: { label: '', icon: Ban, fg: '#676879', bg: '#eef0f4' },
  convert: { label: '', icon: Rocket, fg: '#00854d', bg: '#e3f8ee' },
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
  const [review, setReview] = useState({ project_type_id: '', template_id: '', proposed_leader_id: null as number | null, authority_approver_id: null as number | null, scope_assessment: '' });
  const [conv, setConv] = useState({ start: dayjs().format('YYYY-MM-DD'), target: '', sponsor: '' });
  const [notFound, setNotFound] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [tab, setTab] = useState('details');
  const docType = useDocumentTypes().find((t) => t.id === r?.document_type_id);

  const load = useCallback(async () => {
    const { data, error } = await db.from('project_requests').select('*').eq('id', id).maybeSingle();
    if (error || !data) return setNotFound(true);
    setR(data);
    setReview({
      project_type_id: data.project_type_id?.toString() ?? '', template_id: data.template_id?.toString() ?? '',
      proposed_leader_id: data.proposed_leader_id, authority_approver_id: data.authority_approver_id, scope_assessment: data.scope_assessment ?? '',
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

  if (notFound) return <Alert><AlertDescription>Request not found or you do not have access.</AlertDescription></Alert>;
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
  const audience = (s: ApprovalStep) =>
    s.approver_levels ? stepAudience(s) : s.approver_ids?.length ? s.approver_ids.map(profileName).join(' / ') : s.approver_id ? profileName(s.approver_id) : `Any ${ROLE_LABELS[s.approver_role as Role] ?? s.approver_role}`;

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
    }, 'Review saved');

  return (
    <>
      <PageHeader
        title={<>{r.request_no ?? 'Draft request'} — {r.project_name}</>}
        subtitle={<div className="flex flex-wrap items-center gap-2">
          {docType && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{docType.name}</span>}
          <StatusChip list={REQUEST_STATUSES} value={r.status} /> <PriorityChip value={r.priority} />
          <span className="text-xs">Requested by {r.req_full_name} · {r.req_department}</span>
        </div>}
        actions={<>
          {r.project_id && <Button asChild><Link href={`/projects/${r.project_id}`}>Open Project</Link></Button>}
          {mine && ['draft', 'need_more_information', 'waiting_requestor_approval'].includes(r.status) && r.request_no && (
            <Button variant="destructive" onClick={async () => { if (confirm('Cancel this request?')) await rpc('cancel_request', { p_request_id: r.id, p_comment: null }, 'Request cancelled'); }}>Cancel Request</Button>
          )}
          {mine && r.status === 'draft' && !r.request_no && (
            <Button variant="destructive" onClick={async () => {
              if (!confirm('Delete this draft?')) return;
              const { error } = await db.from('project_requests').delete().eq('id', r.id);
              if (error) return notify(errMsg(error), 'error');
              router.replace('/requests');
            }}>Delete Draft</Button>
          )}
        </>}
      />

      {r.status === 'need_more_information' && mine && (
        <Alert className="mb-4 border-[#a25ddc] bg-[#f6effc]"><CircleHelp /><AlertDescription>
          More information requested: <b>{current.find((s) => s.status === 'more_info')?.comment}</b>. Update the request and submit again — it returns to the same approval step.
        </AlertDescription></Alert>
      )}
      {r.status === 'draft' && r.request_no && mine && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]"><Undo2 /><AlertDescription>
          Sent back: <b>{[...actions].reverse().find((a) => a.action === 'send_back')?.comment}</b>. Revise and submit again — approval restarts from step 1.
        </AlertDescription></Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border lg:grid-cols-4">
        <Stat icon={CalendarDays} label="Date Submitted" value={fmtDate(r.date_submitted)} />
        <Stat icon={CalendarClock} label="Date Required" value={fmtDate(r.date_required)}
          hint={daysLeft == null || ['converted', 'cancelled', 'rejected'].includes(r.status) ? null
            : <span className={cn(daysLeft < 0 ? 'text-[#d83a52]' : daysLeft <= 7 && 'text-[#b45309]')}>{daysLeft < 0 ? `${-daysLeft} days overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft} days left`}</span>} />
        <Stat icon={Hourglass} label="Current Step" value={waiting?.step_name ?? optLabel(REQUEST_STATUSES, r.status)}
          hint={waiting && (canAct ? <span className="font-medium text-primary">Your turn</span> : audience(waiting))} />
        <Stat icon={ListChecks} label="Approval Progress" value={current.length ? `${approvedCount} / ${current.length} steps` : 'Not submitted'}
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
              <TabsTrigger value="details" className="flex-none px-3">Details</TabsTrigger>
              {hasClarify && (
                <TabsTrigger value="clarify" className="flex-none gap-1.5 px-3">
                  <Sparkles className="size-3.5" /> Clarifications
                  {coverage && <span className={cn('rounded-full px-1.5 text-[11px] font-medium', coverage.missing.length ? 'bg-[#fff1d6] text-[#b45309]' : 'bg-[#e3f8ee] text-[#00854d]')}>{coverage.covered}/{coverage.total}</span>}
                </TabsTrigger>
              )}
              <TabsTrigger value="attachments" className="flex-none px-3">Attachments</TabsTrigger>
              <TabsTrigger value="history" className="flex-none gap-1.5 px-3">
                History {actions.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium">{actions.length}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'details' && (editable ? (
            <RequestForm
              key={formKey}
              initial={r}
              onSaved={() => load()}
              onSubmit={async (saved) => {
                if (await rpc('submit_request', { p_request_id: saved.id }, 'Request submitted for approval') !== null) celebrate('Request submitted', 'It is now waiting for approval.');
              }}
            />
          ) : (
            <>
              <Section title="Project Information">
                <p className="mb-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{r.description || <span className="text-muted-foreground">No description</span>}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBlock label="Reason for Request">{r.reason}</InfoBlock>
                  <InfoBlock label="Expectation for Project Result">{r.expectation}</InfoBlock>
                </div>
                {r.requestor_approver_id && (
                  <div className="mt-3 text-xs text-muted-foreground">Requestor Approver · <span className="font-medium text-foreground">{profileName(r.requestor_approver_id)}</span></div>
                )}
              </Section>
              {REDUCTION_ROWS.some((row) => r[row.from] != null || r[row.to] != null) && (
                <Section title="Expected Reduction">
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground">
                        <tr><th className="px-3 py-2 text-left font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Current</th><th className="w-8" /><th className="px-3 py-2 text-right font-medium">Target</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {REDUCTION_ROWS.filter((row) => r[row.from] != null || r[row.to] != null).map((row) => (
                          <tr key={row.label}>
                            <td className="px-3 py-2">{row.label}</td>
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
              {(r.project_type_id || r.scope_assessment) && (
                <Section title="System Service — Received Request">
                  <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
                    <Field label="Project Type">{types.find((t) => t.id === r.project_type_id)?.name}</Field>
                    <Field label="Template">{templates.find((t) => t.id === r.template_id)?.name}</Field>
                    <Field label="Project Leader">{profileName(r.proposed_leader_id)}</Field>
                    {r.authority_approver_id && <Field label="Authority Approver">{profileName(r.authority_approver_id)}</Field>}
                  </div>
                  {r.scope_assessment && <InfoBlock label="Scope Assessment">{r.scope_assessment}</InfoBlock>}
                </Section>
              )}
            </>
          ))}

          {tab === 'clarify' && hasClarify && (
            <Section
              title="Project Clarifications"
              actions={r.ai_coverage && <span className="text-xs text-muted-foreground">Checked {fmtDateTime(r.ai_coverage.checked_at)}</span>}
            >
              <p className="mb-3 text-xs text-muted-foreground">Gathered by AI before submit and confirmed by the requestor — please double-check.</p>
              {coverage && coverage.missing.length > 0 && (
                <Alert className="mb-3 border-[#fdab3d] bg-[#fff6e5]"><CircleHelp /><AlertDescription>
                  Still missing: <b>{coverage.missing.map((m) => m.label).join(', ')}</b>
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
                            {c.required && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground uppercase">Required</span>}
                          </div>
                          <div className="text-sm break-words whitespace-pre-wrap text-muted-foreground" title={c.note ?? undefined}>
                            {c.summary || (c.status === 'missing' ? <i>Not covered</i> : c.note)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {na.length > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">Not applicable: {na.map((c) => c.label).join(', ')}</p>
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
                        : <div className="mt-0.5 text-xs text-muted-foreground italic">Skipped by the requestor</div>}
                    </li>
                  ))}
                </ol>
              )}
              {!!r.ai_chat?.length && (
                <details className="group mt-4 rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none">
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> Conversation with the AI
                    <span className="text-xs font-normal text-muted-foreground">· {r.ai_chat.length} messages</span>
                  </summary>
                  <div className="max-h-[32rem] space-y-2 overflow-y-auto border-t px-3 py-3">
                    {r.ai_chat.map((m, i) => (
                      <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}>
                        <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
                          m.role === 'user' ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-muted')}>{m.content}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Section>
          )}

          {tab === 'attachments' && (
            <Section title="Attachments">
              <EvidencePanel entityType="request" entityId={r.id} requestId={r.id} canAdd={editable || (mine && !['converted', 'cancelled', 'rejected'].includes(r.status)) || hasRole('system_reviewer')} defaultInternal={false} />
            </Section>
          )}

          {tab === 'history' && (
            <>
              <Section title="Approval History">
                {actions.length === 0 ? <p className="text-sm text-muted-foreground">No actions yet.</p> : (
                  <ol>
                    {[...actions].reverse().map((a, i, all) => {
                      const meta = HISTORY_META[a.action] ?? HISTORY_META.cancel;
                      return (
                        <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {i < all.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-0.5 bg-border" />}
                          <Bubble tone={meta}><meta.icon className="size-3.5" strokeWidth={2.5} /></Bubble>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="text-sm">
                              <span className="font-semibold" style={{ color: meta.fg }}>{APPROVAL_ACTION_LABELS[a.action] ?? a.action}</span>
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
              <Section title="Change History">
                <AuditHistory requestId={r.id} entity={{ table: 'project_requests', id: r.id }} />
              </Section>
            </>
          )}
        </div>

        <div className="col-span-12 xl:col-span-4">
          {isReview && (
            <Section title={`System Service — ${waiting?.step_name}`} className="ring-2 ring-[#fdab3d]">
              <div className="space-y-3">
                <SelectField label="Project Type" required value={review.project_type_id} onChange={(v) => {
                  const tpl = templates.find((t) => t.project_type_id === Number(v));
                  setReview({ ...review, project_type_id: v, template_id: review.template_id || tpl?.id.toString() || '' });
                }} options={types.map((t) => ({ value: t.id.toString(), label: t.name }))} />
                <SelectField label="Project Template" allowEmpty value={review.template_id} onChange={(v) => setReview({ ...review, template_id: v })} options={templates.map((t) => ({ value: t.id.toString(), label: t.name }))} />
                <UserSelect label="Project Leader" required roles={['project_leader']} value={review.proposed_leader_id} onChange={(v) => setReview({ ...review, proposed_leader_id: v })} />
                {legacyReview && <UserSelect label="Authority Approver" required roles={['authority_approver']} value={review.authority_approver_id} onChange={(v) => setReview({ ...review, authority_approver_id: v })} />}
                <TextField label="Scope Assessment" multiline value={review.scope_assessment} onChange={(v) => setReview({ ...review, scope_assessment: v })} />
                <Button variant="outline" className="w-full" onClick={saveReview}>Save Review</Button>
              </div>
            </Section>
          )}

          {canAct && waiting && (
            <Section className="overflow-hidden bg-gradient-to-b from-[#eef5ff] to-card to-60% ring-2 ring-primary/70">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Hourglass className="size-4" /></span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-primary">Your action required · Step {current.indexOf(waiting) + 1} of {current.length}</div>
                  <h3 className="text-base font-semibold">{waiting.step_name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Review the request, then approve it or pick another action. A comment is required unless you approve.</p>
                </div>
              </div>
              {(() => {
                const go = async (a: Act) => {
                  if (a === 'approve' && isReview) {
                    const saved = await saveReview();
                    if (!saved) return;
                  }
                  setDialog(a);
                };
                const others = (Object.keys(ACT_META) as Act[]).filter((a) => a !== 'approve');
                return (
                  <>
                    <ActionButton tone="success" className="h-11 w-full gap-2 text-sm shadow-sm" onClick={() => go('approve')}>
                      <Check className="size-4" strokeWidth={3} /> Approve
                    </ActionButton>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {others.map((a) => {
                        const Icon = ACT_META[a].icon;
                        return (
                          <ActionButton key={a} tone={ACT_META[a].tone} outline title={ACT_META[a].label} className="h-auto flex-col gap-1 px-1 py-2 text-xs whitespace-normal" onClick={() => go(a)}>
                            <Icon className="size-4" />
                            {ACT_META[a].short}
                          </ActionButton>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </Section>
          )}

          {canConvert && (
            <Section title="Convert to Controlled Project" className="ring-2 ring-[#00c875]">
              <p className="mb-3 text-sm text-muted-foreground">Creates the Project Code, project record, team and default activities from the template.</p>
              <div className="space-y-3">
                <DateField label="Start Date" required value={conv.start} onChange={(v) => setConv({ ...conv, start: v })} />
                <DateField label="Target Date" required value={conv.target} onChange={(v) => setConv({ ...conv, target: v })} />
                <TextField label="Sponsor" value={conv.sponsor} onChange={(v) => setConv({ ...conv, sponsor: v })} />
                <ActionButton tone="success" className="h-9 w-full" disabled={!conv.start || !conv.target} onClick={async () => {
                  const p = await rpc('convert_request_to_project', { p_request_id: r.id, p_start_date: conv.start, p_target_date: conv.target, p_sponsor: conv.sponsor || null }, 'Project created');
                  if (p) router.push(`/projects/${(p as { id: number }).id}`);
                }}>Convert to Project</ActionButton>
              </div>
            </Section>
          )}

          <Section title="Approval Route">
            {current.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not submitted yet.</p>
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
                          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group}</span>
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
                              {isWaiting && canAct ? 'Your turn' : meta?.label ?? s.status.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="size-3 shrink-0" />
                            <span className="truncate">{audience(s)}</span>
                          </div>
                          {s.acted_at && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              by <span className="font-medium text-foreground">{profileName(s.acted_by)}</span> · {fmtDateTime(s.acted_at)}
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

          <Section title="Requestor">
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
              {(r.req_telephone || r.req_extension) && <div className="flex items-center gap-2"><Phone className="size-3.5 shrink-0 text-muted-foreground" />{[r.req_telephone, r.req_extension && `ext. ${r.req_extension}`].filter(Boolean).join(' · ')}</div>}
            </div>
          </Section>
        </div>
      </div>

      {dialog && waiting && (
        <CommentDialog
          open
          title={`${ACT_META[dialog].label} — ${waiting.step_name}`}
          description={`${r.request_no} · ${r.project_name}`}
          confirmLabel={ACT_META[dialog].label}
          variant={ACT_META[dialog].tone}
          required={ACT_META[dialog].required}
          onClose={() => setDialog(null)}
          onConfirm={async (comment) => {
            const ok = await rpc('act_on_approval', { p_step_id: waiting.id, p_action: dialog, p_comment: comment || null }, `${ACT_META[dialog].label}: done`);
            if (!ok) return;
            setDialog(null);
            if (dialog === 'approve') celebrate('Approved', waiting.step_name);
          }}
        />
      )}
    </>
  );
}
