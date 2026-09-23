import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
}

const env = { ...loadEnvFile('.env.local'), ...process.env };
const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local');

const accounts = [
  { email: 'own@gmail.com', fullName: 'Owner', role: 'own' },
  { email: 'admin@gmail.com', fullName: 'Admin', role: 'admin' },
  ...Array.from({ length: 10 }, (_, index) => ({ email: `test${index + 1}@gmail.com`, fullName: `Test ${index + 1}`, role: 'employee' }))
];

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.msg || body.message || body.error_description || JSON.stringify(body)}`);
  return body;
}
function temporaryPassword() { return `Gc-${randomBytes(12).toString('base64url')}`; }

const users = (await request('/auth/v1/admin/users?per_page=1000')).users || [];
const credentials = [['email', 'temporary_password', 'role']];
for (const account of accounts) {
  let user = users.find(item => item.email?.toLowerCase() === account.email);
  let created = false;
  if (!user) {
    const password = temporaryPassword();
    user = await request('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: account.email, password, email_confirm: true, user_metadata: { full_name: account.fullName } }) });
    created = true;
    credentials.push([account.email, password, account.role]);
  } else {
    credentials.push([account.email, 'already-existed', account.role]);
  }
  await request(`/rest/v1/profiles?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: user.id, full_name: account.fullName, role: account.role }) });
  console.log(`${created ? 'Created' : 'Updated'} ${account.email} -> ${account.role}`);
}
writeFileSync('created-users.csv', credentials.map(row => row.join(',')).join('\n') + '\n', { mode: 0o600 });
console.log('Hoàn tất. Thông tin tạm được ghi vào created-users.csv; không commit file này.');
