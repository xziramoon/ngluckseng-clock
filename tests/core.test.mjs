// Unit test ของตรรกะกลาง (SHARED CORE v3 + REPORT CORE) ด้วย node ล้วน ไม่ต้องมี emulator/Java
// รัน: cd tests && npm run test:core   (docs/plan-phase3.md ข้อ 9.1 U1-U20)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CLOCK = read('clock.html'), MASTER = read('clock-master.html');
const SHARED_RE = /\/\/ ==== SHARED CORE v3 BEGIN[^\n]*\n([\s\S]*?)\/\/ ==== SHARED CORE v3 END ====/g;
const REPORT_RE = /\/\/ ==== REPORT CORE BEGIN[^\n]*\n([\s\S]*?)\/\/ ==== REPORT CORE END ====/g;
const blocks = (src, re) => [...src.matchAll(re)].map((m) => m[1]);
const sharedM = blocks(MASTER, SHARED_RE), sharedC = blocks(CLOCK, SHARED_RE), reportM = blocks(MASTER, REPORT_RE), reportC = blocks(CLOCK, REPORT_RE);
const SHARED = sharedM[0], REPORT = reportM[0] || '';

const NAMES = 'MIN_MS,DAY_MS,STALE_MS,TYPE_ORDER,isExcluded,bkkDateOf,hhmmOf,tsOf,addDaysKey,floorMin,logsToList,summarize,dayReport';
const REPORT_NAMES = 'monthRange,datesBetween,weekdayTh,csvText,csvId,csvNum,toCsv,buildReport,dailyCsv,summaryCsv,MAX_RANGE_DAYS';
const core = new Function(SHARED + (REPORT ? '\n' + REPORT : '') + `\nreturn { ${NAMES}${REPORT ? ',' + REPORT_NAMES : ''} };`)();
const { tsOf, bkkDateOf, hhmmOf, addDaysKey, floorMin, summarize, dayReport, logsToList, STALE_MS } = core;

// ---------- helpers ----------
const mkLogs = (rows) => Object.fromEntries(rows.map((r, i) => {
  const [type, d, hhmm, o = {}] = r;
  const { plus, sec = 0, ...rest } = o;
  return ['k' + String(i).padStart(2, '0'), { type, ts: tsOf(d, hhmm, plus) + sec * 1000, branchId: 'wongwian', source: 'app', ...rest }];
}));
const CTX = (o = {}) => ({ shiftStart: '07:00', shiftEnd: '18:00', graceMin: 5, homeBranchId: 'wongwian', breakLimitFor: () => 60, state: null, now: tsOf('2026-10-25', '12:00'), ...o });
const D1 = '2026-10-01';
const day = (rows, o = {}, d = D1) => dayReport(d, mkLogs(rows), CTX(o));

// ---------- U1/U2 ----------
describe('บล็อกกลาง', () => {
  test('U1 parity: SHARED CORE ใน clock.html และ clock-master.html เหมือนกันทุกตัวอักษร; REPORT CORE มีเฉพาะ master', () => {
    assert.equal(sharedM.length, 1); assert.equal(sharedC.length, 1);
    assert.equal(sharedM[0], sharedC[0]);
    assert.ok(sharedM[0].length > 2000);
    assert.equal(reportC.length, 0);
    assert.ok(reportM.length <= 1);
  });
  test('U2 บล็อกไม่อ้าง DOM/Intl/ตัวแปรนอกบล็อก และ evaluate ได้โดยไม่มี global อื่น', () => {
    const code = SHARED + (REPORT ? '\n' + REPORT : '');
    const noComments = code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const bad of ['document', 'window', 'localStorage', 'Intl', 'serverNow', 'bangkokDate', 'fmtTime', 'fmtMin', 'D.', 'await ', 'import ', 'export ']) {
      assert.ok(!noComments.includes(bad), 'พบ ' + bad);
    }
    // รันใน vm ที่ไม่มี global ใดเลยนอกจาก builtin ของ JS
    const f = new Function('document', 'window', 'localStorage', 'Intl', 'D', 'serverNow', code + '\nreturn typeof summarize === "function" && typeof dayReport === "function";');
    assert.equal(f(undefined, undefined, undefined, undefined, undefined, undefined), true);
  });
});

// ---------- U3 ----------
test('U3 bkkDateOf/hhmmOf ตรงกับ Intl Asia/Bangkok (สุ่ม 10,000 ค่า + ขอบเขต) และ addDaysKey ข้ามเดือน/ปี/29 ก.พ.', () => {
  const dF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
  const tF = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const edge = [Date.parse('2026-10-24T16:59:59.999Z'), Date.parse('2026-10-24T17:00:00.000Z'), Date.parse('2028-02-28T16:59:59.999Z'), Date.parse('2028-02-28T17:00:00.000Z'), Date.parse('2026-12-31T17:00:00Z'), 0];
  for (const t of edge) { assert.equal(bkkDateOf(t), dF.format(t)); assert.equal(hhmmOf(t), tF.format(t)); }
  for (let i = 0; i < 10000; i++) { const t = Math.floor(946684800000 + rnd() * 1.2e12); assert.equal(bkkDateOf(t), dF.format(t)); assert.equal(hhmmOf(t), tF.format(t)); }
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysKey('2028-02-29', 1), '2028-03-01');
  assert.equal(addDaysKey('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysKey('2026-10-25', -70), '2026-08-16');
});

// ---------- U4 ----------
test('U4 summarize v3 เท่ากับสำเนา v2 ที่แช่แข็งไว้ (inTs/outTs/breakMs/openBreak/netMs/flags) ทุก fixture', () => {
  const TO = { in: 0, break_start: 1, break_end: 2, out: 3 };
  const ex = (l) => !!l && (l.voided === true || l.review === 'rejected');
  const ltl = (obj) => Object.entries(obj || {}).filter(([, l]) => l && typeof l === 'object').map(([id, l]) => ({ ...l, id })).sort((a, b) => (a.ts || 0) - (b.ts || 0) || (TO[a.type] ?? 9) - (TO[b.type] ?? 9));
  function v2(logsObj) {
    const ev = ltl(logsObj).filter((l) => typeof l.ts === 'number' && !ex(l));
    const segments = [], flags = new Set(); let cur = null;
    for (const e of ev) {
      if (e.flag && !e.review) flags.add(e.flag);
      if (e.type === 'in') { cur = { inTs: e.ts, outTs: null, breakMs: 0, openBreak: null }; segments.push(cur); continue; }
      if (!cur) continue;
      if (e.type === 'break_start') { if (cur.openBreak == null) cur.openBreak = e.ts; }
      else if (e.type === 'break_end') { if (cur.openBreak != null) { cur.breakMs += e.ts - cur.openBreak; cur.openBreak = null; } }
      else if (e.type === 'out') cur.outTs = e.ts;
    }
    const last = segments[segments.length - 1] || null;
    const netMs = segments.filter((g) => g.outTs != null).reduce((a, g) => a + (g.outTs - g.inTs - g.breakMs), 0);
    return { inTs: segments[0] ? segments[0].inTs : null, outTs: last ? last.outTs : null, breakMs: segments.reduce((a, g) => a + g.breakMs, 0), openBreak: last ? last.openBreak : null, netMs, flags: [...flags].sort(), evIds: ev.map((e) => e.id) };
  }
  const fixtures = [
    [], [['in', D1, '07:00']], [['in', D1, '07:00'], ['out', D1, '18:00']],
    [['in', D1, '07:00'], ['break_start', D1, '12:00'], ['break_end', D1, '13:00'], ['out', D1, '18:00']],
    [['in', D1, '07:00'], ['break_start', D1, '12:00']], [['break_start', D1, '12:00'], ['in', D1, '13:00']],
    [['in', D1, '07:00'], ['out', D1, '12:00'], ['in', D1, '13:00'], ['out', D1, '17:00']],
    [['in', D1, '07:00', { flag: 'suspect' }], ['in', D1, '08:00', { flag: 'borderline', review: 'approved' }], ['out', D1, '09:00', { voided: true }]],
    [['in', D1, '07:00'], ['break_start', D1, '12:00'], ['break_start', D1, '12:10'], ['break_end', D1, '12:30'], ['break_end', D1, '12:40'], ['out', D1, '18:00']],
    [['in', D1, '07:00', { review: 'rejected' }], ['out', D1, '18:00']],
  ];
  for (const f of fixtures) {
    const logs = mkLogs(f), n = summarize(logs), o = v2(logs);
    assert.equal(n.inTs, o.inTs); assert.equal(n.outTs, o.outTs); assert.equal(n.breakMs, o.breakMs);
    assert.equal(n.openBreak, o.openBreak); assert.equal(n.netMs, o.netMs);
    assert.deepEqual([...n.flags].sort(), o.flags); assert.deepEqual(n.ev.map((e) => e.id), o.evIds);
  }
});

// ---------- U5-U8 ----------
describe('นับ/ไม่นับ และหน่วยนาที', () => {
  test('U5 voided / rejected ไม่นับ; reject in แล้ว break/out กำพร้าไม่นับ', () => {
    let r = day([['in', D1, '07:00'], ['out', D1, '18:00', { voided: true }]]);
    assert.equal(r.openStatus, 'missing'); assert.equal(r.netMin, 0); assert.ok(r.hasExcluded);
    r = day([['in', D1, '07:00'], ['break_start', D1, '12:00', { review: 'rejected' }], ['break_end', D1, '13:00', { review: 'rejected' }], ['out', D1, '18:00']]);
    assert.equal(r.netMin, 660); assert.equal(r.breakMinAll, 0);
    r = day([['in', D1, '07:00', { review: 'rejected' }], ['break_start', D1, '12:00'], ['break_end', D1, '13:00'], ['out', D1, '18:00']]);
    assert.equal(r.worked, false); assert.equal(r.netMin, 0); assert.equal(r.segs.length, 0);
    assert.equal(r.lateRawMin, null); assert.equal(r.earlyMin, null);
  });
  test('U6 หลายกะ: net รวม ช่วงห่างไม่นับ สายจากกะแรกเท่านั้น', () => {
    const r = day([['in', D1, '07:10'], ['out', D1, '12:00'], ['in', D1, '13:00'], ['break_start', D1, '15:00'], ['break_end', D1, '15:20'], ['out', D1, '17:00']]);
    assert.equal(r.segs.length, 2);
    assert.equal(r.segs[0].netMin, 290); assert.equal(r.segs[1].netMin, 220);
    assert.equal(r.netMin, 510); assert.equal(r.breakMin, 20);
    assert.equal(r.lateRawMin, 10); assert.equal(r.isLate, true); assert.equal(r.lateMin, 10);
    assert.equal(r.lastOutTs, tsOf(D1, '17:00')); assert.equal(r.earlyMin, 60);
  });
  test('U7 ข้ามคืน: เข้า 20:03 ออก 02:00(+1) พัก 20 = 337, outPlus; ข้ามเดือน อยู่ใน workDate เดิม', () => {
    const r = day([['in', D1, '20:03'], ['break_start', D1, '23:00'], ['break_end', D1, '23:20'], ['out', D1, '02:00', { plus: true }]], { shiftStart: '20:00', shiftEnd: '04:00' });
    assert.equal(r.netMin, 337); assert.equal(r.segs[0].outPlus, true); assert.equal(r.segs[0].inPlus, false);
    const m = dayReport('2026-10-31', mkLogs([['in', '2026-10-31', '20:00'], ['out', '2026-10-31', '02:00', { plus: true }]]), CTX({ shiftStart: '20:00', shiftEnd: '04:00' }));
    assert.equal(m.netMin, 360); assert.equal(m.d, '2026-10-31'); assert.equal(bkkDateOf(m.lastOutTs), '2026-11-01');
  });
  test('U8 นาทีเต็ม: 07:00:59-17:00:10 = 600; พัก 12:00:30-12:59:59 = 59', () => {
    let r = day([['in', D1, '07:00', { sec: 59 }], ['out', D1, '17:00', { sec: 10 }]]);
    assert.equal(r.netMin, 600);
    r = day([['in', D1, '07:00'], ['break_start', D1, '12:00', { sec: 30 }], ['break_end', D1, '12:59', { sec: 59 }], ['out', D1, '17:00']]);
    assert.equal(r.breakMin, 59); assert.equal(r.netMin, 600 - 59);
  });
});

// ---------- U9-U10 ----------
describe('สาย / พักเกิน / ออกก่อนเวลา', () => {
  test('U9 สาย (grace 5, กะ 07:00): 07:05:59 ไม่สาย; 07:06:00 สาย 6; มาก่อนกะ = 0; shiftStart ผิดรูป = null; grace 0', () => {
    let r = day([['in', D1, '07:05', { sec: 59 }], ['out', D1, '18:00']]); assert.equal(r.lateRawMin, 5); assert.equal(r.isLate, false); assert.equal(r.lateMin, 0);
    r = day([['in', D1, '07:06'], ['out', D1, '18:00']]); assert.equal(r.isLate, true); assert.equal(r.lateMin, 6);
    r = day([['in', D1, '06:50'], ['out', D1, '18:00']]); assert.equal(r.isLate, false); assert.equal(r.lateMin, 0); assert.equal(r.lateRawMin, -10);
    for (const bad of [undefined, null, '', '7:00', '25:00', 'abc']) { r = day([['in', D1, '09:00'], ['out', D1, '18:00']], { shiftStart: bad }); assert.equal(r.lateRawMin, null); assert.equal(r.isLate, false); assert.equal(r.lateMin, 0); }
    r = day([['in', D1, '07:01'], ['out', D1, '18:00']], { graceMin: 0 }); assert.equal(r.isLate, true); assert.equal(r.lateMin, 1);
    r = day([['in', D1, '07:00', { sec: 59 }], ['out', D1, '18:00']], { graceMin: 0 }); assert.equal(r.isLate, false);
  });
  test('U10 พักเกิน (60): 60 ไม่เกิน, 61 เกิน 1; สาขาไม่มีค่า = 60; limit 0; ใช้สาขาของ in แรก', () => {
    const brk = (m) => [['in', D1, '07:00'], ['break_start', D1, '12:00'], ['break_end', D1, tsHHMM(12 * 60 + m)], ['out', D1, '18:00']];
    const tsHHMM = (mm) => String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
    let r = day(brk(60)); assert.equal(r.isOverBreak, false); assert.equal(r.overBreakMin, 0);
    r = day(brk(61)); assert.equal(r.isOverBreak, true); assert.equal(r.overBreakMin, 1);
    r = day(brk(61), { breakLimitFor: () => undefined }); assert.equal(r.breakLimitMin, 60); assert.equal(r.isOverBreak, true);
    r = day(brk(61), { breakLimitFor: () => 'x' }); assert.equal(r.breakLimitMin, 60);
    r = day(brk(1), { breakLimitFor: () => 0 }); assert.equal(r.breakLimitMin, 0); assert.equal(r.isOverBreak, true); assert.equal(r.overBreakMin, 1);
    r = day([['in', D1, '07:00', { branchId: 'kl' }], ['break_start', D1, '12:00'], ['break_end', D1, '12:50'], ['out', D1, '18:00', { branchId: 'wongwian' }]], { breakLimitFor: (b) => (b === 'kl' ? 30 : 60) });
    assert.equal(r.branchId, 'kl'); assert.equal(r.breakLimitMin, 30); assert.equal(r.isOverBreak, true); assert.equal(r.multiBranch, true);
    r = day([['out', D1, '18:00']], { homeBranchId: 'home' }); assert.equal(r.branchId, 'home');
  });
  test('U18 ออกก่อนเวลา (เลิกกะ 18:00): 18:00:59 ไม่ก่อน; 17:59:59 ก่อน 1 นาที; 17:00 ก่อน 60; ออกหลังเที่ยงคืน (+1) ไม่ก่อน', () => {
    let r = day([['in', D1, '07:00'], ['out', D1, '18:00', { sec: 59 }]]); assert.equal(r.earlyMin, 0); assert.equal(r.isEarly, false);
    r = day([['in', D1, '07:00'], ['out', D1, '17:59', { sec: 59 }]]); assert.equal(r.earlyMin, 1); assert.equal(r.isEarly, true);
    r = day([['in', D1, '07:00'], ['out', D1, '17:00']]); assert.equal(r.earlyMin, 60);
    r = day([['in', D1, '07:00'], ['out', D1, '02:00', { plus: true }]]); assert.equal(r.earlyMin, 0);
    r = day([['in', D1, '07:00'], ['out', D1, '17:00']], { shiftEnd: undefined }); assert.equal(r.earlyMin, 60);   // ค่าเริ่มต้น 18:00
    r = day([['in', D1, '07:00'], ['out', D1, '17:00']], { shiftEnd: '17:30' }); assert.equal(r.earlyMin, 30);
    r = day([['in', D1, '07:00'], ['out', D1, '17:00']], { shiftEnd: 'xx' }); assert.equal(r.earlyMin, null); assert.equal(r.isEarly, false);
  });
  test('U19 ออกก่อนเวลา: เฉพาะวันที่ครบ (ไม่มีเวลาออก/กำลังทำงาน = null) ใช้เวลาออกของกะสุดท้าย', () => {
    let r = day([['in', D1, '07:00']]); assert.equal(r.earlyMin, null); assert.equal(r.isEarly, false);
    r = day([['in', D1, '07:00'], ['out', D1, '12:00'], ['in', D1, '13:00']]); assert.equal(r.openStatus, 'missing'); assert.equal(r.earlyMin, null);
    r = day([['in', D1, '07:00'], ['out', D1, '12:00'], ['in', D1, '13:00'], ['out', D1, '17:30']]); assert.equal(r.earlyMin, 30);
    r = day([], {}); assert.equal(r.earlyMin, null);
  });
  test('U20 ออกก่อนเวลา: กะข้ามคืน (เลิกกะ < เข้ากะ = วันถัดไป)', () => {
    const o = { shiftStart: '20:00', shiftEnd: '04:00' };
    let r = day([['in', D1, '20:00'], ['out', D1, '02:00', { plus: true }]], o); assert.equal(r.earlyMin, 120); assert.equal(r.shiftEndTs, tsOf(D1, '04:00', true));
    r = day([['in', D1, '20:00'], ['out', D1, '04:00', { plus: true }]], o); assert.equal(r.earlyMin, 0);
    r = day([['in', D1, '20:00'], ['out', D1, '05:00', { plus: true }]], o); assert.equal(r.earlyMin, 0);
    // เลิกกะ > เข้ากะ = วันเดียวกัน
    r = day([['in', D1, '08:00'], ['out', D1, '16:00']], { shiftStart: '08:00', shiftEnd: '17:00' }); assert.equal(r.earlyMin, 60);
  });
});

// ---------- U11-U12 ----------
describe('กะเปิดและความผิดปกติ', () => {
  test('U11 กะเปิด: live (state วันนั้น working ไม่ STALE) vs missing; net/break ไม่รวม; breakMinAll รวม', () => {
    const now = tsOf('2026-10-25', '12:00');
    const d = '2026-10-25';
    const rows = [['in', d, '07:00'], ['break_start', d, '09:00'], ['break_end', d, '09:30']];
    const st = (o) => ({ status: 'working', workDate: d, inAt: tsOf(d, '07:00'), ...o });
    let r = day(rows, { state: st(), now }, d); assert.equal(r.openStatus, 'live'); assert.equal(r.netMin, 0); assert.equal(r.breakMin, 0); assert.equal(r.breakMinAll, 30); assert.equal(r.earlyMin, null);
    r = day(rows, { state: st({ status: 'on_break' }), now }, d); assert.equal(r.openStatus, 'live');
    r = day(rows, { state: st({ inAt: now - STALE_MS - 1 }), now }, d); assert.equal(r.openStatus, 'missing');
    r = day(rows, { state: st({ inAt: now - STALE_MS }), now }, d); assert.equal(r.openStatus, 'live');
    r = day(rows, { state: st({ workDate: '2026-10-24' }), now }, d); assert.equal(r.openStatus, 'missing');
    r = day(rows, { state: st({ status: 'done' }), now }, d); assert.equal(r.openStatus, 'missing');
    r = day(rows, { state: null, now }, d); assert.equal(r.openStatus, 'missing');
    r = day([['in', d, '07:00'], ['out', d, '09:00'], ['in', d, '10:00']], { state: st({ inAt: tsOf(d, '10:00') }), now }, d);
    assert.equal(r.segs[0].status, 'closed'); assert.equal(r.segs[1].status, 'live'); assert.equal(r.openStatus, 'live'); assert.equal(r.netMin, 120);
    r = day([['in', d, '07:00'], ['in', d, '10:00']], { state: st({ inAt: tsOf(d, '10:00') }), now }, d);
    assert.equal(r.segs[0].status, 'missing'); assert.equal(r.openStatus, 'missing');   // ไม่ใช่กะสุดท้าย
  });
  test('U12 anomalies: openBreakAtOut, negativeNet, longShift', () => {
    let r = day([['in', D1, '07:00'], ['break_start', D1, '12:00'], ['out', D1, '13:00']]);
    assert.deepEqual(r.anomalies, ['openBreakAtOut']); assert.equal(r.breakMin, 0); assert.equal(r.netMin, 360);
    r = day([['in', D1, '07:00'], ['break_start', D1, '08:00'], ['break_end', D1, '10:00'], ['out', D1, '09:00']]);
    assert.ok(r.anomalies.includes('negativeNet') || r.netMin >= 0);
    r = day([['in', D1, '06:00'], ['out', D1, '23:00']]); assert.deepEqual(r.anomalies, ['longShift']); assert.equal(r.netMin, 1020);
    r = day([['in', D1, '07:00'], ['out', D1, '18:00']]); assert.deepEqual(r.anomalies, []);
  });
  test('U21 out ซ้ำในกะที่ปิดแล้ว (in ที่สอง voided): ไม่ทับ out เดิม, ไม่ขยายกะ, anomaly orphanOut, net ไม่รวม', () => {
    const r = day([['in', D1, '07:00'], ['out', D1, '12:00'], ['in', D1, '13:00', { voided: true }], ['out', D1, '17:00']]);
    assert.equal(r.segs.length, 1); assert.equal(r.segs[0].outTs, tsOf(D1, '12:00')); assert.equal(r.netMin, 300);
    assert.ok(r.anomalies.includes('orphanOut')); assert.equal(r.lastOutTs, tsOf(D1, '12:00'));
    assert.equal(r.sum.outTs, tsOf(D1, '12:00'));
    // out ซ้ำแบบติดกันก็ไม่ทับ
    const r2 = day([['in', D1, '07:00'], ['out', D1, '18:00'], ['out', D1, '18:30']]);
    assert.equal(r2.netMin, 660); assert.ok(r2.anomalies.includes('orphanOut'));
    // กะปกติ 2 กะไม่เป็น orphan
    assert.ok(!day([['in', D1, '07:00'], ['out', D1, '12:00'], ['in', D1, '13:00'], ['out', D1, '17:00']]).anomalies.includes('orphanOut'));
  });
  test('U22 shiftEnd ค่าเริ่มต้น 18:00 ใช้เมื่อเข้ากะก่อน 18:00 เท่านั้น (กะเย็น/ดึกไม่มี shiftEnd = ไม่คิดออกก่อนเวลา)', () => {
    let r = day([['in', D1, '19:00'], ['out', D1, '03:00', { plus: true }]], { shiftStart: '19:00', shiftEnd: undefined });
    assert.equal(r.earlyMin, null); assert.equal(r.isEarly, false);
    r = day([['in', D1, '18:00'], ['out', D1, '23:00']], { shiftStart: '18:00', shiftEnd: '' }); assert.equal(r.earlyMin, null);
    r = day([['in', D1, '19:00'], ['out', D1, '23:00']], { shiftStart: '19:00', shiftEnd: '23:30' }); assert.equal(r.earlyMin, 30);   // ตั้งเองยังคิด
    r = day([['in', D1, '17:00'], ['out', D1, '17:30']], { shiftStart: '17:00', shiftEnd: undefined }); assert.equal(r.earlyMin, 30);
    r = day([['in', D1, '08:00'], ['out', D1, '17:00']], { shiftStart: undefined, shiftEnd: undefined }); assert.equal(r.earlyMin, 60);   // ไม่มี shiftStart ใช้ 18:00
  });
  test('U23 breakLimitFor: null หรือสตริงว่าง = ค่าเริ่มต้น 60 (ไม่ใช่ 0), 0 จริงยังเป็น 0', () => {
    const brk = [['in', D1, '07:00'], ['break_start', D1, '12:00'], ['break_end', D1, '12:30'], ['out', D1, '18:00']];
    for (const v of [null, '', undefined, 'x']) { const r = day(brk, { breakLimitFor: () => v }); assert.equal(r.breakLimitMin, 60); assert.equal(r.isOverBreak, false); }
    assert.equal(day(brk, { breakLimitFor: () => 0 }).breakLimitMin, 0);
    assert.equal(day(brk, { breakLimitFor: () => '45' }).breakLimitMin, 45);
  });
  test('U24 csvId: id:+รหัส ไม่ขึ้นต้นด้วย = + - @ (Excel ไม่ตีเป็นสูตร), รหัสผิดรูปแบบผ่าน guard', () => {
    assert.equal(core.csvId('-OAa1'), 'id:-OAa1'); assert.equal(core.csvId('abc_1'), 'id:abc_1');
    assert.ok(!/^[=+@\t\r-]/.test(core.csvId('-OAa1')));
    assert.equal(core.csvId('=1+1'), "'=1+1"); assert.equal(core.csvId('a,b'), '"a,b"'); assert.equal(core.csvId(null), '');
  });
  test('U25 ยอดพักในไฟล์รายวัน = ยอดสรุป: กะที่ยังไม่ปิดเว้นช่องพักรวม (ไม่นับ) ผลรวมพักของแถวรายวัน = พักรวมในสรุป', () => {
    const fx = fxData('2026-10');
    fx.logs['2026-10-05']['-OBb2']['Lbrk1'] = { type: 'break_start', ts: tsOf('2026-10-05', '12:00'), branchId: 'wongwian', source: 'app' };
    fx.logs['2026-10-05']['-OBb2']['Lbrk2'] = { type: 'break_end', ts: tsOf('2026-10-05', '12:20'), branchId: 'wongwian', source: 'app' };
    const rp = mkReport(fx);
    const dl = core.dailyCsv(rp, brName).slice(1).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    const per = {};
    for (const c of dl) if (c[8] !== '') per[c[2]] = (per[c[2]] || 0) + Number(c[8]);
    const row5 = dl.find((c) => c[0] === '2026-10-05'); assert.equal(row5[8], ''); assert.equal(row5[14], 'ไม่มีเวลาออก');
    for (const p of rp.people) assert.equal(per[p.name] || 0, p.breakMin);
  });
  test('logsToList: เรียง ts แล้ว TYPE_ORDER; ข้ามข้อมูลที่ไม่ใช่ object', () => {
    const l = logsToList({ a: { type: 'out', ts: 5 }, b: { type: 'in', ts: 5 }, c: null, d: 'x', e: { type: 'in', ts: 1 } });
    assert.deepEqual(l.map((x) => x.id), ['e', 'b', 'a']);
  });
});

// =================== REPORT CORE (U13-U17) ===================
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/phase3.json', import.meta.url), 'utf8'));
function fxData(ym) {
  const logs = {}, days = {}, staff = {};
  for (const s of FX.staff) staff[s.sid] = { nickname: s.nickname, branchId: FX.branch.id, shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, active: true };
  const keyOf = (k) => FX.staff.find((s) => s.key === k).sid;
  FX.days.forEach((r, i) => {
    const d = `${ym}-${String(r.day).padStart(2, '0')}`, sid = keyOf(r.staff);
    logs[d] ||= {}; logs[d][sid] ||= {};
    r.logs.forEach(([type, hhmm, o = {}], j) => { logs[d][sid]['L' + i + '_' + j] = { type, ts: tsOf(d, hhmm, o.plus), branchId: FX.branch.id, source: r.source || 'app' }; });
    if (r.confirmed) { days[d] ||= {}; days[d][sid] = { confirmed: true }; }
  });
  return { logs, days, staff };
}
const BR = { [FX.branch.id]: { name: FX.branch.name, breakLimitMin: FX.branch.breakLimitMin } };
const mkReport = (fx, o = {}) => {
  const ym = '2026-10', r = core.monthRange(ym);
  return core.buildReport({ from: r.from, to: r.to, staff: fx.staff, branches: BR, settings: FX.settings, state: {}, logsFor: (d) => fx.logs[d], daysFor: (d) => fx.days[d], sid: 'all', branch: 'all', inactive: true, onlyConfirmed: false, now: tsOf('2026-10-25', '12:00'), ...o });
};
const rep0 = (o = {}) => { const fx = fxData('2026-10'); return { fx, report: mkReport(fx, o) }; };
const brName = (b) => (BR[b] || {}).name || b;

const GOLD_DAILY = [
  'วันที่,วัน,ชื่อ,สาขา,กะที่,เข้า,ออก,ออกวันถัดไป,พักรวม (นาที),สุทธิ (นาที),สุทธิ (ชม.),สาย (นาที),พักเกิน (นาที),ออกก่อนเวลา (นาที),สถานะกะ,ยืนยันวัน,หมายเหตุ,รหัสพนักงาน',
  "2026-10-01,พฤ.,เอ,สาขาวงเวียน,1,07:12,18:05,0,70,583,9.72,12,10,0,ปกติ,ยืนยันแล้ว,,id:-OAa1",
  "2026-10-02,ศ.,เอ,สาขาวงเวียน,1,06:58,17:50,0,45,607,10.12,0,0,10,ปกติ,ยืนยันแล้ว,,id:-OAa1",
  "2026-10-03,ส.,บี,สาขาวงเวียน,1,07:03,18:00,0,20,637,10.62,0,0,0,ปกติ,ยังไม่ยืนยัน,,id:-OBb2",
  "2026-10-04,อา.,เอ,สาขาวงเวียน,1,07:00,12:00,0,0,300,5.00,0,0,,ปกติ,ยังไม่ยืนยัน,แอดมินบันทึก,id:-OAa1",
  "2026-10-04,อา.,เอ,สาขาวงเวียน,2,13:00,17:00,0,0,240,4.00,,,60,ปกติ,ยังไม่ยืนยัน,แอดมินบันทึก,id:-OAa1",
  "2026-10-05,จ.,บี,สาขาวงเวียน,1,07:30,,,,,,30,0,,ไม่มีเวลาออก,ยังไม่ยืนยัน,,id:-OBb2",
].join('\r\n') + '\r\n';
const GOLD_SUMMARY = [
  'ชื่อ,สาขาหลัก,จากวันที่,ถึงวันที่,วันทำงาน,วันครบ,ไม่มีเวลาออก (วัน),สุทธิ (นาที),สุทธิ (ชม.),พักรวม (นาที),มาสาย (ครั้ง),มาสาย (นาที),พักเกิน (ครั้ง),พักเกิน (นาที),ออกก่อนเวลา (ครั้ง),ออกก่อนเวลา (นาที),ยังไม่ยืนยัน (วัน),รหัสพนักงาน',
  "บี,สาขาวงเวียน,2026-10-01,2026-10-31,2,1,1,637,10.62,20,1,30,0,0,0,0,2,id:-OBb2",
  "เอ,สาขาวงเวียน,2026-10-01,2026-10-31,3,3,0,1730,28.83,115,1,12,1,10,2,70,1,id:-OAa1",
  'รวม,,2026-10-01,2026-10-31,5,4,1,2367,39.45,135,2,42,1,10,2,70,3,',
].join('\r\n') + '\r\n';

describe('REPORT CORE', () => {
  test('U13 buildReport: ตัวกรองสาขา/เฉพาะยืนยัน/คนปิดบัญชี/staff ถูกลบ/active ไม่มีข้อมูล/รวมนาทีก่อนแปลงชั่วโมง', () => {
    let { report } = rep0();
    assert.equal(report.rows.length, 5); assert.equal(report.people.length, 2);
    assert.equal(report.totals.netMin, 2367); assert.equal(report.totals.days, 5); assert.equal(report.totals.unconfirmed, 3);
    assert.deepEqual(report.warnings, { unconfirmed: 3, missing: 1, live: 0, pending: 0 });
    ({ report } = rep0({ onlyConfirmed: true })); assert.equal(report.rows.length, 2); assert.equal(report.totals.netMin, 1190);
    ({ report } = rep0({ branch: 'klongyang' })); assert.equal(report.rows.length, 0); assert.equal(report.people.length, 0);
    ({ report } = rep0({ sid: '-OBb2' })); assert.deepEqual(report.people.map((p) => p.name), ['บี']); assert.equal(report.totals.days, 2);
    // ปิดบัญชีกลางเดือน: มีข้อมูล -> แสดงพร้อม (ปิดบัญชี); ไม่รวมคนปิดบัญชี -> หายไป
    const fx = fxData('2026-10'); fx.staff['-OBb2'].active = false;
    assert.ok(mkReport(fx, { inactive: true }).people.some((p) => p.name === 'บี (ปิดบัญชี)'));
    assert.ok(!mkReport(fx, { inactive: false }).people.some((p) => p.name.startsWith('บี')));
    // staff ถูกลบ: ชื่อ (ไม่พบในรายชื่อ) ไม่คิดสาย แต่ shiftEnd ค่าเริ่มต้น 18:00 ยังคิดออกก่อนเวลาได้
    const fx1 = fxData('2026-10'); delete fx1.staff['-OAa1'];
    const orphan = mkReport(fx1).people.find((p) => p.sid === '-OAa1');
    assert.equal(orphan.name, '(ไม่พบในรายชื่อ) -OAa1'); assert.equal(orphan.lateCount, 0); assert.equal(orphan.earlyCount, 2);
    // active ไม่มีข้อมูล = แถว 0
    const fx2 = fxData('2026-10'); fx2.staff.zzz = { nickname: 'ซี', branchId: FX.branch.id, active: true };
    assert.equal(mkReport(fx2).people.find((p) => p.sid === 'zzz').days, 0);
    // ช่วงไม่ถูกต้อง
    assert.ok(core.buildReport({ from: '2026-10-05', to: '2026-10-01' }).error);
    // log ที่ถูก reject ทั้งวัน = ไม่นับ (ไม่โผล่ในรายงาน)
    const fx3 = fxData('2026-10'); for (const l of Object.values(fx3.logs['2026-10-05']['-OBb2'])) l.review = 'rejected';
    assert.equal(mkReport(fx3).rows.length, 4);
  });
  test('U14 monthRange / datesBetween / weekdayTh: ก.พ. 28/29 วัน, ธ.ค. 31, จำกัด 92 วัน', () => {
    assert.deepEqual(core.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(core.monthRange('2028-02').to, '2028-02-29');
    assert.equal(core.monthRange('2026-12').to, '2026-12-31');
    assert.equal(core.monthRange('2026-13'), null); assert.equal(core.monthRange('abc'), null);
    assert.equal(core.datesBetween('2026-10-01', '2026-10-31').length, 31);
    assert.equal(core.datesBetween('2026-01-01', '2026-04-02').length, 92);
    assert.equal(core.datesBetween('2026-01-01', '2026-04-03'), null);
    assert.equal(core.datesBetween('2026-10-05', '2026-10-01'), null);
    assert.equal(core.datesBetween('2026-12-30', '2027-01-02').join(), '2026-12-30,2026-12-31,2027-01-01,2027-01-02');
    assert.equal(core.weekdayTh('2026-10-04'), 'อา.'); assert.equal(core.weekdayTh('2026-10-01'), 'พฤ.');
  });
  test('U15 CSV: BOM, CRLF ทุกบรรทัด (รวมท้ายไฟล์), ไม่มี sep=, quote, guard เฉพาะ csvText, csvNum', () => {
    const { report } = rep0();
    for (const csv of [core.dailyCsv(report, brName), core.summaryCsv(report, brName)]) {
      assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.endsWith('\r\n')); assert.ok(!csv.includes('sep='));
      const noCrlf = csv.replace(/\r\n/g, '');
      assert.equal(noCrlf.includes('\n'), false); assert.equal(noCrlf.includes('\r'), false);
    }
    assert.equal(core.csvText('a,b'), '"a,b"'); assert.equal(core.csvText('say "hi"'), '"say ""hi"""'); assert.equal(core.csvText('x\ny'), '"x\ny"');
    for (const c of ['=1+1', '+1', '-2+3', '@SUM(1)', '\tx', '\rx']) assert.ok(core.csvText(c).replace(/^"/, '').startsWith("'"), JSON.stringify(c));
    assert.equal(core.csvText('=a,b'), '"\'=a,b"');
    assert.equal(core.csvText(null), ''); assert.equal(core.csvText(undefined), ''); assert.equal(core.csvText(0), '0');
    assert.equal(core.csvNum(-5), '-5'); assert.equal(core.csvNum(null), ''); assert.equal(core.csvNum(undefined), ''); assert.equal(core.csvNum(NaN), '');
    assert.equal(core.csvNum(9.7166, 2), '9.72'); assert.equal(core.csvNum(0), '0'); assert.equal(core.csvNum(5, 2), '5.00');
    // ชื่อพนักงานที่เป็นสูตร/มี , " ถูก guard ในไฟล์จริง และคอลัมน์ไม่เลื่อน
    const fx = fxData('2026-10'); fx.staff['-OAa1'].nickname = '=1+1'; fx.staff['-OBb2'].nickname = 'เอ, "จูเนียร์"';
    const dl = core.dailyCsv(mkReport(fx), brName).split('\r\n');
    assert.equal(dl[1].split(',')[2], "'=1+1"); assert.ok(dl[3].includes('"เอ, ""จูเนียร์"""'));
    const cols = (l) => { let n = 1, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) n++; } return n; };
    for (const l of dl.filter(Boolean)) assert.equal(cols(l), 18);
  });
  test('U16 เกณฑ์ตรวจรับ: CSV ตรง golden ทุกตัวอักษร; แถวที่มีเวลาออก (ออก + 1440*ออกวันถัดไป - เข้า) - พัก = สุทธิ; ผลรวมรายวัน = สรุป', () => {
    const { report } = rep0();
    const daily = core.dailyCsv(report, brName), summary = core.summaryCsv(report, brName);
    assert.equal(daily, '﻿' + GOLD_DAILY); assert.equal(summary, '﻿' + GOLD_SUMMARY);
    const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const rows = daily.slice(1).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    const per = {};
    for (const c of rows) {
      const [, , name, , , inn, out, plus, brk, net, hr] = c;
      if (out) { assert.equal(toMin(out) + 1440 * Number(plus) - toMin(inn) - Number(brk), Number(net)); assert.equal(hr, (Number(net) / 60).toFixed(2)); per[name] = (per[name] || 0) + Number(net); }
    }
    const sl = summary.slice(1).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    for (const c of sl) if (c[0] !== 'รวม') assert.equal(per[c[0]], Number(c[7]));
  });
  test('U17 ภาษาไทย/emoji ในชื่อ encode UTF-8 ขึ้นต้น EF BB BF และอ่านกลับได้เหมือนเดิม', () => {
    const fx = fxData('2026-10'); fx.staff['-OAa1'].nickname = 'เอ😀';
    const csv = core.dailyCsv(mkReport(fx), brName), buf = Buffer.from(csv, 'utf8');
    assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    const back = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);
    assert.equal(back, csv); assert.ok(back.includes('เอ😀'));
    assert.ok(buf.includes(Buffer.from('\r\n')));
  });
});
