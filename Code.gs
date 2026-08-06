/**
 * Code.gs — Backend สำหรับระบบติดตามการใช้ห้องประชุม
 * ใช้ Google Calendar เป็นฐานข้อมูล (แต่ละ "ห้องประชุม" = 1 ปฏิทิน หรือใช้
 * ปฏิทินเดียวแล้วเก็บชื่อห้องไว้ใน event tag [ROOM:xxx] ก็ได้)
 *
 * วิธี Deploy:
 * 1. เปิด script.google.com > สร้างโปรเจกต์ใหม่ > วางโค้ดนี้ทั้งหมด
 * 2. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (หรือ Anyone within organization)
 * 3. คัดลอก Web app URL ไปใส่ในหน้า "ตั้งค่า" ของระบบ (CONFIG.GAS_URL)
 * 4. ตั้งค่า CALENDAR_ID ให้ตรงกับปฏิทินที่ต้องการใช้เก็บข้อมูลการจอง
 */

const CALENDAR_ID = 'nattawatloveffk@gmail.com';
const ROOM_PROPERTY_KEY = 'roomId'; // เก็บใน Event's extended properties
const ADMIN_SECURITY_TOKEN = 'SECURE_MEETING_ROOM_API_KEY_2569'; // API Security Token สำหรับยืนยันสิทธิ์แอดมิน

// ตัวอย่างรายชื่อห้อง — ในระบบจริงอาจเก็บใน Google Sheet แยกต่างหาก
const ROOMS = [
  { id: 'r1', name: 'ห้องประชุมศูนย์การเรียนรู้เพื่อพัฒนาท้องถิ่น', capacity: 20, color: '#0f4c5c' },
  { id: 'r2', name: 'ห้องประชุม B',        capacity: 10, color: '#14708a' },
  { id: 'r3', name: 'ห้องประชุม C (เล็ก)', capacity: 6,  color: '#cf8a26' },
  { id: 'r4', name: 'ห้องประชุมออนไลน์',   capacity: 99, color: '#2fa84f' },
];

function doPost(e) {
  const action = e.parameter ? e.parameter.action : '';
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : '{}');
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
  }
  const payload = body.payload || {};
  const authToken = body.authToken || (e.parameter ? e.parameter.token : '') || '';

  // ความปลอดภัย: Action ที่มีการเขียน/แก้ไข/ลบ ข้อมูล ต้องได้รับการยืนยันด้วย Security Token เท่านั้น
  const WRITE_ACTIONS = ['createBooking', 'updateBooking', 'deleteBooking'];
  if (WRITE_ACTIONS.includes(action)) {
    if (!authToken || authToken !== ADMIN_SECURITY_TOKEN) {
      return jsonResponse({ success: false, error: 'Access Denied: Invalid Security Token' }, 403);
    }
  }

  let result;
  try {
    switch (action) {
      case 'ping':           result = { success: true, time: new Date() }; break;
      case 'listRooms':      result = ROOMS; break;
      case 'listBookings':   result = listBookings(); break;
      case 'createBooking':  result = createBooking(payload); break;
      case 'updateBooking':  result = updateBooking(payload); break;
      case 'deleteBooking':  result = deleteBooking(payload.id); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

function doGet(e) {
  // อนุญาตให้ ping ผ่าน GET เพื่อทดสอบง่าย ๆ จากเบราว์เซอร์
  return jsonResponse({ status: 'ok', message: 'Meeting Room API is running' });
}

/* ---------------- Calendar helpers ---------------- */

function getCalendar() {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('ไม่พบปฏิทิน: ตรวจสอบ CALENDAR_ID');
  return cal;
}

function listBookings() {
  const cal = getCalendar();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const events = cal.getEvents(from, to);

  return events.map(eventToBooking);
}

function eventToBooking(event) {
  const start = event.getStartTime();
  const end = event.getEndTime();
  return {
    id: event.getId(),
    title: event.getTitle(),
    roomId: event.getTag(ROOM_PROPERTY_KEY) || 'r1',
    date: Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    start: Utilities.formatDate(start, Session.getScriptTimeZone(), 'HH:mm'),
    end: Utilities.formatDate(end, Session.getScriptTimeZone(), 'HH:mm'),
    owner: event.getTag('owner') || '',
    note: event.getDescription() || '',
  };
}

function validateBookingPayload(b) {
  if (!b || typeof b !== 'object') throw new Error('Invalid payload object');
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) {
    throw new Error('กรุณาระบุหัวข้อการประชุม');
  }
  if (b.title.length > 200) throw new Error('หัวข้อการประชุมยาวเกิน 200 ตัวอักษร');
  if (b.owner && (typeof b.owner !== 'string' || b.owner.length > 100)) {
    throw new Error('ชื่อผู้จองยาวเกิน 100 ตัวอักษร');
  }
  if (b.note && (typeof b.note !== 'string' || b.note.length > 500)) {
    throw new Error('หมายเหตุยาวเกิน 500 ตัวอักษร');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
  if (!/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) {
    throw new Error('รูปแบบเวลาไม่ถูกต้อง (HH:MM)');
  }
}

function createBooking(b) {
  validateBookingPayload(b);
  const cal = getCalendar();
  const start = new Date(`${b.date}T${b.start}:00`);
  const end = new Date(`${b.date}T${b.end}:00`);
  const event = cal.createEvent(b.title, start, end, { description: b.note || '' });
  event.setTag(ROOM_PROPERTY_KEY, b.roomId || 'r1');
  event.setTag('owner', b.owner || '');
  return eventToBooking(event);
}

function updateBooking(b) {
  validateBookingPayload(b);
  const cal = getCalendar();
  const event = cal.getEventById(b.id);
  if (!event) throw new Error('ไม่พบรายการจองนี้');
  event.setTitle(b.title);
  event.setTime(new Date(`${b.date}T${b.start}:00`), new Date(`${b.date}T${b.end}:00`));
  event.setDescription(b.note || '');
  event.setTag(ROOM_PROPERTY_KEY, b.roomId);
  event.setTag('owner', b.owner || '');
  return eventToBooking(event);
}

function deleteBooking(id) {
  const cal = getCalendar();
  const event = cal.getEventById(id);
  if (event) event.deleteEvent();
  return { success: true };
}

function jsonResponse(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
