(() => {
  const panel = document.createElement('section');
  panel.className = 'panel admin-wide hidden'; panel.id = 'admin-attendance-panel';
  panel.innerHTML = `<h2>Lịch sử chấm công nhân viên</h2>
    <form id="report-filter" class="form-grid">
      <div><label for="report-employee">Nhân viên</label><select id="report-employee"><option value="">Tất cả nhân viên</option></select></div>
      <div><label for="report-from">Từ ngày</label><input id="report-from" type="date" required></div>
      <div><label for="report-to">Đến ngày</label><input id="report-to" type="date" required></div>
      <div><label>&nbsp;</label><button class="primary">Xem lịch sử</button> <button class="outline" type="button" id="report-export">Xuất CSV</button></div>
    </form><p id="report-status" role="status"></p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>Nhân viên</th><th>Ngày công</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Ghi chú</th><th>Yêu cầu</th></tr></thead><tbody id="report-rows"></tbody></table></div>
    <p><button class="outline" id="report-prev">← Trước</button> <span id="report-page"></span> <button class="outline" id="report-next">Sau →</button></p>
    <hr><h2>Bổ sung / điều chỉnh công</h2><p>Giờ Việt Nam (UTC+7). Chọn nhân viên, ngày công rồi tải bản ghi trước khi lưu. Để trống giờ ra nếu ca chưa kết thúc.</p>
    <form id="adjustment-form">
      <div class="form-grid"><div><label for="adjust-employee">Nhân viên</label><select id="adjust-employee" required></select></div>
      <div><label for="adjust-date">Ngày công</label><input id="adjust-date" type="date" required></div>
      <div><label>&nbsp;</label><button class="outline" id="adjust-load" type="button">Tải công ngày này</button></div></div>
      <div class="form-grid"><div><label for="adjust-in">Giờ vào</label><input id="adjust-in" type="datetime-local" step="1" required></div>
      <div><label for="adjust-out">Giờ ra</label><input id="adjust-out" type="datetime-local" step="1"></div></div>
      <label for="adjust-reason">Lý do bổ sung / điều chỉnh</label><textarea id="adjust-reason" maxlength="1000" required></textarea>
      <button class="primary" id="adjust-save" style="margin-top:12px" disabled>Gửi yêu cầu duyệt công</button>
    </form><p id="adjust-status" role="status"></p>`;
  document.querySelector('main .grid').append(panel);
  const adminActive = () => ['admin','own'].includes(currentUser.role) && currentUser.id !== 'demo';
  const today = () => new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Ho_Chi_Minh'});
  const localInput = value => value ? new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0,19) : '';
  const displayTime = value => value ? new Date(value).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'}) : '';
  const hours = row => row.check_in && row.check_out ? ((new Date(row.check_out) - new Date(row.check_in))/3600000).toFixed(2) : '';
  // Quote every cell and neutralize spreadsheet formula prefixes in user-entered text.
  const csvCell = value => {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  let generation = 0, employeeRequest = 0, reportRequest = 0, adjustRequest = 0;
  let employees = [], rows = [], page = 0, loadedKey = '', expected = null, saving = false;
  const cellRow = (parent, values) => {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value ?? ''; tr.append(td); }
    parent.append(tr); return tr;
  };
  function invalidateAdjustment() {
    adjustRequest++; loadedKey = ''; expected = null;
    $('adjust-save').disabled = true;
    $('adjust-in').value = $('adjust-out').value = $('adjust-reason').value = '';
    $('adjust-status').textContent = 'Chọn ngày và tải công trước khi nhập.';
  }
  async function fetchEmployees() {
    if (!adminActive()) return;
    const userGeneration = generation, request = ++employeeRequest;
    $('employee-list-status').textContent = 'Đang tải danh sách…';
    try {
      let all = [], offset = 0;
      while (true) {
        const {data, error} = await client.from('profiles').select('id,full_name,department').eq('role','employee').order('id').range(offset, offset + 499);
        if (error) throw error;
        if (userGeneration !== generation || request !== employeeRequest || !adminActive()) return;
        all.push(...data); offset += data.length;
        if (!data.length) break;
      }
      employees = all;
      $('employee-list').replaceChildren();
      for (const employee of employees) cellRow($('employee-list'), [employee.full_name, employee.department || '—', employee.id]);
      $('employee-count').textContent = `${employees.length} nhân viên`;
      $('employee-list-status').textContent = employees.length ? '' : 'Chưa có nhân viên. Tạo tài khoản ở mục bên dưới.';
      for (const id of ['report-employee', 'adjust-employee']) {
        const select = $(id), previous = select.value;
        select.replaceChildren(new Option(id === 'report-employee' ? 'Tất cả nhân viên' : 'Chọn nhân viên', ''));
        for (const employee of employees) select.add(new Option(`${employee.full_name} (${employee.id.slice(0,8)})`, employee.id));
        if (employees.some(e => e.id === previous)) select.value = previous;
      }
    } catch (error) {
      if (userGeneration === generation && request === employeeRequest) $('employee-list-status').textContent = `Không tải được danh sách: ${error.message}`;
    }
  }
  function filter() {
    const from = $('report-from').value, to = $('report-to').value;
    if (!from || !to || from > to) throw new Error('Chọn khoảng ngày hợp lệ (từ ngày không sau đến ngày).');
    return {from, to, employee: $('report-employee').value};
  }
  async function fetchReport(filters, userGeneration, request) {
    const all = []; let offset = 0;
    while (true) {
      // Inner join excludes administrator attendance from the employee report.
      let query = client.from('attendance').select('*,profiles!inner(full_name,department,role)')
        .eq('profiles.role', 'employee').gte('work_date', filters.from).lte('work_date', filters.to)
        .order('work_date', {ascending:false}).order('id').range(offset, offset + 499);
      if (filters.employee) query = query.eq('employee_id', filters.employee);
      const {data, error} = await query;
      if (error) throw error;
      if (userGeneration !== generation || request !== reportRequest || !adminActive()) return null;
      all.push(...data); offset += data.length;
      if (!data.length) return all;
    }
  }
  function renderReport() {
    $('report-rows').replaceChildren();
    for (const row of rows.slice(page*20, page*20+20)) {
      const tr=cellRow($('report-rows'), [row.profiles.full_name, row.work_date, displayTime(row.check_in), displayTime(row.check_out), hours(row), row.note]);
      const td=document.createElement('td'), button=document.createElement('button');
      button.className='outline'; button.textContent='Yêu cầu xóa';
      button.onclick=async()=>{
        if(!adminActive()) return;
        const reason=prompt(`Lý do đề nghị xóa công ${row.work_date} của ${row.profiles.full_name}:`);
        if(!reason?.trim()) return;
        button.disabled=true;
        try {
          const {error}=await client.rpc('submit_approval',{p_action:'attendance_delete',p_target:row.id,p_payload:{},p_reason:reason.trim()});
          if(error) throw error;
          $('report-status').textContent='Đã gửi yêu cầu xóa công, chờ own duyệt.';
          window.dispatchEvent(new Event('approvals-changed'));
        } catch(error) { $('report-status').textContent=error.message; }
        finally { button.disabled=false; }
      };
      td.append(button); tr.append(td);
    }
    $('report-page').textContent = `${page+1} / ${Math.max(1, Math.ceil(rows.length/20))}`;
    $('report-prev').disabled = page === 0;
    $('report-next').disabled = (page+1)*20 >= rows.length;
  }
  async function loadReport(exportCsv = false) {
    if (!adminActive()) return;
    const userGeneration = generation, request = ++reportRequest;
    $('report-status').textContent = 'Đang tải báo cáo…';
    try {
      const filters = filter();
      const data = await fetchReport(filters, userGeneration, request);
      if (data === null) return;
      rows = data; page = 0; renderReport();
      $('report-status').textContent = `${rows.length} bản ghi từ ${filters.from} đến ${filters.to}. Giờ Việt Nam; số giờ là chênh lệch vào/ra, chưa trừ giờ nghỉ.`;
      if (exportCsv) {
        const output = [['Mã nhân viên','Họ tên','Phòng ban','Ngày công','Giờ vào (UTC+7)','Giờ ra (UTC+7)','Số giờ','Ghi chú'],
          ...rows.map(row => [row.employee_id,row.profiles.full_name,row.profiles.department,row.work_date,displayTime(row.check_in),displayTime(row.check_out),hours(row),row.note])];
        const blob = new Blob(['\uFEFF' + output.map(row => row.map(csvCell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `cham-cong-${filters.from}-${filters.to}.csv`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (userGeneration === generation && request === reportRequest) {
        rows = []; page = 0; renderReport(); $('report-status').textContent = `Không tải được báo cáo: ${error.message}`;
      }
    }
  }
  $('report-filter').onsubmit = event => { event.preventDefault(); loadReport(); };
  $('report-export').onclick = () => loadReport(true);
  $('export').onclick = () => { panel.scrollIntoView({behavior:'smooth'}); loadReport(true); };
  $('report-prev').onclick = () => { if (page > 0) { page--; renderReport(); } };
  $('report-next').onclick = () => { if ((page+1)*20 < rows.length) { page++; renderReport(); } };
  for (const id of ['report-from','report-to','report-employee']) $(id).onchange = () => {
    reportRequest++; rows = []; page = 0; renderReport(); $('report-status').textContent = 'Bộ lọc đã thay đổi. Bấm Xem lịch sử hoặc Xuất CSV.';
  };
  $('reload-employees').onclick = fetchEmployees;
  for (const id of ['adjust-employee','adjust-date']) $(id).onchange = invalidateAdjustment;
  $('adjust-load').onclick = async () => {
    if (!adminActive() || saving) return;
    invalidateAdjustment();
    const employee = $('adjust-employee').value, date = $('adjust-date').value;
    if (!employee || !date) { $('adjust-status').textContent = 'Chọn nhân viên và ngày công.'; return; }
    const userGeneration = generation, request = adjustRequest;
    $('adjust-status').textContent = 'Đang tải công…';
    try {
      const {data, error} = await client.from('attendance').select('*').eq('employee_id',employee).eq('work_date',date).maybeSingle();
      if (error) throw error;
      if (userGeneration !== generation || request !== adjustRequest || !adminActive()) return;
      expected = data; loadedKey = `${employee}/${date}`;
      $('adjust-in').value = localInput(data?.check_in); $('adjust-out').value = localInput(data?.check_out);
      $('adjust-save').disabled = false;
      $('adjust-status').textContent = data ? 'Đã tải công. Nhập giờ cần điều chỉnh và lý do.' : 'Chưa có công ngày này. Nhập giờ và lý do để bổ sung.';
    } catch (error) {
      if (userGeneration === generation && request === adjustRequest) $('adjust-status').textContent = error.message;
    }
  };
  $('adjustment-form').onsubmit = async event => {
    event.preventDefault();
    if (!adminActive() || saving) return;
    const employee = $('adjust-employee').value, date = $('adjust-date').value;
    if (loadedKey !== `${employee}/${date}`) { $('adjust-status').textContent = 'Tải công trước khi lưu.'; return; }
    const userGeneration = generation;
    saving = true;
    const controls = [...event.target.querySelectorAll('input,select,textarea,button')];
    controls.forEach(control => { control.disabled = true; });
    let saved = false;
    try {
      const start = $('adjust-in').value, end = $('adjust-out').value;
      if (!start || start.slice(0,10) !== date || (end && end < start)) throw new Error('Giờ vào phải thuộc ngày công; giờ ra không được trước giờ vào.');
      const {error} = await client.rpc('submit_approval', {p_action:'attendance_save',p_target:expected?.id || null,p_reason:$('adjust-reason').value.trim(),p_payload:{
        p_employee_id: employee, p_work_date: date, p_check_in: new Date(start+'+07:00').toISOString(),
        p_check_out: end ? new Date(end+'+07:00').toISOString() : null,
        p_reason: $('adjust-reason').value.trim(), p_expected: expected,
      }});
      if (error) throw error;
      saved = true;
      if (userGeneration !== generation || !adminActive()) return;
      loadedKey = ''; expected = null;
      $('adjust-status').textContent = 'Đã gửi yêu cầu. Công chỉ thay đổi khi own đồng ý.';
      window.dispatchEvent(new Event('approvals-changed'));
      await loadReport();
    } catch (error) { if (userGeneration === generation) $('adjust-status').textContent = `Không lưu được công: ${error.message}`; }
    finally {
      saving = false; controls.forEach(control => { control.disabled = false; });
      $('adjust-save').disabled = saved || !loadedKey;
    }
  };
  function resetAdmin() {
    generation++; employeeRequest++; reportRequest++; employees = []; rows = []; page = 0;
    panel.classList.toggle('hidden', !adminActive());
    $('employee-list').replaceChildren(); $('employee-count').textContent = '0 nhân viên';
    $('report-rows').replaceChildren(); $('report-status').textContent = '';
    $('report-employee').replaceChildren(new Option('Tất cả nhân viên',''));
    $('adjust-employee').replaceChildren(new Option('Chọn nhân viên',''));
    invalidateAdjustment(); renderReport();
  }
  window.addEventListener('attendance-user-change', () => {
    resetAdmin();
    const date = today(); $('report-from').value = date.slice(0,8)+'01'; $('report-to').value = date; $('adjust-date').value = date;
    if (adminActive()) { fetchEmployees(); loadReport(); }
  });
  window.addEventListener('employees-changed', fetchEmployees);
  window.addEventListener('approval-applied', () => { if (adminActive()) { fetchEmployees(); loadReport(); } });
  $('logout').addEventListener('click', resetAdmin);
})();
