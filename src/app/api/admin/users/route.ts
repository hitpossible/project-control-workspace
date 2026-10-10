import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: isAdmin } = await supabase.rpc('has_role', { p_role: 'admin' });
  if (!isAdmin) return NextResponse.json({ error: 'Administrator only' }, { status: 403 });

  const b = await req.json();
  if (!b.email || !b.full_name || !b.password || String(b.password).length < 8) {
    return NextResponse.json({ error: 'Email, full name and a password of at least 8 characters are required' }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: b.email,
    password: b.password,
    email_confirm: true,
    user_metadata: { full_name: b.full_name, employee_id: b.employee_id, department: b.department, section: b.section, roles: b.roles ?? ['requestor'] },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from('profiles').update({ telephone: b.telephone ?? null, extension: b.extension ?? null, is_active: b.is_active ?? true }).eq('id', data.user.id);
  return NextResponse.json({ id: data.user.id });
}
