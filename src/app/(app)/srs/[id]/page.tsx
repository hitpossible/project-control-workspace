'use client';

import { useParams } from 'next/navigation';
import SrsWorkspace from '@/components/srs/SrsWorkspace';

/** One SRS: place signature boxes, sign, or follow who has signed (signers outside the project land here from the notification) */
export default function SrsPage() {
  const { id } = useParams<{ id: string }>();
  return <SrsWorkspace key={id} id={Number(id)} />;
}
