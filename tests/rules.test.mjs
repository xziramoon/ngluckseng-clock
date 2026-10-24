// ทดสอบ Security Rules ของ attendance/ ด้วย Firebase Emulator (เคส R1-R21 ใน docs/plan-phase1.md ข้อ 7.2)
// รัน: cd tests && npm test
import { test, before, after, beforeEach, describe } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove, push, serverTimestamp, query, orderByChild, equalTo } from 'firebase/database';

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
    // admin เขียน state/log (เฟส 2) ได้
    await assertSucceeds(set(ref(db, A('state/s2')), { status: 'working', workDate: TODAY, since: 1, inAt: 1 }));
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
    // เอกสารพฤติกรรมปัจจุบัน ถ้าวันหนึ่งปิดช่องนี้ได้ ให้เปลี่ยน assertSucceeds เป็น assertFails
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
    await assertFails(remove(ref(db, A('corrections/c1'))));
    await assertFails(set(ref(db, A('corrections/c2')), body({ status: 'approved' })));
    await assertFails(set(ref(db, A('corrections/c3')), body({ staffId: 's2' })));        // ของคนอื่น
    await assertFails(set(ref(db, A('corrections/bad id')), body()));
    await assertFails(set(ref(db, A('corrections/c4')), body({ createdAt: 123 })));
    await assertFails(update(ref(db, A('corrections/c1')), { status: 'approved' }));
    const mine = await assertSucceeds(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    if (Object.keys(mine.val() || {}).length !== 1) throw new Error('ควรอ่านของตัวเองได้ 1 รายการ');
    await assertFails(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s2'))));
    await assertFails(get(ref(db, A('corrections'))));
    await assertSucceeds(update(ref(admin(), A('corrections/c1')), { status: 'approved', decidedBy: 'adm', decidedAt: 1 }));
  });

  test('R21 แอดมินสร้าง staff ที่มี pinHash ใน staff/ ไม่ได้', async () => {
    const db = admin();
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '08:00', active: true, pinHash: HASH_A }));
    await assertFails(update(ref(db, A('staff/s1')), { pinHash: HASH_A }));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'nope', shiftStart: '08:00', active: true }));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '25:00', active: true }));
    await assertFails(set(ref(db, A('staffSecret/s9')), { pinHash: 'zzzz' }));
  });
});

async function seedGet(p) {
  let v;
  await seed(async (db) => { v = (await get(ref(db, A(p)))).val(); });
  return v;
}
