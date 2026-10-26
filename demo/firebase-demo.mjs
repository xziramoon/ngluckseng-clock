// โหมดเดโม: แทน Firebase SDK (app/auth/database) ด้วยฐานข้อมูลจำลองในเครื่อง (localStorage)
// โหลดเฉพาะเมื่อเปิดหน้าด้วย ?demo=1 (clock.html / clock-master.html) ไม่ได้ตรวจสิทธิ์ (Security Rules) ใดๆ
// ใช้เฉพาะ API เท่าที่แอปทั้งสองใช้จริง ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น แท็บที่เปิดพร้อมกันเห็นการเปลี่ยนแปลงของกันและกันทันที (BroadcastChannel + storage event)

// แยกคีย์ localStorage/sessionStorage ที่แอปใช้ ('clock.last', 'clock.hist.*', 'clock.corrSeen', 'clock.skipInstall') ออกจากของจริงบน origin เดียวกัน
// โมดูลนี้โหลดเฉพาะตอน ?demo=1 จึงไม่กระทบหน้าใช้งานจริง
{
  const P = Storage.prototype, g = P.getItem, st = P.setItem, rm = P.removeItem;
  const map = (k) => (typeof k === 'string' && k.startsWith('clock.') ? 'clockdemo.ls.' + k : k);
  P.getItem = function (k) { return g.call(this, map(k)); };
  P.setItem = function (k, v) { return st.call(this, map(k), v); };
  P.removeItem = function (k) { return rm.call(this, map(k)); };
}
const KEY = 'clockdemo.db.v1';
const CH = 'clockdemo.channel';
export const DEMO_ADMIN = { email: 'admin@demo', password: 'demo1234', uid: 'demoAdminUid000000000000000000' };
export const DEMO_STAFF = [
  { sid: '-DemoStaffA01', nickname: 'เอ', pin: '1111' },
  { sid: '-DemoStaffB02', nickname: 'บี', pin: '2222' },
  { sid: '-DemoStaffC03', nickname: 'ซี', pin: '3333' }
];
export const DEMO_SHOP = { lat: 17.318062, lng: 99.832187 };

/* ---------- SHA-256 (sync) ให้ได้ค่าเดียวกับ crypto.subtle ใช้ seed PIN และเป็นตัวสำรองเมื่อหน้าไม่ใช่ https ---------- */
export function sha256Hex(text) {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length, total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296)); dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/* ---------- ที่เก็บข้อมูล ---------- */
let rawCache = null, mem = null;
function seed() {
  const now = Date.now();
  const base = { radius: 10, maxAccuracy: 30, graceFactor: 2, breakLimitMin: 60, active: true, updatedAt: now };
  const att = {
    admins: { [DEMO_ADMIN.uid]: true },
    settings: { lateGraceMin: 5 },
    branches: { wongwian: { name: 'สาขาวงเวียน', lat: DEMO_SHOP.lat, lng: DEMO_SHOP.lng, ...base }, klongyang: { name: 'สาขาแยกคลองยาง', ...base } },
    staff: {}, staffSecret: {}
  };
  for (const s of DEMO_STAFF) {
    att.staff[s.sid] = { nickname: s.nickname, branchId: 'wongwian', shiftStart: '07:00', shiftEnd: '18:00', active: true, createdAt: now };
    att.staffSecret[s.sid] = { pinHash: sha256Hex(s.sid + s.pin) };
  }
  return { attendance: att, __users: { [DEMO_ADMIN.email]: { uid: DEMO_ADMIN.uid, password: DEMO_ADMIN.password } } };
}
function load() {
  let raw = localStorage.getItem(KEY);
  if (raw == null) { mem = seed(); raw = JSON.stringify(mem); try { localStorage.setItem(KEY, raw); } catch (_) { } rawCache = raw; return mem; }
  if (raw !== rawCache) { try { mem = JSON.parse(raw); } catch (_) { mem = seed(); } rawCache = raw; }
  return mem;
}
function save(db) { rawCache = JSON.stringify(db); localStorage.setItem(KEY, rawCache); mem = db; }
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const split = (p) => String(p || '').split('/').filter(Boolean);

/** แปลง serverTimestamp, ตัด null/undefined/ออบเจ็กต์ว่าง (Firebase ไม่เก็บ) */
function resolveValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const r = resolveValue(x); if (r !== null) o[i] = r; }); return Object.keys(o).length ? o : null; }
    const o = {};
    for (const [k, x] of Object.entries(v)) { const r = resolveValue(x); if (r !== null) o[k] = r; }
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('ค่าตัวเลขไม่ถูกต้อง');
  return v;
}
function setAt(root, parts, value) {
  if (!parts.length) return;
  const stack = [root];
  for (let i = 0; i < parts.length - 1; i++) {
    let n = stack[i][parts[i]];
    if (n === undefined || n === null || typeof n !== 'object') { if (value === null) return; n = stack[i][parts[i]] = {}; }
    stack.push(n);
  }
  const last = parts[parts.length - 1];
  if (value === null) delete stack[stack.length - 1][last]; else stack[stack.length - 1][last] = value;
  for (let i = stack.length - 1; i > 0; i--) { if (Object.keys(stack[i]).length === 0) delete stack[i - 1][parts[i - 1]]; else break; }
}
const getAt = (root, parts) => { let n = root; for (const p of parts) { if (n === null || typeof n !== 'object' || !(p in n)) return null; n = n[p]; } return n === undefined ? null : n; };

/* ---------- รายการที่ฟังอยู่ + ซิงก์ข้ามแท็บ ---------- */
const listeners = new Set();
let bc = null;
try { bc = new BroadcastChannel(CH); bc.onmessage = (e) => { if (e.data === 'reset') { for (const k of Object.keys(sessionStorage)) if (k.startsWith('clockdemo.')) sessionStorage.removeItem(k); location.reload(); return; } notify(); }; } catch (_) { }
addEventListener('storage', (e) => { if (e.key === KEY) notify(); });
function notify() {
  for (const l of [...listeners]) {
    let v; try { v = evalRef(l.ref); } catch (_) { continue; }
    const s = JSON.stringify(v);
    if (l.first || s !== l.last) { l.first = false; l.last = s; try { l.cb(new Snapshot(l.ref, v)); } catch (e) { console.error(e); } }
  }
}
const changed = () => { try { bc && bc.postMessage('c'); } catch (_) { } setTimeout(notify, 0); };

/* ---------- ref / query / snapshot ---------- */
class Snapshot {
  constructor(ref, v) { this._v = v; this.ref = ref; this.key = ref.key; }
  val() { return clone(this._v); }
  exists() { return this._v !== null && this._v !== undefined; }
  hasChildren() { return this._v !== null && typeof this._v === 'object'; }
  child(p) { const cp = this.ref.path ? this.ref.path + '/' + p : p; return new Snapshot(mkRef(cp), getAt({ x: this._v }, ['x', ...split(p)])); }
  forEach(cb) { if (!this.hasChildren()) return false; for (const [k, v] of Object.entries(this._v)) { if (cb(new Snapshot(mkRef((this.ref.path ? this.ref.path + '/' : '') + k), v)) === true) return true; } return false; }
}
const mkRef = (path) => { const parts = split(path); return { _t: 'ref', path: parts.join('/'), key: parts.length ? parts[parts.length - 1] : null, db: null }; };
export function ref(db, path) { const r = mkRef(path || ''); r.db = db; return r; }
export const child = (r, p) => { const x = mkRef((r.path ? r.path + '/' : '') + p); x.db = r.db; return x; };

const CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPush = 0; const lastRand = [];
function pushId() {
  let now = Date.now(); const dup = now === lastPush; lastPush = now;
  const ts = new Array(8); for (let i = 7; i >= 0; i--) { ts[i] = CHARS.charAt(now % 64); now = Math.floor(now / 64); }
  let id = ts.join('');
  if (!dup) for (let i = 0; i < 12; i++) lastRand[i] = Math.floor(Math.random() * 64);
  else { let i = 11; for (; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0; lastRand[i]++; }
  for (let i = 0; i < 12; i++) id += CHARS.charAt(lastRand[i]);
  return id;
}
export function push(r, value) { const c = child(r, pushId()); if (value !== undefined) return Object.assign(set(c, value).then(() => c), c); return c; }

export const serverTimestamp = () => ({ '.sv': 'timestamp' });
export const orderByChild = (path) => ({ _c: 'orderByChild', path });
export const orderByKey = () => ({ _c: 'orderByKey' });
export const equalTo = (v) => ({ _c: 'equalTo', v });
export const startAt = (v) => ({ _c: 'startAt', v });
export const endAt = (v) => ({ _c: 'endAt', v });
export const limitToLast = (n) => ({ _c: 'limitToLast', n });
export const limitToFirst = (n) => ({ _c: 'limitToFirst', n });
export function query(r, ...cs) { return { _t: 'query', ref: r, path: r.path, key: r.key, db: r.db, cs: [...(r.cs || []), ...cs] }; }

function evalRef(r) {
  const base = r._t === 'query' ? r.ref : r;
  if (base.path === '.info/connected') return true;
  if (base.path === '.info/serverTimeOffset') return 0;
  const node = getAt(load(), split(base.path));
  if (r._t !== 'query' || !r.cs.length) return clone(node);
  if (node === null || typeof node !== 'object') return null;
  let ent = Object.entries(node);
  const o = r.cs.find((c) => c._c === 'orderByChild' || c._c === 'orderByKey') || { _c: 'orderByKey' };
  const eq = r.cs.find((c) => c._c === 'equalTo'), sa = r.cs.find((c) => c._c === 'startAt'), ea = r.cs.find((c) => c._c === 'endAt');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  if (o._c === 'orderByChild') {
    const cp = split(o.path);
    ent = ent.map(([k, v]) => [k, v, getAt({ x: v }, ['x', ...cp])]);
    if (eq) ent = ent.filter((e) => e[2] === eq.v);
    if (sa) ent = ent.filter((e) => e[2] !== null && e[2] >= sa.v);
    if (ea) ent = ent.filter((e) => e[2] !== null && e[2] <= ea.v);
    ent.sort((a, b) => cmp(a[2] === null ? -Infinity : a[2], b[2] === null ? -Infinity : b[2]) || cmp(a[0], b[0]));
  } else {
    if (eq) ent = ent.filter((e) => e[0] === eq.v);
    if (sa) ent = ent.filter((e) => e[0] >= sa.v);
    if (ea) ent = ent.filter((e) => e[0] <= ea.v);
    ent.sort((a, b) => cmp(a[0], b[0]));
  }
  const ll = r.cs.find((c) => c._c === 'limitToLast'), lf = r.cs.find((c) => c._c === 'limitToFirst');
  if (ll) ent = ent.slice(-ll.n); if (lf) ent = ent.slice(0, lf.n);
  if (!ent.length) return null;
  return clone(Object.fromEntries(ent.map((e) => [e[0], e[1]])));
}

/* ---------- เขียน/อ่าน ---------- */
export function set(r, value) {
  try { const db = load(); setAt(db, split(r.path), resolveValue(value)); save(db); changed(); return Promise.resolve(); }
  catch (e) { return Promise.reject(e); }
}
export function update(r, values) {
  try {
    const db = load();
    for (const [k, v] of Object.entries(values || {})) setAt(db, [...split(r.path), ...split(k)], resolveValue(v));
    save(db); changed(); return Promise.resolve();
  } catch (e) { return Promise.reject(e); }
}
export const remove = (r) => set(r, null);
export function get(r) { try { return Promise.resolve(new Snapshot(r._t === 'query' ? r.ref : r, evalRef(r))); } catch (e) { return Promise.reject(e); } }
export function onValue(r, cb) {
  const l = { ref: r, cb, last: null, first: true };
  listeners.add(l);
  setTimeout(() => { if (listeners.has(l)) notify(); }, 0);
  return () => listeners.delete(l);
}
export const off = (r) => { for (const l of [...listeners]) if (l.ref === r) listeners.delete(l); };
export const goOffline = () => { }; export const goOnline = () => { };

/* ---------- app / database ---------- */
export function initializeApp(config, name) { return { name: name || '[DEFAULT]', options: config || {} }; }
export const getDatabase = (app) => ({ app, _t: 'db' });
export const connectDatabaseEmulator = () => { };
export const connectAuthEmulator = () => { };

/* ---------- auth (แยกตามชื่อแอป: แอปลงเวลา = anonymous ติดเครื่อง, master = อีเมล/รหัสผ่านต่อแท็บ) ---------- */
export const indexedDBLocalPersistence = { type: 'LOCAL' };
export const browserSessionPersistence = { type: 'SESSION' };
const auths = new Map();
export function getAuth(app) {
  const name = (app && app.name) || '[DEFAULT]';
  if (auths.has(name)) return auths.get(name);
  const a = { app, _name: name, _persist: indexedDBLocalPersistence, _subs: new Set(), _user: undefined };
  const store = () => (a._persist === browserSessionPersistence ? sessionStorage : localStorage);
  const skey = 'clockdemo.auth.' + name;
  Object.defineProperty(a, 'currentUser', {
    get() {
      if (a._user === undefined) { try { a._user = JSON.parse(store().getItem(skey) || 'null'); } catch (_) { a._user = null; } }
      return a._user;
    }
  });
  a._set = (u) => {
    a._user = u;
    try { if (u) store().setItem(skey, JSON.stringify(u)); else store().removeItem(skey); } catch (_) { }
    for (const cb of [...a._subs]) setTimeout(() => cb(u), 0);
  };
  auths.set(name, a);
  return a;
}
export const setPersistence = (a, p) => { a._persist = p; a._user = undefined; return Promise.resolve(); };
export function onAuthStateChanged(a, cb) { a._subs.add(cb); setTimeout(() => { if (a._subs.has(cb)) cb(a.currentUser); }, 0); return () => a._subs.delete(cb); }
export function signInAnonymously(a) {
  let uid = localStorage.getItem('clockdemo.anonuid.' + a._name);
  if (!uid) { uid = 'anon' + pushId().replace(/[^A-Za-z0-9]/g, '') + Math.random().toString(36).slice(2, 8); localStorage.setItem('clockdemo.anonuid.' + a._name, uid); }
  const u = { uid, isAnonymous: true, email: null };
  a._set(u); return Promise.resolve({ user: u });
}
export function signInWithEmailAndPassword(a, email, password) {
  const rec = (load().__users || {})[String(email).trim().toLowerCase()];
  if (!rec || rec.password !== password) { const e = new Error('invalid credential'); e.code = 'auth/invalid-credential'; return Promise.reject(e); }
  const u = { uid: rec.uid, isAnonymous: false, email: String(email).trim().toLowerCase() };
  a._set(u); return Promise.resolve({ user: u });
}
export const signOut = (a) => { a._set(null); return Promise.resolve(); };

/** ล้างข้อมูลเดโมทั้งหมด (ใช้จาก demo.html) */
export function resetDemo() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('clockdemo.')) localStorage.removeItem(k);
  for (const k of Object.keys(sessionStorage)) if (k.startsWith('clockdemo.')) sessionStorage.removeItem(k);
  try { bc && bc.postMessage('reset'); } catch (_) { }
}

/* ---------- จำลองตำแหน่ง (เฉพาะ clock.html เดโม) ---------- */
export const demoGpsMode = () => localStorage.getItem('clockdemo.gps') || 'shop';       // 'real' | 'shop' | 'far'
const M_PER_DEG = 111320;
function fakeFix() {
  const jit = () => (Math.random() * 2 - 1) * 2.5 / M_PER_DEG;                        // สุ่ม +-2.5 ม. กันธง "พิกัดซ้ำ"
  const north = demoGpsMode() === 'far' ? 50 / M_PER_DEG : 0;
  return { coords: { latitude: DEMO_SHOP.lat + north + jit(), longitude: DEMO_SHOP.lng + jit(), accuracy: 8 + Math.random() * 4, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
}
const watches = new Map(); let wid = 0;
export const demoGeo = {
  getCurrentPosition(ok, err, opts) {
    if (demoGpsMode() === 'real') return navigator.geolocation.getCurrentPosition(ok, err, opts);
    setTimeout(() => ok(fakeFix()), 150);
  },
  watchPosition(ok, err, opts) {
    if (demoGpsMode() === 'real') return navigator.geolocation.watchPosition(ok, err, opts);
    const id = 'd' + (++wid);
    setTimeout(() => { if (watches.has(id)) ok(fakeFix()); }, 100);
    watches.set(id, setInterval(() => ok(fakeFix()), 1500));
    return id;
  },
  clearWatch(id) { if (typeof id === 'string') { clearInterval(watches.get(id)); watches.delete(id); } else navigator.geolocation.clearWatch(id); }
};

/* ---------- แถบแจ้งโหมดทดสอบ ---------- */
export function mountBanner(kind, onGps) {
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const bar = el('div', 'background:#9a3412;color:#fff;padding:8px 12px;font:600 14px/1.4 system-ui,sans-serif;text-align:center;position:relative;z-index:5000');
  bar.id = 'demoBanner';
  bar.append(el('div', '', 'โหมดทดสอบ — ข้อมูลอยู่ในเครื่องนี้เท่านั้น ไม่ได้ตรวจสิทธิ์ของ Firebase'));
  if (kind === 'clock') {
    const row = el('div', 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:6px');
    row.append(el('span', 'align-self:center;font-weight:700', 'ตำแหน่ง:'));
    const opts = [['real', 'GPS จริง'], ['shop', 'จำลอง: อยู่หน้าร้าน'], ['far', 'จำลอง: อยู่นอกร้าน 50 ม.']];
    const btns = [];
    const paint = () => btns.forEach(([m, b]) => { const on = demoGpsMode() === m; b.style.background = on ? '#fff' : 'rgba(255,255,255,.18)'; b.style.color = on ? '#9a3412' : '#fff'; });
    for (const [m, label] of opts) {
      const b = el('button', 'border:0;border-radius:8px;padding:8px 10px;font:700 14px system-ui,sans-serif;min-height:40px;cursor:pointer', label);
      b.type = 'button'; b.dataset.gps = m;
      b.addEventListener('click', () => { localStorage.setItem('clockdemo.gps', m); paint(); if (onGps) onGps(m); });
      btns.push([m, b]); row.append(b);
    }
    paint(); bar.append(row);
  }
  const a = el('a', 'color:#fff;margin-left:8px;text-decoration:underline', 'หน้าเดโม');
  a.href = './demo.html'; bar.firstChild.append(a);
  document.body.prepend(bar);
  if (kind === 'master') {
    const form = document.getElementById('loginForm');
    if (form) {
      const hint = el('div', 'background:#fef3c7;color:#92400e;padding:8px 10px;border-radius:8px;margin:10px 0;font-size:14px', `บัญชีเดโม: ${DEMO_ADMIN.email} / รหัสผ่าน ${DEMO_ADMIN.password}`);
      hint.id = 'demoHint'; form.before(hint);
      const em = document.getElementById('em'), pw = document.getElementById('pw');
      if (em) em.value = DEMO_ADMIN.email; if (pw) pw.value = DEMO_ADMIN.password;
    }
  }
  return bar;
}
