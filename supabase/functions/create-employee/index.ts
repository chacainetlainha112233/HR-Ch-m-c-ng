import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Chỉ hỗ trợ POST.' });
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Vui lòng đăng nhập.' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return reply(401, { error: 'Phiên đăng nhập không hợp lệ.' });
    const { data: profile, error: profileError } = await admin.from('profiles').select('role,is_active').eq('id', user.id).single();
    if (profileError || !profile?.is_active || !['admin','own'].includes(profile.role)) return reply(403, { error: 'Chỉ quản trị viên được tạo tài khoản.' });
    if (profile.role !== 'own') {
      const {data: permission, error: permissionError} = await admin.from('admin_permissions').select('can_create_employees').eq('user_id',user.id).maybeSingle();
      if (permissionError || !permission?.can_create_employees) return reply(403, {error:'Cần own cấp quyền tạo nhân viên trước.'});
    }
    let body;
    try { body = await request.json(); } catch { return reply(400, { error: 'Dữ liệu không hợp lệ.' }); }
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 120 || password.length < 12 || password.length > 128) {
      return reply(400, { error: 'Nhập họ tên, email hợp lệ và mật khẩu từ 12 đến 128 ký tự.' });
    }
    // The database trigger always assigns employee; never accept a role from the browser.
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { must_change_password: true },
    });
    if (error) return reply(400, { error: error.message });
    return reply(201, { id: data.user.id, email: data.user.email });
  } catch {
    return reply(500, { error: 'Không thể tạo tài khoản. Vui lòng thử lại.' });
  }
});
