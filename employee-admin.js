(() => {
  const panel = document.createElement('section');
  panel.id = 'create-employee-panel'; panel.className = 'panel hidden';
  panel.innerHTML = `<h2>Tạo tài khoản nhân viên</h2>
    <p>Admin/own quản lý toàn hệ thống. Manager chỉ tạo nhân viên thuộc department của mình.</p>
    <form id="create-employee-form">
      <label for="employee-name">Họ tên</label><input id="employee-name" maxlength="120" required>
      <label for="employee-email">Email đăng nhập</label><input id="employee-email" type="email" maxlength="254" autocomplete="off" required>
      <label for="employee-password">Mật khẩu (12–128 ký tự)</label><input id="employee-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>
      <button class="primary" style="margin-top:12px">Tạo nhân viên</button>
    </form><hr><h3>Cập nhật nhân viên</h3><form id="manage-employee-form"><label for="managed-employee">Nhân viên</label><select id="managed-employee" required></select><label for="managed-employee-name">Họ tên</label><input id="managed-employee-name" maxlength="120" required><label for="managed-employee-active">Trạng thái</label><select id="managed-employee-active"><option value="true">Đang hoạt động</option><option value="false">Đã khóa</option></select><button class="outline" style="margin-top:12px">Lưu thay đổi</button></form><p id="create-employee-status" role="status"></p>`;
  document.querySelector('main .grid').append(panel);
  window.addEventListener('attendance-user-change', () => {
    panel.classList.toggle('hidden', !['admin','own','manager'].includes(currentUser.role) || currentUser.id === 'demo');
    $('create-employee-form').reset(); $('create-employee-status').textContent = '';
    loadManagedEmployees();
  });
  async function loadManagedEmployees() {
    if (!client || !['admin','own','manager'].includes(currentUser.role) || currentUser.id === 'demo') return;
    const {data} = await client.from('profiles').select('id,full_name,is_active,department_id').eq('role','employee').order('full_name');
    const visible = currentUser.role === 'manager' ? (data || []).filter(employee => employee.department_id === currentUser.departmentId) : data || [];
    $('managed-employee').innerHTML = visible.map(employee => `<option value="${employee.id}">${employee.full_name}</option>`).join('');
    const selected = visible[0];
    if (selected) { $('managed-employee-name').value = selected.full_name; $('managed-employee-active').value = String(selected.is_active); }
  }
  $('managed-employee').onchange = async event => {
    const {data} = await client.from('profiles').select('full_name,is_active').eq('id', event.target.value).single();
    if (data) { $('managed-employee-name').value = data.full_name; $('managed-employee-active').value = String(data.is_active); }
  };
  $('manage-employee-form').onsubmit = async event => {
    event.preventDefault();
    const id = $('managed-employee').value;
    const {error} = await client.rpc('manager_update_employee', {p_id:id, p_full_name:$('managed-employee-name').value.trim(), p_department_id:currentUser.departmentId || null, p_is_active:$('managed-employee-active').value === 'true'});
    $('create-employee-status').textContent = error ? `Không cập nhật được: ${error.message}` : 'Đã cập nhật nhân viên.';
    loadManagedEmployees();
  };
  $('create-employee-form').onsubmit = async event => {
    event.preventDefault();
    if (!['admin','own','manager'].includes(currentUser.role) || currentUser.id === 'demo') return;
    const button = event.target.querySelector('button');
    button.disabled = true; $('create-employee-status').textContent = 'Đang tạo tài khoản…';
    try {
      const {data, error} = await client.functions.invoke('create-employee', {body: {
        full_name: $('employee-name').value.trim(), email: $('employee-email').value.trim(), password: $('employee-password').value,
      }});
      if (error) {
        let message = error.message;
        try { message = (await error.context.json()).error || message; } catch { /* Network/deployment error */ }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      event.target.reset();
      window.dispatchEvent(new Event('employees-changed'));
      $('create-employee-status').textContent = `Đã tạo tài khoản nhân viên ${data.email}. Bạn có thể cung cấp thông tin đăng nhập cho nhân viên.`;
    } catch (error) { $('create-employee-status').textContent = `Không tạo được tài khoản: ${error.message}`; }
    finally { button.disabled = false; }
  };
})();
