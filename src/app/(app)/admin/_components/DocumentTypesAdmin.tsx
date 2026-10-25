'use client';

import { ArrowDown, ArrowUp, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/labels';
import { MultiSelect, SelectField, TextField } from '@/components/shared/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useOptions } from '@/i18n/useOptions';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { DocumentType, PositionLevel } from '@/lib/types';
import { DEFAULT_CRITERIA, type ClarifyCriterion } from '@/lib/clarify';
import { POSITION_LEVELS, ROUTE_STAGES, andUp, defaultRoute, formatPrefix, routeApprovers, routeProblems, type RouteStage, type RouteStep } from '@/lib/approval';
import { cn } from '@/lib/utils';
import { DOC_TOKENS, TokenHints, previewCode } from './codeFormat';

type DocDraft = Omit<DocumentType, 'id'> & { id?: number };
const newDoc = (sort: number): DocDraft => ({
  code: '', name: '', form_no: '', request_no_format: '{DOC}-{YYYY}-{SEQ:4}', approval_route: defaultRoute(), clarify_criteria: DEFAULT_CRITERIA, sort_order: sort, is_active: true,
});

export function DocumentTypesAdmin() {
  const t = useTranslations('admin.docTypes');
  const tc = useTranslations('common');
  const { text: enumText } = useOptions();
  const db = dbClient();
  const { notify, profiles } = useApp();
  const [rows, setRows] = useState<DocumentType[]>([]);
  const [edit, setEdit] = useState<DocDraft | null>(null);
  const [savedEdit, setSavedEdit] = useState('');
  const dirty = !!edit && JSON.stringify(edit) !== savedEdit;
  const load = useCallback(async () => {
    const list = ((await db.from('document_types').select('*').order('sort_order').order('name')).data ?? []) as DocumentType[];
    setRows(list);
    return list;
  }, [db]);
  const open = (d: DocDraft) => {
    setEdit(d);
    setSavedEdit(JSON.stringify(d));
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load().then((list) => list[0] && open(list[0]));
  }, [load]);

  const problems = (d: DocDraft) => {
    const out: string[] = [];
    if (!d.code.trim()) out.push(t('problem.code'));
    if (!d.name.trim()) out.push(t('problem.name'));
    if (!/\{SEQ:\d+\}/.test(d.request_no_format)) out.push(t('problem.seq', { token: '{SEQ:n}' }));
    const year = String(new Date().getFullYear());
    const clash = rows.find((o) => o.id !== d.id && formatPrefix(o.request_no_format, o.code, year) === formatPrefix(d.request_no_format, d.code, year));
    if (clash) out.push(t('problem.clash', { name: clash.name, token: '{DOC}' }));
    if ((d.clarify_criteria ?? []).some((c) => !c.label.trim())) out.push(t('problem.criterion'));
    return [...out, ...routeProblems(d.approval_route).map((c) => enumText('routeProblem', c))];
  };

  const save = async () => {
    if (!edit) return;
    const p = problems(edit);
    if (p.length) return notify(t('cannotSave', { problems: p.join('; ') }), 'error');
    const { id, code, name, form_no, request_no_format, approval_route, sort_order, is_active } = edit;
    const clarify_criteria = (edit.clarify_criteria ?? []).map((c) => ({ ...c, label: c.label.trim(), hint: c.hint.trim() }));
    const payload = { code: code.trim(), name: name.trim(), form_no: form_no?.trim() || null, request_no_format: request_no_format.trim(), approval_route, clarify_criteria, sort_order, is_active };
    const res = id
      ? await db.from('document_types').update(payload).eq('id', id).select().single()
      : await db.from('document_types').insert(payload).select().single();
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(t('saved', { name: payload.name }));
    await load();
    open(res.data as DocumentType);
  };

  const route = edit?.approval_route ?? [];
  const setRoute = (r: RouteStep[]) => edit && setEdit({ ...edit, approval_route: r });
  const patchStep = (i: number, patch: Partial<RouteStep>) => setRoute(route.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = (stage: RouteStage) => {
    const at = route.reduce((last, s, j) => (ROUTE_STAGES.findIndex((x) => x.value === s.stage) <= ROUTE_STAGES.findIndex((x) => x.value === stage) ? j + 1 : last), 0);
    let n = 1;
    while (route.some((s) => s.step_code === `${stage}_${n}`)) n++;
    const step: RouteStep = stage === 'requestor'
      ? { step_code: `${stage}_${n}`, step_name: 'Approved By', stage, levels: andUp('manager') }
      : { step_code: `${stage}_${n}`, step_name: 'Approved Request By', stage, approvers: [] };
    setRoute([...route.slice(0, at), step, ...route.slice(at)]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (route[j]?.stage !== route[i].stage) return;
    const next = [...route];
    [next[i], next[j]] = [next[j], next[i]];
    setRoute(next);
  };
  const criteria = edit?.clarify_criteria ?? [];
  const setCriteria = (c: ClarifyCriterion[]) => edit && setEdit({ ...edit, clarify_criteria: c });
  const patchCriterion = (i: number, patch: Partial<ClarifyCriterion>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCriterion = () => {
    let n = 1;
    while (criteria.some((c) => c.key === `custom_${n}`)) n++;
    setCriteria([...criteria, { key: `custom_${n}`, label: '', hint: '', required: false }]);
  };
  const moveCriterion = (i: number, d: -1 | 1) => {
    const next = [...criteria];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setCriteria(next);
  };
  const personOpts = (selected: number[]) => profiles.filter((p) => p.is_active || selected.includes(p.id)).map((p) => ({ value: String(p.id), label: p.full_name }));
  const stepNo = (i: number) => <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>;

  const stageBlock = (stage: RouteStage, hint: string) => {
    const items = route.map((s, i) => ({ s, i })).filter(({ s }) => s.stage === stage);
    const fixed = stage === 'receive';
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{enumText('routeStage', stage)}</span>
          {!fixed && <Button size="sm" variant="ghost" className="h-7" onClick={() => addStep(stage)}><Plus /> {t('addStep')}</Button>}
        </div>
        {items.length === 0 && <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('noSteps')}</p>}
        <ol className="space-y-1.5">
          {items.map(({ s, i }) => (
            <li key={s.step_code} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <span className="mt-1.5">{stepNo(i)}</span>
              <Input className="h-9 w-44 shrink-0" value={s.step_name} onChange={(e) => patchStep(i, { step_name: e.target.value })} />
              {stage === 'requestor' ? (
                <SelectField className="flex-1" value={s.levels?.[0] ?? ''} onChange={(v) => patchStep(i, { levels: andUp(v as PositionLevel) })}
                  options={POSITION_LEVELS.map((l) => ({ value: l.value, label: t('levelUp', { level: enumText('positionLevel', l.value) }) }))} />
              ) : (
                <MultiSelect className="flex-1" placeholder={t('selectPeople')} value={routeApprovers(s).map(String)}
                  options={personOpts(routeApprovers(s))} onChange={(v) => patchStep(i, { approvers: v.map(Number) })} />
              )}
              {!fixed && (
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" className="size-9" disabled={route[i - 1]?.stage !== stage} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" className="size-9" disabled={route[i + 1]?.stage !== stage} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size="icon" variant="ghost" className="size-9 text-destructive" onClick={() => setRoute(route.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </div>
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <BoardGroup title={t('title')} color="#579bfc" count={rows.length}
        actions={<Button size="sm" onClick={() => open(newDoc((rows.at(-1)?.sort_order ?? 0) + 1))}><Plus /> {tc('add')}</Button>}>
        <ul className="divide-y">
          {rows.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => open(d)}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60', edit?.id === d.id && 'bg-primary/5')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{previewCode(d.request_no_format, null, d.code)}</span>
                </span>
                {!d.is_active && <Badge variant="secondary">{t('inactive')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </BoardGroup>

      {edit && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{edit.id ? edit.name || t('documentType') : t('new')}</CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-12 gap-3">
                <TextField className="col-span-3" label={t('field.code')} required value={edit.code} disabled={!!edit.id}
                  onChange={(v) => setEdit({ ...edit, code: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  helperText={edit.id ? t('field.codeFixed') : t('field.codeHelp', { token: '{DOC}' })} />
                <TextField className="col-span-6" label={t('field.name')} required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
                <TextField className="col-span-3" label={t('field.formNo')} value={edit.form_no} placeholder="FM-SYS-004" onChange={(v) => setEdit({ ...edit, form_no: v })} />
                <div className="col-span-9">
                  <TextField label={t('field.requestNo')} required mono value={edit.request_no_format} onChange={(v) => setEdit({ ...edit, request_no_format: v })} />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {t('preview')} <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(edit.request_no_format, null, edit.code) || '—'}</span>
                    {' '}· {t('field.continues')}
                  </div>
                </div>
                <TextField className="col-span-3" label={t('field.order')} type="number" value={edit.sort_order} onChange={(v) => setEdit({ ...edit, sort_order: Number(v) || 0 })} />
              </div>
              <TokenHints tokens={DOC_TOKENS} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={edit.is_active} onCheckedChange={(c) => setEdit({ ...edit, is_active: c })} /> {t('field.open')}
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('route.title')}</CardTitle>
              <CardDescription>{t('route.description', { name: edit.name || t('route.request') })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {stageBlock('requestor', t('route.hint.requestor'))}
              {stageBlock('receive', t('route.hint.receive'))}
              {stageBlock('authority', t('route.hint.authority'))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {t('criteria.title')}</CardTitle>
              <CardDescription>{t('criteria.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {criteria.length === 0 && <p className="mb-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('criteria.none')}</p>}
              <ol className="space-y-1.5">
                {criteria.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    {stepNo(i)}
                    <Input className="h-9 w-48 shrink-0" placeholder={t('criteria.name')} value={c.label} onChange={(e) => patchCriterion(i, { label: e.target.value })} />
                    <Input className="h-9 flex-1" placeholder={t('criteria.hint')} value={c.hint} onChange={(e) => patchCriterion(i, { hint: e.target.value })} />
                    <label className="flex shrink-0 items-center gap-1.5 text-xs">
                      <Switch checked={c.required} onCheckedChange={(v) => patchCriterion(i, { required: v })} /> {t('criteria.required')}
                    </label>
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" className="size-9" disabled={i === 0} onClick={() => moveCriterion(i, -1)}><ArrowUp /></Button>
                      <Button size="icon" variant="ghost" className="size-9" disabled={i === criteria.length - 1} onClick={() => moveCriterion(i, 1)}><ArrowDown /></Button>
                      <Button size="icon" variant="ghost" className="size-9 text-destructive" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" className="h-7" onClick={addCriterion}><Plus /> {t('criteria.add')}</Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setCriteria(DEFAULT_CRITERIA)}><RotateCcw /> {t('criteria.reset')}</Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {problems(edit).length > 0 && <span className="text-xs text-destructive">{problems(edit)[0]}</span>}
            {route.some((s) => s.stage !== 'requestor' && !routeApprovers(s).length) && !problems(edit).length && (
              <span className="text-xs text-destructive">{t('needApprovers')}</span>
            )}
            <Button variant={dirty ? 'default' : 'outline'} disabled={!dirty} onClick={save}>{tc('save')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
