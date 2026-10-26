// Service worker ของแอปพนักงาน (clock.html)  อัปเดตเวอร์ชัน: เพิ่มเลข CACHE_VERSION
const CACHE_VERSION = 'clock-v2';
const SDK_CACHE = 'clock-sdk-v1';
const PRECACHE = ['./clock.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, timeoutMs) {
  // คีย์ cache ตัด query ออก (เช่น ?emu=1) กัน cache โตไม่จำกัด
  const u = new URL(req.url); u.search = ''; u.hash = '';
  const key = new Request(u.toString());
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(key).then((hit) => hit || caches.match('./clock.html'));
    const timer = setTimeout(() => { if (!settled) fallback().then((r) => { if (r && !settled) { settled = true; resolve(r); } }); }, timeoutMs);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(key, copy)); }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      if (!settled) fallback().then((r) => { settled = true; resolve(r || Response.error()); });
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ไม่ยุ่งกับ Firebase / Google auth
  if (/(\.firebaseio\.com|\.firebasedatabase\.app|\.googleapis\.com)$/.test(url.hostname)) return;

  // ไฟล์ SDK จาก gstatic (URL มีเลขเวอร์ชัน) cache-first
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(
      caches.open(SDK_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })))
    );
    return;
  }

  if (url.origin !== location.origin) return;
  // master ไม่ผ่าน SW
  if (url.pathname.endsWith('/clock-master.html')) return;

  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/clock.html');
  if (isNav) { e.respondWith(networkFirst(req, 3000)); return; }

  // ไฟล์อื่นของแอป (manifest, icons): cache ก่อน แล้วค่อยเน็ต
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
