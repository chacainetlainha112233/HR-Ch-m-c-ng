// IP checks are enforced by whitelist-ip.sql; browser checks provide feedback only.
(() => {
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  $('check-in').closest('section').append(notice);
  const panel = document.createElement('section');
  panel.className = 'panel hidden';
  panel.innerHTML = `<h2>Whitelist IP</h2>
    <p>Chỉ các IP hoặc dải mạng trong danh sách được phép vào/ra ca.</p>
    <p id="current-ip"></p>
    <form id="ip-form"><label for="ip-network">IP công cộng hoặc CIDR</label>
    <input id="ip-network" placeholder="Ví dụ: 203.0.113.10 hoặc 203.0.113.0/24" required>
    <label for="ip-label">Tên địa điểm</label><input id="ip-label" maxlength="120" placeholder="Văn phòng">
    <button class="primary" style="margin-top:12px">Gửi yêu cầu thêm IP</button></form>
    <p id="ip-error" role="status"></p><ul id="ip-list"></ul>`;
  document.querySelector('main .grid').append(panel);
  let busy = false;
  const dateKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const format = value => value ? new Date(value).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}) : '--:--';
  function render() {
    $('check-in-time').textContent = format(currentAttendance?.check_in);
    $('check-out-time').textContent = format(currentAttendance?.check_out);
    $('check-in').disabled = busy || !!currentAttendance?.check_in;
    $('check-out').disabled = busy || !currentAttendance?.check_in || !!currentAttendance?.check_out;
    $('today-status').textContent = currentAttendance?.check_out ? 'Đã hoàn thành' : currentAttendance?.check_in ? 'Đang làm việc' : 'Chưa vào ca';
    $('today-note').textContent = currentAttendance?.check_out ? 'Cảm ơn bạn, hẹn gặp lại!' : currentAttendance?.check_in ? 'Ca làm đang được ghi nhận.' : 'Bấm “Bắt đầu ca” khi bạn sẵn sàng.';
  }
  async function loadList() {
    const {data, error} = await client.from('ip_whitelist').select('id,network,label').order('created_at');
    if (error) throw error;
    $('ip-list').replaceChildren();
    if (!data.length) $('ip-list').textContent = 'Danh sách trống: tất cả IP đang bị chặn chấm công.';
    for (const row of data) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      item.textContent = `${row.network}${row.label ? ' — ' + row.label : ''} `;
      button.textContent = 'Yêu cầu xóa'; button.className = 'outline';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const {error} = await client.rpc('submit_approval', {p_action:'ip_delete',p_target:row.id,p_payload:{},p_reason:'Đề nghị xóa IP: '+row.network});
          if (error) throw error;
          $('ip-error').textContent = 'Đã gửi yêu cầu xóa IP, chờ own duyệt.';
          window.dispatchEvent(new Event('approvals-changed'));
          button.disabled = false;
        } catch (error) { $('ip-error').textContent = error.message; button.disabled = false; }
      };
      item.append(button); $('ip-list').append(item);
    }
  }
  $('ip-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button'); button.disabled = true;
    $('ip-error').textContent = '';
    try {
      const {error} = await client.rpc('submit_approval', {p_action:'ip_add',p_target:null,p_reason:'Đề nghị thêm IP: '+$('ip-network').value.trim(),p_payload:{network: $('ip-network').value.trim(), label: $('ip-label').value.trim()}});
      if (error) throw error;
      event.target.reset(); $('ip-error').textContent = 'Đã gửi yêu cầu thêm IP, chờ own duyệt.'; window.dispatchEvent(new Event('approvals-changed'));
    } catch (error) { $('ip-error').textContent = `Không thêm được IP: ${error.message}`; }
    finally { button.disabled = false; }
  };
  window.addEventListener('attendance-user-change', async () => {
    currentAttendance = null; busy = true; render();
    panel.classList.toggle('hidden', !['admin','own'].includes(currentUser.role) || currentUser.id === 'demo');
    notice.textContent = currentUser.id === 'demo' ? 'Bản demo: không kiểm tra IP và không lưu dữ liệu.' : 'Đang tải trạng thái chấm công…';
    try {
      if (currentUser.id !== 'demo') {
        const {data, error} = await client.from('attendance').select('*').eq('employee_id', currentUser.id).eq('work_date', dateKey()).maybeSingle();
        if (error) throw error;
        currentAttendance = data;
        const result = await client.rpc('attendance_client_ip');
        if (result.error) throw result.error;
        $('current-ip').textContent = `IP hiện tại: ${result.data || 'Không xác định'}`;
        notice.textContent = `IP hiện tại: ${result.data || 'Không xác định'}. IP sẽ được kiểm tra khi vào/ra ca.`;
        if (['admin','own'].includes(currentUser.role)) await loadList();
      }
    } catch (error) { notice.textContent = `Không tải được cấu hình chấm công: ${error.message}. Kiểm tra đã chạy whitelist-ip.sql.`; }
    finally { busy = false; render(); }
  });
  async function record(checkOut) {
    if (busy) return;
    busy = true; render();
    try {
      const timestamp = new Date().toISOString();
      if (currentUser.id === 'demo') {
        currentAttendance = {...currentAttendance, [checkOut ? 'check_out' : 'check_in']: timestamp};
      } else {
        const {data: allowed, error: ipError} = await client.rpc('attendance_ip_allowed');
        if (ipError) throw ipError;
        if (!allowed) throw new Error('IP hiện tại không được phép chấm công. Hãy kết nối mạng văn phòng hoặc liên hệ quản trị viên.');
        const query = checkOut
          ? client.from('attendance').update({check_out: timestamp}).eq('id', currentAttendance.id)
          : client.from('attendance').insert({employee_id: currentUser.id, work_date: dateKey(), check_in: timestamp});
        const {data, error} = await query.select('*').single();
        if (error) throw error;
        currentAttendance = data;
        await loadHistory();
      }
      notice.textContent = currentUser.id === 'demo' ? 'Đã cập nhật bản demo; không lưu dữ liệu.' : 'Đã lưu chấm công thành công.';
    } catch (error) { notice.textContent = `Không thể chấm công: ${error.message}`; }
    finally { busy = false; render(); }
  }
  window.addEventListener('approval-applied', () => { if (['admin','own'].includes(currentUser.role)) loadList().catch(error => { $('ip-error').textContent = error.message; }); });
  $('check-in').addEventListener('click', () => record(false));
  $('check-out').addEventListener('click', () => record(true));
})();
