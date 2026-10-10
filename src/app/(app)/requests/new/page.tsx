'use client';

import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { PageHeader } from '@/components/common';
import RequestForm, { emptyRequest } from '@/components/RequestForm';

export default function NewRequestPage() {
  const { me } = useApp();
  const router = useRouter();
  if (!me) return null;
  return (
    <div className="max-w-5xl">
      <PageHeader title="New Project Request" subtitle="FM-SYS-004 Project Development Request Form" />
      <RequestForm initial={emptyRequest(me)} onSaved={(r) => router.replace(`/requests/${r.id}`)} />
    </div>
  );
}
