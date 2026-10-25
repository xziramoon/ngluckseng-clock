// ทดสอบ Security Rules ของ attendance/ ด้วย Firebase Emulator (เคส R1-R28 ใน docs/plan-phase1.md ข้อ 7.2, R29-R48 ใน docs/plan-phase2.md ข้อ 11)
// รัน: cd tests && npm test
import { test, before, after, beforeEach, describe } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove, push, serverTimestamp, query, orderByChild, equalTo, startAt, endAt, orderByKey } from 'firebase/database';

const RULES = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const [HOST, PORT] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(Date.now());
const YESTERDAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(Date.now() - 86400000);
const HASH_A = 'a'.repeat(64);

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-clock',
    database: { host: HOST, port: Number(PORT), rules: RULES },
  });
});
after(async () => { await env?.cleanup(); });

const anon = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).database();
const admin = () => env.authenticatedContext('adm', { firebase: { sign_in_provider: 'password' } }).database();
const adminEmail = () => env.authenticatedContext('adm', { email: 'boss@test.com', firebase: { sign_in_provider: 'password' } }).database();
const anonAsAdminUid = () => env.authenticatedContext('adm', { firebase: { sign_in_provider: 'anonymous' } }).database();
const guest = () => env.unauthenticatedContext().database();

const A = (p) => `attendance/${p}`;
async function seed(fn) { await env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.database()); }); }

beforeEach(async () => {
  await env.clearDatabase();
  await seed(async (db) => {
    await set(ref(db, A('admins/adm')), true);
    await set(ref(db, A('branches/b1')), { name: 'สาขาทดสอบ', lat: 13.7, lng: 100.5, radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60, active: true });
    await set(ref(db, A('staff/s1')), { nickname: 'เอ', branchId: 'b1', shiftStart: '08:00', active: true, uid: 'u1', deviceApproved: true });
    await set(ref(db, A('staff/s2')), { nickname: 'บี', branchId: 'b1', shiftStart: '08:00', active: true, uid: 'u2', deviceApproved: true });
    await set(ref(db, A('staff/s3')), { nickname: 'ซี', branchId: 'b1', shiftStart: '08:00', active: false, uid: 'u3', deviceApproved: true });
    await set(ref(db, A('staff/s4')), { nickname: 'ดี', branchId: 'b1', shiftStart: '08:00', active: true });
    await set(ref(db, A('staff/s5')), { nickname: 'อี', branchId: 'b1', shiftStart: '08:00', active: true, uid: 'u5', deviceApproved: false });
    await set(ref(db, A('staffSecret/s1')), { pinHash: HASH_A });
  });
});

/** ประกอบ multi-path update แบบเดียวกับที่ clock.html ส่ง */
function build(db, { sid, uid, type, d = TODAY, prev = null, extraLog = {}, stateOverride = {}, logOverride = {} }) {
  const lid = push(ref(db, A(`logs/${d}/${sid}`))).key;
  const log = { type, ts: serverTimestamp(), lat: 13.7, lng: 100.5, accuracy: 20, distance: 10, branchId: 'b1', uid, source: 'app', clientTs: Date.now(), ...extraLog, ...logOverride };
  const NEXT = { in: 'working', break_start: 'on_break', break_end: 'working', out: 'done' };
  const st = {
    status: NEXT[type], workDate: d, since: serverTimestamp(),
    inAt: type === 'in' ? serverTimestamp() : prev?.inAt,
    lastLogId: lid, lastLat: 13.7, lastLng: 100.5, lastBranchId: 'b1', ...stateOverride,
  };
  return { lid, updates: { [A(`logs/${d}/${sid}/${lid}`)]: log, [A(`state/${sid}`)]: st } };
}
const send = (db, o) => update(ref(db), build(db, o).updates);

async function setState(sid, st) { await seed((db) => set(ref(db, A(`state/${sid}`)), st)); }
const WORKING = (over = {}) => ({ status: 'working', workDate: TODAY, since: Date.now() - 120000, inAt: Date.now() - 3600000, lastLogId: 'oldlog', ...over });

// ---------- เฟส 2: helper ของแอดมิน ----------
/** audit.after ที่ rules ตรวจกับของจริง (ts/voided/review ของ log, status/workDate ของ state, confirmed ของ days) */
function auditAfter(path, node) {
  const pick = (keys) => Object.fromEntries(keys.filter((k) => node[k] !== undefined && node[k] !== null).map((k) => [k, node[k]]));
  if (path.startsWith('logs/')) return pick(['ts', 'voided', 'review']);
  if (path.startsWith('state/')) return pick(['status', 'workDate']);
  if (path.startsWith('days/')) return pick(['confirmed']);
  return { ...node };
}
/**
 * ประกอบ multi-path update แบบเดียวกับ withAudit() ใน clock-master.html
 * item: { path, node?, before?, op?, nodeOver?, auditOver?, aid?, noAudit?, bind? }  (node ไม่ใส่ = ไม่เขียน node แต่ยังสร้าง audit)
 */
function withAudit(db, items, { email = true, group = 'g1' } = {}) {
  const u = {};
  for (const it of items) {
    const aid = it.aid || push(ref(db, A('audit'))).key;
    if (it.node) {
      const node = { ...it.node };
      if (it.bind !== false && /^(logs|state|days)\//.test(it.path)) node.auditId = aid;
      if (it.path.startsWith('logs/') && it.bind !== false) { node.editedBy = 'adm'; node.editedAt = serverTimestamp(); }
      u[A(it.path)] = { ...node, ...(it.nodeOver || {}) };
    }
    if (!it.noAudit) {
      u[A(`audit/${aid}`)] = {
        path: it.path, by: 'adm', ...(email ? { byEmail: 'boss@test.com' } : {}), at: serverTimestamp(), op: it.op || 'edit_log', group,
        after: it.after || (it.node ? auditAfter(it.path, it.node) : { x: 1 }),
        ...(it.before ? { before: it.before } : {}), ...(it.auditOver || {}),
      };
    }
  }
  return u;
}
const APPLOG = (over = {}) => ({ type: 'in', ts: Date.now() - 3600000, lat: 13.7, lng: 100.5, accuracy: 20, distance: 10, branchId: 'b1', uid: 'u1', source: 'app', clientTs: Date.now() - 3600000, ...over });
async function seedLog(sid, d, lid, node) { await seed((db) => set(ref(db, A(`logs/${d}/${sid}/${lid}`)), node)); }
/** แก้ log เดิม: old = ค่าปัจจุบันใน DB, changes = ฟิลด์ที่เปลี่ยน (null = ลบฟิลด์); คืน updates พร้อม audit (before.ts = old.ts) */
function editLog(db, { sid = 's1', d = TODAY, lid = 'L1', old, changes = {}, extra = {} }) {
  const node = { ...old, ...changes };
  for (const k of Object.keys(node)) if (node[k] === null) delete node[k];
  return withAudit(db, [{ path: `logs/${d}/${sid}/${lid}`, node, before: { ts: old.ts }, ...extra }]);
}
const stNode = (over = {}) => {
  const n = { status: 'working', workDate: TODAY, since: Date.now() - 3600000, inAt: Date.now() - 3600000, lastLogId: 'L1', prevLogId: 'L1', ...over };
  for (const k of Object.keys(n)) if (n[k] === null) delete n[k];
  return n;
};
/** seed: กะที่กำลังทำของ s1 (log L1 + state) */
async function seedShift(over = {}) {
  const t = Date.now() - 3600000;
  await seedLog('s1', TODAY, 'L1', APPLOG({ ts: t, clientTs: t }));
  await setState('s1', { status: 'working', workDate: TODAY, since: t, inAt: t, lastLogId: 'L1', ...over });
}
const midnightTH = (d) => Date.parse(`${d}T00:00:00+07:00`);
const addDaysTH = (d, n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(Date.parse(`${d}T12:00:00+07:00`) + n * 86400000);

describe('Security Rules attendance/', () => {
  test('R1 ไม่ล็อกอิน: อ่าน staff, logs ไม่ได้', async () => {
    const db = guest();
    await assertFails(get(ref(db, A('staff'))));
    await assertFails(get(ref(db, A('logs'))));
    await assertFails(get(ref(db, A('branches'))));
  });

  test('R2 anonymous: อ่าน staff, branches ได้', async () => {
    const db = anon('u9');
    await assertSucceeds(get(ref(db, A('staff'))));
    await assertSucceeds(get(ref(db, A('branches'))));
    await assertSucceeds(get(ref(db, A('settings'))));
  });

  test('R3 anonymous: อ่าน staffSecret, admins, deviceRequests, state, logs ไม่ได้', async () => {
    await setState('s1', WORKING());
    const db = anon('u9');
    await assertFails(get(ref(db, A('staffSecret'))));
    await assertFails(get(ref(db, A('staffSecret/s1'))));
    await assertFails(get(ref(db, A('admins'))));
    await assertFails(get(ref(db, A('deviceRequests'))));
    await assertFails(get(ref(db, A('state'))));
    await assertFails(get(ref(db, A('state/s1'))));
    await assertFails(get(ref(db, A(`logs/${TODAY}`))));
    await assertFails(get(ref(db, A(`logs/${TODAY}/s1`))));
    await assertFails(get(ref(db, A('audit'))));
    await assertFails(get(ref(db, A('days'))));
    // เจ้าของเครื่องอ่าน state ของตัวเองได้ แต่ไม่ใช่ของคนอื่น
    await assertSucceeds(get(ref(anon('u1'), A('state/s1'))));
    await assertFails(get(ref(anon('u2'), A('state/s1'))));
    // admins/{uid} อ่านได้เฉพาะของตัวเอง
    await assertSucceeds(get(ref(anon('u9'), A('admins/u9'))));
    await assertFails(get(ref(anon('u9'), A('admins/adm'))));
  });

  test('R4 เครื่องที่ยังไม่อนุมัติ/ไม่ใช่เจ้าของ เขียน log+state ไม่ได้', async () => {
    await assertFails(send(anon('u9'), { sid: 's1', uid: 'u9', type: 'in' }));       // uid ไม่ตรง
    await assertFails(send(anon('u9'), { sid: 's4', uid: 'u9', type: 'in' }));       // staff ยังไม่ผูกเครื่อง
    await assertFails(send(anon('u5'), { sid: 's5', uid: 'u5', type: 'in' }));       // ผูกแล้วแต่ deviceApproved=false
    await assertFails(send(guest(), { sid: 's1', uid: 'x', type: 'in' }));
  });

  test('R5 พนักงานที่อนุมัติแล้ว: in ที่ถูกต้องผ่าน (และ in ครั้งแรกที่มี flag)', async () => {
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    const snap = await seedGet('state/s1');
    if (snap.status !== 'working') throw new Error('state ไม่เป็น working');
    await seed((db) => remove(ref(db, A('state/s1'))));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', extraLog: { flag: 'borderline', flagReason: 'x' } }));
  });

  test('R6 log โดยไม่มี state / state โดยไม่มี log ต้องถูกปฏิเสธ', async () => {
    const db = anon('u1');
    const { lid, updates } = build(db, { sid: 's1', uid: 'u1', type: 'in' });
    await assertFails(update(ref(db), { [A(`logs/${TODAY}/s1/${lid}`)]: updates[A(`logs/${TODAY}/s1/${lid}`)] }));
    await assertFails(update(ref(db), { [A('state/s1')]: updates[A('state/s1')] }));
    // state ชี้ไป log ที่ไม่ได้เขียนมาด้วย
    await assertFails(update(ref(db), { [A('state/s1')]: { ...updates[A('state/s1')], lastLogId: 'ghost' } }));
    // 2 log ใน write เดียว
    const b2 = build(db, { sid: 's1', uid: 'u1', type: 'in' });
    await assertFails(update(ref(db), { ...updates, ...b2.updates, [A('state/s1')]: updates[A('state/s1')] }).then(() => { }));
  });

  test('R7 ts เป็นเลขที่กำหนดเอง ต้องถูกปฏิเสธ', async () => {
    const db = anon('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { ts: Date.now() - 7200000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { ts: Date.now() - 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { since: Date.now() - 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { inAt: Date.now() - 1000000 } }));
  });

  test('R8 เขียนทับ/ลบ log เดิม, ลบ state ไม่ได้', async () => {
    const db = anon('u1');
    const b = build(db, { sid: 's1', uid: 'u1', type: 'in' });
    await assertSucceeds(update(ref(db), b.updates));
    const logPath = A(`logs/${TODAY}/s1/${b.lid}`);
    await assertFails(set(ref(db, logPath), { type: 'in', ts: serverTimestamp(), branchId: 'b1', source: 'app' }));
    await assertFails(update(ref(db, logPath), { lat: 1 }));
    await assertFails(remove(ref(db, logPath)));
    await assertFails(remove(ref(db, A('state/s1'))));
    await assertFails(set(ref(db, A('state/s1')), null));
    // เขียน state ตรงๆ ย้อนเป็น off ไม่ได้
    await assertFails(update(ref(db, A('state/s1')), { status: 'off' }));
  });

  test('R9 break_start ภายใน 30 วิหลัง in ถูกปฏิเสธ', async () => {
    await setState('s1', WORKING({ since: Date.now() - 5000 }));
    const prev = (await seedGet('state/s1'));
    await assertFails(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
    await setState('s1', WORKING({ since: Date.now() - 40000 }));
    const prev2 = await seedGet('state/s1');
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev: prev2 }));
  });

  test('R10 ลำดับสถานะผิดถูกปฏิเสธ', async () => {
    const db = anon('u1');
    // out ขณะ on_break
    await setState('s1', WORKING({ status: 'on_break' }));
    let prev = await seedGet('state/s1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'out', prev }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'break_start', prev }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', prev }));
    // in ขณะ working (ยังไม่ stale)
    await setState('s1', WORKING());
    prev = await seedGet('state/s1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', prev }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'break_end', prev }));
    // in ซ้ำหลัง done วันเดียวกัน
    await setState('s1', WORKING({ status: 'done' }));
    prev = await seedGet('state/s1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', prev }));
    // ... แต่ done ของเมื่อวาน in ได้
    await setState('s1', WORKING({ status: 'done', workDate: YESTERDAY }));
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in', prev }));
    // STALE: working เกิน 16 ชม. in ใหม่ได้
    await setState('s1', WORKING({ inAt: Date.now() - 17 * 3600000 }));
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in', prev }));
    // จับ out บนวัน workDate ผิด
    await setState('s1', WORKING());
    prev = await seedGet('state/s1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'out', d: YESTERDAY === TODAY ? '2020-01-01' : YESTERDAY, prev }));
    // inAt ต้องไม่ถูกแก้ตอน out
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'out', prev, stateOverride: { inAt: Date.now() } }));
  });

  test('R11 in -> break_start -> break_end -> out ผ่านทุกขั้น', async () => {
    const db = anon('u1');
    const age = () => seed((adb) => update(ref(adb, A('state/s1')), { since: Date.now() - 60000 }));
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in' }));
    await age();
    let prev = (await get(ref(db, A('state/s1')))).val();
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'break_start', prev }));
    await age();
    prev = (await get(ref(db, A('state/s1')))).val();
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'break_end', prev }));
    await age();
    prev = (await get(ref(db, A('state/s1')))).val();
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'break_start', prev })); // พักหลายรอบ
    await age();
    prev = (await get(ref(db, A('state/s1')))).val();
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'break_end', prev }));
    await age();
    prev = (await get(ref(db, A('state/s1')))).val();
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'out', prev }));
    const fin = (await get(ref(db, A('state/s1')))).val();
    if (fin.status !== 'done') throw new Error('สุดท้ายควรเป็น done');
    // ข้ามเที่ยงคืน: break/out ใช้ workDate เดิมของ state ได้แม้ไม่ใช่วันนี้
    await setState('s2', WORKING({ workDate: YESTERDAY }));
    prev = await seedGet('state/s2');
    await assertSucceeds(send(anon('u2'), { sid: 's2', uid: 'u2', type: 'break_start', d: YESTERDAY, prev }));
  });

  test('R12 พนักงาน A เขียน log/state ของ B ไม่ได้', async () => {
    await assertFails(send(anon('u1'), { sid: 's2', uid: 'u1', type: 'in' }));
    await assertFails(send(anon('u1'), { sid: 's2', uid: 'u2', type: 'in' }));
    await assertFails(send(anon('u1'), { sid: 's1', uid: 'u2', type: 'in' })); // uid ใน log ไม่ตรง auth
  });

  test('R13 active=false: in ไม่ได้', async () => {
    await assertFails(send(anon('u3'), { sid: 's3', uid: 'u3', type: 'in' }));
    // ปิดบัญชีกลางกะ ก็เขียนต่อไม่ได้
    await setState('s1', WORKING());
    const prev = await seedGet('state/s1');
    await seed((db) => update(ref(db, A('staff/s1')), { active: false }));
    await assertFails(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
  });

  test('R14 source:admin, review, ฟิลด์แปลกปลอม ถูกปฏิเสธ', async () => {
    const db = anon('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { source: 'admin' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { review: 'approved' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { hacker: 1 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { flag: 'trusted' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { type: 'hack' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { branchId: 'nope' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { extra: 1 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', d: '2026-13-45' }));
  });

  test('R15 deviceRequests: สร้างของตัวเอง pending ผ่าน; ของคนอื่น/ตั้ง status เอง ไม่ผ่าน', async () => {
    const db = anon('u9');
    const body = (over = {}) => ({ staffId: 's4', pinHash: HASH_A, requestedAt: serverTimestamp(), status: 'pending', userAgent: 'UA', ...over });
    await assertSucceeds(set(ref(db, A('deviceRequests/u9')), body()));
    await assertSucceeds(get(ref(db, A('deviceRequests/u9'))));
    await assertFails(set(ref(db, A('deviceRequests/other')), body()));
    await assertFails(get(ref(db, A('deviceRequests/other'))));
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ status: 'rejected' })));
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ status: 'approved' })));
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ requestedAt: 12345 })));
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ staffId: 's3' })));      // staff ปิดบัญชี
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ staffId: 'nope' })));
    await assertFails(set(ref(anon('u8'), A('deviceRequests/u8')), body({ pinHash: '1234' })));
    // ทับคำขอ pending เดิมไม่ได้ / แก้ status เองไม่ได้
    await assertFails(set(ref(db, A('deviceRequests/u9')), body({ staffId: 's1' })));
    await assertFails(update(ref(db, A('deviceRequests/u9')), { status: 'approved' }));
    // ลบของตัวเองได้
    await assertSucceeds(remove(ref(db, A('deviceRequests/u9'))));
    // หลังถูก rejected (admin) ลงทะเบียนใหม่ได้
    await assertSucceeds(set(ref(db, A('deviceRequests/u9')), body()));
    await assertSucceeds(update(ref(admin(), A('deviceRequests/u9')), { status: 'rejected' }));
    await assertSucceeds(set(ref(db, A('deviceRequests/u9')), body()));
  });

  test('R16 anonymous เขียน staff/{sid}/uid เองไม่ได้', async () => {
    const db = anon('u9');
    await assertFails(set(ref(db, A('staff/s4/uid')), 'u9'));
    await assertFails(update(ref(db, A('staff/s4')), { uid: 'u9', deviceApproved: true }));
    await assertFails(set(ref(db, A('staff/s1/active')), false));
  });

  test('R17 แอดมิน (password): อ่าน/เขียนได้ และอนุมัติเครื่อง', async () => {
    const db = admin();
    await assertSucceeds(get(ref(db, A('staffSecret'))));
    await assertSucceeds(get(ref(db, A('deviceRequests'))));
    await assertSucceeds(get(ref(db, A('state'))));
    await assertSucceeds(get(ref(db, A('logs'))));
    await assertSucceeds(get(ref(db, A('admins'))));
    await assertSucceeds(set(ref(db, A('branches/b2')), { name: 'สาขา 2', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60, active: true }));
    await assertSucceeds(set(ref(db, A('settings/lateGraceMin')), 5));
    await assertSucceeds(update(ref(db, A('branches/b1')), { radius: 120, lat: 13.71, lng: 100.51 }));
    await assertFails(set(ref(db, A('branches/b3')), { name: 'x', radius: 5000, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertSucceeds(set(ref(db, A('branches/b4')), { name: 'x', radius: 10, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(set(ref(db, A('branches/b5')), { name: 'x', radius: 5, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(set(ref(db, A('branches/BAD ID')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    // เพิ่มพนักงาน (multi-path staff + staffSecret)
    await assertSucceeds(update(ref(db), {
      [A('staff/s9')]: { nickname: 'ใหม่', branchId: 'b1', shiftStart: '08:30', active: true, createdAt: serverTimestamp() },
      [A('staffSecret/s9')]: { pinHash: HASH_A },
    }));
    // อนุมัติเครื่อง
    await set(ref(anon('u4'), A('deviceRequests/u4')), { staffId: 's4', pinHash: HASH_A, requestedAt: serverTimestamp(), status: 'pending', userAgent: 'UA' });
    await assertSucceeds(get(ref(db, A('deviceRequests/u4'))));
    await assertSucceeds(update(ref(db), {
      [A('staff/s4/uid')]: 'u4', [A('staff/s4/deviceApproved')]: true, [A('staff/s4/deviceApprovedAt')]: serverTimestamp(),
      [A('deviceRequests/u4')]: null,
    }));
    // หลังอนุมัติ s4 ลงเวลาได้
    await assertSucceeds(send(anon('u4'), { sid: 's4', uid: 'u4', type: 'in' }));
    // ยกเลิกผูกเครื่อง
    await assertSucceeds(update(ref(db, A('staff/s4')), { uid: null, deviceApproved: false }));
    // เฟส 2: admin เขียน state ได้เฉพาะพร้อม audit ใหม่ใน update เดียว + prevLogId ('-' เมื่อยังไม่มี state)
    await assertFails(set(ref(db, A('state/s2')), { status: 'working', workDate: TODAY, since: 1, inAt: 1 }));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: 'state/s2', node: { status: 'working', workDate: TODAY, since: 1, inAt: 1, prevLogId: '-' }, op: 'set_state' }], { email: false })));
  });

  test('R18 uid ที่อยู่ใน admins แต่ล็อกอิน anonymous: อ่าน staffSecret ไม่ได้', async () => {
    const db = anonAsAdminUid();
    await assertFails(get(ref(db, A('staffSecret'))));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '08:00', active: true }));
    await assertFails(set(ref(db, A('branches/b2')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(get(ref(db, A('logs'))));
  });

  test('R19 วันที่ confirmed แล้ว พนักงาน in ไม่ได้', async () => {
    await seed((db) => set(ref(db, A(`days/${TODAY}/s1`)), { confirmed: true, confirmedBy: 'adm', confirmedAt: 1 }));
    await assertFails(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    await seed((db) => set(ref(db, A(`days/${TODAY}/s1/confirmed`)), false));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R20 แอดมินแก้/ลบ audit เดิมไม่ได้ (สร้างใหม่ได้)', async () => {
    const db = admin();
    const entry = () => ({ path: 'x', by: 'adm', at: serverTimestamp(), before: 1, after: 2 });
    await assertSucceeds(set(ref(db, A('audit/a1')), entry()));
    await assertFails(set(ref(db, A('audit/a1')), entry()));
    await assertFails(update(ref(db, A('audit/a1')), { after: 3 }));
    await assertFails(remove(ref(db, A('audit/a1'))));
    await assertFails(set(ref(db, A('audit/a2')), { path: 'x', by: 'someone-else', at: serverTimestamp() }));
    await assertFails(set(ref(db, A('audit/a3')), { path: 'x', by: 'adm', at: 5 }));
    await assertFails(set(ref(anon('u1'), A('audit/a4')), entry()));
  });

  test('R22 distance ที่ client อ้างต้องไม่เกิน radius x graceFactor ของสาขา (ในเทส = 80 x 1.5 = 120)', async () => {
    const db = anon('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 121 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { accuracy: -1 } }));
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 120 } }));
  });

  test('R23 [ข้อจำกัดที่ทราบ] $d ย้อนหลัง/ล่วงหน้า สำหรับ in: rules แปลง now เป็นวันที่ไม่ได้ จึงผ่าน (บรรเทาด้วยป้ายเตือนใน master)', async () => {
    // เอกสารพฤติกรรมเมื่อ settings/calendarEnforced ปิดอยู่ (ค่าเริ่มต้น) เมื่อเปิดแล้วถูกปฏิเสธ ดู R45
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2020-01-01' }));
    await seed((db) => remove(ref(db, A('state/s1'))));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2099-12-31' }));
  });

  test('R24 in หลัง done ด้วย $d คนละวัน ผ่าน (กะใหม่) แต่ $d เดียวกันไม่ผ่าน', async () => {
    await setState('s1', WORKING({ status: 'done', workDate: '2026-01-05' }));
    const prev = await seedGet('state/s1');
    await assertFails(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2026-01-05', prev }));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2026-01-06', prev }));
  });

  test('R25 type ไม่ตรงกับ state.status ถูกปฏิเสธ (ทุกคู่ที่ผิด)', async () => {
    const db = anon('u1');
    const cases = [
      ['off', ['break_start', 'break_end', 'out']],
      ['working', ['break_end', 'in']],
      ['on_break', ['break_start', 'out', 'in']],
      ['done', ['break_start', 'break_end', 'out', 'in']],
    ];
    for (const [status, types] of cases) {
      await setState('s1', WORKING({ status }));
      const prev = await seedGet('state/s1');
      for (const type of types) await assertFails(send(db, { sid: 's1', uid: 'u1', type, prev }));
    }
  });

  test('R26 เขียน state เป็นบางส่วนไม่ได้', async () => {
    await setState('s1', WORKING());
    const db = anon('u1');
    await assertFails(update(ref(db, A('state/s1')), { status: 'done' }));
    await assertFails(update(ref(db, A('state/s1')), { since: serverTimestamp() }));
    await assertFails(set(ref(db, A('state/s1/status')), 'off'));
    await assertFails(set(ref(db, A('state/s1/inAt')), 1));
  });

  test('R27 anonymous เขียน settings, days, branches, admins ไม่ได้', async () => {
    const db = anon('u1');
    await assertFails(set(ref(db, A('settings/lateGraceMin')), 5));
    await assertFails(set(ref(db, A('days/' + TODAY + '/s1')), { confirmed: true }));
    await assertFails(set(ref(db, A('branches/b1/radius')), 300));
    await assertFails(set(ref(db, A('admins/u1')), true));
    await assertFails(set(ref(db, A('staffSecret/s1')), { pinHash: HASH_A }));
  });

  test('R28 corrections: สร้างของตัวเองได้ pending เท่านั้น อ่านของตัวเองผ่าน query ได้', async () => {
    const db = anon('u1');
    const body = (over = {}) => ({ staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(set(ref(db, A('corrections/c1')), body()));
    await assertFails(set(ref(db, A('corrections/c1')), body({ reason: 'แก้' })));          // create-only
    // เฟส 2: เจ้าของลบคำขอ pending ของตัวเองได้ (ดู R41) แต่คนอื่นลบไม่ได้
    await assertFails(remove(ref(anon('u2'), A('corrections/c1'))));
    await assertFails(set(ref(db, A('corrections/c2')), body({ status: 'approved' })));
    await assertFails(set(ref(db, A('corrections/c3')), body({ staffId: 's2' })));        // ของคนอื่น
    await assertFails(set(ref(db, A('corrections/bad id')), body()));
    await assertFails(set(ref(db, A('corrections/c4')), body({ createdAt: 123 })));
    await assertFails(update(ref(db, A('corrections/c1')), { status: 'approved' }));
    const mine = await assertSucceeds(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    if (Object.keys(mine.val() || {}).length !== 1) throw new Error('ควรอ่านของตัวเองได้ 1 รายการ');
    await assertFails(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s2'))));
    await assertFails(get(ref(db, A('corrections'))));
    await assertSucceeds(update(ref(admin(), A('corrections/c1')), { status: 'approved', decidedBy: 'adm', decidedAt: serverTimestamp() }));
  });

  test('R21 แอดมินสร้าง staff ที่มี pinHash ใน staff/ ไม่ได้', async () => {
    const db = admin();
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '08:00', active: true, pinHash: HASH_A }));
    await assertFails(update(ref(db, A('staff/s1')), { pinHash: HASH_A }));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'nope', shiftStart: '08:00', active: true }));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '25:00', active: true }));
    await assertFails(set(ref(db, A('staffSecret/s9')), { pinHash: 'zzzz' }));
  });

  // ================= เฟส 2 (R29-R48) =================
  test('R29 แอดมินแก้ ts ของ log app: ไม่มี audit ปฏิเสธ / มี audit + origTs ผ่าน', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    const ts2 = old.ts - 600000;
    // ไม่มี audit (เขียน node ตรงๆ)
    await assertFails(set(ref(db, A(`logs/${TODAY}/s1/L1`)), { ...old, ts: ts2, origTs: old.ts }));
    // มี audit + origTs = ts เดิม
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { ts: ts2, origTs: old.ts } })));
    const got = (await get(ref(db, A(`logs/${TODAY}/s1/L1`)))).val();
    if (got.ts !== ts2 || got.origTs !== old.ts) throw new Error('ts/origTs ไม่ถูกเก็บ');
  });

  test('R30 audit ผูกกับ node: auditId ซ้ำ / path ผิด / after,before ไม่ตรง / editedBy,editedAt ผิด / review ไม่เปลี่ยน auditId', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    const ts2 = old.ts - 60000, oc = { ts: ts2, origTs: old.ts };
    // auditId ที่มีอยู่แล้ว (ใช้ audit ซ้ำ)
    await seed((adb) => set(ref(adb, A('audit/dup')), { path: `logs/${TODAY}/s1/L1`, by: 'adm', at: 1, after: { ts: ts2 }, before: { ts: old.ts } }));
    await assertFails(update(ref(db), { [A(`logs/${TODAY}/s1/L1`)]: { ...old, ...oc, auditId: 'dup', editedBy: 'adm', editedAt: serverTimestamp() } }));
    // audit ชี้ path ของ log อื่น
    await assertFails(update(ref(db), editLog(db, { old, changes: oc, extra: { auditOver: { path: `logs/${TODAY}/s1/L9` } } })));
    // after/ts ไม่ตรง, before/ts ไม่ตรง
    await assertFails(update(ref(db), editLog(db, { old, changes: oc, extra: { after: { ts: ts2 + 1 } } })));
    await assertFails(update(ref(db), editLog(db, { old, changes: oc, extra: { before: { ts: 1 } } })));
    // editedBy คนอื่น / editedAt ไม่ใช่ now
    await assertFails(update(ref(db), editLog(db, { old, changes: oc, extra: { nodeOver: { editedBy: 'someone' } } })));
    await assertFails(update(ref(db), editLog(db, { old, changes: oc, extra: { nodeOver: { editedAt: 5 } } })));
    // update review อย่างเดียว ไม่เปลี่ยน auditId
    await assertFails(update(ref(db), { [A(`logs/${TODAY}/s1/L1/review`)]: 'approved' }));
    await assertFails(set(ref(db, A(`logs/${TODAY}/s1/L1/review`)), 'approved'));
    // ... แต่ผ่านเมื่อทำถูก และครั้งถัดไปที่ไม่เปลี่ยน auditId ใช้ไม่ได้
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { review: 'approved' } })));
    await assertFails(update(ref(db), { [A(`logs/${TODAY}/s1/L1/review`)]: 'rejected' }));
  });

  test('R31 หลักฐานของ log app แก้ไม่ได้ (lat/distance/type/uid/branchId/flag/ลบ lat/source) แต่ review/voided/note แก้ได้', async () => {
    const db = adminEmail();
    await seed((adb) => set(ref(adb, A('branches/b2')), { name: 'อีกสาขา', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60, active: true }));
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    const bad = [{ lat: 14 }, { distance: 11 }, { type: 'out' }, { uid: 'u2' }, { branchId: 'b2' }, { flag: 'suspect' }, { lat: null }, { source: 'admin' }];
    for (const changes of bad) await assertFails(update(ref(db), editLog(db, { old, changes })));
    let cur = { ...old };
    for (const changes of [{ review: 'approved' }, { voided: true }, { note: 'ทดสอบ' }]) {
      await assertSucceeds(update(ref(db), editLog(db, { old: cur, changes })));
      cur = { ...cur, ...changes };
    }
  });

  test('R32 แอดมินลบ log ไม่ได้ (remove / set null) แต่ void พร้อม audit ได้', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    await assertFails(remove(ref(db, A(`logs/${TODAY}/s1/L1`))));
    await assertFails(set(ref(db, A(`logs/${TODAY}/s1/L1`)), null));
    await assertFails(update(ref(db), { [A(`logs/${TODAY}/s1/L1`)]: null }));
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { voided: true }, extra: { op: 'void_log' } })));
  });

  test('R33 แอดมินสร้าง log source admin: ผ่าน / ts อนาคต,ก่อนปี 2020, branchId ไม่มีจริง, ไม่มี audit ปฏิเสธ', async () => {
    const db = adminEmail();
    const n = (over = {}) => ({ type: 'in', ts: Date.now() - 7200000, branchId: 'b1', source: 'admin', ...over });
    const mk = (lid, over, extra = {}) => withAudit(db, [{ path: `logs/${TODAY}/s1/${lid}`, node: n(over), op: 'add_log', ...extra }]);
    await assertSucceeds(update(ref(db), mk('N1')));
    await assertFails(update(ref(db), mk('N2', { ts: Date.now() + 3600000 })));
    await assertFails(update(ref(db), mk('N3', { ts: 1500000000000 })));
    await assertFails(update(ref(db), mk('N4', { branchId: 'nope' })));
    await assertFails(update(ref(db), mk('N5', {}, { noAudit: true })));
    // ห้ามสร้าง log ที่อ้างว่ามาจากเครื่อง (source app) โดยไม่ใช่การย้าย (movedFrom)
    await assertFails(update(ref(db), mk('N6', { source: 'app', lat: 13.7, lng: 100.5, accuracy: 5, distance: 1, uid: 'u1' })));
  });

  test('R34 origTs: ตั้งครั้งแรกต้องเท่า ts เดิม, ครั้งต่อไปแก้/ลบไม่ได้', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    const t2 = old.ts - 300000, t3 = old.ts - 600000;
    await assertFails(update(ref(db), editLog(db, { old, changes: { ts: t2 } })));                        // ไม่ใส่ origTs
    await assertFails(update(ref(db), editLog(db, { old, changes: { ts: t2, origTs: old.ts + 1 } })));    // origTs ≠ ts เดิม
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { ts: t2, origTs: old.ts } })));
    const cur = { ...old, ts: t2, origTs: old.ts };
    await assertFails(update(ref(db), editLog(db, { old: cur, changes: { ts: t3, origTs: t2 } })));       // เปลี่ยน origTs
    await assertFails(update(ref(db), editLog(db, { old: cur, changes: { ts: t3, origTs: null } })));     // ไม่ส่ง origTs
    await assertSucceeds(update(ref(db), editLog(db, { old: cur, changes: { ts: t3 } })));                // origTs เท่าเดิม
  });

  test('R35 days: ยืนยัน+audit ผ่าน / ไม่มี audit, set ทั้งก้อน, confirmedBy/At ผิด, ลบ ปฏิเสธ / ปลดล็อกผ่าน', async () => {
    const db = adminEmail();
    const conf = (over = {}) => ({ confirmed: true, confirmedBy: 'adm', confirmedAt: serverTimestamp(), ...over });
    const dp = `days/${TODAY}/s1`;
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: dp, node: conf(), op: 'confirm_day' }])));
    await seed((adb) => remove(ref(adb, A(dp))));
    await assertFails(set(ref(db, A(dp)), conf({ auditId: 'zzz' })));                                       // ไม่มี audit
    await assertFails(set(ref(db, A(`days/${TODAY}`)), { s1: conf({ auditId: 'zzz' }) }));                  // set ทั้งก้อนระดับ $d
    await assertFails(set(ref(db, A('days')), { [TODAY]: { s1: conf({ auditId: 'zzz' }) } }));              // set ทั้ง days (สิทธิ์ต้องไม่ไหลลงมา)
    await assertFails(update(ref(db, A(`days/${TODAY}/s1`)), { confirmed: true, confirmedBy: 'adm', confirmedAt: 1 }));
    await assertFails(update(ref(db), withAudit(db, [{ path: dp, node: conf({ confirmedBy: 'other' }) }])));
    await assertFails(update(ref(db), withAudit(db, [{ path: dp, node: conf({ confirmedAt: 5 }) }])));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: dp, node: conf() }])));
    await assertFails(remove(ref(db, A(dp))));
    await assertFails(set(ref(db, A(`days/${TODAY}`)), null));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: dp, node: { confirmed: false, confirmedBy: 'adm', confirmedAt: 1 }, op: 'unlock_day' }])));
  });

  test('R36 ยืนยันวันที่กะยังเปิดไม่ได้ / หลังใส่ out ได้ / ใส่ out+state+ยืนยันใน update เดียวได้', async () => {
    const db = adminEmail();
    const conf = () => ({ confirmed: true, confirmedBy: 'adm', confirmedAt: serverTimestamp() });
    const dp = `days/${TODAY}/s1`;
    const t = Date.now() - 3600000;
    for (const status of ['working', 'on_break']) {
      await seedShift({ status });
      await assertFails(update(ref(db), withAudit(db, [{ path: dp, node: conf() }])));
    }
    const outItems = () => [
      { path: `logs/${TODAY}/s1/L2`, node: { type: 'out', ts: t + 1800000, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s1', node: stNode({ status: 'done', since: t + 1800000, lastLogId: 'L2', prevLogId: 'L1', inAt: t }), op: 'set_state' },
    ];
    // ใส่ out + state done + ยืนยัน ใน update เดียว
    await seedShift();
    await assertSucceeds(update(ref(db), withAudit(db, [...outItems(), { path: dp, node: conf(), op: 'confirm_day' }])));
    // อีกเส้นทาง: ใส่ out แล้วค่อยยืนยัน
    await env.clearDatabase();
    await seed(async (adb) => { await set(ref(adb, A('admins/adm')), true); await set(ref(adb, A('branches/b1')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }); });
    await seedShift();
    await assertSucceeds(update(ref(db), withAudit(db, outItems())));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: dp, node: conf(), op: 'confirm_day' }])));
  });

  test('R37 วันที่ล็อก: แก้ไม่ได้, ปลดล็อก+แก้ใน update เดียวไม่ได้, ปลดล็อกแล้วแก้ได้, แก้+ยืนยันในครั้งเดียวได้', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    await seed((adb) => set(ref(adb, A(`days/${TODAY}/s1`)), { confirmed: true, confirmedBy: 'adm', confirmedAt: 1, auditId: 'seedaud' }));
    const dp = `days/${TODAY}/s1`;
    const unlock = () => ({ path: dp, node: { confirmed: false, confirmedBy: 'adm', confirmedAt: 1 }, op: 'unlock_day' });
    await assertFails(update(ref(db), editLog(db, { old, changes: { voided: true } })));
    const both = { ...editLog(db, { old, changes: { voided: true } }), ...withAudit(db, [unlock()]) };
    await assertFails(update(ref(db), both));
    await assertSucceeds(update(ref(db), withAudit(db, [unlock()])));
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { voided: true } })));
    // แก้ + ยืนยันใน update เดียวบนวันที่ยังไม่ล็อก
    const cur = { ...old, voided: true };
    const edit2 = editLog(db, { old: cur, changes: { voided: false } });
    const conf = withAudit(db, [{ path: dp, node: { confirmed: true, confirmedBy: 'adm', confirmedAt: serverTimestamp() }, op: 'confirm_day' }]);
    await assertSucceeds(update(ref(db), { ...edit2, ...conf }));
  });

  test('R38 แอดมินเขียน state: ต้องมี audit + compare-and-set prevLogId + inAt + lastLogId มีจริง + เขียนทั้งก้อน', async () => {
    const db = adminEmail();
    await seedShift();
    const st = (over = {}, extra = {}) => withAudit(db, [{ path: 'state/s1', node: stNode({ status: 'done', ...over }), op: 'set_state', ...extra }]);
    await assertFails(update(ref(db), { [A('state/s1')]: stNode({ status: 'done', auditId: 'nope' }) }));       // ไม่มี audit
    await assertFails(update(ref(db), st({ prevLogId: 'L9' })));                                               // staff กดแทรก (lastLogId เปลี่ยน)
    await assertFails(update(ref(db), st({ prevLogId: '-' })));                                                // '-' ใช้ได้เมื่อไม่มี lastLogId เท่านั้น
    await assertFails(update(ref(db), st({ inAt: null })));                                                    // working/done ไม่มี inAt
    await assertFails(update(ref(db), st({ lastLogId: 'ghost' })));                                            // log ไม่มีจริง
    await assertFails(update(ref(db, A('state/s1')), { status: 'done' }));                                     // บางฟิลด์
    await assertFails(remove(ref(db, A('state/s1'))));
    await assertFails(set(ref(db, A('state/s1')), null));
    await assertFails(update(ref(db), st({}, { after: { status: 'working', workDate: TODAY } })));             // audit after/status ไม่ตรง
    await assertFails(update(ref(db), st({}, { after: { status: 'done', workDate: '2020-01-01' } })));
    await assertSucceeds(update(ref(db), st({})));
    // ยังไม่มี state: prevLogId '-' ผ่าน; 'off' ไม่ต้องมี inAt
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: 'state/s2', node: { status: 'off', workDate: TODAY, since: 1, prevLogId: '-' }, op: 'set_state' }])));
    await assertFails(update(ref(db), withAudit(db, [{ path: 'state/s5', node: { status: 'off', workDate: TODAY, since: 1, prevLogId: 'x' }, op: 'set_state' }])));
  });

  test('R39 หลังแอดมินแก้ พนักงานกดต่อได้ (ก: ออกเมื่อวานแล้วเข้าวันนี้ / ข: แอดมินใส่เข้าวันนี้แล้วพนักงานกดพัก / ค: ยกเลิกทุกรายการแล้วเข้าใหม่)', async () => {
    const db = adminEmail();
    // (ก)
    const ty = Date.now() - 20 * 3600000;
    await seedLog('s1', YESTERDAY, 'Y1', APPLOG({ ts: ty, clientTs: ty }));
    await setState('s1', { status: 'working', workDate: YESTERDAY, since: ty, inAt: ty, lastLogId: 'Y1' });
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${YESTERDAY}/s1/Y2`, node: { type: 'out', ts: ty + 3600000, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s1', node: { status: 'done', workDate: YESTERDAY, since: ty + 3600000, inAt: ty, lastLogId: 'Y2', prevLogId: 'Y1' }, op: 'set_state' },
    ])));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    // (ข) s2 ยังไม่มี state
    const tb = Date.now() - 7200000;
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s2/B1`, node: { type: 'in', ts: tb, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s2', node: { status: 'working', workDate: TODAY, since: tb, inAt: tb, lastLogId: 'B1', prevLogId: '-' }, op: 'set_state' },
    ])));
    const prev = await seedGet('state/s2');
    await assertSucceeds(send(anon('u2'), { sid: 's2', uid: 'u2', type: 'break_start', prev }));
    // (ค) s1 กำลังทำงานวันนี้ (จาก (ก)) แอดมิน void ทุกรายการ ตั้ง state off
    const s1 = (await get(ref(db, A('state/s1')))).val();
    const logs = (await get(ref(db, A(`logs/${TODAY}/s1`)))).val();
    const [lid0, l0] = Object.entries(logs)[0];
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s1/${lid0}`, node: { ...l0, voided: true }, before: { ts: l0.ts }, op: 'void_log' },
      { path: 'state/s1', node: { status: 'off', workDate: TODAY, since: Date.now() - 60000, prevLogId: s1.lastLogId }, op: 'rebuild_state' },
    ])));
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R40 พนักงานใส่ฟิลด์ของแอดมิน (auditId/prevLogId/editedBy/voided/origTs/note/correctionId/movedFrom) ไม่ได้', async () => {
    const db = anon('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { auditId: 'a1' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { prevLogId: '-' } }));
    for (const f of [{ auditId: 'a1' }, { editedBy: 'u1' }, { editedAt: serverTimestamp() }, { voided: true }, { origTs: 1 }, { note: 'x' }, { correctionId: 'c1' }, { movedFrom: 'logs/x' }]) {
      await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: f }));
    }
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R41 corrections ของพนักงาน: break+endTime, nextDay, ลบคำขอ pending ของตัวเอง, ฟิลด์ของแอดมินใส่เองไม่ได้', async () => {
    const db = anon('u1');
    const body = (over = {}) => ({ staffId: 's1', workDate: TODAY, type: 'out', time: '17:30', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(set(ref(db, A('corrections/c1')), body({ type: 'break', time: '12:00', endTime: '13:00' })));
    await assertFails(set(ref(db, A('corrections/c2')), body({ type: 'break', time: '12:00' })));                      // break ไม่มี endTime
    await assertFails(set(ref(db, A('corrections/c2')), body({ endTime: '25:00' })));
    await assertSucceeds(set(ref(db, A('corrections/c3')), body({ time: '02:00', nextDay: true })));
    await assertFails(set(ref(db, A('corrections/c4')), body({ nextDay: 'yes' })));
    await assertSucceeds(remove(ref(db, A('corrections/c1'))));                                                          // ลบ pending ของตัวเอง
    await seed(async (adb) => {
      await set(ref(adb, A('corrections/cd')), body({ status: 'approved', createdAt: 1, decidedBy: 'adm', decidedAt: 2 }));
      await set(ref(adb, A('corrections/co')), body({ staffId: 's2', createdAt: 1 }));
    });
    await assertFails(remove(ref(db, A('corrections/cd'))));                                                             // ตัดสินแล้ว
    await assertFails(remove(ref(db, A('corrections/co'))));                                                             // ของคนอื่น
    await assertFails(set(ref(db, A('corrections/c5')), body({ resultNote: 'อนุมัติ' })));
    await assertFails(set(ref(db, A('corrections/c6')), body({ appliedTs: 1 })));
    await assertFails(set(ref(db, A('corrections/c7')), body({ decidedBy: 'u1' })));
    await assertFails(set(ref(db, A('corrections/c8')), body({ appliedLogId: 'L1' })));
    await assertFails(update(ref(db, A('corrections/c3')), { time: '03:00' }));                                          // แก้เองไม่ได้
  });

  test('R42 แอดมินตัดสินคำขอ: ครั้งเดียว, decidedBy/At ต้องถูก, แก้ตัวคำขอ/สร้าง/ลบไม่ได้', async () => {
    const db = adminEmail();
    const body = { staffId: 's1', workDate: TODAY, type: 'out', time: '17:30', reason: 'ลืมกด', status: 'pending', createdAt: 1 };
    await seed(async (adb) => { for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) await set(ref(adb, A(`corrections/${c}`)), body); });
    const dec = () => ({ status: 'approved', decidedBy: 'adm', decidedAt: serverTimestamp() });
    await assertSucceeds(update(ref(db, A('corrections/c1')), dec()));
    await assertFails(update(ref(db, A('corrections/c2')), { ...dec(), decidedBy: 'other' }));
    await assertFails(update(ref(db, A('corrections/c2')), { ...dec(), decidedAt: 5 }));
    await assertFails(update(ref(db, A('corrections/c1')), { status: 'rejected', decidedBy: 'adm', decidedAt: serverTimestamp() })); // ตัดสินซ้ำ
    await assertFails(update(ref(db, A('corrections/c3')), { ...dec(), time: '18:00' }));
    await assertFails(update(ref(db, A('corrections/c3')), { ...dec(), reason: 'อย่างอื่น' }));
    await assertFails(set(ref(db, A('corrections/c9')), { ...body, createdAt: serverTimestamp() }));                     // แอดมินสร้างเองไม่ได้
    await assertFails(remove(ref(db, A('corrections/c4'))));
    await assertSucceeds(update(ref(db, A('corrections/c5')), { status: 'rejected', decidedBy: 'adm', decidedAt: serverTimestamp(), resultNote: 'เวลาไม่ตรงกับที่เห็น' }));
  });

  test('R43 appliedLogId ต้องชี้ log ที่ผูก correctionId นั้น และ log.correctionId ต้องชี้คำขอที่มีจริง', async () => {
    const db = adminEmail();
    await seed((adb) => set(ref(adb, A('corrections/c1')), { staffId: 's1', workDate: TODAY, type: 'out', time: '17:30', reason: 'ลืมกด', status: 'pending', createdAt: 1 }));
    const cp = 'attendance/corrections/c1';
    const dec = (applied) => ({ [`${cp}/status`]: 'approved', [`${cp}/decidedBy`]: 'adm', [`${cp}/decidedAt`]: serverTimestamp(), [`${cp}/appliedLogId`]: applied });
    const newLog = (lid, over = {}) => withAudit(db, [{ path: `logs/${TODAY}/s1/${lid}`, node: { type: 'out', ts: Date.now() - 60000, branchId: 'b1', source: 'admin', ...over }, op: 'add_log' }]);
    // log ที่มี correctionId ชี้คำขอที่ไม่มี
    await assertFails(update(ref(db), newLog('A1', { correctionId: 'cx' })));
    // appliedLogId ชี้ log ที่ไม่มี correctionId
    await assertFails(update(ref(db), { ...newLog('A2'), ...dec('A2') }));
    await seed((adb) => set(ref(adb, A(`logs/${TODAY}/s1/A3`)), { type: 'out', ts: 1600000000000, branchId: 'b1', source: 'admin' }));
    await assertFails(update(ref(db), dec('A3')));
    // ถูกต้อง
    await assertSucceeds(update(ref(db), { ...newLog('A4', { correctionId: 'c1' }), ...dec('A4') }));
  });

  test('R44 audit: ฟิลด์ใหม่ถูกต้องผ่าน, byEmail ไม่ตรง/op ผิดรูป/ฟิลด์แปลก ปฏิเสธ, query ตาม path, anonymous อ่านไม่ได้', async () => {
    const db = adminEmail();
    const e = (over = {}) => ({ path: `logs/${TODAY}/s1/L1`, by: 'adm', byEmail: 'boss@test.com', at: serverTimestamp(), op: 'edit_log', group: 'g1', ref: 'c1', reason: 'กดผิด', before: { ts: 1 }, after: { ts: 2 }, ...over });
    await assertSucceeds(set(ref(db, A('audit/a1')), e()));
    await assertFails(set(ref(db, A('audit/a2')), e({ byEmail: 'evil@test.com' })));
    await assertFails(set(ref(db, A('audit/a3')), e({ op: 'Bad-Op' })));
    await assertFails(set(ref(db, A('audit/a4')), e({ extra: 1 })));
    await assertSucceeds(set(ref(db, A('audit/a5')), e({ path: `logs/${TODAY}/s1/L2` })));
    await assertSucceeds(set(ref(db, A('audit/a6')), e({ path: `logs/${TODAY}/s2/L3` })));
    const P = `logs/${TODAY}/s1/`;
    const snap = await assertSucceeds(get(query(ref(db, A('audit')), orderByChild('path'), startAt(P), endAt(P + ''))));
    if (Object.keys(snap.val() || {}).length !== 2) throw new Error('query audit ตาม path ควรได้ 2 รายการ');
    await assertFails(get(ref(anon('u1'), A('audit'))));
  });

  test('R45 calendar + calendarEnforced: เขียนเฉพาะค่าเที่ยงคืนโดยแอดมิน, เมื่อเปิดบังคับ in ต้องตรงวันจริง', async () => {
    const db = adminEmail();
    await assertSucceeds(set(ref(db, A(`calendar/${TODAY}`)), midnightTH(TODAY)));
    await assertFails(set(ref(db, A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY) + 3600000));
    await assertFails(set(ref(anon('u1'), A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY)));
    await assertFails(set(ref(db, A('calendar/not-a-date')), midnightTH(TODAY)));
    await assertSucceeds(set(ref(db, A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY)));
    await assertSucceeds(set(ref(db, A('settings/calendarEnforced')), true));
    const u1 = anon('u1');
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));                           // $d = วันนี้
    await seed((adb) => remove(ref(adb, A('state/s1'))));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', d: '2020-01-01' }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', d: '2099-12-31' }));            // ไม่มีในปฏิทิน
    // กะเมื่อวานที่ค้างอยู่ break_start ไม่ถูกบังคับ
    await setState('s2', WORKING({ workDate: YESTERDAY }));
    const prev = await seedGet('state/s2');
    await assertSucceeds(send(anon('u2'), { sid: 's2', uid: 'u2', type: 'break_start', d: YESTERDAY, prev }));
  });

  test('R46 settings ใหม่: reviewDays 7..92, correctionDays 1..62, calendarEnforced boolean, แอดมินเท่านั้น', async () => {
    const db = adminEmail();
    await assertSucceeds(set(ref(db, A('settings/reviewDays')), 31));
    await assertFails(set(ref(db, A('settings/reviewDays')), 1000));
    await assertSucceeds(set(ref(db, A('settings/correctionDays')), 7));
    await assertFails(set(ref(db, A('settings/correctionDays')), 0));
    await assertSucceeds(set(ref(db, A('settings/calendarEnforced')), true));
    await assertFails(set(ref(db, A('settings/calendarEnforced')), 'yes'));
    await assertFails(set(ref(anon('u1'), A('settings/calendarEnforced')), true));
    await assertSucceeds(get(ref(anon('u1'), A('settings'))));
  });

  test('R47 พนักงานกดครบวงหลังแอดมินเคยเขียน state (auditId/prevLogId ค้างอยู่) ผ่านทุกขั้น', async () => {
    const db = adminEmail();
    const tb = Date.now() - 7200000;
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s1/B1`, node: { type: 'in', ts: tb, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s1', node: { status: 'working', workDate: TODAY, since: tb, inAt: tb, lastLogId: 'B1', prevLogId: '-' }, op: 'set_state' },
    ])));
    const u = anon('u1');
    const age = () => seed((adb) => update(ref(adb, A('state/s1')), { since: Date.now() - 60000 }));
    let prev = (await get(ref(u, A('state/s1')))).val();
    if (!prev.auditId || !prev.prevLogId) throw new Error('state ควรมี auditId/prevLogId ค้างอยู่');
    await assertSucceeds(send(u, { sid: 's1', uid: 'u1', type: 'break_start', prev }));
    await age(); prev = (await get(ref(u, A('state/s1')))).val();
    await assertSucceeds(send(u, { sid: 's1', uid: 'u1', type: 'break_end', prev }));
    await age(); prev = (await get(ref(u, A('state/s1')))).val();
    await assertSucceeds(send(u, { sid: 's1', uid: 'u1', type: 'out', prev }));
    const fin = (await get(ref(u, A('state/s1')))).val();
    if (fin.status !== 'done' || fin.auditId !== undefined) throw new Error('state สุดท้ายควรเป็น done และไม่มี auditId');
  });

  test('R48 ข้อมูลรูปแบบเฟส 1 (ไม่มีฟิลด์ใหม่) อ่านตามสิทธิ์เดิมได้ และพนักงานกดต่อจาก state เดิมได้', async () => {
    const t = Date.now() - 3600000;
    await seed(async (adb) => {
      await set(ref(adb, A(`logs/${TODAY}/s1/P1`)), APPLOG({ ts: t, clientTs: t, flag: 'borderline', flagReason: 'dist' }));
      await set(ref(adb, A('state/s1')), { status: 'working', workDate: TODAY, since: t, inAt: t, lastLogId: 'P1', lastLat: 13.7, lastLng: 100.5, lastBranchId: 'b1' });
      await set(ref(adb, A('corrections/cp')), { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: t });
    });
    await assertSucceeds(get(ref(anon('u1'), A('state/s1'))));
    await assertSucceeds(get(ref(anon('u1'), A(`logs/${TODAY}/s1`))));
    await assertSucceeds(get(query(ref(anon('u1'), A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    await assertFails(get(ref(anon('u2'), A('state/s1'))));
    await assertSucceeds(get(ref(adminEmail(), A('logs'))));
    const prev = await seedGet('state/s1');
    await assertSucceeds(send(anon('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
  });

  // ================= เทสเพิ่มจากรีวิว (R49-R55) =================
  test('R49 audit ต้องตรงกับของจริง: after/voided, after/review, path ของ state และ days', async () => {
    const db = adminEmail();
    const old = APPLOG(); await seedLog('s1', TODAY, 'L1', old);
    await assertFails(update(ref(db), editLog(db, { old, changes: { voided: true }, extra: { after: { ts: old.ts } } })));            // audit ไม่บอกว่า voided
    await assertFails(update(ref(db), editLog(db, { old, changes: { review: 'approved' }, extra: { after: { ts: old.ts } } })));     // audit ไม่บอก review
    await assertFails(update(ref(db), editLog(db, { old, changes: { voided: true }, extra: { after: { ts: old.ts, voided: false } } })));
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { voided: true, review: 'approved' } })));
    await seedShift();
    const st = (path) => withAudit(db, [{ path: 'state/s1', node: stNode({ status: 'done' }), op: 'set_state', auditOver: { path } }]);
    await assertFails(update(ref(db), st('state/s2')));
    await assertSucceeds(update(ref(db), st('state/s1')));
    const conf = { confirmed: true, confirmedBy: 'adm', confirmedAt: serverTimestamp() };
    await assertFails(update(ref(db), withAudit(db, [{ path: `days/${TODAY}/s1`, node: conf, auditOver: { path: `days/${TODAY}/s2` } }])));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: `days/${TODAY}/s1`, node: conf }])));
  });

  test('R50 หลักฐาน log app: flagReason/clientTs/accuracy แก้ไม่ได้, source ของ log admin เปลี่ยนไม่ได้', async () => {
    const db = adminEmail();
    const old = APPLOG({ flag: 'borderline', flagReason: 'dist' }); await seedLog('s1', TODAY, 'L1', old);
    for (const changes of [{ flagReason: 'acc' }, { clientTs: old.clientTs + 1 }, { accuracy: 21 }, { flag: null }, { distance: 11 }]) {
      await assertFails(update(ref(db), editLog(db, { old, changes })));
    }
    await assertSucceeds(update(ref(db), editLog(db, { old, changes: { note: 'ok' } })));
    const adm = { type: 'in', ts: Date.now() - 7200000, branchId: 'b1', source: 'admin' };
    await seedLog('s1', YESTERDAY, 'A1', adm);
    await assertFails(update(ref(db), editLog(db, { d: YESTERDAY, lid: 'A1', old: adm, changes: { source: 'app', lat: 13.7, lng: 100.5, accuracy: 5, distance: 1, uid: 'u1' } })));
    await assertSucceeds(update(ref(db), editLog(db, { d: YESTERDAY, lid: 'A1', old: adm, changes: { note: 'ok' } })));
  });

  test('R51 calendarEnforced: ขอบเขต -15 นาที และ +24 ชม. 15 นาที', async () => {
    await seed((adb) => set(ref(adb, A('settings/calendarEnforced')), true));
    const D2 = '2030-01-01';
    const tryIn = async (cal, shouldPass) => {
      await seed(async (adb) => { await remove(ref(adb, A('state/s1'))); await set(ref(adb, A(`calendar/${D2}`)), cal); });
      const p = send(anon('u1'), { sid: 's1', uid: 'u1', type: 'in', d: D2 });
      await (shouldPass ? assertSucceeds(p) : assertFails(p));
    };
    const n = Date.now();
    await tryIn(n + 880000, true);              // now >= CAL-15m (เหลือ ~20 วิ)
    await tryIn(n + 930000, false);             // เร็วกว่า 15 นาที
    await tryIn(n - 87300000 + 20000, true);    // now < CAL+24h15m
    await tryIn(n - 87300000 - 20000, false);   // เกิน 24h15m
  });

  test('R52 correction: endTime/nextDay/endNextDay แก้ไม่ได้ตอนตัดสิน', async () => {
    const db = adminEmail();
    const body = { staffId: 's1', workDate: TODAY, type: 'break', time: '12:00', endTime: '13:00', nextDay: false, reason: 'ลืมกด', status: 'pending', createdAt: 1 };
    await seed(async (adb) => { for (const c of ['c1', 'c2', 'c3', 'c4']) await set(ref(adb, A(`corrections/${c}`)), body); });
    const dec = () => ({ status: 'approved', decidedBy: 'adm', decidedAt: serverTimestamp() });
    await assertFails(update(ref(db, A('corrections/c1')), { ...dec(), endTime: '13:30' }));
    await assertFails(update(ref(db, A('corrections/c2')), { ...dec(), nextDay: true }));
    await assertFails(update(ref(db, A('corrections/c3')), { ...dec(), endNextDay: true }));
    await assertSucceeds(update(ref(db, A('corrections/c4')), dec()));
  });

  test('R53 correction จากเครื่องที่ไม่ได้อนุมัติ/ปิดบัญชี/ยังไม่ผูก ปฏิเสธ', async () => {
    const body = (sid) => ({ staffId: sid, workDate: TODAY, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp() });
    await assertFails(set(ref(anon('u5'), A('corrections/c5')), body('s5')));   // deviceApproved=false
    await assertFails(set(ref(anon('u3'), A('corrections/c3')), body('s3')));   // active=false
    await assertFails(set(ref(anon('u9'), A('corrections/c4')), body('s4')));   // ยังไม่ผูกเครื่อง
    await assertSucceeds(set(ref(anon('u1'), A('corrections/c1')), body('s1')));
  });

  test('R54 ย้ายกะ (movedFrom): ถูกต้องผ่าน; ปลอม movedFrom (path อื่น, ค่าไม่ตรง, ต้นทางไม่ void, sid อื่น, source admin) ปฏิเสธ', async () => {
    const db = adminEmail();
    const src = APPLOG({ flag: 'suspect', flagReason: 'same', origTs: Date.now() - 3700000 });
    await seedLog('s1', TODAY, 'Lo', src);
    const { auditId, editedBy, editedAt, ...copyBase } = src;
    const mv = (over = {}, o = {}) => {
      const items = [];
      if (!o.noVoid) items.push({ path: `logs/${TODAY}/s1/Lo`, node: { ...src, voided: true, note: 'ย้ายไป' }, before: { ts: src.ts }, op: 'move_log' });
      items.push({ path: `logs/${YESTERDAY}/s1/${o.lid || 'Lc'}`, node: { ...copyBase, movedFrom: `logs/${TODAY}/s1/Lo`, ...over }, op: 'move_log' });
      return withAudit(db, items);
    };
    await assertFails(update(ref(db), mv({ movedFrom: 'admins/adm' }, { lid: 'F1' })));
    await assertFails(update(ref(db), mv({ movedFrom: `logs/${TODAY}/s2/Lo` }, { lid: 'F2' })));
    await assertFails(update(ref(db), mv({ lat: 1 }, { lid: 'F3' })));
    await assertFails(update(ref(db), mv({ distance: 1 }, { lid: 'F4' })));
    await assertFails(update(ref(db), mv({ origTs: 5 }, { lid: 'F5' })));
    await assertFails(update(ref(db), mv({ uid: 'u2' }, { lid: 'F6' })));
    await assertFails(update(ref(db), mv({}, { lid: 'F7', noVoid: true })));
    await assertFails(update(ref(db), mv({ source: 'admin' }, { lid: 'F8' })));
    await assertFails(update(ref(db), mv({ movedFrom: `logs/${TODAY}/s1/nope` }, { lid: 'F9' })));
    await assertSucceeds(update(ref(db), mv({}, { lid: 'Lc' })));
    const got = (await get(ref(db, A(`logs/${YESTERDAY}/s1/Lc`)))).val();
    if (got.origTs !== src.origTs || got.lat !== src.lat) throw new Error('สำเนาต้องพก origTs และหลักฐาน');
    // แก้ movedFrom ของสำเนาภายหลังไม่ได้
    await assertFails(update(ref(db), withAudit(db, [{ path: `logs/${YESTERDAY}/s1/Lc`, node: { ...got, movedFrom: `logs/${TODAY}/s1/Lo`, lat: 2 }, before: { ts: got.ts } }])));
  });

  test('R55 correction workDate: เมื่อมีปฏิทิน (calendarLast) ต้องอยู่ในช่วง correctionDays+1 วัน และไม่ใช่อนาคต', async () => {
    const mid = (n) => midnightTH(addDaysTH(TODAY, n));
    await seed(async (adb) => {
      await set(ref(adb, A('settings/calendarLast')), '2030-12-31');
      for (const n of [-9, -7, -1, 0, 2]) await set(ref(adb, A(`calendar/${addDaysTH(TODAY, n)}`)), mid(n));
    });
    const db = anon('u1');
    const body = (d, over = {}) => ({ staffId: 's1', workDate: d, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(set(ref(db, A('corrections/w0')), body(TODAY)));
    await assertSucceeds(set(ref(db, A('corrections/w1')), body(addDaysTH(TODAY, -1))));
    await assertSucceeds(set(ref(db, A('corrections/w7')), body(addDaysTH(TODAY, -7))));          // ครบ 7 วัน
    await assertFails(set(ref(db, A('corrections/w9')), body(addDaysTH(TODAY, -9))));             // เกินช่วง
    await assertFails(set(ref(db, A('corrections/wf')), body(addDaysTH(TODAY, 2))));              // อนาคต
    await assertFails(set(ref(db, A('corrections/wa')), body('2020-01-01')));                     // ไม่มีในปฏิทิน
    await assertFails(set(ref(db, A('corrections/wb')), body('2099-12-31')));
    // correctionDays = 3 -> ย้อนได้ ~3 วัน
    await seed((adb) => set(ref(adb, A('settings/correctionDays')), 3));
    await assertFails(set(ref(db, A('corrections/w7b')), body(addDaysTH(TODAY, -7))));
    await assertSucceeds(set(ref(db, A('corrections/w1b')), body(addDaysTH(TODAY, -1))));
    // ยังไม่เคยสร้างปฏิทิน (ไม่มี calendarLast): ไม่บังคับช่วง (ข้อจำกัดที่ทราบ) แต่ยังตรวจรูปแบบวัน
    await seed((adb) => remove(ref(adb, A('settings/calendarLast'))));
    await assertSucceeds(set(ref(db, A('corrections/wn')), body('2020-01-01')));
    await assertFails(set(ref(db, A('corrections/wm')), body('2020-13-45')));
  });

  // ================= เฟส 3 (R56-R60) =================
  test('R56 พนักงานอ่าน logs ได้เฉพาะ logs/{วัน}/{ตัวเอง}: วันว่างได้ null, ของคนอื่น/ทั้งวัน/query ช่วง ปฏิเสธ', async () => {
    await seedLog('s2', TODAY, 'X1', APPLOG({ uid: 'u2' }));
    const db = anon('u1');
    const snap = await assertSucceeds(get(ref(db, A('logs/2020-01-01/s1'))));
    if (snap.val() !== null) throw new Error('วันที่ไม่มีข้อมูลต้องได้ null');
    await assertSucceeds(get(ref(db, A(`logs/${TODAY}/s1`))));
    await assertFails(get(ref(db, A(`logs/${TODAY}/s2`))));
    await assertFails(get(ref(db, A(`logs/${TODAY}`))));
    await assertFails(get(query(ref(db, A('logs')), orderByKey(), startAt('2026-01-01'), endAt('2026-12-31'))));
    await assertFails(get(ref(db, A('logs'))));
  });

  test('R57 days: พนักงานอ่านไม่ได้; แอดมิน query logs/days แบบช่วง orderByKey ได้', async () => {
    await seedLog('s1', TODAY, 'X1', APPLOG());
    await seed((adb) => set(ref(adb, A(`days/${TODAY}/s1`)), { confirmed: true, confirmedBy: 'adm', confirmedAt: 1, auditId: 'seedaud' }));
    await assertFails(get(ref(anon('u1'), A(`days/${TODAY}/s1`))));
    await assertFails(get(ref(anon('u1'), A(`days/${TODAY}`))));
    const db = adminEmail();
    const l = await assertSucceeds(get(query(ref(db, A('logs')), orderByKey(), startAt(YESTERDAY), endAt(TODAY))));
    const dd = await assertSucceeds(get(query(ref(db, A('days')), orderByKey(), startAt(YESTERDAY), endAt(TODAY))));
    if (!l.val()[TODAY] || !dd.val()[TODAY]) throw new Error('ควรได้ข้อมูลของวันนี้');
  });

  test('R58 staff.shiftEnd: แอดมินตั้งได้ HH:MM เท่านั้น (ค่าผิดรูปแบบ/ชนิดผิดปฏิเสธ) และเป็น optional', async () => {
    const db = adminEmail();
    const base = { nickname: 'ใหม่', branchId: 'b1', shiftStart: '07:00', active: true };
    await assertSucceeds(set(ref(db, A('staff/n1')), { ...base, shiftEnd: '18:00' }));
    await assertSucceeds(set(ref(db, A('staff/n2')), { ...base, shiftEnd: '00:30' }));
    await assertSucceeds(set(ref(db, A('staff/n3')), base));                                   // ไม่มี shiftEnd (ข้อมูลเดิม)
    await assertSucceeds(update(ref(db, A('staff/s1')), { shiftEnd: '17:30' }));
    for (const bad of ['24:00', '7:00', '18:60', 'abc', '', 1800, true]) await assertFails(set(ref(db, A('staff/n4')), { ...base, shiftEnd: bad }));
    await assertFails(update(ref(db, A('staff/s1')), { shiftEnd: '25:00' }));
    const v = (await get(ref(db, A('staff/s1/shiftEnd')))).val();
    if (v !== '17:30') throw new Error('shiftEnd ต้องเก็บค่า');
  });

  test('R59 shiftEnd: พนักงาน/anonymous/แอดมินที่เป็น anonymous แก้ไม่ได้', async () => {
    await assertFails(set(ref(anon('u1'), A('staff/s1/shiftEnd')), '10:00'));
    await assertFails(update(ref(anon('u1'), A('staff/s1')), { shiftEnd: '10:00' }));
    await assertFails(set(ref(anonAsAdminUid(), A('staff/s1/shiftEnd')), '10:00'));
    await assertFails(set(ref(guest(), A('staff/s1/shiftEnd')), '10:00'));
    await assertSucceeds(get(ref(anon('u9'), A('staff/s1'))));       // ยังอ่านได้ (แอปพนักงานใช้ shiftStart/shiftEnd)
  });

  test('R60 ฟิลด์แปลกใน staff ยังถูกปฏิเสธ (เพิ่ม shiftEnd ไม่เปิด $other)', async () => {
    const db = adminEmail();
    await assertFails(update(ref(db, A('staff/s1')), { shiftEnds: '18:00' }));
    await assertFails(update(ref(db, A('staff/s1')), { shiftEnd: '18:00', extra: 1 }));
    await assertSucceeds(update(ref(db, A('staff/s1')), { shiftEnd: '18:00', shiftStart: '07:00' }));
  });
});

async function seedGet(p) {
  let v;
  await seed(async (db) => { v = (await get(ref(db, A(p)))).val(); });
  return v;
}
