'use client';

import { useReactFlow } from '@xyflow/react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, FoldVertical, Italic, Type, Underline } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Tip } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type DiagramNodeData, type TextStyle } from '@/lib/diagram';
import { type FlowNode } from './flow';

const FONTS = ['Sarabun', 'Helvetica', 'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];
const DEFAULT_FONT = 'default';

/** right-hand panel: text formatting of the selected shapes / tables (draw.io's "Text" panel) */
export function FormatPanel({ selected }: { selected: FlowNode[] }) {
  const t = useTranslations('design.format');
  const { updateNodeData } = useReactFlow();
  const ts = selected[0].data.text ?? {};
  const onlyTables = selected.every((n) => n.type === 'entity');
  const apply = (patch: Partial<TextStyle>) => {
    for (const n of selected) updateNodeData(n.id, (node) => ({ text: { ...(node.data as DiagramNodeData).text, ...patch } }));
  };
  const [size, setSize] = useState(String(ts.size ?? ''));
  const commitSize = () => {
    const v = Math.round(Number(size));
    apply({ size: size.trim() && v ? Math.min(72, Math.max(8, v)) : undefined });
  };
  const btn = (key: string, tip: string, icon: React.ReactNode, on: boolean, onClick: () => void, disabled?: boolean) => (
    <Tip key={key} title={tip}>
      <Button size="icon-sm" variant={on ? 'secondary' : 'ghost'} aria-pressed={on} disabled={disabled} onClick={onClick}>{icon}</Button>
    </Tip>
  );
  return (
    <div className="nowheel absolute top-2 right-2 z-10 w-56 space-y-2.5 rounded-lg border bg-background/95 p-3 shadow-md">
      <p className="text-xs font-semibold">{t('title')}</p>
      <Select value={ts.font ?? DEFAULT_FONT} onValueChange={(v) => apply({ font: v === DEFAULT_FONT ? undefined : v })}>
        <SelectTrigger size="sm" className="w-full" aria-label={t('font')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_FONT}>{t('defaultFont')}</SelectItem>
          {FONTS.map((f) => <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-0.5">
        {btn('b', t('bold'), <Bold />, !!ts.bold, () => apply({ bold: !ts.bold || undefined }))}
        {btn('i', t('italic'), <Italic />, !!ts.italic, () => apply({ italic: !ts.italic || undefined }))}
        {btn('u', t('underline'), <Underline />, !!ts.underline, () => apply({ underline: !ts.underline || undefined }))}
        {btn('v', t('vertical'), <Type className="-rotate-90" />, !!ts.vertical, () => apply({ vertical: !ts.vertical || undefined }), onlyTables)}
        <div className="ml-auto flex items-center gap-1">
          <Input
            type="number" min={8} max={72} value={size} placeholder={onlyTables ? '13' : '12'} aria-label={t('size')}
            onChange={(e) => setSize(e.target.value)} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }}
            className="h-7 w-14 px-1.5 text-right text-xs"
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {btn('al', t('alignLeft'), <AlignLeft />, ts.align === 'left', () => apply({ align: 'left' }))}
        {btn('ac', t('alignCenter'), <AlignCenter />, (ts.align ?? 'center') === 'center', () => apply({ align: undefined }))}
        {btn('ar', t('alignRight'), <AlignRight />, ts.align === 'right', () => apply({ align: 'right' }))}
        <span className="mx-auto h-5 w-px bg-border" />
        {btn('vt', t('top'), <ArrowUpToLine />, ts.valign === 'top', () => apply({ valign: 'top' }), onlyTables)}
        {btn('vm', t('middle'), <FoldVertical />, !onlyTables && (ts.valign ?? 'middle') === 'middle', () => apply({ valign: undefined }), onlyTables)}
        {btn('vb', t('bottom'), <ArrowDownToLine />, ts.valign === 'bottom', () => apply({ valign: 'bottom' }), onlyTables)}
      </div>
    </div>
  );
}
