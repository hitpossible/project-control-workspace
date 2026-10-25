'use client';

import dayjs from 'dayjs';
import { CalendarClock, CalendarDays, CircleHelp, Hourglass, ListChecks, Sparkles, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import RequestForm from '../_components/RequestForm';
import AiAnalysisCard from './_components/AiAnalysisCard';
import { ApprovalHistory } from './_components/ApprovalHistory';
import { ApprovalRoute } from './_components/ApprovalRoute';
import { ACT_META, type Act } from './_components/approvalMeta';
import { ClarifyPanel } from './_components/ClarifyPanel';
import { DecisionBar } from './_components/DecisionBar';
import { Stat } from './_components/parts';
import { RequestDetails } from './_components/RequestDetails';
import { RequestorCard } from './_components/RequestorCard';
import { ReviewCard, reviewDraft, type ReviewDraft } from './_components/ReviewCard';
import AuditHistory from '@/components/shared/AuditHistory';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { CommentDialog, DateField, TextField } from '@/components/shared/form';
import { PageHeader, Section } from '@/components/shared/layout';
import { PriorityChip, StatusChip } from '@/components/shared/labels';
import EvidencePanel from '@/components/shared/EvidencePanel';
import { celebrate } from '@/components/shared/motion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTypes } from '@/hooks/useDocumentTypes';
import { coverageCount } from '@/lib/clarify';
import { canActOnStep, canConvertRequest, stepAudience, stepStage } from '@/lib/approval';
import { useOptions } from '@/i18n/useOptions';
import { REQUEST_STATUSES, ROLES } from '@/lib/constants';
import { errMsg, fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ApprovalAction, ApprovalStep, ProjectRequest, ProjectTemplate, ProjectType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/shared/ConfirmDialog';

export default function RequestDetailPage() {
  const t = useTranslations('requestDetail');
  const tf = useTranslations('requestForm.field');
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
  const [review, setReview] = useState<ReviewDraft>({ project_type_id: '', template_id: '', proposed_leader_id: null, authority_approver_id: null, scope_assessment: '', estimated_md: '' });
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
    setReview(reviewDraft(data));
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
  const convert = async () => {
    const p = await rpc('convert_request_to_project', { p_request_id: r.id, p_start_date: conv.start, p_target_date: conv.target, p_sponsor: conv.sponsor || null }, t('toast.projectCreated'));
    if (p) router.push(`/projects/${(p as { id: number }).id}`);
  };
  const floating = canAct && waiting ? 'approval' : canConvert ? 'convert' : null;
  const showConvertCard = () => convertCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
          ) : <RequestDetails r={r} types={types} templates={templates} />)}

          {tab === 'clarify' && hasClarify && <ClarifyPanel r={r} />}

          {tab === 'attachments' && (
            <Section title={t('tab.attachments')}>
              <EvidencePanel entityType="request" entityId={r.id} requestId={r.id} canAdd={editable || (mine && !['converted', 'cancelled', 'rejected'].includes(r.status)) || hasRole('system_reviewer')} defaultInternal={false} />
            </Section>
          )}

          {tab === 'history' && (
            <>
              <Section title={t('section.approvalHistory')}>
                <ApprovalHistory actions={actions} steps={steps} />
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
          {isReview && waiting && (
            <ReviewCard r={r} stepName={waiting.step_name} review={review} onChange={setReview} types={types} templates={templates} legacy={legacyReview} onSave={saveReview} />
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
            <ApprovalRoute steps={current} canAct={canAct} audience={audience} />
          </Section>

          <RequestorCard r={r} />
        </div>
      </div>

      {floating === 'approval' && waiting && <DecisionBar mode="approval" waiting={waiting} steps={current} onAct={go} />}
      {floating === 'convert' && <DecisionBar mode="convert" conv={conv} onShowDates={showConvertCard} onConvert={convert} />}

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
