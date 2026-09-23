(() => {
  const panel = document.createElement('section');
  panel.id = 'create-employee-panel'; panel.className = 'panel hidden';
  panel.innerHTML = `<h2>Tạo tài khoản nhân viên</h2>
    <p>Nhân viên chỉ được chấm công và xem lịch sử của chính mình. Admin cần own cấp quyền tạo nhân viên trong mục Yêu cầu duyệt.</p>
    <form id="create-employee-form">
      <label for="employee-name">Họ tên</label><input id="employee-name" maxlength="120" required>
      <label for="employee-email">Email đăng nhập</label><input id="employee-email" type="email" maxlength="254" autocomplete="off" required>
      <label for="employee-password">Mật khẩu (12–128 ký tự)</label><input id="employee-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>
      <button class="primary" style="margin-top:12px">Tạo nhân viên</button>
    </form><p id="create-employee-status" role="status"></p>`;
  document.querySelector('main .grid').append(panel);
  window.addEventListener('attendance-user-change', () => {
    panel.classList.toggle('hidden', !['admin','own'].includes(currentUser.role) || currentUser.id === 'demo');
    $('create-employee-form').reset(); $('create-employee-status').textContent = '';
  });
  $('create-employee-form').onsubmit = async event => {
    event.preventDefault();
    if (!['admin','own'].includes(currentUser.role) || currentUser.id === 'demo') return;
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
