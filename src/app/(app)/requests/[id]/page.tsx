'use client';

import dayjs from 'dayjs';
import { CircleCheck, CircleDashed, CircleHelp, CircleX, Hourglass, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AuditHistory from '@/components/AuditHistory';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { ActionButton, CommentDialog, DateField, Field, PageHeader, PriorityChip, Section, SelectField, StatusChip, TextField, UserSelect } from '@/components/common';
import EvidencePanel from '@/components/EvidencePanel';
import RequestForm from '@/components/RequestForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { APPROVAL_ACTION_LABELS, REQUEST_STATUSES, ROLE_LABELS } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ApprovalAction, ApprovalStep, ProjectRequest, ProjectTemplate, ProjectType, Role } from '@/lib/types';
import { cn } from '@/lib/utils';

type Act = 'approve' | 'reject' | 'send_back' | 'request_more_info';
const ACT_META: Record<Act, { label: string; tone: 'success' | 'destructive' | 'warning' | 'secondary'; required: boolean }> = {
  approve: { label: 'Approve', tone: 'success', required: false },
  reject: { label: 'Reject', tone: 'destructive', required: true },
  send_back: { label: 'Send Back', tone: 'warning', required: true },
  request_more_info: { label: 'Request More Information', tone: 'secondary', required: true },
};

function StepIcon({ status }: { status: string }) {
  const cls = 'size-5 shrink-0';
  switch (status) {
    case 'approved': return <CircleCheck className={cn(cls, 'text-[#00c875]')} />;
    case 'waiting': return <Hourglass className={cn(cls, 'text-[#fdab3d]')} />;
    case 'rejected': return <CircleX className={cn(cls, 'text-[#e2445c]')} />;
    case 'sent_back': return <Undo2 className={cn(cls, 'text-[#fdab3d]')} />;
    case 'more_info': return <CircleHelp className={cn(cls, 'text-[#a25ddc]')} />;
    default: return <CircleDashed className={cn(cls, 'text-muted-foreground/50')} />;
  }
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const { me, hasRole, profileName, notify, refreshUnread } = useApp();
  const [r, setR] = useState<ProjectRequest | null>(null);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [actions, setActions] = useState<ApprovalAction[]>([]);
  const [types, setTypes] = useState<ProjectType[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [dialog, setDialog] = useState<Act | null>(null);
  const [review, setReview] = useState({ project_type_id: '', template_id: '', proposed_leader_id: null as string | null, authority_approver_id: null as string | null, scope_assessment: '' });
  const [conv, setConv] = useState({ start: dayjs().format('YYYY-MM-DD'), target: '', sponsor: '' });
  const [notFound, setNotFound] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('project_requests').select('*').eq('id', id).maybeSingle();
    if (error || !data) return setNotFound(true);
    setR(data);
    setReview({
      project_type_id: data.project_type_id?.toString() ?? '', template_id: data.template_id?.toString() ?? '',
      proposed_leader_id: data.proposed_leader_id, authority_approver_id: data.authority_approver_id, scope_assessment: data.scope_assessment ?? '',
    });
    setConv((c) => ({ ...c, target: c.target || data.date_required || '' }));
    const [s, a] = await Promise.all([
      supabase.from('approval_steps').select('*').eq('request_id', id).order('cycle').order('step_no'),
      supabase.from('approval_actions').select('*').eq('request_id', id).order('created_at'),
    ]);
    setSteps((s.data ?? []) as ApprovalStep[]);
    setActions((a.data ?? []) as ApprovalAction[]);
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
    supabase.from('project_types').select('*').eq('is_active', true).order('name').then(({ data }) => setTypes(data ?? []));
    supabase.from('project_templates').select('*').eq('is_active', true).order('name').then(({ data }) => setTemplates(data ?? []));
  }, [load, supabase]);

  if (notFound) return <Alert><AlertDescription>Request not found or you do not have access.</AlertDescription></Alert>;
  if (!r || !me) return null;

  const mine = r.requestor_id === me.id;
  const editable = mine && ['draft', 'need_more_information'].includes(r.status);
  const cycle = Math.max(0, ...steps.map((s) => s.cycle));
  const current = steps.filter((s) => s.cycle === cycle);
  const waiting = current.find((s) => s.status === 'waiting');
  const canAct = !!waiting && (waiting.approver_id ? waiting.approver_id === me.id : me.roles.includes(waiting.approver_role as never));
  const isReview = canAct && waiting?.step_code === 'system_review';
  const canConvert = r.status === 'approved' && (hasRole('system_reviewer') || r.proposed_leader_id === me.id);

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { data, error } = await supabase.rpc(fn, args);
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
              const { error } = await supabase.from('project_requests').delete().eq('id', r.id);
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
                  <Field label="Requestor Approver">{profileName(r.requestor_approver_id)}</Field>
                </div>
                <Field label="Reduction / Benefit Details">{r.benefit}</Field>
              </Section>
              {(r.project_type_id || r.scope_assessment) && (
                <Section title="System Service Review">
                  <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
                    <Field label="Project Type">{types.find((t) => t.id === r.project_type_id)?.name}</Field>
                    <Field label="Template">{templates.find((t) => t.id === r.template_id)?.name}</Field>
                    <Field label="Project Leader">{profileName(r.proposed_leader_id)}</Field>
                    <Field label="Authority Approver">{profileName(r.authority_approver_id)}</Field>
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
          <Section title="Approval Route">
            {current.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not submitted yet.</p>
            ) : (
              <ol className="relative space-y-4">
                {current.map((s, i) => (
                  <li key={s.id} className="relative flex gap-3">
                    {i < current.length - 1 && <span className="absolute top-6 left-[9px] h-[calc(100%-4px)] w-px bg-border" />}
                    <StepIcon status={s.status} />
                    <div className="min-w-0">
                      <div className={cn('text-sm font-semibold', s.status === 'waiting' && 'text-[#d97706]')}>{s.step_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.approver_id ? profileName(s.approver_id) : `Any ${ROLE_LABELS[s.approver_role as Role] ?? s.approver_role}`} · {s.status.replace('_', ' ')}
                      </div>
                      {s.acted_at && <div className="text-xs">{profileName(s.acted_by)} · {fmtDateTime(s.acted_at)}</div>}
                      {s.comment && <div className="text-sm italic">“{s.comment}”</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {isReview && (
            <Section title="System Service Review" className="ring-2 ring-[#fdab3d]">
              <div className="space-y-3">
                <SelectField label="Project Type" required value={review.project_type_id} onChange={(v) => {
                  const tpl = templates.find((t) => t.project_type_id === Number(v));
                  setReview({ ...review, project_type_id: v, template_id: review.template_id || tpl?.id.toString() || '' });
                }} options={types.map((t) => ({ value: t.id.toString(), label: t.name }))} />
                <SelectField label="Project Template" allowEmpty value={review.template_id} onChange={(v) => setReview({ ...review, template_id: v })} options={templates.map((t) => ({ value: t.id.toString(), label: t.name }))} />
                <UserSelect label="Project Leader" required roles={['project_leader']} value={review.proposed_leader_id} onChange={(v) => setReview({ ...review, proposed_leader_id: v })} />
                <UserSelect label="Authority Approver" required roles={['authority_approver']} value={review.authority_approver_id} onChange={(v) => setReview({ ...review, authority_approver_id: v })} />
                <TextField label="Scope Assessment" multiline value={review.scope_assessment} onChange={(v) => setReview({ ...review, scope_assessment: v })} />
                <Button variant="outline" className="w-full" onClick={saveReview}>Save Review</Button>
              </div>
            </Section>
          )}

          {canAct && waiting && (
            <Section title={`Your action — ${waiting.step_name}`} className="ring-2 ring-primary">
              <div className="flex flex-col gap-2">
                {(Object.keys(ACT_META) as Act[]).map((a) => (
                  <ActionButton key={a} tone={ACT_META[a].tone} outline={a !== 'approve'} className="h-9 w-full" onClick={async () => {
                    if (a === 'approve' && isReview) {
                      const saved = await saveReview();
                      if (!saved) return;
                    }
                    setDialog(a);
                  }}>{ACT_META[a].label}</ActionButton>
                ))}
              </div>
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
                  if (p) router.push(`/projects/${(p as { id: string }).id}`);
                }}>Convert to Project</ActionButton>
              </div>
            </Section>
          )}

          <Section title="Approval History">
            {actions.length === 0 ? <p className="text-sm text-muted-foreground">No actions yet.</p> : (
              <div className="divide-y divide-grid">
                {[...actions].reverse().map((a) => (
                  <div key={a.id} className="py-2">
                    <div className="text-sm font-semibold">
                      {APPROVAL_ACTION_LABELS[a.action] ?? a.action}
                      {a.step_code && <span className="text-xs font-normal text-muted-foreground"> · {a.step_code.replace('_', ' ')}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{profileName(a.action_by)} · {fmtDateTime(a.created_at)}</div>
                    {a.comment && <div className="text-sm italic">“{a.comment}”</div>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Change History">
            <AuditHistory requestId={r.id} entityId={r.id} />
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
