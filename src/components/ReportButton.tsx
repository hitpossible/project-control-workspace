'use client';

import dayjs from 'dayjs';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { errMsg } from '@/lib/format';
import type { ReportType } from '@/lib/pdf/data';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useApp } from './AppProvider';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

/** Generates a PDF report from Workspace data and downloads it */
export function useReport() {
  const supabase = supabaseBrowser();
  const { me, profileName, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const generate = async (type: ReportType, opts: { projectId?: string; from?: string; to?: string; code?: string }) => {
    setBusy(true);
    try {
      const [{ loadManagementReport, loadProjectReport }, { renderReport, downloadBlob }] = await Promise.all([import('@/lib/pdf/data'), import('@/lib/pdf/reports')]);
      const data = type === 'management'
        ? await loadManagementReport(supabase, opts.from!, opts.to!)
        : await loadProjectReport(supabase, opts.projectId!);
      const blob = await renderReport(type, data, { generatedBy: me?.full_name ?? '', generatedAt: dayjs().format('DD MMM YYYY HH:mm'), name: (id) => profileName(id) }, window.location.origin);
      const label = { status: 'Status', meeting: 'UserMeeting', closure: 'Closure', management: 'Management' }[type];
      downloadBlob(blob, `${opts.code ?? 'SystemService'}_${label}_${dayjs().format('YYYYMMDD')}.pdf`);
      notify('PDF report generated');
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { generate, busy };
}

export default function ReportButton({ projectId, code }: { projectId: string; code: string }) {
  const { generate, busy } = useReport();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}><FileText /> {busy ? 'Generating…' : 'PDF Report'}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => generate('status', { projectId, code })}>Project Status Report</DropdownMenuItem>
        <DropdownMenuItem onClick={() => generate('meeting', { projectId, code })}>User Meeting Report</DropdownMenuItem>
        <DropdownMenuItem onClick={() => generate('closure', { projectId, code })}>Project Closure Report</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
