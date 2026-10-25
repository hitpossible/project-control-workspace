import { useCallback, useEffect, useState } from 'react';
import { dbClient } from '@/lib/db/client';
import type { Department, Position, Section } from '@/lib/types';

export function useDepartments() {
  const db = dbClient();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const load = useCallback(async () => {
    const [d, s, p] = await Promise.all([
      db.from('departments').select('*').order('name'), db.from('sections').select('*').order('name'), db.from('positions').select('*').order('name'),
    ]);
    setDepartments((d.data ?? []) as Department[]);
    setSections((s.data ?? []) as Section[]);
    setPositions((p.data ?? []) as Position[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  return { departments, sections, positions, load };
}
