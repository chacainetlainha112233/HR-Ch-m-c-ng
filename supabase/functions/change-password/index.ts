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
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return reply(401, { error: 'Phiên đăng nhập không hợp lệ.' });
    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';
    if (password.length < 12 || password === '123456') return reply(400, { error: 'Mật khẩu mới phải có ít nhất 12 ký tự và không được là mật khẩu mặc định.' });
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, app_metadata: { ...user.app_metadata, must_change_password: false } });
    if (error) return reply(400, { error: error.message });
    const { error: auditError } = await admin.from('audit_logs').insert({ user_id: user.id, event: 'password_change', metadata: { source: 'change-password' } });
    if (auditError) return reply(500, { error: 'Đã đổi mật khẩu nhưng không ghi được nhật ký. Vui lòng liên hệ quản trị viên.' });
    return reply(200, { ok: true });
  } catch {
    return reply(500, { error: 'Không thể đổi mật khẩu. Vui lòng thử lại.' });
  }
});