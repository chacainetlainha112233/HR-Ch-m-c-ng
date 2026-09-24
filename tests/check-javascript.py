import ctypes as c, re
from pathlib import Path
j=c.CDLL('/System/Library/Frameworks/JavaScriptCore.framework/JavaScriptCore')
p=c.c_void_p
j.JSGlobalContextCreate.argtypes=[p]; j.JSGlobalContextCreate.restype=p
j.JSStringCreateWithUTF8CString.argtypes=[c.c_char_p]; j.JSStringCreateWithUTF8CString.restype=p
j.JSCheckScriptSyntax.argtypes=[p,p,p,c.c_int,c.POINTER(p)]; j.JSCheckScriptSyntax.restype=c.c_bool
j.JSEvaluateScript.argtypes=[p,p,p,p,c.c_int,c.POINTER(p)]; j.JSEvaluateScript.restype=p
j.JSValueToStringCopy.argtypes=[p,p,c.POINTER(p)]; j.JSValueToStringCopy.restype=p
j.JSStringGetUTF8CString.argtypes=[p,c.c_char_p,c.c_size_t]
ctx=j.JSGlobalContextCreate(None)
def string(s): return j.JSStringCreateWithUTF8CString(s.encode())
def message(v):
    s=j.JSValueToStringCopy(ctx,v,None); b=c.create_string_buffer(4096); j.JSStringGetUTF8CString(s,b,4096); return b.value.decode()
html=Path('indec.html').read_text()
scripts=re.findall(r'<script>(.*?)</script>', html, re.S)
for name, source in [('inline', '\n'.join(scripts))]+[(n,Path(n).read_text()) for n in ['employee-admin.js','whitelist-ip.js','admin-attendance.js','owner-approvals.js','page-tabs.js']]:
    error=p()
    assert j.JSCheckScriptSyntax(ctx,string(source),None,1,c.byref(error)), (name,message(error))
    print('PASS syntax:',name)
mock='''
const elements = new Map();
function element() { return {classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},toggle(x,on){on?this.add(x):this.remove(x)},contains(x){return this.values.has(x)}},replaceChildren(){},addEventListener(){},textContent:'',innerHTML:''}; }
const stats=[element(),element(),element()];
const document={getElementById(id){if(!elements.has(id)) elements.set(id,element()); return elements.get(id)},querySelectorAll(){return stats}};
const window={dispatchEvent(){}};
function Event() {}
const location={reload(){}};
function alert() {}
'''
test='''
setView({id:'demo',name:'Admin',role:'admin'});
if ($('admin-panel').classList.contains('hidden') || $('management-home').classList.contains('hidden')) throw Error('Admin management hidden');
setView({id:'demo',name:'Own',role:'own'});
if ($('admin-panel').classList.contains('hidden') || $('user-role').textContent !== 'Chủ sở hữu (own)') throw Error('Own role unavailable');
setView({id:'demo',name:'Manager',role:'manager'});
if ($('management-home').classList.contains('hidden') || $('manager-tools').classList.contains('hidden')) throw Error('Manager tools hidden');
if (!$('admin-tools').classList.contains('hidden') || !$('open-system').classList.contains('hidden')) throw Error('Manager sees owner/admin controls');
setView({id:'demo',name:'Employee',role:'employee'});
if (!$('management-home').classList.contains('hidden')) throw Error('Employee sees management home');
for(const id of ['admin-nav','admin-panel','export','schedule-panel']) if(!$(id).classList.contains('hidden')) throw Error('Employee can see '+id);
if(stats.some(s=>!s.classList.contains('hidden'))) throw Error('Employee sees placeholder stats');
if($('page-title').textContent !== 'Chấm công của tôi') throw Error('Wrong employee view');
'''
error=p(); j.JSEvaluateScript(ctx,string(mock+scripts[0]+test),None,None,1,c.byref(error))
assert not error.value, message(error)
print('PASS: switching admin to employee hides all administrative UI')

source=Path('admin-attendance.js').read_text()
helpers=source[source.index('  const localInput'):source.index('  let generation')]
tests = r''' 
function assert(value, label) { if (!value) throw Error(label); }
assert(localInput('2026-09-20T01:00:00Z') === '2026-09-20T08:00:00', 'Vietnam time conversion');
assert(hours({check_in:'2026-09-20T15:00:00Z',check_out:'2026-09-20T23:00:00Z'}) === '8.00', 'Overnight shift hours');
assert(hours({check_in:'2026-09-20T15:00:00Z',check_out:null}) === '', 'Open shift hours');
assert(csvCell('=1+1') === '"\'=1+1"', 'Formula neutralization');
assert(csvCell('  @SUM(A1)') === '"\'  @SUM(A1)"', 'Leading spaces formula');
assert(csvCell('a,"b"') === '"a,""b"""', 'CSV quoting');
assert(csvCell('Nguyễn An') === '"Nguyễn An"', 'Vietnamese CSV text');
'''
error=p(); j.JSEvaluateScript(ctx,string(helpers+tests),None,None,1,c.byref(error))
assert not error.value, message(error)
print('PASS: report time conversion, overnight hours, CSV formula protection and quoting')
# Execute the Edge Function with mocked Supabase calls; no network or accounts are created.
edge = Path('supabase/functions/create-employee/index.ts').read_text()
edge = re.sub(r"import .*?;\n", '', edge, count=1)
edge = edge.replace('(status: number, body: unknown)', '(status, body)')
edge = edge.replace("Deno.env.get('SUPABASE_URL')!", "Deno.env.get('SUPABASE_URL')")
edge = edge.replace("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!", "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
edge_mock = r'''
let handler, principal, created=0, lastAttributes;
const identities={own:{role:'own',is_active:true},admin:{role:'admin',is_active:true},allowed:{role:'admin',is_active:true},employee:{role:'employee',is_active:true},disabled:{role:'admin',is_active:false}};
const Deno={serve(fn){handler=fn},env:{get(){return 'test'}}};
class Response { constructor(body, options){this.status=options.status||200;this.body=body} }
function createClient(){ return {
 auth:{getUser:async token=>{principal=token;return {data:{user:identities[token]?{id:token}:null},error:null}},admin:{createUser:async attrs=>{created++;lastAttributes=attrs;return {data:{user:{id:'new-user',email:attrs.email}},error:null}}}},
 from(table){return {select(){return this},eq(){return this},single:async()=>({data:identities[principal],error:null}),maybeSingle:async()=>({data:{can_create_employees:principal==='allowed'},error:null})}}
};}
const payload={email:'employee@example.invalid',full_name:'Nhân viên',password:'Test-password-123',role:'own'};
function req(token){return {method:'POST',headers:{get(){return token ? 'Bearer '+token : null}},json:async()=>payload};}
'''
edge_tests = r'''
let edgeResult='pending';
(async()=>{
 for(const [token,status] of [[null,401],['invalid',401],['employee',403],['disabled',403],['admin',403],['allowed',201],['own',201]]) {
  const result=await handler(req(token)); if(result.status!==status) throw Error(token+': '+result.status+' != '+status);
 }
 if(created!==2) throw Error('Unauthorized creation occurred');
 if(lastAttributes.role || lastAttributes.user_metadata.role) throw Error('Browser-supplied role trusted');
 edgeResult='PASS';
})().catch(error=>{edgeResult=String(error)});
'''
# Separate context avoids collision with browser helpers.
ctx = j.JSGlobalContextCreate(None)
error=p(); j.JSEvaluateScript(ctx,string(edge_mock+edge+edge_tests),None,None,1,c.byref(error))
assert not error.value, message(error)
result=j.JSEvaluateScript(ctx,string('edgeResult'),None,None,1,c.byref(error))
assert message(result)=='PASS', message(result)
print('PASS: creation endpoint rejects unauthenticated, employee, disabled and unapproved admin; permits own/approved admin')
# Regression: a missing profile column must be visible, never silently downgrade to employee.
load_user = scripts[0][scripts[0].index('async function loadUser()'):scripts[0].index("$('login-form')")]
access_mock = r'''
const ui=new Map();
const $=id=>{if(!ui.has(id))ui.set(id,{classList:{add(){},remove(){}},textContent:''});return ui.get(id)};
let mode='missing', seen=[], signedOut=false;
const client={
 auth:{getUser:async()=>({data:{user:{id:'test',email:'test@example.invalid'}}}),signOut:async()=>{signedOut=true}},
 from(){return {select(){return this},eq(){return this},single:async()=> mode==='missing'?{error:{message:'column profiles.department_id does not exist'}}:mode==='legacy'?{data:{full_name:'Legacy admin',role:'admin'}}:{data:{full_name:'Manager',role:'manager',is_active:mode!=='inactive',department_id:'dept-1'}}}}
};
function setView(user){seen.push(user)}
'''
access_tests = r'''
let accessResult='pending';
(async()=>{
 await loadUser();
 if(seen.length || !$('login-error').textContent.includes('department_id')) throw Error('Schema error silently downgraded role');
 mode='manager'; await loadUser();
 if(seen.length!==1 || seen[0].role!=='manager' || seen[0].departmentId!=='dept-1') throw Error('Manager identity lost');
 mode='legacy'; await loadUser();
 if(seen.length!==2 || seen[1].role!=='admin' || seen[1].managementReady!==false || !seen[1].schemaWarning) throw Error('Legacy admin loses management view');
 mode='inactive'; await loadUser();
 if(seen.length!==2 || !signedOut) throw Error('Inactive user allowed');
 accessResult='PASS';
})().catch(error=>{accessResult=String(error)});
'''
ctx=j.JSGlobalContextCreate(None)
error=p(); j.JSEvaluateScript(ctx,string(access_mock+load_user+access_tests),None,None,1,c.byref(error))
assert not error.value, message(error)
result=j.JSEvaluateScript(ctx,string('accessResult'),None,None,1,c.byref(error))
assert message(result)=='PASS', message(result)
print('PASS: missing schema shows error, manager role/department retained, inactive user blocked')
# Exercise the actual tab router against a minimal DOM, without network access.
tab_mock = r'''
const nodes=new Map(), events=new Map();
class Node {
 constructor(){this.children=[];this.attributes={};this.hidden=false;this.classList={toggle(){}};this.handlers={};}
 append(...items){this.children.push(...items)}
 before(node){this.beforeNode=node}
 replaceChildren(...items){this.children=items}
 setAttribute(key,value){this.attributes[key]=value}
 addEventListener(event,fn){this.handlers[event]=fn}
 focus(){this.focused=true}
 set id(value){this._id=value;nodes.set(value,this)}
 get id(){return this._id}
}
for(const id of ['page-host','page-title','page-subtitle','overview-nav','history-nav','admin-nav','approval-nav','open-system','open-employees','open-shifts','open-approvals','logout','management-home','overview-stats','attendance-panel','history-panel','admin-panel','create-employee-panel','admin-tools','manager-tools','employee-request-tools','approval-panel','audit-panel','schedule-panel']) {const n=new Node();n.id=id;}
const $=id=>nodes.get(id);
const document={createElement(){return new Node()}};
const window={addEventListener(event,fn){events.set(event,fn)}};
const location={hash:'',pathname:'/indec.html',search:''};
const history={pushState(a,b,url){location.hash=url.startsWith('#')?url:''},replaceState(a,b,url){this.pushState(a,b,url)}};
let currentUser={id:'admin-id',role:'admin'};
'''
tab_checks = r'''
function assertTabs(condition,label){if(!condition)throw Error(label)}
function visiblePages(){return [...nodes.values()].filter(n=>n.attributes.role==='tabpanel'&&!n.hidden)}
events.get('attendance-user-change')();
assertTabs(visiblePages().length===1&&!$('page-dashboard').hidden,'Admin landing');
$('tab-employees').onclick();
assertTabs(visiblePages().length===1&&!$('page-employees').hidden&&location.hash==='#page=employees','Exclusive page navigation');
$('tab-history').onclick();
assertTabs($('page-employees').hidden&&!$('page-history').hidden,'Previous page hidden');
location.hash='#page=employees';events.get('popstate')();
assertTabs(!$('page-employees').hidden,'Browser back');
currentUser={id:'manager-id',role:'manager'};events.get('attendance-user-change')();
$('admin-nav').onclick();
assertTabs(!$('page-dashboard').hidden,'Manager navigation');
location.hash='#page=system';events.get('hashchange')();
assertTabs($('page-system').hidden,'Manager cannot open admin page by hash');
currentUser={id:'employee-id',role:'employee'};events.get('attendance-user-change')();
assertTabs(visiblePages().length===1&&!$('page-attendance').hidden,'Employee default and role reset');
location.hash='#page=approvals';events.get('hashchange')();
assertTabs($('page-approvals').hidden,'Employee cannot open owner page');
$('tab-history').onkeydown({key:'Home',preventDefault(){}});
assertTabs(!$('page-attendance').hidden,'Keyboard navigation');
$('logout').handlers.click();assertTabs(visiblePages().length===0,'Logout hides pages');
'''
ctx=j.JSGlobalContextCreate(None)
error=p();j.JSEvaluateScript(ctx,string(tab_mock+Path('page-tabs.js').read_text()+tab_checks),None,None,1,c.byref(error))
assert not error.value,message(error)
print('PASS: tab pages, role guards, browser back, keyboard navigation and logout')
