// เขียนข้อมูลทดสอบเฟส 3 ลง Firebase Emulator ผ่าน REST (ใช้ตอนทดสอบรายงาน/CSV/ประวัติด้วยมือ ไม่ใช่ส่วนของแอป)
//   node seed-phase3.mjs                      เดือนปัจจุบัน (ตามเวลาไทย)
//   node seed-phase3.mjs 2026-10 2026-09      หลายเดือน (เดือนก่อนอยู่นอกหน้าต่าง reviewDays จึงใช้ทดสอบ range query)
//   ตัวเลือก: --no-extras (ไม่ใส่พนักงานปิดบัญชี "ซี") --clean (ล้าง logs/days/state/corrections/audit ก่อน)
// ใช้สาขาวงเวียนสาขาเดียว (17.318062, 99.832187 รัศมี 10 / แม่นยำ 30 / ชายขอบ x2) พนักงาน เอ และ บี กะ 07:00-18:00 รหัส PIN 1234
// ต้องเปิด emulator ก่อน: npx firebase emulators:start --only auth,database --project demo-clock (ในโฟลเดอร์ tests)
import fs from 'node:fs';
import crypto from 'node:crypto';

const HOST = process.env.RTDB_HOST || '127.0.0.1:9000', NS = process.env.RTDB_NS || 'demo-clock-default-rtdb';
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/phase3.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const bkk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const today = bkk.format(Date.now());
const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
if (!months.length) months.push(today.slice(0, 7));
const tsOf = (d, hhmm, plus) => Date.parse(`${d}T${hhmm}:00+07:00`) + (plus ? 86400000 : 0);
const H = { Authorization: 'Bearer owner' };
const put = async (p, v) => { const r = await fetch(`http://${HOST}/${p}.json?ns=${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) }); if (!r.ok) throw new Error(`PUT ${p} ${r.status}`); };
const del = (p) => fetch(`http://${HOST}/${p}.json?ns=${NS}`, { method: 'DELETE', headers: H });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

if (flags.has('--clean')) for (const k of ['logs', 'state', 'days', 'corrections', 'audit', 'deviceRequests', 'calendar']) await del('attendance/' + k);
const b = FX.branch;
await put('attendance/branches/' + b.id, { name: b.name, lat: b.lat, lng: b.lng, radius: b.radius, maxAccuracy: b.maxAccuracy, graceFactor: b.graceFactor, breakLimitMin: b.breakLimitMin, active: true, updatedAt: Date.now() });
await put('attendance/settings/lateGraceMin', FX.settings.lateGraceMin);
const staff = [...FX.staff];
if (!flags.has('--no-extras')) staff.push({ key: 'C', sid: '-OCc3', nickname: 'ซี', shiftStart: '07:00', shiftEnd: '18:00', inactive: true });
for (const s of staff) {
  await put('attendance/staff/' + s.sid, { nickname: s.nickname, branchId: b.id, shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, active: s.inactive ? false : true, createdAt: Date.now() });
  await put('attendance/staffSecret/' + s.sid, { pinHash: sha(s.sid + '1234') });
}
const sidOf = (k) => staff.find((s) => s.key === k).sid;
const days = [...FX.days];
if (!flags.has('--no-extras')) days.push({ day: 6, staff: 'C', confirmed: true, logs: [['in', '07:00'], ['out', '18:00']] });   // คนปิดบัญชีที่ยังมีข้อมูลเดิม
let n = 0, skipped = 0;
for (const ym of months) {
  for (const [i, r] of days.entries()) {
    const d = `${ym}-${String(r.day).padStart(2, '0')}`, sid = sidOf(r.staff);
    if (d > today) { skipped++; continue; }
    for (const [j, [type, hhmm, o = {}]] of r.logs.entries()) {
      const ts = tsOf(d, hhmm, o.plus);
      if (ts > Date.now()) { skipped++; continue; }
      const log = { type, ts, branchId: b.id, source: r.source || 'app', clientTs: ts };
      if (log.source === 'app') Object.assign(log, { lat: b.lat, lng: b.lng, accuracy: 10, distance: 3, uid: 'seed' });
      await put(`attendance/logs/${d}/${sid}/S${ym.replace('-', '')}_${i}_${j}`, log); n++;
    }
    if (r.confirmed) await put(`attendance/days/${d}/${sid}`, { confirmed: true, confirmedBy: 'seed', confirmedAt: Date.now(), auditId: 'seed' + d });
  }
}
console.log(`seed เฟส 3: เดือน ${months.join(', ')} · log ${n} รายการ · ข้าม ${skipped} (วัน/เวลาในอนาคต) · พนักงาน ${staff.map((s) => s.nickname + '=' + s.sid).join(' ')} (PIN 1234)`);
