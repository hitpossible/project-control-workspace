'use client';

import dayjs from 'dayjs';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { errMsg } from '@/lib/format';
import type { ReportType } from '@/lib/pdf/data';
import { dbClient } from '@/lib/db/client';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Generates a PDF report from Workspace data and downloads it */
export function useReport() {
  const t = useTranslations('reports');
  const db = dbClient();
  const { me, profileName, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const generate = async (type: ReportType, opts: { projectId?: number; from?: string; to?: string; code?: string }) => {
    setBusy(true);
    try {
      const [{ loadManagementReport, loadProjectReport }, { renderReport, downloadBlob }] = await Promise.all([import('@/lib/pdf/data'), import('@/lib/pdf/reports')]);
      const data = type === 'management'
        ? await loadManagementReport(db, opts.from!, opts.to!)
        : await loadProjectReport(db, opts.projectId!);
      const blob = await renderReport(type, data, { generatedBy: me?.full_name ?? '', generatedAt: dayjs().format('DD MMM YYYY HH:mm'), name: (id) => profileName(id) }, window.location.origin);
      const label = { status: 'Status', meeting: 'UserMeeting', closure: 'Closure', management: 'Management' }[type];
      downloadBlob(blob, `${opts.code ?? 'SystemService'}_${label}_${dayjs().format('YYYYMMDD')}.pdf`);
      notify(t('generated'));
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { generate, busy };
}

export default function ReportButton({ projectId, code }: { projectId: number; code: string }) {
  const t = useTranslations('reports');
  const { generate, busy } = useReport();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}><FileText /> {busy ? t('generating') : t('pdfReport')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => generate('status', { projectId, code })}>{t('type.status.title')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => generate('meeting', { projectId, code })}>{t('type.meeting.title')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => generate('closure', { projectId, code })}>{t('type.closure.title')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
