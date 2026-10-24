# แผนงานเฟส 1 (MVP): ระบบลงเวลาด้วย GPS ร้านอึ้งลักเส็ง

> ยึด `docs/clock-brief.md` เป็นหลัก แผนนี้ระบุว่าจะสร้างอะไร ตัดสินใจอะไรไปแล้ว และยังเหลือคำถามอะไร
> สถานะ: **รออนุมัติ** ยังไม่เริ่มเขียนโค้ด

## 0. สรุปการตัดสินใจหลัก

| เรื่อง | ที่เลือก | เหตุผลสั้นๆ |
|---|---|---|
| Repo | git repo ใหม่ที่ `D:\Claude\ngluckseng-clock` → GitHub `xziramoon/ngluckseng-clock` (public) → GitHub Pages | ผู้ใช้ตัดสินใจแล้ว; Pages บน repo private ต้องใช้แผนเสียเงิน |
| ตรวจ PIN | **แอดมินเทียบ hash เอง** (staff ส่ง `pinHash` ใน `deviceRequests/{uid}`, หน้า master เทียบกับ `staffSecret/`) ไม่ใช้การเทียบใน rules | การเทียบใน rules กลายเป็นช่องให้เดา PIN 4 หลักได้ (ดูข้อ 3) |
| `pinHash` | ย้ายไป `attendance/staffSecret/{staffId}/pinHash` ให้แอดมินอ่านได้คนเดียว | สิทธิ์อ่านของ RTDB ไหลลงลูกทั้งหมด จะซ่อนลูกบางตัวใน `staff/{id}` ไม่ได้ |
| ความถูกต้องของลำดับสถานะ | บังคับใน **rules** ด้วยการเขียน log + state พร้อมกันในครั้งเดียว (multi-path update) และให้แต่ละ path อ้างถึงกัน | ทำให้ rules ตรวจได้ทั้ง "สร้างใหม่เท่านั้น", `ts === now`, กันกดซ้ำ 30 วิ และลำดับ in→break→out |
| ธง suspect (เฟส 2) | **คำนวณและบันทึกตั้งแต่เฟส 1** (ยังไม่มี UI ตรวจ) | ใช้โค้ดราว 25 บรรทัด log เก่าจะมีธงครบตอนหน้า "รอตรวจ" ของเฟส 2 มาถึง |
| แท็บใน master | ทำแท็บ "รอตรวจ" ตั้งแต่ตอนนี้ แต่มีแค่ส่วน "คำขอผูกเครื่อง" | เฟส 2 เพิ่มส่วนใหม่เข้าไปได้เลย ไม่ต้องจัดหน้าใหม่ |
| ลิงก์ ประวัติ/แจ้งแก้เวลา | **ซ่อน** ในเฟส 1 | ไม่ให้มีปุ่มที่กดแล้วไม่ทำอะไร |
| ทดสอบ rules | เทสอัตโนมัติด้วย Firebase Emulator (`tests/`, devDependencies เท่านั้น) + รายการเคสสำหรับ Rules Playground | rules คือส่วนที่เสี่ยงที่สุด; ตัวแอปยังไม่ใช้ build tool ตามที่ brief กำหนด |

---

## 1. รายการไฟล์และโครงสร้างโฟลเดอร์

```
ngluckseng-clock/                 (git repo ใหม่, branch main)
  index.html                      redirect ไป ./clock.html (ให้ลิงก์ราก Pages ใช้ได้)
  clock.html                      แอปพนักงาน (PWA) ไฟล์เดียว CSS/JS inline
  clock-master.html               หน้าเจ้าของ ไฟล์เดียว
  manifest.json                   start_url "./clock.html", scope "./", display "standalone"
  sw.js                           service worker (ดูข้อ 6.2)
  icons/
    icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png (180x180)
  database.rules.json             ก้อน rules ของ "attendance" (อยู่ใน {"rules":{...}} พร้อมใช้)
  README.md                       คู่มือติดตั้งภาษาไทย (ดูข้อ 1.1)
  .nojekyll                       ไม่ให้ Pages ประมวลผลแบบ Jekyll
  .gitignore                      node_modules/, *.log, .firebase/
  docs/
    clock-brief.md                (มีอยู่แล้ว)
    plan-phase1.md                (ไฟล์นี้)
    testing.md                    เช็กลิสต์ทดสอบ + เคส Rules Playground (ภาษาไทย)
  tools/
    make-icons.mjs                สคริปต์ Node ไม่ต้องลงแพ็กเกจเพิ่ม (ใช้ zlib ในตัว) สร้าง PNG ไอคอน
  tests/
    package.json                  devDependencies: firebase-tools, @firebase/rules-unit-testing, firebase
    firebase.json                 ตั้งค่า emulator สำหรับ database + auth, rules → ../database.rules.json
    rules.test.mjs                เทส rules ด้วย node:test
```

หมายเหตุ
- `D:\Claude` เป็น git repo อีกตัว โฟลเดอร์นี้จะมี `.git` ของตัวเอง ตัว repo แม่จะเห็นเป็นโฟลเดอร์ที่ยังไม่ track ถ้ามีคนสั่ง `git add .` ที่ repo แม่ จะได้ gitlink (embedded repo) ติดไปด้วย **แผนนี้ไม่แตะ repo แม่** (ดูคำถามข้อ 8.5)
- ไอคอน: เครื่องนี้ไม่มี Python PIL จึงใช้ `tools/make-icons.mjs` วาดรูปนาฬิกาเรียบๆ (วงกลม + เข็ม บนพื้นเขียว) แล้วเขียน PNG เองด้วย `zlib` ของ Node
- เวอร์ชัน Firebase JS SDK: ล็อกเวอร์ชันเดียว ใช้ URL แบบ `https://www.gstatic.com/firebasejs/<VER>/firebase-*.js` code-builder ต้องเช็กเวอร์ชันเสถียรล่าสุดด้วย `npm view firebase version` แล้วใช้ค่าเดียวกันทั้ง 2 ไฟล์ HTML และใน `sw.js`
- Leaflet 1.9.4 จาก unpkg ใส่ SRI `integrity` + `crossorigin` (เฉพาะ master)

### 1.1 เนื้อหา README.md (ภาษาไทย)
1. ระบบนี้คืออะไร และลิงก์ของ 2 หน้า
2. **ขั้นที่ 0 ตรวจกฎเดิมก่อน (สำคัญมาก)** ดูข้อ 5.3 ต้องทำก่อนเปิด Anonymous Auth
3. Firebase Console → Authentication → Sign-in method → เปิด **Anonymous** และ **Email/Password**
4. Authentication → Settings → Authorized domains → เพิ่ม `xziramoon.github.io` (และ `localhost` ซึ่งมีอยู่แล้วตามปกติ)
5. สร้างแอดมินคนแรก: Authentication → Users → Add user (อีเมล + รหัสผ่าน) → คัดลอก **User UID** → Realtime Database → Data → เพิ่ม `attendance/admins/<UID>` = `true` (boolean ไม่ใช่ข้อความ) การเขียนใน Console ไม่ผ่าน rules จึงเพิ่มได้
6. รวม rules: เอาก้อน `"attendance": {...}` จาก `database.rules.json` ไปวางใน `"rules"` เดิม **ห้ามวางทับทั้งหน้า** ให้ Boss ตรวจก่อนกด Publish (ใช้แนวเดียวกับที่ทำ `pos_hero_inbox` ไว้)
7. เอา config: Project settings → Your apps → Web app (ถ้ายังไม่มีให้สร้าง) → คัดลอกค่าไปใส่ `FIREBASE_CONFIG` ด้านบนของ **ทั้งสองไฟล์** (ต้องมี `databaseURL` ของภูมิภาค เช่น `...asia-southeast1.firebasedatabase.app`) อธิบายว่า config ของเว็บไม่ใช่ความลับ สิ่งที่กันข้อมูลคือ rules
8. GitHub Pages: Settings → Pages → Deploy from branch `main` / `(root)` → ลิงก์ `https://xziramoon.github.io/ngluckseng-clock/clock.html`
9. (แนะนำ) Google Cloud Console → Credentials → จำกัด API key ให้ใช้ได้เฉพาะ HTTP referrer `https://xziramoon.github.io/*` และ `http://localhost:*/*`
10. เริ่มใช้: เปิด master → ล็อกอิน → "สร้าง 2 สาขาเริ่มต้น" → ไปยืนที่ร้านแล้วตั้งพิกัด → เพิ่มพนักงาน + PIN
11. วิธีติดตั้งบนมือถือ: iPhone (Safari → ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม → **เปิดจากไอคอนแล้วค่อยลงทะเบียน**) / Android Chrome (เมนู ⋮ → ติดตั้งแอป)
12. แก้ปัญหาที่พบบ่อย: ตำแหน่งถูกปฏิเสธ, iPhone ปิด "ตำแหน่งที่แม่นยำ", เปลี่ยนเครื่อง, ล้างข้อมูลเบราว์เซอร์แล้วต้องลงทะเบียนใหม่
13. วิธีอัปเดตเวอร์ชัน (เพิ่มเลข `CACHE_VERSION` ใน `sw.js`)

---

## 2. `clock.html` (แอปพนักงาน)

### 2.1 โครงหน้าและหลักการทำงาน
- `<script type="module">` ตัวเดียว import `firebase-app`, `firebase-auth`, `firebase-database` จาก gstatic
- `const FIREBASE_CONFIG = { apiKey: "PASTE_HERE", ... }` อยู่บนสุด ถ้ายังเป็นค่า placeholder ให้แสดงหน้า "ยังไม่ได้ตั้งค่า Firebase — ดู README"
- โหมด emulator: ถ้า `location.hostname === 'localhost'` และมี `?emu=1` ให้เรียก `connectAuthEmulator` / `connectDatabaseEmulator` (ทดสอบในเครื่องได้โดยไม่แตะฐานข้อมูลจริง)
- ฟอนต์ระบบเท่านั้น ไม่โหลด webfont ไม่มีโหมดมืด ไม่มีอนิเมชันนอกจากเครื่องหมายถูก
- โหลดเร็ว: แสดงโครงหน้าทันทีจาก cache ใน `localStorage` (`clock.last = {staffId, nickname, status}`) ระหว่างที่ Firebase กำลังเชื่อมต่อ แต่ปุ่มจะยังกดไม่ได้จนได้ข้อมูลจริง
- `setPersistence(auth, indexedDBLocalPersistence)` แล้วเรียก `navigator.storage?.persist?.()` เพื่อลดโอกาสที่เบราว์เซอร์ลบข้อมูลทิ้ง
- `signInAnonymously` ครั้งแรกเท่านั้น หลังจากนั้นใช้ uid เดิมผ่าน `onAuthStateChanged`
- listener ที่เปิดไว้ตลอด: `.info/connected`, `.info/serverTimeOffset`, `attendance/branches`, `attendance/settings`, `attendance/staff`, และหลังรู้ตัวตนแล้วเปิด `attendance/state/{sid}` กับ `attendance/logs/{workDate}/{sid}`
- `serverNow() = Date.now() + serverTimeOffset` ใช้กับทุกอย่างที่แสดงผลหรือคำนวณ (ตัวนับเวลาพัก, workDate, นับถอยหลัง 30 วิ) ส่วนเวลาที่บันทึกจริงใช้ `serverTimestamp()` เสมอ
- แสดงเวลาด้วย `Intl.DateTimeFormat('th-TH', {timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit', hour12:false})`
- `bangkokDate(ms)` = `new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(ms)` ได้รูปแบบ `YYYY-MM-DD`
- แสดงชื่อด้วย `textContent` เท่านั้น ห้ามใช้ `innerHTML` กับข้อมูลจากฐานข้อมูล

### 2.2 state machine ของหน้าจอ
```
BOOT
 ├─ ไม่มี config ─────────────────→ CONFIG_MISSING
 ├─ ไม่ใช่ HTTPS/ไม่มี geolocation ──→ UNSUPPORTED ("เปิดจากลิงก์ https เท่านั้น")
 └─ signIn ok → LOADING (รอ staff + branches + serverTimeOffset)
      → ระบุตัวตน: หา staff ที่ uid === auth.uid
         ├─ เจอ, active, deviceApproved → MAIN
         ├─ เจอ, active=false            → DISABLED ("บัญชีนี้ถูกปิด ติดต่อเจ้าของร้าน")
         └─ ไม่เจอ → อ่าน deviceRequests/{uid}
              ├─ status pending  → WAITING
              ├─ status rejected → REJECTED (ปุ่ม "ลงทะเบียนใหม่" ลบคำขอแล้วไป PICK)
              └─ ไม่มี            → (iOS ที่ยังไม่ได้ติดตั้งเป็นแอป → INSTALL_HINT) → PICK

REGISTER: PICK (ปุ่มชื่อเล่นใหญ่ของ staff ที่ active) → PIN (แป้น 4 หลักที่สร้างเอง, ปุ่ม ≥ 72px)
        → LOCATION_EXPLAIN ("ร้านใช้ตำแหน่งเฉพาะตอนกดปุ่ม เพื่อยืนยันว่าอยู่ที่ร้าน" + ปุ่ม "อนุญาต")
        → SUBMIT → WAITING (ฟัง staff/{sid}: ถ้า uid === ของเรา → MAIN อัตโนมัติ;
                            ฟัง deviceRequests/{uid}: status rejected → REJECTED)

MAIN (สถานะย่อยมาจาก state/{sid}):
  OFF      : ยังไม่มี state | status off | (status done และ workDate ≠ วันนี้)  → ปุ่มเขียว "เข้างาน"
  WORKING  : ปุ่มส้ม "เริ่มพัก" + ปุ่มรองแดงขนาดกลาง "ออกงาน" (กดแล้วต้องยืนยันอีกครั้ง)
  ON_BREAK : ปุ่มฟ้า "กลับจากพัก" + ตัวนับเวลาพักตัวใหญ่ (เป็นสีส้มเมื่อพักรวมวันนี้ > breakLimitMin)
  DONE     : สรุป "ทำงาน 8 ชม. 05 น. · พัก 55 นาที" ปุ่มเป็นสีเทา
  STALE    : working/on_break และ serverNow − inAt > 16 ชม. → "กะก่อนยังไม่ได้กดออกงาน — แจ้งเจ้าของให้แก้"
             แล้วแสดงปุ่มเขียว "เข้างาน" (rules อนุญาตกรณีนี้)
  ถ้าการผูกเครื่องถูกยกเลิกขณะเปิดอยู่ (staff.uid ≠ ของเรา) → REVOKED ("เครื่องนี้ถูกยกเลิก — ลงทะเบียนใหม่")

ACTION: กดปุ่ม → [ออกงานต้องยืนยันก่อน] → ตรวจ offline / 30 วิ → LOCATING ("กำลังหาตำแหน่ง...")
        → EVALUATE → REFUSED (เหตุผล + วิธีแก้ ค้างไว้จนกดปิดหรือกดใหม่)
                   → SAVING ("กำลังบันทึก...") → SUCCESS (2 วิ) → MAIN
                                              → SAVE_ERROR
```

### 2.3 อัลกอริทึม geofence (ตอนกดปุ่ม)
1. **เก็บตัวอย่างตำแหน่ง:** เรียก `getCurrentPosition({enableHighAccuracy:true, timeout:10000, maximumAge:0})` ต่อกันทีละครั้ง จนได้ 3 ค่า หรือครบ 6 วิแล้วมีอย่างน้อย 1 ค่า หรือชนเพดาน 12 วิ ระหว่างนี้ fix ใหม่ที่มาจาก `watchPosition` ซึ่งเปิดอยู่แล้วก็นับรวมด้วย (fix ที่ timestamp ≥ เวลาเริ่มกด) เลือกค่าที่ `accuracy` น้อยที่สุด
2. **สาขาที่ใกล้สุด:** ดูทุกสาขาที่ `active !== false` และมี lat/lng เป็นตัวเลข คำนวณ `haversine(lat1,lng1,lat2,lng2)` (R = 6371008.8 ม.) แล้วเลือกระยะน้อยสุด ถ้าไม่มีสาขาไหนตั้งพิกัดเลย → "ร้านยังไม่ได้ตั้งตำแหน่ง — แจ้งเจ้าของ"
3. **ตัดสิน** (d = ระยะ, a = accuracy, R = radius, M = maxAccuracy, g = graceFactor):
   - `d ≤ R && a ≤ M` → **ok** (ไม่มี `flag`)
   - `(R < d ≤ R·g && a ≤ M)` หรือ `(d ≤ R && M < a ≤ 2M)` → **borderline** (`flag:"borderline"`)
   - ที่เหลือทั้งหมด (รวมกรณีที่ทั้งระยะและ accuracy อยู่ในโซนชายขอบพร้อมกัน) → **ไม่บันทึก** การตีความนี้เข้มกว่า brief เล็กน้อย ดูคำถามข้อ 8.3
   - เหตุผลที่แสดงตอนไม่บันทึก: ถ้า `a > 2M` → แจ้งเรื่องสัญญาณ, ถ้าไม่ใช่ → แจ้งระยะ
4. **ธง suspect** (คำนวณที่ client; ใส่ทับ borderline ได้) พร้อม `flagReason`:
   - `a < 3` (รวม 0) → `"acc"`
   - `lat.toFixed(6), lng.toFixed(6)` ซ้ำกับ `state.lastLat/lastLng` → `"same"`
   - `branchId ≠ state.lastBranchId` และ `serverNow − state.since < 10 นาที` → `"hop"`
   - ใส่ `clientTs: Date.now()` เพิ่มใน log ด้วย (เฟส 2 จะใช้ดูว่ามีการแก้นาฬิกาเครื่องหรือไม่)
   - ข้อจำกัด: เป็นแค่การคาดการณ์ฝั่ง client คนที่ตั้งใจโกงแก้ไขได้ ใช้ช่วยคัดเรื่องให้เจ้าของดูเท่านั้น
5. ใน log เก็บค่า lat/lng ปัดเป็นทศนิยม 6 ตำแหน่ง ส่วน accuracy และ distance ปัดเป็นจำนวนเต็มเมตร

### 2.4 แถบระยะสด (ทุก 5 วิ)
- เริ่ม `watchPosition({enableHighAccuracy:true, maximumAge:5000})` ได้เมื่อ `navigator.permissions.query({name:'geolocation'})` ตอบ `granted` แล้วเท่านั้น (ป้องกันไม่ให้ระบบเด้งถามสิทธิ์ก่อนที่จะได้อธิบาย) ถ้าได้ `prompt` ให้แสดงการ์ดอธิบาย + ปุ่ม "อนุญาตตำแหน่ง"
- หยุด watch ตอน `visibilitychange` เป็น hidden และเริ่มใหม่ตอนกลับมา (ไม่ติดตามตำแหน่งเบื้องหลัง)
- `setInterval(5000)` เอา fix ล่าสุดมาประเมินด้วยฟังก์ชันเดียวกับข้อ 2.3 ข้อ 3:
  เขียว "● อยู่ในร้าน (ห่าง 12 ม.)" / ส้ม "● ใกล้ขอบเขตร้าน (ห่าง 95 ม.)" / แดง "● อยู่นอกร้าน (ห่าง 240 ม.)" / เทา "กำลังหาตำแหน่ง..." หรือ "ยังไม่ได้อนุญาตตำแหน่ง" ถ้า fix เก่ากว่า 20 วิ ให้เป็นสีเทา
- แถบนี้ใช้ดูเฉยๆ ปุ่มยังกดได้ทุกครั้ง แต่ทุกครั้งที่กดจะอ่านตำแหน่งใหม่ (ข้อ 2.3) ทำให้ "นอกรัศมีกดไม่ได้" เป็นจริงตอนกดเสมอ
- ระยะแสดงเป็นเมตรเต็ม ถ้า ≥ 1000 แสดง "1.2 กม."

### 2.5 การบันทึก (atomic)
```js
const d   = type === 'in' ? bangkokDate(serverNow()) : state.workDate;
const lid = push(ref(db, `attendance/logs/${d}/${sid}`)).key;
await update(ref(db, 'attendance'), {
  [`logs/${d}/${sid}/${lid}`]: { type, ts: serverTimestamp(), lat, lng, accuracy, distance,
                                 branchId, uid: auth.currentUser.uid, source: 'app',
                                 clientTs: Date.now(), ...(flag && {flag, flagReason}) },
  [`state/${sid}`]: { status: NEXT[type], workDate: d, since: serverTimestamp(),
                      inAt: type === 'in' ? serverTimestamp() : state.inAt,
                      lastLogId: lid, lastLat: lat, lastLng: lng, lastBranchId: branchId }
});
```
- `NEXT = {in:'working', break_start:'on_break', break_end:'working', out:'done'}`
- ทุก `serverTimestamp()` ใน write เดียวกันจะได้ค่า `now` เท่ากัน ซึ่ง rules ต้องอาศัยข้อนี้
- RTDB ไม่เก็บค่า `null` จึงไม่ใส่ `flag:null` ลงไป ถ้าไม่มี key `flag` แปลว่า "ปกติ" (ต่างจาก brief แค่ตรงรูปแบบการเก็บ)
- **กันกดเบิ้ล 30 วิ:** ฝั่ง client ถ้า `serverNow() − state.since < 30000` ให้แสดงนับถอยหลัง "เพิ่งกดไปเมื่อสักครู่ — รออีก 25 วินาที" และ rules ก็บังคับซ้ำอีกชั้น นอกจากนี้ปุ่มจะถูกล็อกระหว่าง LOCATING/SAVING
- **ข้ามเที่ยงคืน:** workDate กำหนดตอน `in` เท่านั้น จากนั้นเหตุการณ์ break/out ใช้ `state.workDate` เสมอ แม้จะเลยเที่ยงคืนไปแล้ว ไทม์ไลน์ฟัง `logs/{state.workDate}/{sid}`
- **กะเดียวต่อวันทำงาน:** หลัง `done` จะ `in` ใหม่ได้เมื่อวันกรุงเทพฯ เปลี่ยนแล้วเท่านั้น (ดูคำถามข้อ 8.2)
- **สำเร็จ:** `navigator.vibrate?.(200)` (iOS ไม่สั่น ไม่เป็นไร) + overlay เต็มจอ เครื่องหมายถูกเขียว ≥ 160px + "เข้างาน 08:02" เวลาที่แสดงอ่านจาก `get(logRef)` ซึ่งเป็นเวลาจริงของเซิร์ฟเวอร์ ถ้าอ่านไม่ทันใน 1 วิให้ใช้ `serverNow()` แทน แสดง 2 วิ
- **เน็ตหลุดตอนกำลังส่ง:** RTDB จะเข้าคิวรอส่งและติด timestamp เป็นเวลาที่ไปถึงเซิร์ฟเวอร์จริง ถ้ายังไม่สำเร็จใน 8 วิ ให้แสดง "เน็ตช้า กำลังส่ง... อย่าปิดแอป" และไม่ให้กดซ้ำจนกว่าจะได้ผล

### 2.6 ข้อความเมื่อทำไม่ได้ (ภาษาพูด ไม่มีศัพท์เทคนิค)
| กรณี | ข้อความ |
|---|---|
| สิทธิ์ตำแหน่งถูกปฏิเสธ (code 1) | "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง" + วิธีแยกตามเครื่อง: iPhone "การตั้งค่า > ความเป็นส่วนตัวฯ > บริการหาตำแหน่งที่ตั้ง > Safari/เว็บไซต์ > ขณะใช้งานแอป"; Android "แตะรูปแม่กุญแจข้างลิงก์ > สิทธิ์ > ตำแหน่ง > อนุญาต" + ปุ่ม "ลองใหม่" |
| หาตำแหน่งไม่ได้ (code 2) | "หาตำแหน่งไม่ได้ — เปิด 'ตำแหน่ง' ของมือถือ แล้วกดใหม่" |
| หมดเวลา (code 3 / ไม่ได้สักค่า) | "หาตำแหน่งนานเกินไป — ออกไปใกล้ประตูหรือที่โล่ง แล้วกดใหม่" |
| accuracy > 2M | "สัญญาณตำแหน่งยังไม่ชัด — ออกไปใกล้ประตูหรือที่โล่ง แล้วกดใหม่" |
| accuracy > 1000 ม. (iPhone ปิดตำแหน่งที่แม่นยำ) | "มือถือปิด 'ตำแหน่งที่แม่นยำ' อยู่ — เปิดในการตั้งค่าตำแหน่งของเว็บนี้" |
| ไกลเกินไป | "อยู่ห่างร้าน 240 ม. — เดินเข้าใกล้ร้านอีกนิด" |
| ร้านยังไม่ตั้งพิกัด | "ร้านยังไม่ได้ตั้งตำแหน่ง — แจ้งเจ้าของ" |
| ยังไม่อนุมัติเครื่อง | "รอเจ้าของอนุมัติเครื่องนี้ — เมื่ออนุมัติแล้วหน้านี้จะเปลี่ยนเอง" |
| เจ้าของไม่อนุมัติ | "เจ้าของยังไม่อนุมัติ — ตรวจว่าเลือกชื่อและใส่รหัสถูก แล้วลงทะเบียนใหม่" |
| เครื่องถูกยกเลิก | "เครื่องนี้ถูกยกเลิกการผูกแล้ว — ลงทะเบียนใหม่" |
| บัญชีถูกปิด | "บัญชีนี้ถูกปิดใช้งาน — ติดต่อเจ้าของร้าน" |
| ออฟไลน์ (`.info/connected` = false) | แถบเหลือง "ไม่มีอินเทอร์เน็ต — ต่อเน็ตแล้วกดใหม่" และปุ่มเป็นสีเทา |
| กดซ้ำภายใน 30 วิ | "เพิ่งกดไปเมื่อสักครู่ — รออีก N วินาที" |
| เซิร์ฟเวอร์ปฏิเสธการเขียน | "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งเจ้าของ" (แล้วโหลด state ใหม่) |
| ไม่ใช่ HTTPS / เบราว์เซอร์เก่า | "เปิดจากลิงก์ที่ร้านส่งให้ (https) ด้วย Chrome หรือ Safari" |

### 2.7 การ์ดแนะนำติดตั้งบน iOS (INSTALL_HINT)
ถ้าเป็น iOS และ `navigator.standalone !== true` ให้แสดงรูปขั้นตอน "แชร์ → เพิ่มไปยังหน้าจอโฮม → เปิดจากไอคอน" **ก่อนลงทะเบียน** เหตุผลคือแอปบนหน้าจอโฮมของ iOS แยกที่เก็บข้อมูลจาก Safari ถ้าลงทะเบียนใน Safari แล้วค่อยติดตั้ง จะได้ uid ใหม่และต้องขออนุมัติอีกรอบ มีลิงก์เล็ก "ใช้ในเบราว์เซอร์ต่อ" ให้ข้ามได้

---

## 3. การผูกเครื่องด้วย Anonymous Auth และการตรวจ PIN

### 3.1 แนวทางที่เลือก: ส่ง hash มาในคำขอ แล้วให้แอดมินเทียบ
1. แอดมินสร้างพนักงานใน master แล้วตั้ง PIN 4 หลัก หน้า master คำนวณ `SHA-256(staffId + PIN)` (hex ตัวพิมพ์เล็ก ใช้ `crypto.subtle`) เขียนไปที่ `staffSecret/{sid}/pinHash` (แอดมินอ่าน/เขียนได้คนเดียว) ส่วน `staff/{sid}` **ไม่มี** pinHash
2. พนักงานเลือกชื่อแล้วใส่ PIN มือถือคำนวณ hash แบบเดียวกัน แล้วเขียน
   `deviceRequests/{uid} = { staffId, pinHash, requestedAt: serverTimestamp(), status:'pending', userAgent }`
   (เขียนได้เฉพาะ uid ตัวเอง อ่านได้เฉพาะตัวเองกับแอดมิน)
3. หน้า master แท็บรอตรวจ แสดงคำขอพร้อมป้าย **"PIN ถูกต้อง ✔"** หรือ **"PIN ไม่ตรง ✘"** (เทียบ `req.pinHash === staffSecret[sid].pinHash` ในเบราว์เซอร์ของแอดมิน) พร้อมข้อมูลเครื่องและเวลาที่ขอ ถ้า staff คนนี้ผูกเครื่องอื่นอยู่แล้ว ให้มีป้าย "จะแทนเครื่องเดิม"
4. **อนุมัติ** = multi-path update เดียว:
   `staff/{sid}/uid = reqUid`, `staff/{sid}/deviceApproved = true`, `staff/{sid}/deviceApprovedAt = serverTimestamp()`, `deviceRequests/{reqUid} = null` และถ้า uid นี้เคยผูกกับ staff อื่น ให้เคลียร์ของคนนั้นใน write เดียวกัน ปุ่มอนุมัติจะเป็นสีเทาถ้า PIN ไม่ตรง (แอดมินยังกด "อนุมัติทั้งที่ PIN ไม่ตรง" ได้ แต่ต้องยืนยันอีกครั้ง)
5. **ไม่อนุมัติ** = `deviceRequests/{uid}/status = 'rejected'` มือถือเห็นทันทีและให้ลงทะเบียนใหม่ได้ (ตัวเองลบคำขอแล้วสร้างใหม่ได้)
6. มือถือฟัง `staff/{sid}` อยู่ เมื่อ `uid` ตรงกับของตัวเองจะเข้า MAIN เองแบบ realtime

### 3.2 ทำไมไม่เทียบใน rules
ถ้าเขียน rule ว่า `newData.child('pinHash').val() === root.child('attendance/staffSecret/'+sid+'/pinHash').val()` แล้วการเขียนสำเร็จหรือไม่สำเร็จจะบอกได้ทันทีว่า PIN ถูกหรือผิด PIN 4 หลักมีแค่ 10,000 แบบ สคริปต์ที่ล็อกอินแบบ anonymous ยิงคำขอวนเดาได้ภายในไม่กี่นาที (rules จำกัดจำนวนครั้งไม่ได้ ส่วน uid anonymous ก็สร้างใหม่ได้ไม่จำกัด) แบบที่เลือก **ไม่มีอะไรบอกผลกลับไปที่ client** และแอดมินเป็นด่านตรวจสุดท้ายอยู่แล้ว ข้อเสียคือถ้าใส่ PIN ผิดจะรู้ตอนแอดมินกดไม่อนุมัติ แต่ทุกกรณีก็ต้องรอแอดมินอนุมัติอยู่แล้ว จึงแทบไม่ต่างในทางปฏิบัติ

### 3.3 ข้อจำกัดที่ยอมรับ
- SHA-256 ของ PIN 4 หลักถอดย้อนกลับได้ทันทีถ้า hash หลุด จึงต้องเก็บ `staffSecret` และ `deviceRequests` ให้แอดมินอ่านได้เท่านั้น หน้าที่ของ PIN คือ "ยืนยันว่าเลือกชื่อตัวเอง" ไม่ใช่รหัสผ่านที่แข็งแรง
- ใครก็ตั้งคำขอขยะได้ด้วย uid anonymous ใหม่ๆ แอดมินกดไม่อนุมัติ/ลบได้ (ภายหลังเปิด App Check เพิ่มได้)
- ผูกได้ 1 เครื่องต่อพนักงาน และ 1 เครื่องต่อพนักงาน 1 คน (ใช้มือถือร่วมกันไม่ได้) ถ้าอนุมัติเครื่องใหม่ เครื่องเก่าจะหมดสิทธิ์ทันที

---

## 4. `clock-master.html` (เฟส 1)

### 4.1 การเข้าใช้
- หน้าแรกมีแค่ฟอร์มอีเมล + รหัสผ่าน ไม่มีการอ่านข้อมูลก่อนล็อกอิน และ rules ก็ปฏิเสธอยู่แล้ว
- `setPersistence(auth, browserSessionPersistence)` ปิดเบราว์เซอร์ = ออกจากระบบ
- หลังล็อกอิน: `get(attendance/admins/{uid})` ถ้าได้ `true` เข้าแอป ถ้าได้ค่าอื่นหรือ PERMISSION_DENIED ให้แสดง "บัญชีนี้ไม่มีสิทธิ์เจ้าของร้าน" แล้ว `signOut`
- ข้อความผิดพลาดภาษาไทย: รหัสผิด/ไม่มีบัญชี (`auth/invalid-credential`), ลองหลายครั้งเกิน (`auth/too-many-requests`), ไม่มีเน็ต
- **ล็อกเอาต์เมื่อไม่ใช้งาน 30 นาที:** ฟัง `pointerdown, keydown, wheel, mousemove (throttle)` เก็บเวลาล่าสุด ตรวจทุก 30 วิ ถ้าเกินกำหนดให้ `signOut` แล้วกลับหน้าล็อกอินพร้อมข้อความ "ออกจากระบบอัตโนมัติเพราะไม่ได้ใช้งาน 30 นาที" ตอนเหลือ 1 นาทีให้เตือนก่อน
- **ปุ่มล็อกหน้าจอ** = `signOut` ทันที แล้วล้าง DOM ของข้อมูลทั้งหมด (ปิด listener ทุกตัว)
- แสดงข้อมูลที่มาจากพนักงาน (`userAgent`, ชื่อ) ด้วย `textContent` เท่านั้น **กัน XSS** เพราะ `userAgent` เป็นค่าที่พนักงานพิมพ์มาเองได้

### 4.2 แท็บ (ด้านซ้าย)
1. **สถานะวันนี้**: ฟัง `staff`, `state`, `branches`, `settings`, `logs/{วันนี้}`, `logs/{เมื่อวาน}` (เผื่อกะข้ามคืน) การ์ดแยกตามสาขา โดยถ้ามีกะวันนี้ใช้ `state.lastBranchId` ถ้าไม่มีใช้ `staff.branchId`
   - ยังไม่มา (เทา) / ทำงาน ตั้งแต่ HH:MM (เขียว) / พักอยู่ + ตัวนับ (ฟ้า เป็นส้มเมื่อพักรวมเกิน `breakLimitMin`) / ออกแล้ว + ชม.สุทธิ (เทาเข้ม) / ลืมออกงาน (แดง ใช้เงื่อนไข STALE)
   - **มาสาย** (ขอบส้ม + "สาย 12 นาที") เมื่อ ts ของ `in` > `shiftStart` + `settings.lateGraceMin` (ค่าเริ่มต้น 5) ตามเวลากรุงเทพฯ ของ workDate นั้น
   - ติดป้าย "ใกล้ขอบเขต" / "น่าสงสัย" เล็กๆ ถ้า log วันนี้มี flag (หน้าตรวจละเอียดเป็นของเฟส 2)
   - ตัวนับใช้ `serverNow()` อัปเดตทุก 1 วิ
2. **รอตรวจ** (ตัวเลขแจ้งเตือนบนแท็บ): เฟส 1 มีแค่ส่วน "คำขอผูกเครื่อง" ตามข้อ 3.1 ปุ่ม ✔ อนุมัติ / ✘ ไม่อนุมัติ / ลบ
3. **พนักงาน**: ตารางชื่อเล่น, สาขาหลัก, เวลาเข้ากะ, สถานะบัญชี, สถานะเครื่อง
   - เพิ่ม: ชื่อเล่น, สาขาหลัก (dropdown), เวลาเข้ากะ (`HH:MM`), PIN 4 หลัก (ใส่ 2 ครั้ง) → `sid = push(ref(db,'attendance/staff')).key` → multi-path `{staff/sid, staffSecret/sid}`
   - แก้ไขชื่อ/สาขา/กะ, ปิด/เปิดบัญชี (`active`) โดย **ไม่ลบ** staff เพราะ log อ้างถึง sid
   - รีเซ็ต PIN (เขียน `staffSecret` ใหม่), ยกเลิกผูกเครื่อง (`uid` = null, `deviceApproved` = false) ทั้งสองอย่างต้องกดยืนยัน
4. **ตั้งค่าสาขา**:
   - ถ้า `branches` ว่าง ให้แสดงปุ่ม "สร้าง 2 สาขาเริ่มต้น" ซึ่งจะเขียน `wongwian` {name:"สาขาวงเวียน"} และ `klongyang` {name:"สาขาแยกคลองยาง"} ด้วยค่า radius 80, maxAccuracy 60, graceFactor 1.5, breakLimitMin 60, active true โดย **ยังไม่ใส่ lat/lng** (ตอนนี้ไม่รู้พิกัดจริง แอปพนักงานจะข้ามสาขาที่ยังไม่มีพิกัด) และ `settings/lateGraceMin = 5`
   - ต่อสาขา: Leaflet + OSM tiles (ใส่ attribution) ถ้ายังไม่มีพิกัดให้กึ่งกลางที่ประเทศไทย zoom 6 มีหมุด `draggable` + `L.circle` ที่ปรับตามสไลเดอร์รัศมี 30–300 แบบ `input` event ทันที ช่อง lat/lng (วางข้อความ "13.xxxx, 100.xxxx" จาก Google Maps ได้) ปุ่ม "ใช้ตำแหน่งเครื่องนี้" (อ่าน 3 ครั้ง เลือกค่าที่ดีสุด และแสดง "แม่นยำ ±N ม." พร้อมเตือนว่าคอม PC มักไม่แม่น แนะนำให้เปิดหน้านี้จากมือถือตอนยืนในร้าน) ช่อง maxAccuracy, graceFactor, breakLimitMin และปุ่มบันทึก (ปุ่มจะกดได้เมื่อมีการเปลี่ยนค่า)
   - ส่วน "ค่าทั่วไป": `lateGraceMin`
   - แอปพนักงานฟัง `branches` แบบ realtime ค่าใหม่จึงมีผลทันทีโดยไม่ต้องรีเฟรช (เกณฑ์ตรวจรับข้อ 8)

---

## 5. `database.rules.json`

### 5.1 ตัวย่อ (ใช้ในเอกสารนี้เท่านั้น ไฟล์จริงต้องเขียนเต็ม เพราะ JSON ไม่มีมาโคร)
```
ADMIN       = auth != null && auth.token.firebase.sign_in_provider !== 'anonymous'
              && root.child('attendance/admins/' + auth.uid).val() === true
OWNS(x)     = auth != null && root.child('attendance/staff/' + x + '/uid').val() === auth.uid
STAFF_OK(x) = OWNS(x) && root.child('attendance/staff/' + x + '/active').val() === true
              && root.child('attendance/staff/' + x + '/deviceApproved').val() === true
S           = root.child('attendance/state/' + $sid)                                   // ค่า state ก่อนเขียน
N           = newData.parent().parent().parent().parent().child('state/' + $sid)       // ค่า state หลังเขียน (ดูจาก logs/$d/$sid/$lid)
DATE_RE     = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
KEY_RE      = /^[-_A-Za-z0-9]{1,40}$/
STALE_MS    = 57600000   (16 ชม.)
```

### 5.2 rules ที่จะเขียน (ชั้น `attendance` ไม่มี `.read`/`.write` ทุกอย่างจึงถูกปฏิเสธเป็นค่าตั้งต้น)
```
attendance
├─ admins            .read: ADMIN
│   └─ $uid          .read: auth.uid === $uid            (ให้ตรวจสิทธิ์ตัวเองได้)
│                    .write: ADMIN   .validate: newData.isBoolean()
├─ settings          .read: auth != null   .write: ADMIN
│   ├─ lateGraceMin  isNumber, 0..120
│   └─ $other        .validate: false
├─ branches          .read: auth != null
│   └─ $bid          .write: ADMIN
│                    .validate: $bid.matches(/^[a-z0-9_-]{1,32}$/)
│                               && hasChildren(name,radius,maxAccuracy,graceFactor,breakLimitMin)
│       name string 1..40 | lat number −90..90 | lng number −180..180 | radius 30..300
│       maxAccuracy 5..500 | graceFactor 1..3 | breakLimitMin 0..600 | active bool | updatedAt number
│       $other false
├─ staff             .read: auth != null                 (ไม่มี pinHash แล้ว)
│   └─ $sid          .write: ADMIN
│                    .validate: $sid.matches(KEY_RE) && hasChildren(nickname,branchId,shiftStart,active)
│       nickname string 1..20
│       branchId string && newData.parent().parent().parent().child('branches/' + newData.val()).exists()
│       shiftStart matches /^([01][0-9]|2[0-3]):[0-5][0-9]$/
│       active bool | uid string ≤128 | deviceApproved bool | deviceApprovedAt number | createdAt number
│       $other false                                   (ห้ามมี pinHash ใน node นี้)
├─ staffSecret       .read: ADMIN   .write: ADMIN
│   └─ $sid          .validate: hasChildren(pinHash);  pinHash matches /^[0-9a-f]{64}$/;  $other false
├─ deviceRequests    .read: ADMIN
│   └─ $uid          .read: ADMIN || auth.uid === $uid
│                    .write: ADMIN || (auth != null && auth.uid === $uid
│                              && (!newData.exists() || !data.exists() || data.child('status').val() === 'rejected'))
│                    .validate: hasChildren(staffId,pinHash,requestedAt,status)
│       staffId     isString && root.child('attendance/staff/' + newData.val() + '/active').val() === true
│       pinHash     matches /^[0-9a-f]{64}$/
│       requestedAt isNumber && (newData.val() === now || ADMIN || newData.val() === data.val())
│       status      newData.val() === 'pending' || (ADMIN && newData.val() === 'rejected')
│       userAgent   isString && length ≤ 300
│       $other false
├─ state             .read: ADMIN
│   └─ $sid          .read: ADMIN || OWNS($sid)
│                    .write: ADMIN || (STAFF_OK($sid) && newData.exists())        ← พนักงานลบ state ไม่ได้
│                    .validate: hasChildren(status,workDate,since) && (ADMIN || (
│                          hasChildren(inAt,lastLogId)
│                       && newData.child('since').val() === now
│                       && newData.parent().parent().child('logs/' + newData.child('workDate').val() + '/' + $sid
│                              + '/' + newData.child('lastLogId').val() + '/ts').val() === now ))
│       status enum off|working|on_break|done | workDate matches DATE_RE | since number | inAt number
│       lastLogId matches KEY_RE | lastLat −90..90 | lastLng −180..180 | lastBranchId string ≤32 | $other false
├─ logs              .read: ADMIN
│   └─ $d
│       └─ $sid      .read: ADMIN || OWNS($sid)
│           └─ $lid  .write: ADMIN || (STAFF_OK($sid) && !data.exists() && newData.exists()
│                                 && root.child('attendance/days/' + $d + '/' + $sid + '/confirmed').val() !== true)
│                    .validate: $d.matches(DATE_RE) && hasChildren(type,ts,branchId,source) && (ADMIN || STAFF_LOG)
│       type      enum in|break_start|break_end|out
│       ts        isNumber && (newData.val() === now || ADMIN)
│       lat −90..90 | lng −180..180 | accuracy 0..100000 | distance 0..20000000
│       branchId  isString && root.child('attendance/branches/' + newData.val()).exists()
│       uid       isString && (newData.val() === auth.uid || ADMIN)
│       source    newData.val() === 'app' || (ADMIN && newData.val() === 'admin')
│       flag      borderline | suspect      flagReason string ≤100      clientTs number
│       review    ADMIN && (approved | rejected)
│       $other false
├─ days              .read: ADMIN   .write: ADMIN       (เฟส 2 แต่วาง rules ไว้ก่อน)
│   └─ $d/$sid       confirmed bool | confirmedBy string | confirmedAt number | $other false
├─ corrections       .read: ADMIN || (query.orderByChild === 'staffId' && query.equalTo != null
│                          && root.child('attendance/staff/' + query.equalTo + '/uid').val() === auth.uid)
│                    .indexOn: [staffId, status]                          (เฟส 2)
│   └─ $cid          .read: ADMIN || (data.exists() && OWNS(data.child('staffId').val()))
│                    .write: ADMIN || (!data.exists() && newData.exists()
│                              && STAFF_OK(newData.child('staffId').val()))
│                    .validate: hasChildren(staffId,workDate,type,time,reason,status,createdAt)
│       status    newData.val() === 'pending' || ADMIN       (ค่า approved/rejected ใส่ได้เฉพาะแอดมิน)
│       workDate DATE_RE | type enum | time HH:MM | reason string 1..300
│       createdAt isNumber && (newData.val() === now || ADMIN) | decidedBy string | decidedAt number | $other false
└─ audit             .read: ADMIN                       (เฟส 2)
    └─ $aid          .write: ADMIN && !data.exists()    ← แม้แต่แอดมินก็แก้/ลบ audit ไม่ได้
                     .validate: hasChildren(path,by,at) && newData.child('by').val() === auth.uid
                                && newData.child('at').val() === now      [before/after เป็นข้อมูลอิสระ]
```

**STAFF_LOG** (ตรวจตอนพนักงานสร้าง log ซึ่ง N ต้องเขียนมาพร้อมกันใน update เดียว):
```
newData.child('source').val() === 'app'
&& newData.hasChildren(['lat','lng','accuracy','distance','uid'])
&& N.child('lastLogId').val() === $lid
&& N.child('since').val() === now
&& (!S.exists() || now - S.child('since').val() >= 30000)                    <- กันกดซ้ำ 30 วิ
&& (
   ( type === 'in'
     && ( !S.exists() || S.status === 'off'
          || (S.status === 'done' && S.workDate !== $d)
          || ((S.status === 'working' || S.status === 'on_break') && now - S.inAt > 57600000) )
     && N.status === 'working' && N.workDate === $d && N.inAt === now )
|| ( type === 'break_start' && S.status === 'working'  && S.workDate === $d
     && N.status === 'on_break' && N.workDate === $d && N.inAt === S.inAt )
|| ( type === 'break_end'   && S.status === 'on_break' && S.workDate === $d
     && N.status === 'working'  && N.workDate === $d && N.inAt === S.inAt )
|| ( type === 'out'         && S.status === 'working'  && S.workDate === $d
     && N.status === 'done'     && N.workDate === $d && N.inAt === S.inAt )
)
```
(`S.status` ในที่นี้ย่อมาจาก `S.child('status').val()` ตัวอื่นก็เช่นเดียวกัน)

สิ่งที่การออกแบบนี้รับประกัน: (1) log เขียนได้ครั้งเดียว แก้/ลบไม่ได้ (2) `ts` เป็นเวลาเซิร์ฟเวอร์ (3) state เปลี่ยนได้ต่อเมื่อมี log ใหม่ที่ `ts === now` ใน write เดียวกันเท่านั้น และ log ทุกตัวต้องทำให้ state เปลี่ยนตามลำดับที่ถูกต้อง (4) ใส่ 2 log ใน write เดียวไม่ได้ เพราะ `lastLogId` ตรงกับ log ได้ตัวเดียว (5) ออกงานระหว่างพักไม่ได้ (6) กดซ้ำใน 30 วิไม่ได้ (7) วันที่ยืนยันแล้วเขียนเพิ่มไม่ได้

เพิ่ม `".indexOn"` เฉพาะที่ใช้ query จริง (corrections) เท่านั้น

### 5.3 การรวมเข้ากับ rules เดิมของร้าน (ต้องอยู่ใน README และให้ Boss ทำเอง)
1. Console → Realtime Database → Rules → คัดลอกกฎเดิมทั้งหมดเก็บไว้ก่อน (สำรอง)
2. **ตรวจชั้นราก:** ถ้ามี `".read"` หรือ `".write"` อยู่ที่ระดับ `"rules"` โดยตรง (เช่น `true` หรือ `"auth != null"`) rules ของ attendance จะ**ไม่มีผล** เพราะสิทธิ์ใน RTDB ไหลลงลูกทั้งหมดและเพิกถอนที่ชั้นล่างไม่ได้ ต้องย้ายสิทธิ์นั้นลงไปไว้ที่ node ของ STOCK MASTER แต่ละตัวก่อน
3. **ตรวจ `auth != null` ใน node อื่น (สำคัญมาก):** พอเปิด Anonymous Auth แล้ว ใครก็ได้บนอินเทอร์เน็ตกลายเป็น `auth != null` ได้ ถ้ากฎของ STOCK MASTER ใช้แค่ `auth != null` ต้องเปลี่ยนเป็น
   `auth != null && auth.token.firebase.sign_in_provider !== 'anonymous'` **ก่อน**เปิด Anonymous
4. วางก้อน `"attendance": {...}` เป็น sibling กับ node เดิมใน `"rules"` (เหมือนที่ทำกับ `pos_hero_inbox`)
5. ทดสอบใน Rules Playground ตาม `docs/testing.md` แล้วค่อยกด Publish

### 5.4 ข้อจำกัดของ RTDB rules ที่ต้องรู้
- สิทธิ์อ่าน/เขียนไหลลงลูก ซ่อนลูกบางตัวไม่ได้ (จึงแยก `staffSecret`) และ rules ไม่ใช่ตัวกรองข้อมูล: query ต้องขอเฉพาะ path ที่มีสิทธิ์ เช่นพนักงานอ่าน `logs/{d}` ทั้งวันไม่ได้ ต้องอ่าน `logs/{d}/{sid}`
- ตรวจไม่ได้ว่า lat/lng/accuracy เป็นของจริง แอปปลอมตำแหน่ง (mock location) หรือสคริปต์ยิงตรงก็ผ่าน geofence ได้ rules บังคับได้แค่ชนิดข้อมูล ช่วงค่า และเวลาเซิร์ฟเวอร์ ส่วนที่เหลือพึ่งธง suspect + การตรวจของเจ้าของ (และอนาคตคือเซลฟี่/QR)
- rules แปลง `now` เป็นวันที่ไม่ได้ จึงตรวจได้แค่ว่า `$d` ของ `in` อยู่ในรูปแบบวันที่ แต่ตรวจไม่ได้ว่าเป็น "วันนี้" พนักงานที่แก้โค้ดเองอาจเลือก `$d` เป็นวันอื่นได้ ทางแก้คือหน้า master/รายงานยึด `ts` เป็นหลัก และเฟส 2 ให้ติดธงเมื่อ `bangkokDate(ts) ≠ workDate` (ยกเว้นกะข้ามคืน)
- จำกัดจำนวนครั้งทั่วไปไม่ได้ มีแค่ตัวกันเวลา 30 วิ
- ค่าคงที่ 16 ชม. (STALE) และ 30 วิ ฝังอยู่ใน rules ถ้าจะเปลี่ยนต้องแก้ทั้ง rules และ HTML
- `.validate` ไม่ทำงานตอนลบ จึงกันการลบไว้ที่ `.write` (`newData.exists()`)
- write ที่เข้าคิวตอนออฟไลน์จะได้ `now` เป็นเวลาที่ไปถึงเซิร์ฟเวอร์ (ข้อ 2.5)
- แอดมินผ่านด่านลำดับสถานะทั้งหมด (สำหรับแก้ไขในเฟส 2) ถ้าแอดมินแก้ state ต้องใส่ `inAt` ด้วยเสมอ ไม่อย่างนั้นการกดครั้งถัดไปของพนักงานจะไม่ผ่าน (`N.inAt === S.inAt`)
- `staff` และ `branches` อ่านได้โดยทุกคนที่ล็อกอินแบบ anonymous (ชื่อเล่นและพิกัดร้านจึงไม่ใช่ความลับ ซึ่งยอมรับได้)

---

## 6. edge case และความเสี่ยง

### 6.1 iOS Safari / PWA
- แอปบนหน้าจอโฮมแยกที่เก็บข้อมูลจาก Safari → uid ต่างกัน → ใช้การ์ด INSTALL_HINT (ข้อ 2.7)
- iOS อาจถามสิทธิ์ตำแหน่งใหม่ทุกครั้งที่เปิดแอปจากหน้าจอโฮม ต้องรองรับ permission `prompt` ซ้ำได้โดยไม่ค้าง
- iOS ไม่รองรับ `navigator.vibrate` จึงแสดงผลสำเร็จทางภาพแทน (เครื่องหมายถูกใหญ่ใช้ได้อยู่แล้ว)
- "ตำแหน่งที่แม่นยำ" ปิดอยู่ → accuracy เป็นระดับกิโลเมตร → มีข้อความเฉพาะ (ข้อ 2.6)
- `navigator.permissions` ใช้ได้ใน Safari 16+ ถ้าไม่มีให้ถือว่าเป็น `prompt`
- ใช้ `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`, `viewport-fit=cover` + `env(safe-area-inset-*)`
- Safari ลบข้อมูลเว็บที่ไม่ได้ใช้นาน 7 วัน (ITP) แต่ยกเว้นแอปบนหน้าจอโฮม เป็นอีกเหตุผลที่ต้องติดตั้งก่อนใช้

### 6.2 service worker กับการอัปเดตค่า
- `CACHE_VERSION = 'clock-v1'` precache: `./clock.html`, `./manifest.json`, icons
- `clock.html` และ navigation ใช้ **network-first** timeout 3 วิ ถ้าไม่ทันใช้ cache (deploy ใหม่จึงมีผลทันทีเมื่อมีเน็ต)
- ไฟล์ SDK จาก gstatic (URL มีเลขเวอร์ชันซึ่งไม่เปลี่ยน) ใช้ **cache-first**
- **ไม่ยุ่ง**กับ request ไป `*.firebaseio.com`, `*.firebasedatabase.app`, `*.googleapis.com` (auth) และ `clock-master.html` ส่วนค่ารัศมีมาทาง websocket ของ RTDB ไม่ผ่าน SW จึงไม่ถูก cache ค้าง
- `skipWaiting()` + `clients.claim()` เพื่อลบ cache เก่าตอน activate
- master ไม่ลงทะเบียน SW และไม่มี manifest

### 6.3 นาฬิกาเครื่องเพี้ยน
- เวลาที่บันทึกมาจาก `serverTimestamp()` + rules `ts === now` แก้นาฬิกาเครื่องแล้วไม่มีผล
- ค่าที่แสดงผลใช้ `serverTimeOffset` ค่านี้คำนวณตอนเชื่อมต่อ ถ้าผู้ใช้แก้นาฬิกาขณะแอปเปิดอยู่ ตัวนับบนจอจะเพี้ยนจนกว่าจะเชื่อมต่อใหม่ แต่ข้อมูลที่บันทึกยังถูกต้อง
- `clientTs` เก็บไว้ให้เฟส 2 ใช้หาความต่างระหว่าง `clientTs` กับ `ts`

### 6.4 หลายเครื่อง / ล้างข้อมูล / เปลี่ยนเครื่อง
- ล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง = uid ใหม่ → ลงทะเบียน + รออนุมัติใหม่ เครื่องเก่าหมดสิทธิ์หลังอนุมัติเครื่องใหม่
- พนักงาน 2 คนใช้เครื่องเดียวกันไม่ได้ ถ้าแอดมินอนุมัติ uid ที่ผูกกับคนอื่นอยู่ ระบบจะเตือนและย้ายให้

### 6.5 ปิดบัญชีพนักงาน
- `active=false` → rules ปฏิเสธการเขียนทันที แอปแสดง DISABLED ถ้าปิดกลางกะ state จะค้าง (master แสดงเป็น "ลืมออกงาน" หรือ "ทำงาน") เฟส 2 ให้แอดมินปิดกะแทน
- คนที่ถูกปิดบัญชีจะไม่อยู่ในรายชื่อหน้าลงทะเบียน และ `deviceRequests` ก็ต้องให้ staff เป็น `active`

### 6.6 อื่นๆ
- ลืมกดออกงาน: ใช้เงื่อนไข STALE 16 ชม. (ข้อ 2.2) เพื่อไม่ให้ติดตาย
- สาขาถูกปิดหรือลบระหว่างกะ: `branchId` ของ log ต้องมีอยู่จริงตอนเขียน ฝั่ง master ใช้ `active:false` แทนการลบ (ปุ่มลบสาขาไม่มีในเฟส 1)
- มือถือ 2 แท็บกดพร้อมกัน: rules ปล่อยผ่านแค่ write แรก อีก write ถูกปฏิเสธด้วยกฎ 30 วิ/ลำดับสถานะ แอปแสดงข้อความแล้วโหลด state ใหม่
- **ความเสี่ยงสูงสุด:** rules เดิมของ STOCK MASTER (ข้อ 5.3 ข้อ 2–3) ต้องตรวจก่อนเปิด Anonymous Auth

---

## 7. แผนทดสอบ

### 7.1 ทดสอบในเครื่อง
- เสิร์ฟไฟล์: `npx http-server D:\Claude\ngluckseng-clock -p 8080 -c-1` (หรือ `python -m http.server 8080`) เปิด `http://localhost:8080/clock.html?emu=1` เพราะ localhost นับเป็น secure context จึงใช้ geolocation, crypto.subtle และ SW ได้
- Emulator: `cd tests && npm i && npx firebase emulators:start --only auth,database --project demo-clock` (ต้องใช้ Java และ firebase-tools รุ่นใหม่อาจต้องใช้ JDK 21 ขึ้นไป เครื่องนี้มี JDK 17 ถ้าไม่ผ่านให้ลง JDK 21) ข้อมูลเริ่มต้นสร้างผ่านหน้า master ที่ `?emu=1`
- จำลองตำแหน่ง: Chrome DevTools → More tools → Sensors → Location (ใส่พิกัดในและนอกรัศมี)
- PWA: DevTools → Application → Manifest / Service workers, Lighthouse PWA, Network → Offline
- ทดสอบบนมือถือจริงต้องเป็น HTTPS: push ไป GitHub Pages (หรือใช้ `npx cloudflared tunnel --url http://localhost:8080` ชั่วคราว)
- เทส rules อัตโนมัติ: `cd tests && npm test` (= `firebase emulators:exec --only database --project demo-clock "node --test"`)

### 7.2 เคสเทส rules (`tests/rules.test.mjs` และใช้ซ้ำใน Rules Playground)
| # | ผู้ใช้ | การกระทำ | ผลที่ต้องได้ |
|---|---|---|---|
| R1 | ไม่ล็อกอิน | read `attendance/staff`, `attendance/logs` | ปฏิเสธ |
| R2 | anonymous | read `staff`, `branches` | ผ่าน |
| R3 | anonymous | read `staffSecret`, `admins`, `deviceRequests`, `state`, `logs/d` | ปฏิเสธ |
| R4 | anonymous ที่ยังไม่อนุมัติ | update log+state ของ sid ใดๆ | ปฏิเสธ (เกณฑ์ตรวจรับ) |
| R5 | พนักงานที่อนุมัติแล้ว | in ที่ถูกต้อง (log+state, ts=now) | ผ่าน |
| R6 | พนักงาน | log โดยไม่มี state / state โดยไม่มี log | ปฏิเสธ |
| R7 | พนักงาน | `ts` = เลขที่กำหนดเอง | ปฏิเสธ |
| R8 | พนักงาน | เขียนทับ/ลบ log เดิม, ลบ state | ปฏิเสธ (เกณฑ์ตรวจรับ) |
| R9 | พนักงาน | break_start ภายใน 30 วิหลัง in | ปฏิเสธ |
| R10 | พนักงาน | out ขณะ on_break; in ขณะ working (ยังไม่ stale); in ซ้ำหลัง done วันเดียวกัน | ปฏิเสธ |
| R11 | พนักงาน | in → break_start → break_end → out (ระยะห่าง > 30 วิ) | ผ่านทุกขั้น |
| R12 | พนักงาน A | เขียน log/state ของ B | ปฏิเสธ |
| R13 | พนักงานที่ active=false | in | ปฏิเสธ |
| R14 | พนักงาน | `source:'admin'`, `review:'approved'`, ฟิลด์แปลกปลอม | ปฏิเสธ |
| R15 | anonymous | สร้าง deviceRequests/{ตัวเอง} pending; ของ uid อื่น; ตั้ง status rejected/approved เอง | ผ่าน / ปฏิเสธ / ปฏิเสธ |
| R16 | anonymous | เขียน `staff/{sid}/uid` เอง | ปฏิเสธ |
| R17 | แอดมิน (password) | อ่าน/เขียนทุก node, อนุมัติเครื่อง | ผ่าน |
| R18 | uid ที่อยู่ใน admins แต่ล็อกอินแบบ anonymous | อ่าน staffSecret | ปฏิเสธ |
| R19 | พนักงาน | in บนวันที่ `days/d/sid/confirmed = true` | ปฏิเสธ |
| R20 | แอดมิน | แก้/ลบ audit เดิม | ปฏิเสธ |
| R21 | แอดมิน | สร้าง staff ที่มี `pinHash` อยู่ใน `staff/` | ปฏิเสธ |

หมายเหตุ: Rules Playground จำลอง multi-path update ไม่ได้ (จำลองได้ทีละ path) เคส R5/R6/R11 จึงยืนยันได้เฉพาะในเทสด้วย emulator ใน Playground ให้ทดสอบ R1–R4, R7, R8, R12–R18
การทดสอบเวลา 30 วิ/16 ชม. ใน emulator ให้ seed state ด้วยสิทธิ์แอดมินโดยตั้ง `since`/`inAt` ย้อนหลัง แทนการรอจริง

### 7.3 เทียบกับเกณฑ์ตรวจรับ (brief ข้อ 8)
| เกณฑ์ | วิธีทดสอบ | เฟส |
|---|---|---|
| ติดตั้งเป็นแอปเต็มจอ Android/iPhone | ติดตั้งจาก Pages บนเครื่องจริง 2 ระบบ เปิดจากไอคอนแล้วไม่มีแถบ URL | 1 |
| ลงทะเบียนจนเข้างานได้ภายใน 1 นาที | ให้คนที่ไม่เคยเห็นแอปลองเอง จับเวลา (รวมเวลาที่แอดมินกดอนุมัติ) | 1 |
| นอกรัศมีกดไม่ได้และเห็นระยะ / ในรัศมีกดได้ | Sensors ใน DevTools + เดินจริงที่ร้าน | 1 |
| เปลี่ยนนาฬิกามือถือแล้วเวลาไม่เปลี่ยน | ตั้งนาฬิกาเครื่องเลื่อนไป +2 ชม. กดเข้างาน แล้วดู ts ใน master/Console + เทส R7 | 1 |
| เครื่องที่ยังไม่อนุมัติเขียน log ไม่ได้ | R4 (Playground + emulator) | 1 |
| พนักงานแก้/ลบ log ย้อนหลังไม่ได้ | R8 | 1 |
| master ไม่ล็อกอินอ่านข้อมูลไม่ได้ | เปิดหน้าโดยไม่ล็อกอิน + R1 + ล็อกอินด้วยบัญชีที่ไม่ใช่แอดมิน | 1 |
| ปรับรัศมีแล้วมือถือใช้ค่าใหม่ทันที | เปิดมือถือค้างไว้ แก้รัศมีใน master แถบระยะต้องเปลี่ยนสีภายใน 5 วิ | 1 |
| CSV/ชม.สุทธิ | — | 3 |

---

## 8. คำถามที่ต้องให้เจ้าของตอบ (มีค่าเริ่มต้นแล้ว ไม่ตอบก็ทำต่อได้)
1. **กฎ Firebase เดิมของ STOCK MASTER**: มี `.read`/`.write` ที่ชั้นรากไหม และใช้ `auth != null` ไหม? → *ค่าเริ่มต้น:* ทำ rules ตามแผนนี้ และให้ README บังคับตรวจก่อนเปิด Anonymous **ข้อนี้ไม่ขวางการสร้างงาน แต่ขวางการเปิดใช้จริง**
2. **ทำงานได้กะเดียวต่อวัน** (หลังออกงานแล้วเข้าใหม่วันเดียวกันไม่ได้ ต้องให้เจ้าของแก้ในเฟส 2) → *ค่าเริ่มต้น:* ใช่ และใช้ STALE 16 ชม. สำหรับคนที่ลืมกดออกงาน
3. **โซน borderline**: ถ้าระยะเกินรัศมี **และ** สัญญาณไม่ชัดพร้อมกัน → *ค่าเริ่มต้น:* ไม่ให้บันทึก (เข้มกว่า) ถ้าอยากให้บันทึกเป็น borderline ได้ก็แก้แค่บรรทัดเดียว
4. **ธง suspect ทำตั้งแต่เฟส 1** (เก็บข้อมูลอย่างเดียว ยังไม่มีหน้าตรวจ) → *ค่าเริ่มต้น:* ทำ
5. **repo แม่ `D:\Claude`**: เพิ่ม `ngluckseng-clock/` ลงใน `.gitignore` ของ repo แม่ไหม (กันการ add ติดไปเป็น embedded repo) → *ค่าเริ่มต้น:* ไม่แตะ repo แม่

---

## 9. ลำดับงานสำหรับ code-builder
1. **ตั้ง repo**: `git init -b main` ที่ `D:\Claude\ngluckseng-clock` ตรวจว่า `git rev-parse --show-toplevel` ชี้มาที่โฟลเดอร์นี้ ไม่ใช่ `D:\Claude` แล้วสร้าง `.gitignore`, `.nojekyll`, `index.html` (redirect)
2. **database.rules.json** ตามข้อ 5.2 เขียน expression เต็ม ตรวจว่า JSON parse ได้
3. **tests/** (`package.json`, `firebase.json`, `rules.test.mjs`) ครอบคลุม R1–R21 รันให้ผ่าน ถ้า emulator รันไม่ได้เพราะเวอร์ชัน Java ให้รายงานกลับ ห้ามข้าม
4. **tools/make-icons.mjs** → `icons/*.png` แล้วตามด้วย **manifest.json** (ชื่อ "ลงเวลา อึ้งลักเส็ง", short_name "ลงเวลา", theme/background สีขาว/เขียว, icons รวม maskable)
5. **sw.js** ตามข้อ 6.2
6. **clock-master.html**: ล็อกอิน/ตรวจแอดมิน/idle 30 นาที/ปุ่มล็อก → แท็บพนักงาน → ตั้งค่าสาขา (seed + Leaflet) → รอตรวจ (คำขอผูกเครื่อง) → สถานะวันนี้ ทำก่อน clock.html เพราะต้องใช้สร้างข้อมูลทดสอบ
7. **clock.html**: boot/auth/listener → ลงทะเบียน A (+ INSTALL_HINT) → หน้าหลัก B + state machine → geofence + แถบสด → บันทึก atomic + กัน 30 วิ + ผลสำเร็จ → ข้อความ error ครบตามข้อ 2.6 → ลงทะเบียน SW
8. **README.md** (ข้อ 1.1) + **docs/testing.md** (ข้อ 7)
9. **ทดสอบเองครบวง** บน emulator: สร้างสาขา/พนักงานใน master → ลงทะเบียนใน clock → อนุมัติ → in/break/out โดยใช้ตำแหน่งจำลองทั้งในและนอกรัศมี → เปลี่ยนรัศมีแบบสด แล้วรายงานผลพร้อมสิ่งที่ยังทดสอบไม่ได้ (เครื่องจริง iOS/Android)

จากนั้น: **code-reviewer** (เน้นความถูกต้องของ Security Rules: ทางเลี่ยงลำดับสถานะ, การยิง multi-path, การลบ, การยกระดับสิทธิ์ผ่าน anonymous, XSS จาก `userAgent`, การรั่วของ pinHash) → แก้ตามรีวิว → **git-publisher**: commit แรกบน `main` ของ repo ใหม่ (repo ว่างเปิด PR ไม่ได้) → `gh repo create xziramoon/ngluckseng-clock --public --source . --push` → เปิด Pages (`gh api -X POST repos/xziramoon/ngluckseng-clock/pages -f "source[branch]=main" -f "source[path]=/"`) **ทุกขั้นที่ publish ต้องให้ผู้ใช้ยืนยันก่อน**
