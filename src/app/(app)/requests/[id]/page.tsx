'use client';

import dayjs from 'dayjs';
import { Ban, Check, CircleHelp, Hourglass, MessageCircleQuestion, Rocket, Send, Undo2, Users, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import AuditHistory from '@/components/AuditHistory';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { ActionButton, CommentDialog, DateField, Field, PageHeader, PriorityChip, Section, SelectField, StatusChip, TextField, UserSelect } from '@/components/common';
import EvidencePanel from '@/components/EvidencePanel';
import RequestForm, { REDUCTION_ROWS } from '@/components/RequestForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDocumentTypes } from '@/components/useDocumentTypes';
import { canActOnStep, canConvertRequest, stepAudience, stepGroup, stepStage } from '@/lib/approval';
import { APPROVAL_ACTION_LABELS, REQUEST_STATUSES, ROLE_LABELS } from '@/lib/constants';
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

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8">
          {editable ? (
            <RequestForm
              key={formKey}
              initial={r}
              onSaved={() => load()}
              onSubmit={async (saved) => { await rpc('submit_request', { p_request_id: saved.id }, 'Request submitted for approval'); }}
            />
          ) : (
            <>
              <Section title="Requestor Information">
                <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
                  <Field label="Employee ID">{r.req_employee_id}</Field>
                  <Field label="Full Name">{r.req_full_name}</Field>
                  <Field label="Department">{r.req_department}</Field>
                  <Field label="Section">{r.req_section}</Field>
                  <Field label="Email">{r.req_email}</Field>
                  <Field label="Telephone / Ext.">{[r.req_telephone, r.req_extension].filter(Boolean).join(' / ')}</Field>
                </div>
              </Section>
              <Section title="Project Information">
                <Field label="Brief Description of Request">{r.description}</Field>
                <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
                  <Field label="Reason for Request">{r.reason}</Field>
                  <Field label="Expectation for Project Result">{r.expectation}</Field>
                </div>
                <div className="grid grid-cols-3 gap-x-4">
                  <Field label="Date Submitted">{fmtDate(r.date_submitted)}</Field>
                  <Field label="Date Required">{fmtDate(r.date_required)}</Field>
                  {r.requestor_approver_id && <Field label="Requestor Approver">{profileName(r.requestor_approver_id)}</Field>}
                </div>
              </Section>
              {REDUCTION_ROWS.some((row) => r[row.from] != null || r[row.to] != null) && (
                <Section title="Reduction">
                  <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
                    {REDUCTION_ROWS.map((row) => (
                      <Field key={row.label} label={row.label}>
                        {r[row.from] != null || r[row.to] != null ? `${fmtNum(r[row.from])} → ${fmtNum(r[row.to])}` : null}
                      </Field>
                    ))}
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
                  <Field label="Scope Assessment">{r.scope_assessment}</Field>
                </Section>
              )}
            </>
          )}

          <Section title="Attachments">
            <EvidencePanel entityType="request" entityId={r.id} requestId={r.id} canAdd={editable || (mine && !['converted', 'cancelled', 'rejected'].includes(r.status)) || hasRole('system_reviewer')} defaultInternal={false} />
          </Section>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Section
            title="Approval Route"
            actions={current.length > 0 && <span className="text-xs font-medium text-muted-foreground">{approvedCount} / {current.length} approved</span>}
          >
            {current.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not submitted yet.</p>
            ) : (
              <>
                <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[#00c875] transition-all" style={{ width: `${(approvedCount / current.length) * 100}%` }} />
                </div>
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
                                className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                                style={meta ? { background: meta.bg, color: meta.fg } : { background: '#eef0f4', color: '#676879' }}
                              >
                                {isWaiting && canAct ? 'Your turn' : meta?.label ?? s.status.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Users className="size-3 shrink-0" />
                              <span className="truncate">
                                {s.approver_levels ? stepAudience(s) : s.approver_ids?.length ? s.approver_ids.map(profileName).join(' / ') : s.approver_id ? profileName(s.approver_id) : `Any ${ROLE_LABELS[s.approver_role as Role] ?? s.approver_role}`}
                              </span>
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
              </>
            )}
          </Section>

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
            if (ok) setDialog(null);
          }}
        />
      )}
    </>
  );
}
