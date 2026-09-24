(() => {
  const allRoles = ['employee','manager','admin','own'];
  const managers = ['manager','admin','own'];
  const admins = ['admin','own'];
  const definitions = [
    {id:'dashboard', title:'Tổng quan quản lý', description:'Vai trò và trạng thái hệ thống', icon:'▦', roles:managers, panels:['management-home']},
    {id:'attendance', title:'Chấm công', description:'Bắt đầu và kết thúc ca làm', icon:'◷', roles:allRoles, panels:['overview-stats','attendance-panel']},
    {id:'history', title:'Lịch sử của tôi', description:'Xem các lần vào ca và ra ca', icon:'↺', roles:allRoles, panels:['history-panel']},
    {id:'employees', title:'Nhân viên', description:'Danh sách, tạo và cập nhật tài khoản', icon:'◎', roles:managers, panels:['admin-panel','create-employee-panel']},
    {id:'system', title:'Phòng ban & quyền', description:'Phân công và quản trị tài khoản', icon:'⚙', roles:admins, panels:['admin-tools']},
    {id:'shifts', title:'Ca & yêu cầu', description:'Xếp ca, duyệt nghỉ phép và tăng ca', icon:'▤', roles:managers, panels:['manager-tools']},
    {id:'requests', title:'Gửi yêu cầu', description:'Đăng ký nghỉ phép hoặc tăng ca', icon:'＋', roles:['employee','manager'], panels:['employee-request-tools'], realOnly:true},
    {id:'approvals', title:'Own phê duyệt', description:'Theo dõi và xử lý đề nghị thay đổi', icon:'✓', roles:admins, panels:['approval-panel'], realOnly:true},
    {id:'audit', title:'Nhật ký hoạt động', description:'Theo dõi hoạt động tài khoản', icon:'≡', roles:admins, panels:['audit-panel']},
    {id:'schedule', title:'Lịch làm việc', description:'Thông tin các ca làm sắp tới', icon:'▥', roles:managers, panels:['schedule-panel']},
  ];
  const host = $('page-host');
  const tabs = document.createElement('div');
  tabs.className='feature-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Các trang chức năng');
  host.before(tabs);
  const pages = new Map(), buttons = new Map();
  for (const definition of definitions) {
    const page=document.createElement('section');
    page.id=`page-${definition.id}`; page.className='feature-page'; page.hidden=true;
    page.setAttribute('role','tabpanel'); page.setAttribute('aria-labelledby',`tab-${definition.id}`);
    for(const id of definition.panels) { const panel=$(id); if(panel) page.append(panel); }
    host.append(page); pages.set(definition.id,page);
  }
  let visible=[], selected='';
  const allowed = definition => definition.roles.includes(currentUser.role) && (!definition.realOnly || currentUser.id!=='demo');
  function defaultPage() { return managers.includes(currentUser.role)?'dashboard':'attendance'; }
  function hashPage() { return location.hash.startsWith('#page=') ? location.hash.slice(6) : ''; }
  function openPage(id, {updateUrl=true, focus=false}={}) {
    const definition=visible.find(item=>item.id===id) || visible.find(item=>item.id===defaultPage()) || visible[0];
    if(!definition) return;
    selected=definition.id;
    for(const [key,page] of pages) page.hidden=key!==selected;
    for(const [key,button] of buttons) {
      button.setAttribute('aria-selected',String(key===selected)); button.tabIndex=key===selected?0:-1;
    }
    $('page-title').textContent=definition.title;
    $('page-subtitle').textContent=definition.description;
    for(const id of ['overview-nav','history-nav','admin-nav','approval-nav']) {
      const nav=$(id); if(nav) nav.classList.toggle('active',id==='history-nav'?selected==='history':id==='approval-nav'?selected==='approvals':id==='admin-nav'?managers.includes(currentUser.role)&&!['attendance','history','approvals'].includes(selected):selected==='attendance');
    }
    if(hashPage()!==selected) {
      if(updateUrl) history.pushState(null,'',`#page=${selected}`);
      else history.replaceState(null,'',`#page=${selected}`);
    }
    if(focus) buttons.get(selected)?.focus();
  }
  function rebuild() {
    visible=definitions.filter(allowed); selected=''; buttons.clear(); tabs.replaceChildren();
    for(const definition of visible) {
      const button=document.createElement('button'); button.type='button'; button.id=`tab-${definition.id}`; button.className='feature-tab';
      button.setAttribute('role','tab'); button.setAttribute('aria-controls',`page-${definition.id}`);
      const icon=document.createElement('span'); icon.className='feature-icon'; icon.textContent=definition.icon; icon.setAttribute('aria-hidden','true');
      const content=document.createElement('span'), title=document.createElement('strong'), description=document.createElement('small');
      title.textContent=definition.title; description.textContent=definition.description; content.append(title,description); button.append(icon,content);
      button.onclick=()=>openPage(definition.id);
      button.onkeydown=event=>{
        const index=visible.findIndex(item=>item.id===definition.id);
        let next;
        if(event.key==='ArrowRight'||event.key==='ArrowDown') next=(index+1)%visible.length;
        if(event.key==='ArrowLeft'||event.key==='ArrowUp') next=(index-1+visible.length)%visible.length;
        if(event.key==='Home') next=0;
        if(event.key==='End') next=visible.length-1;
        if(next!==undefined) { event.preventDefault(); openPage(visible[next].id,{focus:true}); }
      };
      tabs.append(button); buttons.set(definition.id,button);
    }
    openPage(hashPage(),{updateUrl:false});
    history.replaceState(null,'',`#page=${selected}`);
  }
  // Override the old scroll links: each destination now opens its own page.
  for(const [id,destination] of [['overview-nav',null],['history-nav','history'],['admin-nav','dashboard'],['approval-nav','approvals'],['open-system','system'],['open-employees','employees'],['open-shifts','shifts'],['open-approvals','approvals']]) {
    if($(id)) $(id).onclick=()=>openPage(destination || defaultPage());
  }
  window.addEventListener('attendance-user-change',rebuild);
  window.addEventListener('popstate',()=>openPage(hashPage(),{updateUrl:false}));
  window.addEventListener('hashchange',()=>openPage(hashPage(),{updateUrl:false}));
  $('logout').addEventListener('click',()=>{
    visible=[];selected='';tabs.replaceChildren();buttons.clear();
    for(const page of pages.values()) page.hidden=true;
    history.replaceState(null,'',location.pathname+location.search);
  });
})();
