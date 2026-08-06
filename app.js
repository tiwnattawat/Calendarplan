/* =====================================================================
   ระบบติดตามการใช้ห้องประชุม — app.js
   สถาปัตยกรรม: Vanilla JS module pattern (IIFE ต่อโมดูล)
   หมายเหตุ: DataStore ออกแบบให้สลับจาก Mock Data ไปเรียก Google Apps
   Script Web App (ที่ผูกกับ Google Calendar API) ได้ทันที โดยแก้ที่
   CONFIG.USE_MOCK = false และตั้งค่า CONFIG.GAS_URL ในหน้า Settings
===================================================================== */

/* ---------------------------------------------------------------------
   0. CONFIG
--------------------------------------------------------------------- */
const CONFIG = {
  USE_MOCK: false,                 // true = ใช้ข้อมูลจำลองในเครื่อง, false = เรียก Google Apps Script
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxcNdrl-0i6x4iPG6IeYTf0pNX-TpjPup8I8JwWYKUTNJ0zL3HAibhq1BMepdlrhimH/exec',                    // URL ของ Web App ที่ deploy จาก Code.gs
  CALENDAR_ID: 'nattawatloveffk@gmail.com',                // Google Calendar ID ที่ใช้เป็นฐานข้อมูล
  OPEN_TIME: '08:00',
  CLOSE_TIME: '17:00',
  ADMIN_USER: 'admin',
  ADMIN_PASS: 'admin1234',
  API_TOKEN: 'SECURE_MEETING_ROOM_API_KEY_2569',
};

const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const THAI_DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

/* ---------------------------------------------------------------------
   SECURITY HELPER: XSS Sanitization
--------------------------------------------------------------------- */
function escapeHTML(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function thaiDate(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return `วัน${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear()+543}`;
}
function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function timeToMinutes(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function hoursBetween(start,end){ return (timeToMinutes(end)-timeToMinutes(start))/60; }
function uid(){ return 'bk_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

/* ---------------------------------------------------------------------
   1. MOCK DATA (ใช้แทนฐานข้อมูล Google Calendar ระหว่างพัฒนา / เดโม)
--------------------------------------------------------------------- */
const ROOM_COLORS = ['#0f4c5c','#14708a','#cf8a26','#2fa84f','#8a4fae','#c2410c'];

const MockDB = {
  rooms: [
    { id:'r1', name:'ห้องประชุมศูนย์การเรียนรู้เพื่อพัฒนาท้องถิ่น', capacity:20, color: ROOM_COLORS[0] },
  ],
  bookings: [],
};

(function seedBookings(){
  const t = new Date();
  const titles = ['ประชุมทีมการตลาด','ประชุมสรุปงบประมาณ','สัมภาษณ์ผู้สมัครงาน','ประชุมโครงการ IT','อบรมพนักงานใหม่','ประชุมผู้บริหาร','Workshop ออกแบบผลิตภัณฑ์','ประชุมคณะกรรมการ'];
  const owners = ['สมชาย ใจดี','วราภรณ์ พงษ์ไทย','อภิสิทธิ์ เก่งกล้า','ปิยะดา สุขสม','ธนกร วัฒนา','กมลชนก ศรีสุข'];
  let n = 0;
  for(let dayOffset=-3; dayOffset<=10; dayOffset++){
    const d = new Date(t); d.setDate(t.getDate()+dayOffset);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const count = Math.floor(Math.random()*3); // 0-2 ต่อวัน
    for(let i=0;i<count;i++){
      const room = MockDB.rooms[Math.floor(Math.random()*MockDB.rooms.length)];
      const startH = 8 + Math.floor(Math.random()*8);
      const dur = [1,1.5,2][Math.floor(Math.random()*3)];
      const start = `${pad(startH)}:00`;
      const endH = startH + Math.floor(dur);
      const endM = dur % 1 === 0 ? 0 : 30;
      const end = `${pad(endH)}:${pad(endM)}`;
      MockDB.bookings.push({
        id: uid(), title: titles[n % titles.length], roomId: room.id,
        date: dateStr, start, end, owner: owners[n % owners.length],
        note: '', createdAt: Date.now(),
      });
      n++;
    }
  }
})();

/* ---------------------------------------------------------------------
   2. DATASTORE — เลเยอร์เข้าถึงข้อมูล (Mock หรือ Google Apps Script)
   ทุกฟังก์ชัน async คืนค่าเป็น Promise เพื่อให้สลับ backend ได้โดยไม่ต้อง
   แก้โค้ดหน้าบ้าน
--------------------------------------------------------------------- */
const DataStore = {
  async listRooms(){
    let rooms = structuredClone(MockDB.rooms);
    if(!CONFIG.USE_MOCK){
      try {
        const res = await GAS.call('listRooms');
        if(Array.isArray(res) && res.length > 0) rooms = res;
      } catch(e){
        console.warn('GAS listRooms failed, using local room definition:', e);
      }
    }
    if(rooms[0]) rooms[0].name = 'ห้องประชุมศูนย์การเรียนรู้เพื่อพัฒนาท้องถิ่น';
    return rooms;
  },
  async listBookings(){
    if(CONFIG.USE_MOCK) return structuredClone(MockDB.bookings);
    // ในการใช้งานจริง ฟังก์ชันนี้จะเรียก Code.gs -> CalendarApp.getCalendarById(id).getEvents(...)
    return GAS.call('listBookings');
  },
  async createBooking(booking){
    if(CONFIG.USE_MOCK){
      booking.id = uid();
      MockDB.bookings.push(booking);
      return structuredClone(booking);
    }
    return GAS.call('createBooking', booking);
  },
  async updateBooking(booking){
    if(CONFIG.USE_MOCK){
      const idx = MockDB.bookings.findIndex(b=>b.id===booking.id);
      if(idx>-1) MockDB.bookings[idx] = booking;
      return structuredClone(booking);
    }
    return GAS.call('updateBooking', booking);
  },
  async deleteBooking(id){
    if(CONFIG.USE_MOCK){
      MockDB.bookings = MockDB.bookings.filter(b=>b.id!==id);
      return { success:true };
    }
    return GAS.call('deleteBooking', { id });
  },
};

/* Google Apps Script bridge — ใช้เมื่อ CONFIG.USE_MOCK = false
   Code.gs ต้อง expose doGet/doPost ที่รับ action + payload แล้วคืน JSON
   ดูตัวอย่างไฟล์ Code.gs ที่แนบมาคู่กับระบบนี้ */
const GAS = {
  async call(action, payload){
    if(!CONFIG.GAS_URL){
      Toast.show('err', 'ยังไม่ได้ตั้งค่า Google Apps Script URL ในหน้าตั้งค่า');
      throw new Error('GAS_URL not configured');
    }
    const res = await fetch(`${CONFIG.GAS_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        calendarId: CONFIG.CALENDAR_ID, 
        authToken: CONFIG.API_TOKEN,
        payload 
      }),
    });
    if(!res.ok) throw new Error('GAS request failed: ' + res.status);
    return res.json();
  }
};

/* In-memory app state (ห้าม localStorage ตามข้อจำกัดของ artifact) */
const State = {
  rooms: [],
  bookings: [],
  isAdmin: false,
  currentPage: 'public',
};

/* ---------------------------------------------------------------------
   3. UI helpers — dark mode, modal, sidebar, toast
--------------------------------------------------------------------- */
const UI = {
  toggleDark(){
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    Charts.refreshTheme(isDark);
  },
  openModal(id){ document.getElementById(id).classList.add('active'); },
  closeModal(id){ document.getElementById(id).classList.remove('active'); },
  togglePassword(inputId, btn){
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if(input.type === 'password'){ input.type='text'; icon.className='fa-regular fa-eye-slash'; }
    else { input.type='password'; icon.className='fa-regular fa-eye'; }
  },
  openSidebar(){ document.getElementById('adminSidebar').classList.add('open'); document.getElementById('sidebarOverlay').classList.add('active'); },
  closeSidebar(){ document.getElementById('adminSidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('active'); },
};

const Toast = {
  icons: { ok:'fa-circle-check', err:'fa-circle-xmark', info:'fa-circle-info' },
  show(type, msg){
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${this.icons[type]} mt-0.5"></i><span>${msg}</span>`;
    host.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(-6px)'; el.style.transition='.25s'; setTimeout(()=>el.remove(),250); }, 3200);
  }
};

/* ---------------------------------------------------------------------
   4. ROUTER — จัดการ 7 หน้า (public/login เข้าได้เสมอ, ที่เหลือต้อง login)
--------------------------------------------------------------------- */
const ADMIN_PAGES = ['dashboard','calendar','manage','report','settings'];
const PAGE_TITLES = { dashboard:'แดชบอร์ด', calendar:'ปฏิทิน', manage:'จัดการการจอง', report:'รายงาน', settings:'ตั้งค่า' };

const Router = {
  go(page){
    if(ADMIN_PAGES.includes(page) && !State.isAdmin){
      Toast.show('info','กรุณาเข้าสู่ระบบก่อนใช้งานส่วนผู้ดูแล');
      page = 'login';
    }
    State.currentPage = page;

    // Toggle top-level shells
    const isAdminPage = ADMIN_PAGES.includes(page);
    document.getElementById('adminShell').classList.toggle('hidden', !isAdminPage);
    document.getElementById('publicTopbar').classList.toggle('hidden', isAdminPage || page === 'login');

    // Toggle views
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const target = document.getElementById('view-' + page);
    if(target) target.classList.add('active');

    // Sidebar active state
    document.querySelectorAll('.side-link').forEach(l=>l.classList.toggle('active', l.dataset.page===page));
    if(isAdminPage) document.getElementById('adminPageTitle').textContent = PAGE_TITLES[page];

    UI.closeSidebar();
    window.scrollTo({top:0, behavior:'smooth'});

    // Lazy render per page
    if(page==='public') Public.render();
    if(page==='dashboard') Dashboard.render();
    if(page==='calendar') AdminCalendar.render();
    if(page==='manage') Manage.render();
    if(page==='report') Report.render();
    if(page==='settings') Settings.render();
  }
};

/* ---------------------------------------------------------------------
   5. AUTH
--------------------------------------------------------------------- */
const Auth = {
  handleLogin(e){
    e.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const errEl = document.getElementById('loginError');
    if(user === CONFIG.ADMIN_USER && pass === CONFIG.ADMIN_PASS){
      State.isAdmin = true;
      errEl.classList.add('hidden');
      document.getElementById('publicLoginBtn').classList.add('hidden');
      document.getElementById('publicAdminBtn').classList.remove('hidden');
      Toast.show('ok','เข้าสู่ระบบสำเร็จ ยินดีต้อนรับผู้ดูแลระบบ');
      Router.go('dashboard');
    } else {
      errEl.classList.remove('hidden');
      errEl.querySelector('span').textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    }
  },
  logout(){
    State.isAdmin = false;
    document.getElementById('publicLoginBtn').classList.remove('hidden');
    document.getElementById('publicAdminBtn').classList.add('hidden');
    Toast.show('info','ออกจากระบบแล้ว');
    Router.go('public');
  }
};

/* ---------------------------------------------------------------------
   6. Data helpers shared across pages
--------------------------------------------------------------------- */
function roomById(id){ return State.rooms.find(r=>r.id===id); }
function roomName(id){ return roomById(id)?.name || '-'; }
function roomColor(id){ return roomById(id)?.color || '#14708a'; }

function bookingsOn(dateStr){
  return State.bookings.filter(b=>b.date===dateStr).sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));
}
function isRoomBusyNow(roomId){
  const now = new Date();
  const dateStr = todayStr();
  const nowMin = now.getHours()*60+now.getMinutes();
  return State.bookings.some(b=> b.roomId===roomId && b.date===dateStr && nowMin>=timeToMinutes(b.start) && nowMin<timeToMinutes(b.end));
}
function currentBookingFor(roomId){
  const now = new Date(); const dateStr = todayStr(); const nowMin = now.getHours()*60+now.getMinutes();
  return State.bookings.find(b=> b.roomId===roomId && b.date===dateStr && nowMin>=timeToMinutes(b.start) && nowMin<timeToMinutes(b.end));
}
function nextBookingFor(roomId){
  const now = new Date(); const dateStr = todayStr(); const nowMin = now.getHours()*60+now.getMinutes();
  return State.bookings
    .filter(b=> b.roomId===roomId && b.date===dateStr && timeToMinutes(b.start)>nowMin)
    .sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start))[0];
}

/* ---------------------------------------------------------------------
   7. PUBLIC HOME
--------------------------------------------------------------------- */
const Public = {
  calendarInstance: null,
  render(){
    document.getElementById('publicTodayLabel').textContent = thaiDate(todayStr());
    this.renderRoomGrid();
    this.renderUpcoming();
    this.renderCalendar();
  },
  renderRoomGrid(){
    const grid = document.getElementById('publicRoomGrid');
    const r = State.rooms[0];
    if(!r) return;
    const busy = isRoomBusyNow(r.id);
    const cur = currentBookingFor(r.id);
    const next = nextBookingFor(r.id);
    grid.innerHTML = `
      <div class="room-card card p-5 sm:p-6 w-full relative overflow-hidden shadow-lg">
        <div class="absolute top-0 left-0 w-full h-1.5" style="background:${r.color}"></div>
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
          <div class="text-left min-w-[200px]">
            <div class="flex items-center gap-3">
              <p class="font-display font-semibold text-xl sm:text-2xl text-brand-800 dark:text-white tracking-wide">${r.name}</p>
              <span class="text-xs text-brand-500 dark:text-brand-400 bg-black/5 dark:bg-white/5 px-3 py-1 rounded-full border border-black/5 dark:border-white/5 font-medium"><i class="fa-solid fa-user-group mr-1.5 opacity-70"></i>${r.capacity} ที่นั่ง</span>
            </div>
            <p class="text-xs text-brand-500 dark:text-brand-400 mt-1"><i class="fa-solid fa-location-dot mr-1.5 opacity-70"></i>ศูนย์การเรียนรู้เพื่อพัฒนาท้องถิ่น</p>
          </div>

          <div class="flex items-center justify-center">
            <div class="inline-flex items-center justify-center px-5 py-2 rounded-full shadow-sm border ${busy?'border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171]':'border-[#4ade80]/30 bg-[#4ade80]/10 text-[#4ade80]'} transition-colors backdrop-blur-sm">
              <span class="status-dot ${busy?'busy':'ok'} mr-2.5 !w-2.5 !h-2.5 shadow-[0_0_8px_currentColor]"></span>
              <span class="font-medium text-sm sm:text-base">${busy?'กำลังถูกใช้งาน':'ห้องว่าง พร้อมใช้งาน'}</span>
            </div>
          </div>

          <div class="w-full md:w-auto min-w-[220px]">
            ${cur ? `<div class="text-[13px] bg-[#f87171]/10 text-[#f87171] rounded-xl px-4 py-2.5 flex items-center border border-[#f87171]/20"><i class="fa-solid fa-circle-play mr-2.5 opacity-80"></i>กำลังใช้: ${escapeHTML(cur.title)} (${cur.start}-${cur.end})</div>` : ''}
            ${next ? `<div class="text-[13px] bg-black/5 dark:bg-white/5 text-brand-600 dark:text-brand-300 rounded-xl px-4 py-2.5 flex items-center border border-black/5 dark:border-white/5"><i class="fa-regular fa-clock mr-2.5 opacity-80 text-gold-500"></i>ถัดไป: ${escapeHTML(next.title)} (${next.start})</div>` : ''}
            ${(!cur && !next) ? `<div class="text-[13px] text-brand-600 dark:text-brand-300 bg-black/5 dark:bg-white/5 rounded-xl px-4 py-2.5 text-center border border-black/5 dark:border-white/5"><i class="fa-regular fa-circle-check mr-2 opacity-80 text-[#4ade80]"></i>ว่างตลอดวันนี้</div>` : ''}
          </div>
        </div>
      </div>`;
  },
  renderUpcoming(){
    const list = document.getElementById('publicUpcomingList');
    const now = new Date();
    const upcoming = State.bookings
      .filter(b => new Date(`${b.date}T${b.start}`) >= now)
      .sort((a,b)=> new Date(`${a.date}T${a.start}`) - new Date(`${b.date}T${b.start}`))
      .slice(0,8);
    if(!upcoming.length){ list.innerHTML = `<p class="text-sm text-brand-400 text-center py-8">ไม่มีรายการที่จะถึง</p>`; return; }
    list.innerHTML = upcoming.map(b=>`
      <div class="flex items-start gap-3 p-3 rounded-[14px] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors border border-transparent hover:border-black/5 dark:hover:border-white/10" onclick="Public.showDetail('${b.id}')">
        <div class="w-1.5 self-stretch rounded-full shadow-sm" style="background:${roomColor(b.roomId)}"></div>
        <div class="flex-1 min-w-0 py-0.5">
          <p class="text-[13px] font-semibold text-brand-800 dark:text-white truncate tracking-wide">${escapeHTML(b.title)}</p>
          <p class="text-[11px] text-brand-500 dark:text-brand-400 mt-1 uppercase tracking-wider">${escapeHTML(roomName(b.roomId))} &middot; ${b.date} &middot; ${b.start}-${b.end}</p>
        </div>
      </div>`).join('');
  },
  showDetail(id){
    const b = State.bookings.find(x=>x.id===id);
    if(!b) return;
    document.getElementById('edTitle').textContent = b.title;
    document.getElementById('edBody').innerHTML = `
      <p><i class="fa-solid fa-door-open w-5 text-gold-500"></i> ${escapeHTML(roomName(b.roomId))}</p>
      <p><i class="fa-regular fa-calendar w-5 text-gold-500"></i> ${thaiDate(b.date)}</p>
      <p><i class="fa-regular fa-clock w-5 text-gold-500"></i> ${b.start} - ${b.end} น. (${hoursBetween(b.start,b.end)} ชม.)</p>
      <p><i class="fa-regular fa-user w-5 text-gold-500"></i> ${escapeHTML(b.owner)}</p>
      ${b.note ? `<p class="pt-2 border-t divider text-brand-500">${escapeHTML(b.note)}</p>` : ''}
    `;
    UI.openModal('modal-eventDetail');
  },
  renderCalendar(){
    const el = document.getElementById('publicCalendar');
    const events = State.bookings.map(b=>({ id:b.id, title:b.title, start:`${b.date}T${b.start}`, end:`${b.date}T${b.end}`, backgroundColor: roomColor(b.roomId) }));

    if(this.calendarInstance){ this.calendarInstance.destroy(); }
    this.calendarInstance = new FullCalendar.Calendar(el, {
      locale: 'th',
      height: 'auto',
      headerToolbar: { left:'prev,next today', center:'title', right:'dayGridMonth,timeGridWeek' },
      initialView: 'dayGridMonth',
      events,
      eventClick: (info)=> this.showDetail(info.event.id),
      dayMaxEvents: 3,
    });
    this.calendarInstance.render();
  }
};

/* ---------------------------------------------------------------------
   8. DASHBOARD
--------------------------------------------------------------------- */
const Dashboard = {
  render(){
    document.getElementById('dashDateLabel').textContent = thaiDate(todayStr());
    const today = bookingsOn(todayStr());
    const busyRoomIds = new Set(State.rooms.filter(r=>isRoomBusyNow(r.id)).map(r=>r.id));
    const isFree = busyRoomIds.size === 0;
    const totalHoursToday = today.reduce((s,b)=>s+hoursBetween(b.start,b.end),0);
    const openMinutes = timeToMinutes(CONFIG.CLOSE_TIME) - timeToMinutes(CONFIG.OPEN_TIME);
    const capacityMinutes = openMinutes * State.rooms.length;
    const usedMinutes = today.reduce((s,b)=>s+(timeToMinutes(b.end)-timeToMinutes(b.start)),0);
    const util = capacityMinutes>0 ? Math.round((usedMinutes/capacityMinutes)*100) : 0;

    const statFreeEl = document.getElementById('statFree');
    statFreeEl.textContent = isFree ? 'ว่าง' : 'ไม่ว่าง';
    statFreeEl.className = `font-display text-2xl font-bold ${isFree ? 'text-ok' : 'text-busy'}`;
    const cur = currentBookingFor(State.rooms[0]?.id);
    document.getElementById('statFreeSub').textContent = cur ? `ใช้งานโดย: ${cur.owner}` : 'พร้อมใช้งาน';
    
    document.getElementById('statToday').textContent = today.length;
    document.getElementById('statHours').textContent = totalHoursToday.toFixed(1);
    document.getElementById('statUtil').textContent = util + '%';

    document.getElementById('dashTodayList').innerHTML = today.length ? today.map(b=>`
      <div class="flex items-center gap-4 p-3.5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] hover:bg-gold-500/10 border border-black/5 dark:border-white/5 transition-all duration-300 group">
        <div class="w-2.5 h-10 rounded-full shadow-sm" style="background:${roomColor(b.roomId)}"></div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-brand-900 dark:text-white truncate group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">${escapeHTML(b.title)}</p>
          <p class="text-xs text-brand-500 dark:text-brand-400 mt-0.5"><i class="fa-regular fa-user mr-1.5 opacity-60"></i>${escapeHTML(b.owner)} &middot; <span class="opacity-80">${escapeHTML(roomName(b.roomId))}</span></p>
        </div>
        <div class="text-right">
          <span class="font-mono-num text-xs font-semibold px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 text-brand-800 dark:text-brand-200 border border-black/5 dark:border-white/10 flex items-center gap-1.5">
            <i class="fa-regular fa-clock text-gold-500 text-[11px]"></i>${b.start} - ${b.end}
          </span>
        </div>
      </div>`).join('') : `<p class="text-sm text-brand-400 text-center py-8">วันนี้ไม่มีรายการจอง</p>`;

    Charts.renderUsageChart();
  }
};

/* ---------------------------------------------------------------------
   9. CHARTS (Chart.js)
--------------------------------------------------------------------- */
const Charts = {
  usageChart:null, shareChart:null, reportChart:null,
  themeColors(){
    const dark = document.documentElement.classList.contains('dark');
    return { text: dark?'#cfe6e9':'#0a3540', grid: dark?'rgba(255,255,255,.08)':'rgba(15,76,92,.08)' };
  },
  refreshTheme(){ Dashboard.render(); if(State.currentPage==='report') Report.render(); },
  last7Days(){
    const days=[];
    for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`); }
    return days;
  },
  renderUsageChart(){
    const ctx = document.getElementById('chartUsage'); if(!ctx) return;
    const days = this.last7Days();
    const r = State.rooms[0];
    const datasets = r ? [{
      label: 'ชั่วโมงใช้งาน',
      backgroundColor: r.color,
      data: days.map(d => State.bookings.filter(b=>b.date===d).reduce((s,b)=>s+hoursBetween(b.start,b.end),0)),
      borderRadius: 6,
    }] : [];
    const { text, grid } = this.themeColors();
    if(this.usageChart) this.usageChart.destroy();
    this.usageChart = new Chart(ctx, {
      type:'bar',
      data:{ labels: days.map(d=>d.slice(5)), datasets },
      options:{
        responsive:true,
        plugins:{ legend:{ position:'bottom', labels:{ color:text, boxWidth:10, font:{family:'Sarabun'} } } },
        scales:{
          x:{ stacked:true, ticks:{color:text}, grid:{color:'transparent'} },
          y:{ stacked:true, ticks:{color:text}, grid:{color:grid} }
        }
      }
    });
  }
};

/* ---------------------------------------------------------------------
   10. ADMIN CALENDAR (FullCalendar interactive: click / add / edit / delete)
--------------------------------------------------------------------- */
const AdminCalendar = {
  instance:null,
  render(){
    const el = document.getElementById('adminCalendar');
    const events = State.bookings.map(b=>({ id:b.id, title:b.title, start:`${b.date}T${b.start}`, end:`${b.date}T${b.end}`, backgroundColor: roomColor(b.roomId), extendedProps:{ roomId:b.roomId } }));

    if(this.instance) this.instance.destroy();
    this.instance = new FullCalendar.Calendar(el, {
      locale:'th',
      height:'auto',
      headerToolbar:{ left:'prev,next today', center:'title', right:'dayGridMonth,timeGridWeek,timeGridDay' },
      initialView:'dayGridMonth',
      selectable:true,
      editable:true,
      events,
      dateClick: (info)=> Booking.openForm(null, info.dateStr),
      eventClick: (info)=> Booking.openForm(info.event.id),
      eventDrop: (info)=> AdminCalendar.persistMove(info.event),
      eventResize: (info)=> AdminCalendar.persistMove(info.event),
    });
    this.instance.render();
  },
  async persistMove(event){
    const b = State.bookings.find(x=>x.id===event.id);
    if(!b) return;
    const d = event.start;
    b.date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    b.start = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const e = event.end || d;
    b.end = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
    await DataStore.updateBooking(b);
    Toast.show('ok','อัปเดตเวลาการจองแล้ว');
    App.refreshAllViews();
  }
};

/* ---------------------------------------------------------------------
   11. BOOKING FORM (shared modal used by Calendar + Manage)
--------------------------------------------------------------------- */
const Booking = {
  editingId:null,
  openForm(id, presetDate){
    document.getElementById('bkRoom').innerHTML = State.rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
    const form = document.getElementById('bookingForm');
    form.reset();
    document.getElementById('bkError').classList.add('hidden');
    this.editingId = id;
    if(id){
      const b = State.bookings.find(x=>x.id===id);
      document.getElementById('bkModalTitle').textContent = 'แก้ไขการจอง';
      document.getElementById('bkId').value = b.id;
      document.getElementById('bkTitle').value = b.title;
      document.getElementById('bkRoom').value = b.roomId;
      document.getElementById('bkDate').value = b.date;
      document.getElementById('bkOwner').value = b.owner;
      document.getElementById('bkStart').value = b.start;
      document.getElementById('bkEnd').value = b.end;
      document.getElementById('bkNote').value = b.note || '';
      document.getElementById('bkDeleteBtn').classList.remove('hidden');
    } else {
      document.getElementById('bkModalTitle').textContent = 'เพิ่มการจอง';
      document.getElementById('bkId').value = '';
      document.getElementById('bkDate').value = presetDate || todayStr();
      document.getElementById('bkStart').value = '09:00';
      document.getElementById('bkEnd').value = '10:00';
      document.getElementById('bkDeleteBtn').classList.add('hidden');
    }
    UI.openModal('modal-booking');
  },
  hasConflict(candidate){
    return State.bookings.some(b =>
      b.id !== candidate.id &&
      b.roomId === candidate.roomId &&
      b.date === candidate.date &&
      timeToMinutes(candidate.start) < timeToMinutes(b.end) &&
      timeToMinutes(candidate.end) > timeToMinutes(b.start)
    );
  },
  async save(e){
    e.preventDefault();
    const hpVal = document.getElementById('bkWebsiteHp')?.value || '';
    if(hpVal !== ''){
      console.warn('Bot submission blocked via Honeypot trap.');
      return;
    }
    const errEl = document.getElementById('bkError');
    const booking = {
      id: document.getElementById('bkId').value || null,
      title: document.getElementById('bkTitle').value.trim(),
      roomId: document.getElementById('bkRoom').value,
      date: document.getElementById('bkDate').value,
      owner: document.getElementById('bkOwner').value.trim(),
      start: document.getElementById('bkStart').value,
      end: document.getElementById('bkEnd').value,
      note: document.getElementById('bkNote').value.trim(),
    };
    if(timeToMinutes(booking.start) >= timeToMinutes(booking.end)){
      errEl.textContent = 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม'; errEl.classList.remove('hidden'); return;
    }
    if(this.hasConflict(booking)){
      errEl.textContent = 'ช่วงเวลานี้ห้องถูกจองแล้ว กรุณาเลือกเวลาอื่น'; errEl.classList.remove('hidden'); return;
    }
    errEl.classList.add('hidden');

    if(booking.id){ await DataStore.updateBooking(booking); Toast.show('ok','แก้ไขการจองสำเร็จ'); }
    else { delete booking.id; await DataStore.createBooking(booking); Toast.show('ok','เพิ่มการจองสำเร็จ'); }

    await App.loadData();
    UI.closeModal('modal-booking');
    App.refreshAllViews();
  },
  remove(){
    const id = document.getElementById('bkId').value;
    if(!id) return;
    document.getElementById('confirmText').textContent = 'ยืนยันการลบรายการจองนี้หรือไม่?';
    document.getElementById('confirmOkBtn').onclick = async ()=>{
      await DataStore.deleteBooking(id);
      await App.loadData();
      UI.closeModal('modal-confirm');
      UI.closeModal('modal-booking');
      Toast.show('ok','ลบการจองแล้ว');
      App.refreshAllViews();
    };
    UI.openModal('modal-confirm');
  }
};

/* ---------------------------------------------------------------------
   12. MANAGE (CRUD table: list / search / filter / edit / delete)
--------------------------------------------------------------------- */
const Manage = {
  render(){
    const search = (document.getElementById('mgSearch').value||'').toLowerCase();
    const dateFilter = document.getElementById('mgDateFilter').value;
    const now = new Date();

    let rows = [...State.bookings];
    if(search) rows = rows.filter(b=> b.title.toLowerCase().includes(search) || b.owner.toLowerCase().includes(search));
    if(dateFilter==='today') rows = rows.filter(b=>b.date===todayStr());
    if(dateFilter==='week'){
      const start = new Date(now); start.setDate(now.getDate()-now.getDay());
      const end = new Date(start); end.setDate(start.getDate()+6);
      rows = rows.filter(b=>{ const d=new Date(b.date); return d>=start && d<=end; });
    }
    if(dateFilter==='month') rows = rows.filter(b=> b.date.slice(0,7) === todayStr().slice(0,7));

    rows.sort((a,b)=> new Date(`${b.date}T${b.start}`) - new Date(`${a.date}T${a.start}`));

    const tbody = document.getElementById('mgTableBody');
    document.getElementById('mgEmpty').classList.toggle('hidden', rows.length>0);
    tbody.innerHTML = rows.map(b=>{
      const busy = b.date===todayStr() && isNowWithin(b);
      return `<tr class="hover:bg-gold-500/5 transition-colors">
        <td class="font-semibold text-brand-900 dark:text-white">${escapeHTML(b.title)}</td>
        <td class="font-mono-num text-xs text-brand-600 dark:text-brand-300"><i class="fa-regular fa-calendar mr-1 opacity-50"></i>${b.date}</td>
        <td class="font-mono-num text-xs font-semibold"><span class="px-2.5 py-1 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10">${b.start} - ${b.end}</span></td>
        <td class="text-sm"><i class="fa-regular fa-user mr-1.5 text-brand-400"></i>${escapeHTML(b.owner)}</td>
        <td><span class="badge ${busy?'badge-busy':'badge-ok'}">${busy?'กำลังใช้งาน':'ปกติ'}</span></td>
        <td class="text-right whitespace-nowrap">
          <button onclick="Booking.openForm('${b.id}')" class="btn-ghost btn !p-2 !rounded-xl text-gold-600 dark:text-gold-400 hover:!bg-gold-500/10" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>
          <button onclick="Manage.quickDelete('${b.id}')" class="btn-danger btn !p-2 !rounded-xl hover:!bg-red-500/20" title="ลบ"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  },
  quickDelete(id){
    document.getElementById('confirmText').textContent = 'ยืนยันการลบรายการจองนี้หรือไม่?';
    document.getElementById('confirmOkBtn').onclick = async ()=>{
      await DataStore.deleteBooking(id);
      await App.loadData();
      UI.closeModal('modal-confirm');
      Toast.show('ok','ลบการจองแล้ว');
      App.refreshAllViews();
    };
    UI.openModal('modal-confirm');
  }
};
function isNowWithin(b){
  const now = new Date(); const nowMin = now.getHours()*60+now.getMinutes();
  return nowMin>=timeToMinutes(b.start) && nowMin<timeToMinutes(b.end);
}

/* ---------------------------------------------------------------------
   13. REPORT (daily / monthly + export PDF / Excel)
--------------------------------------------------------------------- */
const Report = {
  init(){
    const input = document.getElementById('repDate');
    if(!input.value) input.value = todayStr();
  },
  filteredRows(){
    const type = document.getElementById('repType').value;
    const dateVal = document.getElementById('repDate').value || todayStr();
    if(type==='daily') return State.bookings.filter(b=>b.date===dateVal);
    return State.bookings.filter(b=> b.date.slice(0,7) === dateVal.slice(0,7));
  },
  render(){
    this.init();
    const rows = this.filteredRows().sort((a,b)=> a.date.localeCompare(b.date) || timeToMinutes(a.start)-timeToMinutes(b.start));
    const totalHours = rows.reduce((s,b)=>s+hoursBetween(b.start,b.end),0);
    document.getElementById('repCount').textContent = rows.length;
    document.getElementById('repHours').textContent = totalHours.toFixed(1) + ' ชม.';

    document.getElementById('repTableBody').innerHTML = rows.map(b=>`
      <tr>
        <td class="font-mono-num text-xs">${b.date}</td>
        <td>${escapeHTML(b.title)}</td>
        <td class="font-mono-num text-xs">${b.start}-${b.end}</td>
        <td>${escapeHTML(b.owner)}</td>
        <td class="font-mono-num text-xs">${hoursBetween(b.start,b.end).toFixed(1)}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="text-center text-brand-600 dark:text-brand-300 font-medium py-8">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`;
  },
  exportExcel(){
    const rows = this.filteredRows();
    const data = rows.map(b=>({
      'วันที่': b.date, 'หัวข้อ': b.title,
      'เวลาเริ่ม': b.start, 'เวลาสิ้นสุด': b.end, 'ผู้จอง': b.owner, 'ชั่วโมง': hoursBetween(b.start,b.end),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'รายงาน');
    XLSX.writeFile(wb, `รายงานห้องประชุม_${todayStr()}.xlsx`);
    Toast.show('ok','ส่งออกไฟล์ Excel แล้ว');
  },
  exportPDF(){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const rows = this.filteredRows();
    doc.setFontSize(14);
    doc.text('Meeting Room Usage Report', 14, 16);
    doc.setFontSize(9);
    doc.text(`Generated: ${todayStr()}`, 14, 22);
    doc.autoTable({
      startY: 28,
      head: [['Date','Title','Start','End','Owner','Hours']],
      body: rows.map(b=>[b.date, b.title, b.start, b.end, b.owner, hoursBetween(b.start,b.end).toFixed(1)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor:[15,76,92] },
    });
    doc.save(`meeting-room-report_${todayStr()}.pdf`);
    Toast.show('ok','ส่งออกไฟล์ PDF แล้ว (หมายเหตุ: ข้อความไทยในไฟล์ PDF อาจต้องฝังฟอนต์เพิ่มเติม)');
  }
};

/* ---------------------------------------------------------------------
   14. SETTINGS
--------------------------------------------------------------------- */
const Settings = {
  render(){
    document.getElementById('setOpenTime').value = CONFIG.OPEN_TIME;
    document.getElementById('setCloseTime').value = CONFIG.CLOSE_TIME;
    document.getElementById('setGasUrl').value = CONFIG.GAS_URL;
    document.getElementById('setCalId').value = CONFIG.CALENDAR_ID;
  },
  saveHours(){
    CONFIG.OPEN_TIME = document.getElementById('setOpenTime').value || CONFIG.OPEN_TIME;
    CONFIG.CLOSE_TIME = document.getElementById('setCloseTime').value || CONFIG.CLOSE_TIME;
    Toast.show('ok','บันทึกเวลาทำการแล้ว');
    Dashboard.render();
  },
  saveApi(){
    CONFIG.GAS_URL = document.getElementById('setGasUrl').value.trim();
    CONFIG.CALENDAR_ID = document.getElementById('setCalId').value.trim();
    Toast.show('ok','บันทึกการตั้งค่า Google API แล้ว');
  },
  async testConnection(){
    if(!CONFIG.GAS_URL){ Toast.show('err','กรุณากรอก Google Apps Script URL ก่อน'); return; }
    try{
      await GAS.call('ping', {});
      Toast.show('ok','เชื่อมต่อ Google Apps Script สำเร็จ');
    }catch(err){
      Toast.show('err','เชื่อมต่อไม่สำเร็จ: ' + err.message);
    }
  },
  updateAdmin(){
    const u = document.getElementById('setNewUser').value.trim();
    const p = document.getElementById('setNewPass').value;
    if(u) CONFIG.ADMIN_USER = u;
    if(p) CONFIG.ADMIN_PASS = p;
    document.getElementById('setNewUser').value='';
    document.getElementById('setNewPass').value='';
    Toast.show('ok','อัปเดตบัญชีผู้ดูแลระบบแล้ว');
  }
};

/* ---------------------------------------------------------------------
   15. APP BOOTSTRAP
--------------------------------------------------------------------- */
const App = {
  async loadData(){
    State.rooms = await DataStore.listRooms();
    State.bookings = await DataStore.listBookings();
  },
  refreshAllViews(){
    // Re-render whichever page is active + always refresh public data
    if(State.currentPage==='public') Public.render();
    if(State.currentPage==='dashboard') Dashboard.render();
    if(State.currentPage==='calendar') AdminCalendar.render();
    if(State.currentPage==='manage') Manage.render();
    if(State.currentPage==='report') Report.render();
    if(State.currentPage==='settings') Settings.render();
  },
  async init(){
    await this.loadData();
    Router.go('public');
    // Auto-refresh room status every 60s to keep "live" feel
    setInterval(()=>{ if(State.currentPage==='public') Public.renderRoomGrid(); }, 60000);
  }
};

App.init();
