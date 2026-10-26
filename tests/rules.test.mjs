// ทดสอบ Security Rules ของ attendance/ ด้วย Firebase Emulator (R1-R28 ใน docs/plan-phase1.md ข้อ 7.2, R29-R55 ใน docs/plan-phase2.md ข้อ 11, R56-R60 เฟส 3, R61-R76 ใน docs/plan-auth-v2.md ข้อ 10)
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

const DOM = '@staff.ngluckseng.invalid';
const UN = { u1: 'nong_a', u2: 'nong_b', u3: 'nong_c', u5: 'nong_e', u7: 'nong_a2', u9: 'newbie', u10: 'dao' };
const KEYOF = { s1: 'a'.repeat(43), s2: 'b'.repeat(43), s3: 'c'.repeat(43) };
const DID = { s1: 'did_s1_000000000000', s2: 'did_s2_000000000000', s3: 'did_s3_000000000000' };
const KEY9 = 'k'.repeat(43), DID9 = 'did_u9_00000000000000';
/** พนักงาน = password + อีเมลสังเคราะห์โดเมนพนักงาน */
const staffDb = (uid) => env.authenticatedContext(uid, { email: (UN[uid] || uid) + DOM, firebase: { sign_in_provider: 'password' } }).database();
/** คนนอกที่สมัครบัญชีรหัสผ่านเองด้วยอีเมลทั่วไป */
const stranger = (uid) => env.authenticatedContext(uid, { email: uid + '@gmail.com', firebase: { sign_in_provider: 'password' } }).database();
const anonDb = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).database();
const admin = () => env.authenticatedContext('adm', { email: 'boss@test.com', firebase: { sign_in_provider: 'password' } }).database();
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
    const st = (n, un, o = {}) => set(ref(db, A('staff/' + n)), { nickname: o.nick, username: un, branchId: 'b1', shiftStart: '08:00', active: o.active !== false, ...o.f });
    await st('s1', 'nong_a', { nick: 'เอ', f: { uid: 'u1', deviceId: DID.s1 } });
    await st('s2', 'nong_b', { nick: 'บี', f: { uid: 'u2', deviceId: DID.s2 } });
    await st('s3', 'nong_c', { nick: 'ซี', active: false, f: { uid: 'u3', deviceId: DID.s3 } });
    await st('s4', 'nong_d', { nick: 'ดี' });
    await st('s5', 'nong_e', { nick: 'อี', f: { uid: 'u5' } });          // มีบัญชีแต่ยังไม่ผูกเครื่อง
    for (const [u, sid] of [['u1', 's1'], ['u2', 's2'], ['u3', 's3'], ['u5', 's5']]) await set(ref(db, A('accounts/' + u)), sid);
    for (const sid of ['s1', 's2', 's3']) await set(ref(db, A('deviceKeys/' + sid)), { k: KEYOF[sid], did: DID[sid], at: 1 });
  });
});

/** ประกอบ multi-path update แบบเดียวกับที่ clock.html ส่ง */
/** devproof ที่ clock.html ส่งมาด้วยทุกการเขียน (proof=false ไม่ส่ง, {k} = กุญแจที่กำหนด) */
const proofOf = (sid, proof = true) => (proof === false ? {} : { [A(`devproof/${sid}/${(proof && proof.k) || KEYOF[sid] || 'z'.repeat(43)}`)]: serverTimestamp() });
const corrCreate = (db, cid, body, { proof = true } = {}) => update(ref(db), { [A(`corrections/${cid}`)]: body, ...proofOf(body.staffId, proof) });
const corrDelete = (db, cid, sid, { proof = true } = {}) => update(ref(db), { [A(`corrections/${cid}`)]: null, ...proofOf(sid, proof) });
const regReq = (over = {}, infoOver = {}) => ({ info: { kind: 'register', did: DID9, status: 'pending', requestedAt: serverTimestamp(), username: 'newbie', nickname: 'ใหม่', userAgent: 'UA', standalone: true, ...infoOver }, key: KEY9, ...over });
/** อนุมัติคำขอสมัคร: staff + accounts + deviceKeys + ลบคำขอ ใน update เดียว */
function approveReg(o = {}) {
  const sid = o.sid || 's9', uid = o.uid || 'u9';
  const staff = { nickname: 'ใหม่', username: 'newbie', branchId: 'b1', shiftStart: '07:00', shiftEnd: '18:00', active: true, uid, deviceId: DID9, deviceAt: serverTimestamp(), createdAt: serverTimestamp(), ...(o.staff || {}) };
  for (const k of Object.keys(staff)) if (staff[k] === undefined) delete staff[k];
  return {
    [A(`staff/${sid}`)]: staff, [A(`accounts/${uid}`)]: o.accountsSid || sid,
    [A(`deviceKeys/${sid}`)]: { k: KEY9, did: DID9, at: serverTimestamp(), ...(o.keys || {}) }, [A(`deviceRequests/${uid}`)]: null,
  };
}
function build(db, { sid, uid, type, d = TODAY, prev = null, extraLog = {}, stateOverride = {}, logOverride = {}, proof = true }) {
  const lid = push(ref(db, A(`logs/${d}/${sid}`))).key;
  const log = { type, ts: serverTimestamp(), lat: 13.7, lng: 100.5, accuracy: 20, distance: 10, branchId: 'b1', uid, source: 'app', clientTs: Date.now(), ...extraLog, ...logOverride };
  const NEXT = { in: 'working', break_start: 'on_break', break_end: 'working', out: 'done' };
  const st = {
    status: NEXT[type], workDate: d, since: serverTimestamp(),
    inAt: type === 'in' ? serverTimestamp() : prev?.inAt,
    lastLogId: lid, lastLat: 13.7, lastLng: 100.5, lastBranchId: 'b1', ...stateOverride,
  };
  return { lid, updates: { [A(`logs/${d}/${sid}/${lid}`)]: log, [A(`state/${sid}`)]: st, ...proofOf(sid, proof) } };
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

  test('R2 สมาชิก (มีบัญชี) อ่าน branches, settings และ staff ของตัวเองได้; staff ทั้งก้อนอ่านไม่ได้', async () => {
    const db = staffDb('u1');
    await assertSucceeds(get(ref(db, A('branches'))));
    await assertSucceeds(get(ref(db, A('settings'))));
    await assertSucceeds(get(ref(db, A('staff/s1'))));
    await assertFails(get(ref(db, A('staff'))));
    await assertFails(get(ref(db, A('staff/s2'))));
  });

  test('R3 ผู้ไม่ใช่แอดมิน: อ่าน admins, deviceRequests, state, logs, audit, days, accounts, deviceKeys, devproof ไม่ได้', async () => {
    await setState('s1', WORKING());
    for (const db of [staffDb('u9'), anonDb('u9'), stranger('x1')]) {
      await assertFails(get(ref(db, A('admins'))));
      await assertFails(get(ref(db, A('deviceRequests'))));
      await assertFails(get(ref(db, A('state'))));
      await assertFails(get(ref(db, A('state/s1'))));
      await assertFails(get(ref(db, A(`logs/${TODAY}`))));
      await assertFails(get(ref(db, A(`logs/${TODAY}/s1`))));
      await assertFails(get(ref(db, A('audit'))));
      await assertFails(get(ref(db, A('days'))));
      await assertFails(get(ref(db, A('accounts'))));
      await assertFails(get(ref(db, A('deviceKeys'))));
      await assertFails(get(ref(db, A('devproof'))));
    }
    await assertFails(get(ref(guest(), A('branches'))));
    // เจ้าของเครื่องอ่าน state ของตัวเองได้ แต่ไม่ใช่ของคนอื่น
    await assertSucceeds(get(ref(staffDb('u1'), A('state/s1'))));
    await assertFails(get(ref(staffDb('u2'), A('state/s1'))));
    // admins/{uid} อ่านได้เฉพาะของตัวเอง
    await assertSucceeds(get(ref(staffDb('u9'), A('admins/u9'))));
    await assertFails(get(ref(staffDb('u9'), A('admins/adm'))));
  });

  test('R4 เขียน log+state ไม่ได้: ไม่มีกุญแจเครื่อง (s5), ไม่มี uid (s4), uid ไม่ตรง, guest, anonymous', async () => {
    await assertFails(send(staffDb('u9'), { sid: 's1', uid: 'u9', type: 'in' }));         // uid ไม่ตรง
    await assertFails(send(staffDb('u9'), { sid: 's4', uid: 'u9', type: 'in' }));         // staff ยังไม่มีเจ้าของ
    await assertFails(send(staffDb('u5'), { sid: 's5', uid: 'u5', type: 'in' }));         // ผูกบัญชีแล้วแต่ยังไม่มี deviceKeys
    await assertFails(send(guest(), { sid: 's1', uid: 'x', type: 'in' }));
    await assertFails(send(anonDb('uanon'), { sid: 's1', uid: 'uanon', type: 'in' }));            // anonymous ไม่มีสิทธิ์พนักงานแล้ว
  });

  test('R5 พนักงานที่อนุมัติแล้ว: in ที่ถูกต้องผ่าน (และ in ครั้งแรกที่มี flag)', async () => {
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    const snap = await seedGet('state/s1');
    if (snap.status !== 'working') throw new Error('state ไม่เป็น working');
    await seed((db) => remove(ref(db, A('state/s1'))));
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', extraLog: { flag: 'borderline', flagReason: 'x' } }));
  });

  test('R6 log โดยไม่มี state / state โดยไม่มี log ต้องถูกปฏิเสธ', async () => {
    const db = staffDb('u1');
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
    const db = staffDb('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { ts: Date.now() - 7200000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { ts: Date.now() - 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { since: Date.now() - 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { inAt: Date.now() - 1000000 } }));
  });

  test('R8 เขียนทับ/ลบ log เดิม, ลบ state ไม่ได้', async () => {
    const db = staffDb('u1');
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
    await assertFails(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
    await setState('s1', WORKING({ since: Date.now() - 40000 }));
    const prev2 = await seedGet('state/s1');
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev: prev2 }));
  });

  test('R10 ลำดับสถานะผิดถูกปฏิเสธ', async () => {
    const db = staffDb('u1');
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
    const db = staffDb('u1');
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
    await assertSucceeds(send(staffDb('u2'), { sid: 's2', uid: 'u2', type: 'break_start', d: YESTERDAY, prev }));
  });

  test('R12 พนักงาน A เขียน log/state ของ B ไม่ได้', async () => {
    await assertFails(send(staffDb('u1'), { sid: 's2', uid: 'u1', type: 'in' }));
    await assertFails(send(staffDb('u1'), { sid: 's2', uid: 'u2', type: 'in' }));
    await assertFails(send(staffDb('u1'), { sid: 's1', uid: 'u2', type: 'in' })); // uid ใน log ไม่ตรง auth
  });

  test('R13 active=false: in ไม่ได้', async () => {
    await assertFails(send(staffDb('u3'), { sid: 's3', uid: 'u3', type: 'in' }));
    // ปิดบัญชีกลางกะ ก็เขียนต่อไม่ได้
    await setState('s1', WORKING());
    const prev = await seedGet('state/s1');
    await seed((db) => update(ref(db, A('staff/s1')), { active: false }));
    await assertFails(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
  });

  test('R14 source:admin, review, ฟิลด์แปลกปลอม ถูกปฏิเสธ', async () => {
    const db = staffDb('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { source: 'admin' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { review: 'approved' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { hacker: 1 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: { flag: 'trusted' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { type: 'hack' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { branchId: 'nope' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { extra: 1 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', d: '2026-13-45' }));
  });

  test('R15 [เลิกใช้ แทนด้วย R62-R65] deviceRequests แบบ PIN ถูกถอดออก: คำขอรูปแบบเดิมต้องถูกปฏิเสธ', async () => {
    const db = staffDb('u9');
    await assertFails(set(ref(db, A('deviceRequests/u9')), { staffId: 's4', pinHash: HASH_A, requestedAt: serverTimestamp(), status: 'pending', userAgent: 'UA' }));
  });

  test('R16 ผู้ใช้เขียน staff/{sid}/uid, accounts, deviceKeys ของตัวเองไม่ได้', async () => {
    for (const db of [staffDb('u9'), stranger('x1')]) {
      await assertFails(set(ref(db, A('staff/s4/uid')), 'u9'));
      await assertFails(update(ref(db, A('staff/s4')), { uid: 'u9' }));
      await assertFails(set(ref(db, A('accounts/u9')), 's4'));
      await assertFails(set(ref(db, A('deviceKeys/s4')), { k: 'k'.repeat(43), did: 'did_x_00000000000000', at: serverTimestamp() }));
    }
    await assertFails(set(ref(staffDb('u1'), A('staff/s1/active')), false));
  });

  test('R17 แอดมิน (password + อีเมลปกติ): อ่าน/เขียนได้ อนุมัติคำขอสมัคร (update เดียว) แล้วพนักงานลงเวลาได้ และยกเลิกผูกเครื่อง', async () => {
    const db = admin();
    await assertSucceeds(get(ref(db, A('deviceRequests'))));
    await assertSucceeds(get(ref(db, A('state'))));
    await assertSucceeds(get(ref(db, A('logs'))));
    await assertSucceeds(get(ref(db, A('admins'))));
    await assertSucceeds(get(ref(db, A('accounts'))));
    await assertFails(get(ref(db, A('deviceKeys'))));          // แม้แต่แอดมินก็อ่านกุญแจไม่ได้
    await assertSucceeds(set(ref(db, A('branches/b2')), { name: 'สาขา 2', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60, active: true }));
    await assertSucceeds(set(ref(db, A('settings/lateGraceMin')), 5));
    await assertSucceeds(update(ref(db, A('branches/b1')), { radius: 120, lat: 13.71, lng: 100.51 }));
    await assertFails(set(ref(db, A('branches/b3')), { name: 'x', radius: 5000, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertSucceeds(set(ref(db, A('branches/b4')), { name: 'x', radius: 10, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(set(ref(db, A('branches/b5')), { name: 'x', radius: 5, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(set(ref(db, A('branches/BAD ID')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    // อนุมัติคำขอสมัคร (staff + accounts + deviceKeys + ลบคำขอ)
    await set(ref(staffDb('u9'), A('deviceRequests/u9')), regReq());
    await assertSucceeds(update(ref(db), approveReg({ sid: 's9' })));
    await assertSucceeds(send(staffDb('u9'), { sid: 's9', uid: 'u9', type: 'in', proof: { k: KEY9 } }));
    // ยกเลิกผูกเครื่อง
    await assertSucceeds(update(ref(db), { [A('deviceKeys/s9')]: null, [A('staff/s9/deviceId')]: null, [A('staff/s9/deviceAt')]: null }));
    // เฟส 2: แอดมินเขียน state ได้เฉพาะพร้อม audit + prevLogId ('-' เมื่อยังไม่มี state)
    await assertFails(set(ref(db, A('state/s2')), { status: 'working', workDate: TODAY, since: 1, inAt: 1 }));
    await assertSucceeds(update(ref(db), withAudit(db, [{ path: 'state/s2', node: { status: 'working', workDate: TODAY, since: 1, inAt: 1, prevLogId: '-' }, op: 'set_state' }], { email: false })));
  });

  test('R18 uid ที่อยู่ใน admins แต่ล็อกอิน anonymous: อ่าน logs/เขียน staff/branches ไม่ได้', async () => {
    const db = anonAsAdminUid();
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', username: 'xxx', branchId: 'b1', shiftStart: '08:00', active: true }));
    await assertFails(set(ref(db, A('branches/b2')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(get(ref(db, A('logs'))));
    await assertFails(get(ref(db, A('deviceRequests'))));
  });

  test('R19 วันที่ confirmed แล้ว พนักงาน in ไม่ได้', async () => {
    await seed((db) => set(ref(db, A(`days/${TODAY}/s1`)), { confirmed: true, confirmedBy: 'adm', confirmedAt: 1 }));
    await assertFails(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    await seed((db) => set(ref(db, A(`days/${TODAY}/s1/confirmed`)), false));
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
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
    await assertFails(set(ref(staffDb('u1'), A('audit/a4')), entry()));
  });

  test('R22 distance ที่ client อ้างต้องไม่เกิน radius x graceFactor ของสาขา (ในเทส = 80 x 1.5 = 120)', async () => {
    const db = staffDb('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 121 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 5000 } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { accuracy: -1 } }));
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in', logOverride: { distance: 120 } }));
  });

  test('R23 [ข้อจำกัดที่ทราบ] $d ย้อนหลัง/ล่วงหน้า สำหรับ in: rules แปลง now เป็นวันที่ไม่ได้ จึงผ่าน (บรรเทาด้วยป้ายเตือนใน master)', async () => {
    // เอกสารพฤติกรรมเมื่อ settings/calendarEnforced ปิดอยู่ (ค่าเริ่มต้น) เมื่อเปิดแล้วถูกปฏิเสธ ดู R45
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2020-01-01' }));
    await seed((db) => remove(ref(db, A('state/s1'))));
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2099-12-31' }));
  });

  test('R24 in หลัง done ด้วย $d คนละวัน ผ่าน (กะใหม่) แต่ $d เดียวกันไม่ผ่าน', async () => {
    await setState('s1', WORKING({ status: 'done', workDate: '2026-01-05' }));
    const prev = await seedGet('state/s1');
    await assertFails(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2026-01-05', prev }));
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', d: '2026-01-06', prev }));
  });

  test('R25 type ไม่ตรงกับ state.status ถูกปฏิเสธ (ทุกคู่ที่ผิด)', async () => {
    const db = staffDb('u1');
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
    const db = staffDb('u1');
    await assertFails(update(ref(db, A('state/s1')), { status: 'done' }));
    await assertFails(update(ref(db, A('state/s1')), { since: serverTimestamp() }));
    await assertFails(set(ref(db, A('state/s1/status')), 'off'));
    await assertFails(set(ref(db, A('state/s1/inAt')), 1));
  });

  test('R27 พนักงานเขียน settings, days, branches, admins, staff ไม่ได้', async () => {
    const db = staffDb('u1');
    await assertFails(set(ref(db, A('settings/lateGraceMin')), 5));
    await assertFails(set(ref(db, A('days/' + TODAY + '/s1')), { confirmed: true }));
    await assertFails(set(ref(db, A('branches/b1/radius')), 300));
    await assertFails(set(ref(db, A('admins/u1')), true));
    await assertFails(set(ref(db, A('staffSecret/s1')), { pinHash: HASH_A }));
  });

  test('R28 corrections: สร้างของตัวเองได้ pending เท่านั้น อ่านของตัวเองผ่าน query ได้', async () => {
    const db = staffDb('u1');
    const body = (over = {}) => ({ staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(corrCreate(db, 'c1', body()));
    await assertFails(corrCreate(db, 'c1', body({ reason: 'แก้' })));          // create-only
    // เฟส 2: เจ้าของลบคำขอ pending ของตัวเองได้ (ดู R41) แต่คนอื่นลบไม่ได้
    await assertFails(remove(ref(staffDb('u2'), A('corrections/c1'))));
    await assertFails(corrCreate(db, 'c2', body({ status: 'approved' })));
    await assertFails(corrCreate(db, 'c3', body({ staffId: 's2' }), { proof: { k: KEYOF.s2 } }));        // ของคนอื่น
    await assertFails(corrCreate(db, 'bad id', body()));
    await assertFails(corrCreate(db, 'c4', body({ createdAt: 123 })));
    await assertFails(update(ref(db, A('corrections/c1')), { status: 'approved' }));
    const mine = await assertSucceeds(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    if (Object.keys(mine.val() || {}).length !== 1) throw new Error('ควรอ่านของตัวเองได้ 1 รายการ');
    await assertFails(get(query(ref(db, A('corrections')), orderByChild('staffId'), equalTo('s2'))));
    await assertFails(get(ref(db, A('corrections'))));
    await assertSucceeds(update(ref(admin(), A('corrections/c1')), { status: 'approved', decidedBy: 'adm', decidedAt: serverTimestamp() }));
  });

  test('R21 แอดมินสร้าง staff ที่มี pinHash/deviceApproved ไม่ได้ และ staff ต้องมี username/branch/shiftStart ที่ถูกต้อง', async () => {
    const db = admin();
    const ok = { nickname: 'x', username: 'xxx', branchId: 'b1', shiftStart: '08:00', active: true };
    await assertFails(set(ref(db, A('staff/s9')), { ...ok, pinHash: HASH_A }));
    await assertFails(update(ref(db, A('staff/s1')), { pinHash: HASH_A }));
    await assertFails(update(ref(db, A('staff/s1')), { deviceApproved: true }));
    await assertFails(set(ref(db, A('staff/s9')), { ...ok, branchId: 'nope' }));
    await assertFails(set(ref(db, A('staff/s9')), { ...ok, shiftStart: '25:00' }));
    await assertFails(set(ref(db, A('staff/s9')), { nickname: 'x', branchId: 'b1', shiftStart: '08:00', active: true }));   // ไม่มี username
    await assertSucceeds(set(ref(db, A('staff/s9')), ok));
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
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
    // (ข) s2 ยังไม่มี state
    const tb = Date.now() - 7200000;
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s2/B1`, node: { type: 'in', ts: tb, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s2', node: { status: 'working', workDate: TODAY, since: tb, inAt: tb, lastLogId: 'B1', prevLogId: '-' }, op: 'set_state' },
    ])));
    const prev = await seedGet('state/s2');
    await assertSucceeds(send(staffDb('u2'), { sid: 's2', uid: 'u2', type: 'break_start', prev }));
    // (ค) s1 กำลังทำงานวันนี้ (จาก (ก)) แอดมิน void ทุกรายการ ตั้ง state off
    const s1 = (await get(ref(db, A('state/s1')))).val();
    const logs = (await get(ref(db, A(`logs/${TODAY}/s1`)))).val();
    const [lid0, l0] = Object.entries(logs)[0];
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s1/${lid0}`, node: { ...l0, voided: true }, before: { ts: l0.ts }, op: 'void_log' },
      { path: 'state/s1', node: { status: 'off', workDate: TODAY, since: Date.now() - 60000, prevLogId: s1.lastLogId }, op: 'rebuild_state' },
    ])));
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R40 พนักงานใส่ฟิลด์ของแอดมิน (auditId/prevLogId/editedBy/voided/origTs/note/correctionId/movedFrom) ไม่ได้', async () => {
    const db = staffDb('u1');
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { auditId: 'a1' } }));
    await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', stateOverride: { prevLogId: '-' } }));
    for (const f of [{ auditId: 'a1' }, { editedBy: 'u1' }, { editedAt: serverTimestamp() }, { voided: true }, { origTs: 1 }, { note: 'x' }, { correctionId: 'c1' }, { movedFrom: 'logs/x' }]) {
      await assertFails(send(db, { sid: 's1', uid: 'u1', type: 'in', extraLog: f }));
    }
    await assertSucceeds(send(db, { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R41 corrections ของพนักงาน: break+endTime, nextDay, ลบคำขอ pending ของตัวเอง, ฟิลด์ของแอดมินใส่เองไม่ได้', async () => {
    const db = staffDb('u1');
    const body = (over = {}) => ({ staffId: 's1', workDate: TODAY, type: 'out', time: '17:30', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(corrCreate(db, 'c1', body({ type: 'break', time: '12:00', endTime: '13:00' })));
    await assertFails(corrCreate(db, 'c2', body({ type: 'break', time: '12:00' })));                      // break ไม่มี endTime
    await assertFails(corrCreate(db, 'c2', body({ endTime: '25:00' })));
    await assertSucceeds(corrCreate(db, 'c3', body({ time: '02:00', nextDay: true })));
    await assertFails(corrCreate(db, 'c4', body({ nextDay: 'yes' })));
    await assertSucceeds(corrDelete(db, 'c1', 's1'));                                                          // ลบ pending ของตัวเอง
    await seed(async (adb) => {
      await set(ref(adb, A('corrections/cd')), body({ status: 'approved', createdAt: 1, decidedBy: 'adm', decidedAt: 2 }));
      await set(ref(adb, A('corrections/co')), body({ staffId: 's2', createdAt: 1 }));
    });
    await assertFails(corrDelete(db, 'cd', 's1', { proof: { k: KEYOF.s1 } }));                                                             // ตัดสินแล้ว
    await assertFails(corrDelete(db, 'co', 's2', { proof: { k: KEYOF.s1 } }));                                                             // ของคนอื่น
    await assertFails(corrCreate(db, 'c5', body({ resultNote: 'อนุมัติ' })));
    await assertFails(corrCreate(db, 'c6', body({ appliedTs: 1 })));
    await assertFails(corrCreate(db, 'c7', body({ decidedBy: 'u1' })));
    await assertFails(corrCreate(db, 'c8', body({ appliedLogId: 'L1' })));
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
    await assertFails(get(ref(staffDb('u1'), A('audit'))));
  });

  test('R45 calendar + calendarEnforced: เขียนเฉพาะค่าเที่ยงคืนโดยแอดมิน, เมื่อเปิดบังคับ in ต้องตรงวันจริง', async () => {
    const db = adminEmail();
    await assertSucceeds(set(ref(db, A(`calendar/${TODAY}`)), midnightTH(TODAY)));
    await assertFails(set(ref(db, A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY) + 3600000));
    await assertFails(set(ref(staffDb('u1'), A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY)));
    await assertFails(set(ref(db, A('calendar/not-a-date')), midnightTH(TODAY)));
    await assertSucceeds(set(ref(db, A(`calendar/${YESTERDAY}`)), midnightTH(YESTERDAY)));
    await assertSucceeds(set(ref(db, A('settings/calendarEnforced')), true));
    const u1 = staffDb('u1');
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));                           // $d = วันนี้
    await seed((adb) => remove(ref(adb, A('state/s1'))));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', d: '2020-01-01' }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', d: '2099-12-31' }));            // ไม่มีในปฏิทิน
    // กะเมื่อวานที่ค้างอยู่ break_start ไม่ถูกบังคับ
    await setState('s2', WORKING({ workDate: YESTERDAY }));
    const prev = await seedGet('state/s2');
    await assertSucceeds(send(staffDb('u2'), { sid: 's2', uid: 'u2', type: 'break_start', d: YESTERDAY, prev }));
  });

  test('R46 settings ใหม่: reviewDays 7..92, correctionDays 1..62, calendarEnforced boolean, แอดมินเท่านั้น', async () => {
    const db = adminEmail();
    await assertSucceeds(set(ref(db, A('settings/reviewDays')), 31));
    await assertFails(set(ref(db, A('settings/reviewDays')), 1000));
    await assertSucceeds(set(ref(db, A('settings/correctionDays')), 7));
    await assertFails(set(ref(db, A('settings/correctionDays')), 0));
    await assertSucceeds(set(ref(db, A('settings/calendarEnforced')), true));
    await assertFails(set(ref(db, A('settings/calendarEnforced')), 'yes'));
    await assertFails(set(ref(staffDb('u1'), A('settings/calendarEnforced')), true));
    await assertSucceeds(get(ref(staffDb('u1'), A('settings'))));
  });

  test('R47 พนักงานกดครบวงหลังแอดมินเคยเขียน state (auditId/prevLogId ค้างอยู่) ผ่านทุกขั้น', async () => {
    const db = adminEmail();
    const tb = Date.now() - 7200000;
    await assertSucceeds(update(ref(db), withAudit(db, [
      { path: `logs/${TODAY}/s1/B1`, node: { type: 'in', ts: tb, branchId: 'b1', source: 'admin' }, op: 'add_log' },
      { path: 'state/s1', node: { status: 'working', workDate: TODAY, since: tb, inAt: tb, lastLogId: 'B1', prevLogId: '-' }, op: 'set_state' },
    ])));
    const u = staffDb('u1');
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
    await assertSucceeds(get(ref(staffDb('u1'), A('state/s1'))));
    await assertSucceeds(get(ref(staffDb('u1'), A(`logs/${TODAY}/s1`))));
    await assertSucceeds(get(query(ref(staffDb('u1'), A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    await assertFails(get(ref(staffDb('u2'), A('state/s1'))));
    await assertSucceeds(get(ref(adminEmail(), A('logs'))));
    const prev = await seedGet('state/s1');
    await assertSucceeds(send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'break_start', prev }));
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
      const p = send(staffDb('u1'), { sid: 's1', uid: 'u1', type: 'in', d: D2 });
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

  test('R53 correction จากบัญชีที่ไม่มีกุญแจ/ปิดบัญชี/ไม่มีเจ้าของ/ไม่ส่ง proof ปฏิเสธ', async () => {
    const body = (sid) => ({ staffId: sid, workDate: TODAY, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp() });
    await assertFails(corrCreate(staffDb('u5'), 'c5', body('s5')));                // ไม่มี deviceKeys
    await assertFails(corrCreate(staffDb('u3'), 'c3', body('s3')));                // ปิดบัญชี
    await assertFails(corrCreate(staffDb('u9'), 'c4', body('s4'), { proof: { k: 'z'.repeat(43) } }));   // staff ยังไม่มีเจ้าของ
    await assertFails(corrCreate(staffDb('u1'), 'c0', body('s1'), { proof: false }));  // ไม่ส่ง proof
    await assertSucceeds(corrCreate(staffDb('u1'), 'c1', body('s1')));
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
    const db = staffDb('u1');
    const body = (d, over = {}) => ({ staffId: 's1', workDate: d, type: 'in', time: '08:00', reason: 'ลืมกด', status: 'pending', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(corrCreate(db, 'w0', body(TODAY)));
    await assertSucceeds(corrCreate(db, 'w1', body(addDaysTH(TODAY, -1))));
    await assertSucceeds(corrCreate(db, 'w7', body(addDaysTH(TODAY, -7))));          // ครบ 7 วัน
    await assertFails(corrCreate(db, 'w9', body(addDaysTH(TODAY, -9))));             // เกินช่วง
    await assertFails(corrCreate(db, 'wf', body(addDaysTH(TODAY, 2))));              // อนาคต
    await assertFails(corrCreate(db, 'wa', body('2020-01-01')));                     // ไม่มีในปฏิทิน
    await assertFails(corrCreate(db, 'wb', body('2099-12-31')));
    // correctionDays = 3 -> ย้อนได้ ~3 วัน
    await seed((adb) => set(ref(adb, A('settings/correctionDays')), 3));
    await assertFails(corrCreate(db, 'w7b', body(addDaysTH(TODAY, -7))));
    await assertSucceeds(corrCreate(db, 'w1b', body(addDaysTH(TODAY, -1))));
    // ยังไม่เคยสร้างปฏิทิน (ไม่มี calendarLast): ไม่บังคับช่วง (ข้อจำกัดที่ทราบ) แต่ยังตรวจรูปแบบวัน
    await seed((adb) => remove(ref(adb, A('settings/calendarLast'))));
    await assertSucceeds(corrCreate(db, 'wn', body('2020-01-01')));
    await assertFails(corrCreate(db, 'wm', body('2020-13-45')));
  });

  // ================= เฟส 3 (R56-R60) =================
  test('R56 พนักงานอ่าน logs ได้เฉพาะ logs/{วัน}/{ตัวเอง}: วันว่างได้ null, ของคนอื่น/ทั้งวัน/query ช่วง ปฏิเสธ', async () => {
    await seedLog('s2', TODAY, 'X1', APPLOG({ uid: 'u2' }));
    const db = staffDb('u1');
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
    await assertFails(get(ref(staffDb('u1'), A(`days/${TODAY}/s1`))));
    await assertFails(get(ref(staffDb('u1'), A(`days/${TODAY}`))));
    const db = adminEmail();
    const l = await assertSucceeds(get(query(ref(db, A('logs')), orderByKey(), startAt(YESTERDAY), endAt(TODAY))));
    const dd = await assertSucceeds(get(query(ref(db, A('days')), orderByKey(), startAt(YESTERDAY), endAt(TODAY))));
    if (!l.val()[TODAY] || !dd.val()[TODAY]) throw new Error('ควรได้ข้อมูลของวันนี้');
  });

  test('R58 staff.shiftEnd: แอดมินตั้งได้ HH:MM เท่านั้น (ค่าผิดรูปแบบ/ชนิดผิดปฏิเสธ) และเป็น optional', async () => {
    const db = adminEmail();
    const base = { nickname: 'ใหม่', username: 'newbie', branchId: 'b1', shiftStart: '07:00', active: true };
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
    await assertFails(set(ref(staffDb('u1'), A('staff/s1/shiftEnd')), '10:00'));
    await assertFails(update(ref(staffDb('u1'), A('staff/s1')), { shiftEnd: '10:00' }));
    await assertFails(set(ref(anonAsAdminUid(), A('staff/s1/shiftEnd')), '10:00'));
    await assertFails(set(ref(guest(), A('staff/s1/shiftEnd')), '10:00'));
    await assertSucceeds(get(ref(staffDb('u1'), A('staff/s1'))));     // อ่านของตัวเองได้ (แอปใช้ shiftStart/shiftEnd)
    await assertFails(get(ref(stranger('x1'), A('staff/s1'))));       // คนนอกอ่านไม่ได้
  });

  test('R60 ฟิลด์แปลกใน staff ยังถูกปฏิเสธ (เพิ่ม shiftEnd ไม่เปิด $other)', async () => {
    const db = adminEmail();
    await assertFails(update(ref(db, A('staff/s1')), { shiftEnds: '18:00' }));
    await assertFails(update(ref(db, A('staff/s1')), { shiftEnd: '18:00', extra: 1 }));
    await assertSucceeds(update(ref(db, A('staff/s1')), { shiftEnd: '18:00', shiftStart: '07:00' }));
  });

  // ================= Auth v2 (R61-R76) docs/plan-auth-v2.md ข้อ 10.3 =================
  test('R61 ADMIN macro: แอดมิน password + อีเมลปกติผ่าน; uid ใน admins แต่ใช้อีเมลโดเมนพนักงาน / anonymous / provider อื่น ไม่ผ่าน', async () => {
    await assertSucceeds(get(ref(adminEmail(), A('logs'))));
    await assertSucceeds(get(ref(adminEmail(), A('staff'))));
    const staffMail = env.authenticatedContext('adm', { email: 'nong_a' + DOM, firebase: { sign_in_provider: 'password' } }).database();
    await assertFails(get(ref(staffMail, A('logs'))));
    await assertFails(get(ref(staffMail, A('staff'))));
    await assertFails(get(ref(staffMail, A('deviceRequests'))));
    await assertFails(set(ref(staffMail, A('branches/b9')), { name: 'x', radius: 80, maxAccuracy: 60, graceFactor: 1.5, breakLimitMin: 60 }));
    await assertFails(get(ref(anonAsAdminUid(), A('logs'))));
    const google = env.authenticatedContext('adm', { email: 'boss@gmail.com', firebase: { sign_in_provider: 'google.com' } }).database();
    await assertFails(get(ref(google, A('logs'))));
    await assertFails(set(ref(staffMail, A('admins/u9')), true));        // ยกระดับตัวเองไม่ได้
  });

  test('R62 สร้างคำขอสมัคร (register): ถูกต้องผ่าน; username/ชื่อเล่น/key/did/status/requestedAt/ฟิลด์แปลก/uid อื่น/คนนอก ปฏิเสธ', async () => {
    const db = staffDb('u9');
    const put = (req, d = db, uid = 'u9') => set(ref(d, A('deviceRequests/' + uid)), req);
    const omit = (o, ...ks) => { const r = JSON.parse(JSON.stringify(o)); for (const k of ks) delete r[k]; return r; };
    const noNick = regReq(); delete noNick.info.nickname;
    const bads = [
      regReq({}, { username: 'someone' }), regReq({}, { username: 'Newbie' }), regReq({}, { username: 'ab' }), regReq({}, { username: 'new.bie' }),
      regReq({}, { nickname: 'ก'.repeat(21) }), noNick, regReq({ key: 'short' }), omit(regReq(), 'key'), regReq({}, { did: 'short' }),
      regReq({}, { status: 'rejected' }), regReq({}, { status: 'approved' }), regReq({}, { requestedAt: 123 }),
      regReq({}, { hacker: 1 }), regReq({ hacker: 1 }), regReq({}, { kind: 'admin' }), regReq({}, { relink: 'yes' }),
    ];
    for (const b of bads) await assertFails(put(b));
    await assertFails(put(regReq(), db, 'other'));                         // path ของ uid อื่น
    await assertFails(put(regReq({}, { username: 'gmailer' }), stranger('gm1'), 'gm1'));          // อีเมลไม่ใช่โดเมนพนักงาน
    await assertFails(put(regReq(), guest()));
    await assertFails(put(regReq(), anonDb('u9')));
    await assertSucceeds(put(regReq({}, { relink: true, oldUsername: 'nong_a' })));
    const got = (await get(ref(db, A('deviceRequests/u9/info')))).val();
    if (got.username !== 'newbie' || typeof got.requestedAt !== 'number') throw new Error('คำขอไม่ถูกเก็บ');
  });

  test('R63 อ่านคำขอ: ตัวเองอ่าน info ได้ แต่ทั้งก้อนและ key ไม่ได้; uid อื่นอ่าน info ไม่ได้; แอดมินอ่านทั้งหมด', async () => {
    const me = staffDb('u9');
    await set(ref(me, A('deviceRequests/u9')), regReq());
    await assertSucceeds(get(ref(me, A('deviceRequests/u9/info'))));
    await assertFails(get(ref(me, A('deviceRequests/u9'))));
    await assertFails(get(ref(me, A('deviceRequests/u9/key'))));
    await assertFails(get(ref(staffDb('u1'), A('deviceRequests/u9/info'))));
    await assertFails(get(ref(me, A('deviceRequests'))));
    const all = await assertSucceeds(get(ref(adminEmail(), A('deviceRequests'))));
    if (all.val().u9.key !== KEY9) throw new Error('แอดมินต้องเห็น key เพื่ออนุมัติ');
  });

  test('R64 1 คำขอต่อ uid: ทับ pending/แก้ status เองไม่ได้ ลบของตัวเองได้ สร้างใหม่ได้ แอดมินตั้ง rejected แล้วสร้างทับได้', async () => {
    const me = staffDb('u9'), adm = adminEmail();
    const path = A('deviceRequests/u9');
    await assertSucceeds(set(ref(me, path), regReq()));
    await assertFails(set(ref(me, path), regReq({}, { nickname: 'ใหม่2' })));
    await assertFails(update(ref(me, A('deviceRequests/u9/info')), { status: 'approved' }));
    await assertFails(update(ref(me, A('deviceRequests/u9/info')), { status: 'rejected' }));
    await assertSucceeds(remove(ref(me, path)));
    await assertSucceeds(set(ref(me, path), regReq()));
    await assertSucceeds(update(ref(adm, A('deviceRequests/u9/info')), { status: 'rejected' }));
    await assertSucceeds(set(ref(me, path), regReq()));                    // ทับหลัง rejected
    await assertSucceeds(remove(ref(adm, path)));
    await assertSucceeds(set(ref(me, path), regReq()));
  });

  test('R65 register/device: register เมื่อมีบัญชีแล้วไม่ได้; device ของบัญชีที่เปิดอยู่ผ่าน; ปิดบัญชี/ยังไม่มีบัญชี ปฏิเสธ; ปิดรับสมัครกัน register แต่ไม่กัน device', async () => {
    const devReq = (did = 'did_dev_0000000000000') => ({ info: { kind: 'device', did, status: 'pending', requestedAt: serverTimestamp(), userAgent: 'UA', standalone: false }, key: 'q'.repeat(43) });
    await assertFails(set(ref(staffDb('u1'), A('deviceRequests/u1')), regReq({}, { username: 'nong_a' })));
    await assertSucceeds(set(ref(staffDb('u1'), A('deviceRequests/u1')), devReq()));
    await assertFails(set(ref(staffDb('u3'), A('deviceRequests/u3')), devReq()));                 // ปิดบัญชี
    await assertFails(set(ref(staffDb('u9'), A('deviceRequests/u9')), devReq()));                 // ยังไม่มีบัญชี
    await assertFails(set(ref(staffDb('u5'), A('deviceRequests/u5')), regReq({}, { username: 'nong_e' })));   // u5 มีบัญชีแล้ว
    await seed((adb) => set(ref(adb, A('settings/registrationOpen')), false));
    await assertFails(set(ref(staffDb('u9'), A('deviceRequests/u9')), regReq()));
    await assertSucceeds(set(ref(staffDb('u2'), A('deviceRequests/u2')), devReq('did_dev_1111111111111')));
    await seed((adb) => set(ref(adb, A('settings/registrationOpen')), true));
    await assertSucceeds(set(ref(staffDb('u9'), A('deviceRequests/u9')), regReq()));
  });

  test('R66 แอดมินอนุมัติคำขอสมัคร (update เดียว): ครบผ่าน; ขาด accounts/ไม่สอดคล้อง/deviceId ไม่ตรง/ไม่มี username/ค่ากุญแจผิด ปฏิเสธ', async () => {
    const adm = adminEmail();
    await set(ref(staffDb('u9'), A('deviceRequests/u9')), regReq());
    const full = (o = {}) => approveReg(o);
    const without = (k) => { const u = approveReg({}); delete u[A(k)]; return u; };
    await assertFails(update(ref(adm), without('accounts/u9')));
    await assertFails(update(ref(adm), full({ accountsSid: 's8' })));                          // accounts ชี้ sid ที่ uid ไม่ตรง
    await assertFails(update(ref(adm), full({ staff: { uid: 'u8' } })));                        // staff.uid ไม่ตรง accounts
    await assertFails(update(ref(adm), full({ keys: { did: 'did_other_00000000000' } })));      // deviceKeys.did ≠ staff.deviceId
    await assertFails(update(ref(adm), without('deviceKeys/s9')));                              // deviceId โดยไม่มี deviceKeys
    await assertFails(update(ref(adm), full({ staff: { username: undefined } })));
    await assertFails(update(ref(adm), full({ staff: { username: 'Bad Name' } })));
    await assertFails(update(ref(adm), full({ keys: { at: 5 } })));
    await assertFails(update(ref(adm), full({ keys: { k: 'short' } })));
    await assertFails(update(ref(adm), full({ staff: { hacker: 1 } })));
    await assertSucceeds(update(ref(adm), full()));
    const u9 = staffDb('u9');
    await assertSucceeds(send(u9, { sid: 's9', uid: 'u9', type: 'in', proof: { k: KEY9 } }));
  });

  test('R67 ผู้สมัครอนุมัติตัวเองไม่ได้ และอ่าน accounts/deviceKeys/devproof ของคนอื่นไม่ได้ (แอดมินก็อ่านกุญแจไม่ได้)', async () => {
    const me = staffDb('u9');
    await set(ref(me, A('deviceRequests/u9')), regReq());
    await assertFails(set(ref(me, A('accounts/u9')), 's4'));
    await assertFails(set(ref(me, A('deviceKeys/s4')), { k: KEY9, did: DID9, at: serverTimestamp() }));
    await assertFails(set(ref(me, A('staff/s4')), { nickname: 'x', username: 'newbie', branchId: 'b1', shiftStart: '07:00', active: true, uid: 'u9' }));
    await assertFails(update(ref(me), approveReg({})));
    const u1 = staffDb('u1');
    await assertSucceeds(get(ref(u1, A('accounts/u1'))));
    await assertFails(get(ref(u1, A('accounts/u2'))));
    await assertFails(get(ref(u1, A('accounts'))));
    for (const p of ['deviceKeys/s1', 'devproof/s1', 'deviceKeys', 'devproof']) {
      await assertFails(get(ref(u1, A(p))));
      await assertFails(get(ref(adminEmail(), A(p))));
    }
  });

  test('R68 device proof: ต้องส่ง devproof ที่ k ถูกและ at === now มาใน request เดียวกัน; proof เก่า/ผิด sid/ไม่มี k ใช้ไม่ได้', async () => {
    const u1 = staffDb('u1'), u2 = staffDb('u2');
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', proof: false }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', proof: { k: 'x'.repeat(43) } }));
    // devproof เก่าค้างใน DB (k ถูก แต่ at ย้อนหลัง) แต่ไม่ส่ง proof ใหม่
    await seed((adb) => set(ref(adb, A('devproof/s1')), { [KEYOF.s1]: Date.now() - 60000 }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', proof: false }));
    // proof เก่าค้างใน DB ใช้กับคำขอแก้เวลา (สร้าง/ลบ) ไม่ได้
    await seed((adb) => set(ref(adb, A('corrections/cstale')), { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: 1 }));
    await assertFails(corrCreate(u1, 'cn', { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: serverTimestamp() }, { proof: false }));
    await assertFails(corrDelete(u1, 'cstale', 's1', { proof: false }));
    await assertSucceeds(corrDelete(u1, 'cstale', 's1'));
    // proof ของ sid อื่น
    const u = build(u1, { sid: 's1', uid: 'u1', type: 'in', proof: false }).updates;
    u[A(`devproof/s2/${KEYOF.s2}`)] = serverTimestamp();
    await assertFails(update(ref(u1), u));
    // เขียน devproof เดี่ยว (k ถูก) ผ่าน แต่ at/ฟิลด์แปลกไม่ผ่าน
    await assertSucceeds(set(ref(u1, A(`devproof/s1/${KEYOF.s1}`)), serverTimestamp()));
    await assertFails(set(ref(u1, A(`devproof/s1/${KEYOF.s1}`)), 123));
    await assertFails(set(ref(u1, A('devproof/s1/hacker')), serverTimestamp()));
    await assertFails(set(ref(u2, A(`devproof/s1/${KEYOF.s1}`)), serverTimestamp()));            // ไม่ใช่เจ้าของ
    // proof ต้องใหม่ทุกครั้ง: ผ่านแล้วใช้ซ้ำไม่ได้
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'break_start', prev: await seedGet('state/s1'), proof: false }));
    // deviceKeys หาย (null === null) -> proof ใช้ไม่ได้
    await seed(async (adb) => { await remove(ref(adb, A('deviceKeys/s2'))); });
    await assertFails(send(u2, { sid: 's2', uid: 'u2', type: 'in' }));
    await assertFails(set(ref(u2, A(`devproof/s2/${KEYOF.s2}`)), serverTimestamp()));
  });

  test('R77 devproof bypass: รู้แค่รหัสผ่าน (ไม่รู้กุญแจ) ใช้ proof เก่า/เดาเส้นทาง/รูปแบบ object เดิมไม่ได้; กุญแจที่หมุนแล้วใช้ซ้ำไม่ได้; แอดมินล้างได้', async () => {
    const u1 = staffDb('u1'), adm = adminEmail();
    // proof เก่าที่ถูกต้องค้างอยู่ (แบบใหม่ และแบบ object เดิม)
    await seed((adb) => set(ref(adb, A('devproof/s1')), { [KEYOF.s1]: Date.now() - 60000, k: KEYOF.s1, at: Date.now() - 60000 }));
    // (a) เขียนเฉพาะ at / ใบเดียวโดยไม่รู้ k
    await assertFails(set(ref(u1, A('devproof/s1/at')), serverTimestamp()));
    await assertFails(set(ref(u1, A('devproof/s1/k')), serverTimestamp()));
    const ua = build(u1, { sid: 's1', uid: 'u1', type: 'in', proof: false }).updates;
    ua[A('devproof/s1/at')] = serverTimestamp();
    await assertFails(update(ref(u1), ua));
    // (b) log+state พร้อมเส้นทางเดา/เก่า (กุญแจผิด 43 ตัว)
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in', proof: { k: 'g'.repeat(43) } }));
    // (c) รูปแบบ object เดิม {k, at}
    const u = build(u1, { sid: 's1', uid: 'u1', type: 'in', proof: false }).updates;
    u[A('devproof/s1')] = { k: KEYOF.s1, at: serverTimestamp() };
    await assertFails(update(ref(u1), u));
    // กุญแจถูก ผ่าน
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));
    // หมุนกุญแจ (อนุมัติเครื่องใหม่): leaf ของกุญแจเก่าใช้ไม่ได้ และเขียนใหม่ด้วยกุญแจเก่าไม่ได้
    const oldK = KEYOF.s1, newK = 'N'.repeat(43), newDid = 'did_rotated_00000000';
    await assertSucceeds(update(ref(adm), { [A('deviceKeys/s1')]: { k: newK, did: newDid, at: serverTimestamp() }, [A('staff/s1/deviceId')]: newDid, [A('devproof/s1')]: null }));
    await assertFails(corrCreate(u1, 'cOld', { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: serverTimestamp() }, { proof: { k: oldK } }));
    await assertFails(set(ref(u1, A(`devproof/s1/${oldK}`)), serverTimestamp()));
    await assertSucceeds(corrCreate(u1, 'cNew', { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: serverTimestamp() }, { proof: { k: newK } }));
    // ผู้ไม่ใช่แอดมินลบ devproof ไม่ได้; พนักงานอ่านไม่ได้
    await assertFails(remove(ref(u1, A('devproof/s1'))));
    await assertFails(get(ref(u1, A('devproof/s1'))));
  });

  test('R69 เพื่อนที่รู้รหัสผ่านแต่ไม่มีกุญแจ: อ่านได้ (ยอมรับ) แต่ลงเวลา/สร้าง-ลบคำขอแก้เวลาไม่ได้ ส่งคำขอใช้เครื่องได้ครั้งเดียวต่อ pending', async () => {
    await seedShift();
    await seed((adb) => set(ref(adb, A('corrections/cp1')), { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: 1 }));
    const friend = staffDb('u1');
    await assertSucceeds(get(ref(friend, A('state/s1'))));
    await assertSucceeds(get(ref(friend, A(`logs/${TODAY}/s1`))));
    await assertSucceeds(get(query(ref(friend, A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    for (const type of ['break_start', 'out']) await assertFails(send(friend, { sid: 's1', uid: 'u1', type, prev: await seedGet('state/s1'), proof: false }));
    await assertFails(corrCreate(friend, 'cn1', { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: serverTimestamp() }, { proof: false }));
    await assertFails(corrDelete(friend, 'cp1', 's1', { proof: false }));
    const devReq = { info: { kind: 'device', did: 'did_friend_00000000', status: 'pending', requestedAt: serverTimestamp() }, key: 'f'.repeat(43) };
    await assertSucceeds(set(ref(friend, A('deviceRequests/u1')), devReq));
    await assertFails(set(ref(friend, A('deviceRequests/u1')), devReq));
  });

  test('R70 อนุมัติเครื่องใหม่ (หมุนกุญแจ): กุญแจเก่ากดไม่ได้ กุญแจใหม่กดได้', async () => {
    const adm = adminEmail(), u1 = staffDb('u1');
    const NEWK = 'n'.repeat(43), NEWD = 'did_new_0000000000000';
    await assertSucceeds(update(ref(adm), { [A('deviceKeys/s1')]: { k: NEWK, did: NEWD, at: serverTimestamp() }, [A('staff/s1/deviceId')]: NEWD, [A('staff/s1/deviceAt')]: serverTimestamp() }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));                          // กุญแจเก่า
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in', proof: { k: NEWK } }));
    // หมุนกุญแจโดยไม่เปลี่ยน staff.deviceId ไม่ได้ (did ไม่ตรง)
    await assertFails(update(ref(adm), { [A('deviceKeys/s1')]: { k: 'm'.repeat(43), did: 'did_other_00000000000', at: serverTimestamp() } }));
  });

  test('R71 relink (ลืมรหัส): ย้าย s1 จาก u1 ไป u7 แล้ว u1 อ่าน/เขียนไม่ได้ u7 ใช้กุญแจเดิมได้; log เก่าแอดมินยังแก้ ts พร้อม audit แต่เปลี่ยน uid ไม่ได้', async () => {
    const adm = adminEmail();
    const old = APPLOG({ uid: 'u1' }); await seedLog('s1', TODAY, 'L1', old);
    await seed((adb) => set(ref(adb, A('state/s1')), { status: 'working', workDate: TODAY, since: Date.now() - 120000, inAt: old.ts, lastLogId: 'L1' }));
    await assertSucceeds(update(ref(adm), { [A('staff/s1/uid')]: 'u7', [A('staff/s1/username')]: 'nong_a2', [A('accounts/u1')]: null, [A('accounts/u7')]: 's1' }));
    const u1 = staffDb('u1'), u7 = staffDb('u7');
    await assertFails(get(ref(u1, A('state/s1'))));
    await assertFails(get(ref(u1, A(`logs/${TODAY}/s1`))));
    await assertFails(get(query(ref(u1, A('corrections')), orderByChild('staffId'), equalTo('s1'))));
    await assertFails(get(ref(u1, A('staff/s1'))));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'break_start', prev: await seedGet('state/s1') }));
    await assertSucceeds(get(ref(u7, A('state/s1'))));
    await assertSucceeds(get(ref(u7, A('accounts/u7'))));
    await assertSucceeds(send(u7, { sid: 's1', uid: 'u7', type: 'break_start', prev: await seedGet('state/s1') }));
    // log เก่า (uid u1)
    const ts2 = old.ts - 60000;
    await assertSucceeds(update(ref(adm), editLog(adm, { old, changes: { ts: ts2, origTs: old.ts } })));
    await assertFails(update(ref(adm), editLog(adm, { old: { ...old, ts: ts2, origTs: old.ts }, changes: { uid: 'u7' } })));
    // accounts ต้องสอดคล้อง staff.uid
    await assertFails(update(ref(adm), { [A('accounts/u8')]: 's1' }));
  });

  test('R72 ยกเลิกผูกเครื่อง: ลงเวลา/แก้เวลาไม่ได้แต่ขอเครื่องได้; ปิดบัญชี: ลงเวลา/devproof/คำขอเครื่องไม่ได้; เปิดกลับแล้วกดได้', async () => {
    const adm = adminEmail(), u1 = staffDb('u1');
    await assertSucceeds(update(ref(adm), { [A('deviceKeys/s1')]: null, [A('staff/s1/deviceId')]: null, [A('staff/s1/deviceAt')]: null }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));
    await assertFails(corrCreate(u1, 'c1', { staffId: 's1', workDate: TODAY, type: 'in', time: '08:00', reason: 'x', status: 'pending', createdAt: serverTimestamp() }));
    const devReq = { info: { kind: 'device', did: 'did_again_0000000000', status: 'pending', requestedAt: serverTimestamp() }, key: 'r'.repeat(43) };
    await assertSucceeds(set(ref(u1, A('deviceRequests/u1')), devReq));
    await assertSucceeds(remove(ref(u1, A('deviceRequests/u1'))));
    // คืนกุญแจแล้วปิดบัญชี
    await assertSucceeds(update(ref(adm), { [A('deviceKeys/s1')]: { k: KEYOF.s1, did: DID.s1, at: serverTimestamp() }, [A('staff/s1/deviceId')]: DID.s1 }));
    await assertSucceeds(update(ref(adm, A('staff/s1')), { active: false }));
    await assertFails(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));
    await assertFails(set(ref(u1, A(`devproof/s1/${KEYOF.s1}`)), serverTimestamp()));
    await assertFails(set(ref(u1, A('deviceRequests/u1')), devReq));
    await assertSucceeds(update(ref(adm, A('staff/s1')), { active: true }));
    await assertSucceeds(send(u1, { sid: 's1', uid: 'u1', type: 'in' }));
  });

  test('R73 branches/settings/staff อ่านได้เฉพาะสมาชิก: คนนอก/ผู้สมัครที่ยังไม่อนุมัติอ่านไม่ได้ อนุมัติแล้วอ่านได้', async () => {
    for (const db of [stranger('x1'), staffDb('u9'), guest()]) {
      await assertFails(get(ref(db, A('branches'))));
      await assertFails(get(ref(db, A('settings'))));
      await assertFails(get(ref(db, A('staff'))));
      await assertFails(get(ref(db, A('staff/s1'))));
    }
    const u1 = staffDb('u1');
    await assertSucceeds(get(ref(u1, A('branches'))));
    await assertSucceeds(get(ref(u1, A('settings'))));
    await assertSucceeds(get(ref(u1, A('staff/s1'))));
    await assertFails(get(ref(u1, A('staff/s2'))));
    await assertFails(get(ref(u1, A('staff'))));
    await set(ref(staffDb('u9'), A('deviceRequests/u9')), regReq());
    await assertSucceeds(update(ref(adminEmail()), approveReg({})));
    await assertSucceeds(get(ref(staffDb('u9'), A('branches'))));
  });

  test('R74 staffSecret ถูกลบ: อ่าน/เขียนไม่ได้ และ staff เขียน deviceApproved/deviceApprovedAt/pinHash ไม่ได้', async () => {
    const adm = adminEmail();
    await assertFails(get(ref(adm, A('staffSecret/s1'))));
    await assertFails(set(ref(adm, A('staffSecret/s1')), { pinHash: HASH_A }));
    await assertFails(set(ref(staffDb('u1'), A('staffSecret/s1')), { pinHash: HASH_A }));
    for (const f of [{ deviceApproved: true }, { deviceApprovedAt: 1 }, { pinHash: HASH_A }]) await assertFails(update(ref(adm, A('staff/s1')), f));
  });

  test('R75 settings/registrationOpen: แอดมินตั้ง true/false ได้, ค่าอื่นไม่ได้, พนักงานตั้งไม่ได้', async () => {
    const adm = adminEmail();
    await assertSucceeds(set(ref(adm, A('settings/registrationOpen')), true));
    await assertSucceeds(set(ref(adm, A('settings/registrationOpen')), false));
    await assertFails(set(ref(adm, A('settings/registrationOpen')), 'no'));
    await assertFails(set(ref(adm, A('settings/registrationOpen')), 0));
    await assertFails(set(ref(staffDb('u1'), A('settings/registrationOpen')), true));
    await assertFails(set(ref(staffDb('u9'), A('settings/registrationOpen')), true));
  });

  test('R76 เจ้าของสร้างบัญชีให้: staff+accounts ผ่าน; ยังลงเวลาไม่ได้ (ไม่มีกุญแจ); ขอเครื่อง > อนุมัติ > ลงเวลาได้', async () => {
    const adm = adminEmail(), dao = staffDb('u10');
    await assertSucceeds(update(ref(adm), { [A('staff/s10')]: { nickname: 'ดาว', username: 'dao', branchId: 'b1', shiftStart: '07:00', shiftEnd: '18:00', active: true, uid: 'u10', createdAt: serverTimestamp() }, [A('accounts/u10')]: 's10' }));
    await assertFails(send(dao, { sid: 's10', uid: 'u10', type: 'in', proof: { k: 'd'.repeat(43) } }));
    const did = 'did_dao_000000000000', key = 'd'.repeat(43);
    await assertSucceeds(set(ref(dao, A('deviceRequests/u10')), { info: { kind: 'device', did, status: 'pending', requestedAt: serverTimestamp() }, key }));
    await assertSucceeds(update(ref(adm), { [A('deviceKeys/s10')]: { k: key, did, at: serverTimestamp() }, [A('staff/s10/deviceId')]: did, [A('staff/s10/deviceAt')]: serverTimestamp(), [A('deviceRequests/u10')]: null }));
    await assertSucceeds(send(dao, { sid: 's10', uid: 'u10', type: 'in', proof: { k: key } }));
  });
});

async function seedGet(p) {
  let v;
  await seed(async (db) => { v = (await get(ref(db, A(p)))).val(); });
  return v;
}
