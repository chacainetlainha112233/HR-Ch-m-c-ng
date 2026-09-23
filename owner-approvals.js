(() => {
  const panel = document.createElement('section');
  panel.id = 'approval-panel'; panel.className = 'panel admin-wide hidden';
  panel.innerHTML = `<h2 id="approval-heading">Yêu cầu duyệt</h2>
    <p>Thay đổi chỉ có hiệu lực sau khi own đồng ý. Trạng thái “Đã thực hiện” nghĩa là dữ liệu đã được cập nhật.</p>
    <div class="form-grid"><div><label for="approval-filter">Trạng thái</label><select id="approval-filter"><option value="pending">Chờ duyệt</option><option value="">Tất cả</option><option value="applied">Đã thực hiện</option><option value="rejected">Từ chối</option><option value="failed">Thực hiện thất bại</option></select></div>
    <div><label>&nbsp;</label><button class="outline" id="approval-refresh">Làm mới</button></div></div>
    <p id="approval-status" role="status"></p><div id="approval-list"></div>
    <button class="outline" id="approval-prev">← Trước</button> <button class="outline" id="approval-next">Sau →</button>
    <hr><h2>Thông tin và quyền tài khoản</h2>
    <form id="profile-request-form"><label for="managed-profile">Tài khoản</label><select id="managed-profile" required></select>
      <div class="form-grid"><div><label for="managed-name">Họ tên</label><input id="managed-name" maxlength="120" required></div>
      <div><label for="managed-department">Phòng ban</label><input id="managed-department" maxlength="120"></div>
      <div><label for="managed-role">Vai trò</label><select id="managed-role"><option value="employee">Nhân viên</option><option value="admin">Admin</option></select></div>
      <div><label for="managed-active">Trạng thái tài khoản</label><select id="managed-active"><option value="true">Hoạt động</option><option value="false">Khóa tài khoản</option></select></div></div>
      <label for="managed-reason">Lý do</label><input id="managed-reason" maxlength="1000" required>
      <button class="primary" style="margin-top:12px">Gửi yêu cầu thay đổi</button>
    </form>
    <form id="permission-request-form"><label for="managed-permission">Quyền tạo nhân viên cho tài khoản admin đang chọn</label>
      <select id="managed-permission"><option value="true">Cấp quyền</option><option value="false">Thu hồi quyền</option></select>
      <p>Chọn admin trong danh sách tài khoản phía trên. Own quyết định cấp hoặc thu hồi quyền.</p>
      <button class="outline">Gửi yêu cầu quyền</button>
    </form><p id="managed-status" role="status"></p>`;
  document.querySelector('main .grid').append(panel);
  const nav = document.createElement('button'); nav.className='hidden'; nav.textContent='✓ Yêu cầu duyệt'; nav.onclick=()=>panel.scrollIntoView({behavior:'smooth'}); document.querySelector('.nav').append(nav);
  const active = () => ['admin','own'].includes(currentUser.role) && currentUser.id !== 'demo';
  const actions = {attendance_save:'Bổ sung / sửa công',attendance_delete:'Xóa công',ip_add:'Thêm IP',ip_delete:'Xóa IP',profile_update:'Thay đổi tài khoản',permission_change:'Quyền tạo nhân viên'};
  const statuses = {pending:'Chờ duyệt',applied:'Đã thực hiện',rejected:'Từ chối',failed:'Thực hiện thất bại'};
  const labels = {id:'Mã bản ghi',employee_id:'Mã nhân viên',p_employee_id:'Mã nhân viên',work_date:'Ngày công',p_work_date:'Ngày công',check_in:'Giờ vào',p_check_in:'Giờ vào',check_out:'Giờ ra',p_check_out:'Giờ ra',note:'Ghi chú',network:'IP / CIDR',label:'Tên địa điểm',full_name:'Họ tên',department:'Phòng ban',role:'Vai trò',is_active:'Đang hoạt động',can_create_employees:'Được tạo nhân viên',user_id:'Mã tài khoản'};
  let page = 0, epoch = 0, request = 0, profiles = [], timer, busy = false;
  let lastSignature = '';
  function textElement(tag, text) { const element = document.createElement(tag); element.textContent = text; return element; }
  function details(value, title) {
    const box = document.createElement('div'); box.append(textElement('strong', title));
    if (!value) { box.append(textElement('p','Chưa có bản ghi')); return box; }
    for (const [key,label] of Object.entries(labels)) {
      if (!(key in value)) continue;
      let text = value[key];
      if (typeof text === 'boolean') text = text ? 'Có' : 'Không';
      if (/check_in|check_out/.test(key) && text) text = new Date(text).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
      box.append(textElement('p',`${label}: ${text ?? '—'}`));
    }
    return box;
  }
  async function loadProfiles() {
    const generation = epoch; let all = [], offset = 0;
    while (true) {
      const {data,error} = await client.from('profiles').select('id,full_name,department,role,is_active').neq('role','own').order('id').range(offset,offset+499);
      if (error) throw error;
      if (generation !== epoch || !active()) return;
      all.push(...data); offset += data.length;
      if (!data.length) break;
    }
    profiles = all;
    const selected = $('managed-profile').value;
    $('managed-profile').replaceChildren(new Option('Chọn tài khoản',''));
    for (const profile of profiles) $('managed-profile').add(new Option(`${profile.full_name} · ${profile.role} · ${profile.id.slice(0,8)}`,profile.id));
    if (profiles.some(p=>p.id===selected)) $('managed-profile').value = selected;
  }
  $('managed-profile').onchange = () => {
    const profile = profiles.find(p=>p.id===$('managed-profile').value);
    $('managed-name').value = profile?.full_name || ''; $('managed-department').value = profile?.department || '';
    $('managed-role').value = profile?.role || 'employee'; $('managed-active').value = String(profile?.is_active ?? true);
  };
  async function submit(action, payload) {
    if (!active()) return;
    const target = $('managed-profile').value, reason = $('managed-reason').value.trim();
    if (!target || !reason) throw new Error('Chọn tài khoản và nhập lý do.');
    const {error} = await client.rpc('submit_approval',{p_action:action,p_target:target,p_payload:payload,p_reason:reason});
    if (error) throw error;
    $('managed-status').textContent = 'Đã gửi yêu cầu, chờ own duyệt.';
    await loadRequests();
  }
  for (const [id,action,payload] of [
    ['profile-request-form','profile_update',()=>({full_name:$('managed-name').value.trim(),department:$('managed-department').value.trim(),role:$('managed-role').value,is_active:$('managed-active').value==='true'})],
    ['permission-request-form','permission_change',()=>({can_create_employees:$('managed-permission').value==='true'})],
  ]) $(id).onsubmit = async event => {
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
    try { await submit(action,payload()); } catch(error) { $('managed-status').textContent=error.message; }
    finally { button.disabled=false; }
  };
  async function review(row, approve, note, button) {
    if (currentUser.role!=='own' || busy) return;
    busy = true; button.disabled = true;
    try {
      const {data,error} = await client.rpc('review_approval',{p_id:row.id,p_approve:approve,p_note:note});
      if (error) throw error;
      $('approval-status').textContent = data.status==='failed' ? `Chưa thực hiện: ${data.error_message}` : statuses[data.status];
      if (data.status==='applied') window.dispatchEvent(new Event('approval-applied'));
      await loadRequests(); await loadProfiles();
    } catch(error) { $('approval-status').textContent=error.message; }
    finally { busy=false; button.disabled=false; }
  }
  async function loadRequests() {
    if (!active()) return;
    const generation=epoch, sequence=++request;
    try {
      let query=client.from('approval_requests').select('*').order('created_at',{ascending:false}).order('id').range(page*20,page*20+20);
      if ($('approval-filter').value) query=query.eq('status',$('approval-filter').value);
      const {data,error}=await query;
      if(error) throw error;
      if(generation!==epoch || sequence!==request || !active()) return;
      // Avoid replacing an owner's unfinished review note during polling.
      const signature=JSON.stringify(data);
      if(signature===lastSignature) return;
      const hadPrevious=!!lastSignature;
      lastSignature=signature;
      if(hadPrevious) window.dispatchEvent(new Event('approval-applied'));
      $('approval-prev').disabled=page===0; $('approval-next').disabled=data.length<=20;
      $('approval-list').replaceChildren();
      if(!data.length) $('approval-list').textContent='Không có yêu cầu trong mục này.';
      for(const row of data.slice(0,20)) {
        const card=document.createElement('article'); card.className='panel'; card.style.margin='12px 0';
        card.append(textElement('h3',`${actions[row.action]} · ${statuses[row.status]}`));
        card.append(textElement('p',`Người gửi: ${row.requester_id} · ${new Date(row.created_at).toLocaleString('vi-VN')}`));
        card.append(textElement('p',`Lý do: ${row.reason}`));
        const changes=document.createElement('div'); changes.className='form-grid';
        changes.append(details(row.before_value,'Trước thay đổi'));
        changes.append(row.action.endsWith('_delete') ? textElement('p','Sau duyệt: xóa bản ghi này.') : details(row.payload,'Nội dung đề nghị'));
        card.append(changes);
        if(row.error_message) card.append(textElement('p',`Chưa thực hiện: ${row.error_message}. Cần gửi yêu cầu mới.`));
        if(row.reviewer_id) card.append(textElement('p',`Người duyệt: ${row.reviewer_id} · ${row.review_note || 'Không có ghi chú'}`));
        if(row.status==='pending' && currentUser.role==='own') {
          const note=document.createElement('input'); note.placeholder='Ghi chú duyệt / lý do từ chối'; note.maxLength=1000; note.setAttribute('aria-label','Ghi chú duyệt');
          const yes=textElement('button','Đồng ý và thực hiện'); yes.className='primary';
          const no=textElement('button','Từ chối'); no.className='outline';
          yes.onclick=()=>review(row,true,note.value,yes); no.onclick=()=>review(row,false,note.value,no);
          card.append(note,yes,no);
        }
        $('approval-list').append(card);
      }
    } catch(error) { if(generation===epoch) $('approval-status').textContent=`Không tải được yêu cầu: ${error.message}`; }
  }
  $('approval-filter').onchange=()=>{page=0;lastSignature='';loadRequests();};
  $('approval-refresh').onclick=()=>{lastSignature='';loadRequests();loadProfiles().catch(error=>{$('managed-status').textContent=error.message;});};
  $('approval-prev').onclick=()=>{if(page>0){page--;lastSignature='';loadRequests();}};
  $('approval-next').onclick=()=>{page++;lastSignature='';loadRequests();};
  window.addEventListener('approvals-changed',()=>{lastSignature='';loadRequests();});
  window.addEventListener('attendance-user-change',()=>{
    epoch++; request++; clearInterval(timer); page=0; lastSignature='';
    panel.classList.toggle('hidden',!active()); nav.classList.toggle('hidden',!active()); $('approval-list').replaceChildren(); $('managed-profile').replaceChildren();
    $('profile-request-form').reset(); $('managed-status').textContent=$('approval-status').textContent='';
    $('approval-heading').textContent=currentUser.role==='own'?'Own · Duyệt yêu cầu':'Yêu cầu đã gửi';
    if(active()) {
      loadRequests(); loadProfiles().catch(error=>{$('managed-status').textContent=error.message;});
      timer=setInterval(()=>{if(!document.hidden && !busy) loadRequests();},15000);
    }
  });
  $('logout').addEventListener('click',()=>{epoch++;request++;clearInterval(timer);panel.classList.add('hidden');nav.classList.add('hidden');$('approval-list').replaceChildren();});
})();
