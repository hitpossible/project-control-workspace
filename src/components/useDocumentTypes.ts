'use client';

import { useEffect, useState } from 'react';
import { dbClient } from '@/lib/db/client';
import type { DocumentType } from '@/lib/types';

/** All document types (inactive ones too, so older requests still show their type), in Admin order */
export function useDocumentTypes() {
  const db = dbClient();
  const [rows, setRows] = useState<DocumentType[]>([]);
  useEffect(() => {
    db.from('document_types').select('*').order('sort_order').order('name').then(({ data }) => setRows((data ?? []) as DocumentType[]));
  }, [db]);
  return rows;
}
