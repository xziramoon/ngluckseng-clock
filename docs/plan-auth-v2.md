# แผนงาน Auth v2: พนักงานสมัครเอง (ชื่อผู้ใช้ + รหัสผ่าน) + ผูกมือถือด้วยกุญแจประจำเครื่อง

> **แก้ไขหลังตรวจความปลอดภัย:** รูปแบบ devproof เป็น `devproof/{sid}/{k}: serverTimestamp()` (ใบเดียว ชื่อ path คือกุญแจ) แทน `{k, at}` เพราะรูปแบบเดิมเขียนเฉพาะ `at` โดยไม่รู้ k ได้ (ใช้ k เก่าที่ค้างอยู่) แอดมินล้าง `devproof/{sid}` ตอนอนุมัติเครื่องใหม่/ยกเลิกผูก/เชื่อมบัญชี

> ต่อจากเฟส 1-3 (`4cbdb30`) และงานเดโม (`bfde3b5` commit แล้วระหว่างเขียนแผนนี้ แก้ README ด้วย) แทนที่ **plan-phase1.md ข้อ 3** (Anonymous Auth + PIN) ทั้งหมด ส่วนอื่นของเฟส 1-3 คงเดิม
> สถานะ: **รออนุมัติ** ยังไม่เริ่มเขียนโค้ด ยังไม่มอบงาน
> งาน DEMO MODE (`demo/`, `demo.html`, `?demo=1`) commit แล้วที่ `bfde3b5` ข้อ 9 ระบุสิ่งที่ shim/seed/how-to ต้องเปลี่ยน ก่อนเริ่มให้ตรวจว่า agent เดโมไม่ได้แก้ต่อแล้ว (ข้อ 12 ขั้น 1)

## 0. สรุปการตัดสินใจหลัก

| เรื่อง | ที่เลือก | เหตุผลสั้นๆ |
|---|---|---|
| วิธีล็อกอินพนักงาน | Firebase **Email/Password** ใช้อีเมลสังเคราะห์ `<username>@staff.ngluckseng.invalid` | ไม่ต้องมี Admin SDK หรืออีเมลจริง; `.invalid` เป็น TLD ที่สงวนไว้ (RFC 2606/6761) จึงไม่มีเมลไปถึงใครแน่นอน; Auth บังคับให้อีเมลไม่ซ้ำ จึงได้ชื่อผู้ใช้ที่ไม่ซ้ำไปด้วย |
| ชื่อผู้ใช้ | `^[a-z0-9_]{3,20}$` แปลงเป็นตัวเล็กและตัดช่องว่างก่อนใช้เสมอ ชื่อเล่นภาษาไทยเก็บแยก (1-20 ตัว) | local part ที่เป็น ASCII ล้วนใช้กับ Firebase ได้ทุกที่ ไม่มีจุดจึงไม่เจอปัญหาจุดซ้อน |
| รหัสผ่าน | อย่างน้อย **6 ตัว** (ค่าต่ำสุดของ Firebase) ตัวเลขล้วนได้ | พนักงานจำง่าย ความปลอดภัยหลักไม่ได้มาจากรหัสผ่าน แต่มาจากกุญแจประจำเครื่องและการอนุมัติของเจ้าของ |
| ผูกเครื่อง | **กุญแจสุ่ม 256 บิตต่อมือถือ** (`k`) + รหัสเครื่องสาธารณะ (`did`) เมื่อเจ้าของอนุมัติแล้ว `k` จะถูกเก็บที่ `deviceKeys/{sid}` (ไม่มีใครอ่านได้) ทุกการเขียนของพนักงานต้องเขียน `devproof/{sid} = {k, at: now}` มาใน update เดียวกัน | uid เหมือนกันทุกเครื่องแล้ว จึงใช้ uid ผูกเครื่องไม่ได้; การพิสูจน์ด้วยค่าที่เขียนลงโหนดที่อ่านไม่ได้ ทำให้คนที่รู้รหัสผ่านแต่ไม่มีมือถือเครื่องนั้นลงเวลาไม่ได้ |
| ADMIN | `sign_in_provider === 'password'` และอีเมล **ไม่ลงท้าย** ด้วยโดเมนพนักงาน และ `admins/{uid} === true` | ถึงเจ้าของจะเผลอใส่ uid ของพนักงานลงใน `admins` ก็ไม่ผ่าน |
| ข้อมูลอื่นของร้าน (STOCK MASTER) | README ขั้นที่ 0 เปลี่ยนเป็น **allowlist** (`shopUsers/{uid}: true`) ห้ามใช้ `auth != null` หรือ `sign_in_provider !== 'anonymous'` | ตอนนี้ใครก็สมัครบัญชีรหัสผ่านในโปรเจกต์ได้ (เพราะพนักงานต้องสมัครเองได้) จึงเชื่อชนิดผู้ให้บริการล็อกอินไม่ได้ **(ช่องโหว่นี้มีอยู่แล้วตั้งแต่เฟส 1 ถ้ายังไม่ได้ปิด sign-up)** |
| ลืมรหัสผ่าน | สมัคร **ชื่อผู้ใช้ใหม่** แล้วเจ้าของ "เชื่อมกับพนักงานเดิม" (relink: sid เดิม, uid ใหม่) หรือเจ้าของสร้างบัญชีใหม่ให้จาก master แล้ว relink | ถ้าไม่มี Admin SDK จะเปลี่ยนรหัสผ่านของคนอื่นไม่ได้ และไม่มีอีเมลจริงให้ส่งลิงก์รีเซ็ต |
| เจ้าของสร้างบัญชีให้พนักงาน | **ทำได้** ใช้ Firebase app ตัวที่สอง (`'provision'`, `inMemoryPersistence`) เรียก `createUserWithEmailAndPassword` แล้วล็อกเอาต์ แอดมินจึงไม่หลุด | ไม่ต้องใช้ Admin SDK; มือถือพนักงานยังต้องขออนุมัติเครื่องตามปกติ |
| การอ่าน `staff` / `branches` / `settings` | `staff` อ่านได้เฉพาะแอดมินกับเจ้าของ record; `branches`/`settings` อ่านได้เฉพาะแอดมินและสมาชิก (`accounts/{uid}` มีค่า) | บัญชีสแปมที่สมัครเองจะไม่เห็นรายชื่อ/ชื่อผู้ใช้ของพนักงานหรือพิกัดร้าน |
| ย้ายข้อมูล | **แทนที่ทั้งหมด** (ยังไม่มีข้อมูลจริง เพราะยังไม่เคยตั้งค่า Firebase) ลบ `staffSecret`, PIN, Anonymous, `deviceApproved*`; `logs`/`state`/`days`/`corrections`/`audit` ยังใช้ sid เป็น key เหมือนเดิม และกฎข้อบังคับเดิมยังอยู่ครบ | ไม่ต้องเขียน migration |
| สแปมการสมัคร | 1 คำขอต่อ uid, ตรวจรูปแบบทุกช่อง, `requestedAt === now`, สวิตช์ `settings/registrationOpen` (ไม่ได้ตั้ง = เปิด), ปุ่มลบทีละหลายรายการใน master | rules นับจำนวนไม่ได้; Firebase Auth จำกัดจำนวนการสมัครต่อ IP ให้อยู่แล้ว |

---

## 1. ขอบเขต

ทำ:
1. `database.rules.json`: แก้ ADMIN macro, เพิ่มโหนด `accounts`, `deviceKeys`, `devproof`, เขียน `deviceRequests` ใหม่, `staff` (username/deviceId), ตรวจ device proof ใน `state`/`logs`/`corrections`, จำกัดการอ่าน `staff`/`branches`/`settings`, ลบ `staffSecret`
2. `clock.html`: ลบการเลือกชื่อ/PIN/anonymous; เพิ่มหน้าสมัคร/เข้าสู่ระบบ/ลืมรหัส/รออนุมัติบัญชี/ขอใช้เครื่องนี้/ถูกแทนที่; ทุกการเขียนแนบ `devproof`
3. `clock-master.html`: การ์ดคำขอในรอตรวจแบบใหม่ (สมัคร / ใช้เครื่องใหม่ / เชื่อมบัญชีเดิม) พร้อมช่องสาขา/กะ; แท็บพนักงานแสดง username ลบ PIN UI และเพิ่ม "สร้างบัญชีให้พนักงาน" กับ "ตั้งบัญชีใหม่ (ลืมรหัส)"; สวิตช์รับสมัคร
4. `tests/rules.test.mjs`: เปลี่ยน helper/seed, เขียน R2/R3/R4/R16/R17/R18/R21/R27/R53/R59 ใหม่, เลิกใช้ R15, เพิ่ม R61-R76; `tests/seed-phase3.mjs` เปลี่ยนเป็นโมเดลใหม่
5. README (ขั้นที่ 0 + ติดตั้ง + เริ่มใช้ + แก้ปัญหา + ข้อจำกัด), `docs/testing.md`, ติดป้ายในเอกสารเดิมว่าข้อ 3 ของ plan-phase1 ถูกแทนแล้ว
6. demo shim / seed / how-to (**หลังงานเดโม commit แล้ว** ดูข้อ 9)

ไม่ทำ: เปลี่ยนรหัสผ่านในแอปพนักงาน (คำถามข้อ 13.4), App Check, Cloud Functions/Admin SDK, เปลี่ยน SHARED CORE / รายงาน / CSV

---

## 2. โมเดล Auth

### 2.1 ค่าคงที่ (ต้องตรงกันทุกตัวอักษรใน `clock.html`, `clock-master.html`, `database.rules.json`, tests, demo shim)
```js
const STAFF_EMAIL_DOMAIN = '@staff.ngluckseng.invalid';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const PW_MIN = 6;
const normUser = (s) => String(s || '').trim().toLowerCase();
const staffEmail = (u) => normUser(u) + STAFF_EMAIL_DOMAIN;
```
- **ต้องตรวจก่อนสร้างงาน (ขั้น 0 ในข้อ 12):** ลองสมัคร `zz_probe@staff.ngluckseng.invalid` กับ Auth emulator และโปรเจกต์จริง (REST `accounts:signUp`) ถ้า Firebase ไม่ยอมรับ TLD `.invalid` ให้ใช้ `@staff.ngluckseng.example` แทน (`.example` เป็น TLD สงวนเช่นกัน) แล้วแก้ค่าคงที่ให้ตรงกันทุกไฟล์ จากนั้นลบบัญชีทดสอบใน Console
- ห้ามเรียก `sendEmailVerification` / `sendPasswordResetEmail` / `verifyBeforeUpdateEmail` กับบัญชีพนักงาน (ไม่มีกล่องจดหมายจริง)
- Email enumeration protection (เปิดเป็นค่าเริ่มต้นในโปรเจกต์ใหม่): ล็อกอินผิดจะได้ `auth/invalid-credential` เสมอ ส่วนตอนสมัคร `auth/email-already-in-use` ยังคืนมาตามปกติ ข้อความในข้อ 7.4 รองรับทั้งสองแบบ

### 2.2 ความไม่ซ้ำและการแปลงตัวพิมพ์
- Firebase Auth รับประกันว่าอีเมลไม่ซ้ำกัน (ไม่สนตัวพิมพ์) แอปแปลงเป็นตัวเล็กก่อนเสมอ และ rules บังคับ `USERNAME_RE` ซึ่งเป็นตัวเล็กล้วน
- rules ผูก username ในคำขอเข้ากับบัญชีที่ล็อกอินอยู่: `auth.token.email === username + STAFF_EMAIL_DOMAIN` จึงอ้างชื่อผู้ใช้ของคนอื่นไม่ได้ เมื่อรวมกับข้อแรกจึงได้ username ไม่ซ้ำโดยไม่ต้องมีโหนด index แยก
- `staff/{sid}/username` คัดลอกมาจากคำขอตอนอนุมัติ (master เขียน) ส่วนกรณีเจ้าของสร้างบัญชีให้ master รู้ username จากตอนสร้าง
- ลืมรหัสผ่าน = ได้ username ใหม่ (บัญชีเดิมยังจองชื่อเดิมไว้ใน Auth จนกว่าเจ้าของจะลบใน Console) ยอมรับได้และระบุไว้ใน README

### 2.3 การคงการล็อกอิน
- `clock.html`: `setPersistence(auth, indexedDBLocalPersistence)` (เหมือนเดิม) + `navigator.storage.persist()` ล็อกอินครั้งเดียวแล้วอยู่ต่อ จนกว่าจะล้างข้อมูลเบราว์เซอร์ กดออกจากระบบ หรือ refresh token ถูกเพิกถอน (เช่น มีคนเปลี่ยนรหัสผ่าน/ลบบัญชี)
- `clock-master.html` ยังใช้ app ชื่อ `'master'` + `browserSessionPersistence` เหมือนเดิม จึงไม่แชร์ตัวตนกับ `clock.html` บน origin เดียวกัน
- ออกจากระบบ **ไม่ลบ** กุญแจเครื่อง (ข้อ 3.2) ถ้าล็อกอินกลับเข้ามาในบัญชีเดิมบนมือถือเครื่องเดิม ก็ใช้ต่อได้เลยโดยไม่ต้องขออนุมัติใหม่

---

## 3. การผูกเครื่อง (บังคับใน rules)

### 3.1 ข้อมูล
```
attendance/
  accounts/{uid}: "<sid>"                       แอดมินเขียน; อ่านได้: แอดมิน, uid เจ้าของ
  staff/{sid}: { nickname, username, branchId, shiftStart, shiftEnd?, active,
                 uid?, deviceId?, deviceAt?, createdAt? }          (ลบ deviceApproved, deviceApprovedAt)
  deviceKeys/{sid}: { k, did, at }               แอดมินเขียน; ไม่มีใครอ่านได้ (รวมแอดมิน)
  devproof/{sid}: { k, at }                       พนักงานเขียน (k ต้องตรง deviceKeys); ไม่มีใครอ่านได้
  deviceRequests/{uid}: {
      info: { kind:"register"|"device", did, status:"pending"|"rejected", requestedAt,
              username?, nickname?, relink?, oldUsername?, userAgent?, standalone? },
      key: "<k 43 ตัว>" }                         พนักงานสร้างของตัวเอง; อ่าน info ได้: ตัวเอง+แอดมิน; อ่าน key ได้: แอดมินเท่านั้น
  settings/registrationOpen: boolean             (ไม่ได้ตั้ง = เปิดรับสมัคร)
```
- `k` = 32 ไบต์จาก `crypto.getRandomValues` เข้ารหัส base64url ไม่มี padding ได้ 43 ตัว (`^[A-Za-z0-9_-]{43}$`)
- `did` = 15 ไบต์สุ่ม base64url ได้ 20 ตัว (`^[A-Za-z0-9_-]{16,40}$`) **ไม่ใช่ความลับ** ใช้บอกว่ามือถือเครื่องไหนผูกอยู่ (`staff/{sid}/deviceId`)
- `crypto.getRandomValues` ใช้ได้แม้หน้าไม่เป็น secure context (เดโมบน http ก็ใช้ได้) ไม่ต้องใช้ `crypto.subtle`

### 3.2 การเก็บในมือถือ
- `localStorage['clock.dev'] = {did, k}` = คู่ที่ **ใช้งานอยู่** ของมือถือเครื่องนี้ (1 คู่ต่อมือถือ ไม่แยกตาม uid)
- `localStorage['clock.devPending'] = {did, k, uid}` = คู่ที่สร้างตอนส่งคำขอและยังไม่ได้รับอนุมัติ เมื่อเห็นว่า `staff.deviceId === devPending.did` ให้ย้ายไปเป็น `clock.dev` แล้วลบ pending
  - เหตุผล: ถ้ามือถือที่ผูกอยู่แล้วส่งคำขอใหม่โดยไม่ตั้งใจ หรือคำขอถูกปฏิเสธ กุญแจที่ใช้อยู่ต้องไม่หาย
- **ทุกคำขอสร้างคู่ใหม่เสมอ** (ไม่เอาคู่เดิมไปใช้กับพนักงานอีกคน) มือถือ 1 เครื่องจึงมีกุญแจที่ใช้ได้กับพนักงาน 1 คนเท่านั้น ถ้ามือถือที่เคยเป็นของ เอ ถูก บี ขอใช้และได้รับอนุมัติ กุญแจของ เอ จะไม่อยู่บนเครื่องไหนอีก (เอ ต้องขอเครื่องใหม่)
- relink ที่เจ้าของทำ (ข้อ 5 ทาง B) **เก็บ** `deviceKeys`/`deviceId` เดิมไว้ เมื่อพนักงานล็อกอินด้วย username ใหม่บนมือถือเครื่องเดิม → `staff.deviceId === clock.dev.did` → ใช้ต่อได้ทันที

### 3.3 การพิสูจน์ตอนเขียน
ทุก write ของพนักงานที่ต้องผูกเครื่อง (log+state, สร้างคำขอแก้เวลา, ลบคำขอแก้เวลาที่ยัง pending) ส่งเป็น multi-path update ที่มี
```js
[`devproof/${sid}`]: { k: dev.k, at: serverTimestamp() }
```
- `devproof/$sid/.validate` บังคับ `k === root.deviceKeys/$sid/k` (ต้องเป็น string) และ `at === now`
- กฎของ log/state/corrections ตรวจแค่ `newData…devproof/{sid}/at === now` ก็พอ เพราะทางเดียวที่จะทำให้ `at === now` ได้คือเขียน devproof มาใน request นี้ ซึ่งต้องผ่าน validate (k ถูก) ก่อน (newData ของ root รวม devproof เก่าที่เคยเขียนไว้ด้วย การตรวจ `at === now` จึงกันการใช้ proof ซ้ำ) **ห้ามตัดการตรวจ `at === now` ออก** (มีเทส R68 กันไว้)
- devproof ไม่เปิดให้อ่าน จึงไม่มีใครเห็น `k` จากการอ่านฐานข้อมูล และ log ไม่มี `k` การอ่านประวัติของตัวเองจึงไม่ทำให้กุญแจรั่ว
- เดา `k` ไม่ได้ (256 บิต) ถึงจะใช้ rules เป็นตัวบอกถูก/ผิดก็ไม่มีประโยชน์

### 3.4 วิเคราะห์สถานการณ์
| สถานการณ์ | ผลลัพธ์ |
|---|---|
| พนักงาน เอ บอกรหัสผ่านให้เพื่อน ฟ (ใช้มือถือของ ฟ) | ฟ **ล็อกอินได้** และอ่านได้: `staff/{sid}` ของ เอ, state, logs, corrections, ประวัติ (ข้อมูลส่วนตัวของ เอ รั่ว ยอมรับได้) / **ทำไม่ได้**: เข้างาน/พัก/ออก, ส่งหรือลบคำขอแก้เวลา (ไม่มี `k`) / ทำได้แต่ต้องผ่านเจ้าของ: ส่งคำขอ "ใช้เครื่องนี้" (เจ้าของเห็นการ์ด "จะแทนเครื่องเดิม" + รุ่นเครื่อง และมือถือของ เอ ขึ้นแถบเตือน "มีคนขอใช้บัญชีของคุณบนมือถือเครื่องอื่น") / **ทำร้ายได้ (DoS)**: เปลี่ยนรหัสผ่านหรือลบบัญชีของ เอ ผ่าน API โดยตรง (มือถือของ เอ จะหลุดภายในราว 1 ชม. เพราะ token ถูกเพิกถอน) แล้ว เอ ใช้ขั้นตอนลืมรหัสผ่าน (ข้อ 5) README เตือนว่า "ห้ามบอกรหัสผ่านให้ใคร" |
| ฟ มีคำขอ pending ค้างอยู่แล้ว เอ จะส่งคำขอบ้าง | 1 คำขอต่อ uid และทับคำขอ pending ไม่ได้ แต่ลบคำขอของตัวเองได้ (uid เดียวกัน) ทั้งสองฝ่ายจึงแย่งกันได้ ด่านสุดท้ายคือเจ้าของ ซึ่งการ์ดแสดงเวลาที่ขอ รุ่นเครื่อง ติดตั้งเป็นแอปหรือยัง |
| ล้างข้อมูลเบราว์เซอร์ / ลบแอปแล้วติดตั้งใหม่ | session และ `clock.dev` หายทั้งคู่ ต้องล็อกอินด้วย username/รหัสผ่าน แล้วเห็นหน้า "มือถือเครื่องนี้ยังไม่ได้ผูกกับบัญชีของคุณ" กดขอใช้เครื่องนี้ แล้วรอเจ้าของอนุมัติ ข้อมูลเวลางานไม่หายเพราะผูกกับ sid |
| iPhone: Safari กับแอปบนหน้าจอโฮมแยกที่เก็บข้อมูลกัน | ถ้าลงทะเบียนใน Safari แล้วค่อยติดตั้ง ในแอปต้องล็อกอินใหม่ (ง่าย) และต้องขออนุมัติเครื่องอีกรอบ (`clock.dev` อยู่คนละที่) จึงยังคงการ์ด INSTALL ไว้ก่อนสมัคร/ล็อกอิน คำขอส่ง `standalone` ไปด้วย การ์ดของเจ้าของเตือน "ยังไม่ได้ติดตั้งเป็นแอป อนุมัติแล้วอาจต้องอนุมัติซ้ำ" Safari ที่ไม่ได้ติดตั้งจะลบข้อมูลเว็บที่ไม่ได้ใช้ 7 วัน (ITP) ส่วนแอปบนหน้าจอโฮมไม่โดน |
| Android: Chrome กับแอปที่ติดตั้งใช้ที่เก็บเดียวกัน | ไม่มีปัญหา |
| พนักงาน 2 คนใช้มือถือเครื่องเดียวกัน | ทำไม่ได้ (ตามที่เจ้าของกำหนด): คำขอของคนที่สองจะทับ `clock.dev` หลังได้รับอนุมัติ คนแรกเสียการผูกเครื่อง |
| มือถือที่ถูกแทนแล้ว (เจ้าของอนุมัติเครื่องใหม่) | ยังล็อกอินอยู่และอ่านข้อมูลได้ แต่เขียนไม่ได้ทันที (`k` ไม่ตรง) หน้าจอเป็น REPLACED พร้อมปุ่ม "ขอใช้เครื่องนี้แทน" |
| ปิดบัญชี (`active=false`) | เขียน devproof ไม่ได้ ทุกอย่างจึงถูกปฏิเสธ ส่งคำขอเครื่องก็ไม่ได้ แอปแสดง DISABLED |

---

## 4. แอดมิน vs พนักงาน และข้อมูลอื่นของร้าน

### 4.1 ADMIN macro ใหม่ (แทนทั้ง 54 จุดในไฟล์)
แทนข้อความ `auth.token.firebase.sign_in_provider !== 'anonymous'` **ทุกจุด** ด้วย
```
auth.token.firebase.sign_in_provider === 'password' && !auth.token.email.endsWith('@staff.ngluckseng.invalid')
```
ได้เป็น
```
ADMIN = auth != null && auth.token.firebase.sign_in_provider === 'password'
        && !auth.token.email.endsWith('@staff.ngluckseng.invalid')
        && root.child('attendance/admins/' + auth.uid).val() === true
```
- บัญชีรหัสผ่านมี `email` ใน token เสมอ ส่วน anonymous/ไม่ล็อกอินจะหยุดที่เงื่อนไขก่อนหน้า (`&&` ทำงานแบบ short-circuit) จึงไม่เรียก `.endsWith` กับค่า null
- `admins/$uid` เขียนได้โดย ADMIN (และ Console) เท่านั้น พนักงานจึงยกระดับตัวเองไม่ได้ ถ้าเจ้าของเผลอใส่ uid ของพนักงานลงใน `admins` ก็ยังไม่ผ่านเพราะติดเงื่อนไขโดเมน (R61)
- ผลข้างเคียง: แอดมินต้องล็อกอินด้วย Email/Password เท่านั้น (ถ้าภายหลังเพิ่ม Google sign-in ต้องแก้ macro)
- หลังแก้ ตรวจด้วย `grep -c "sign_in_provider !== 'anonymous'" database.rules.json` ต้องได้ 0 และนับ `endsWith('@staff.ngluckseng.invalid')` ให้เท่ากับจำนวนจุด ADMIN + STAFF_TOKEN

### 4.2 STAFF_TOKEN และ MEMBER
```
STAFF_TOKEN = auth != null && auth.token.firebase.sign_in_provider === 'password'
              && auth.token.email.endsWith('@staff.ngluckseng.invalid')
MEMBER      = auth != null && root.child('attendance/accounts/' + auth.uid).isString()
```

### 4.3 ความเสี่ยงข้ามระบบ: STOCK MASTER และโหนดอื่นของร้าน (สำคัญที่สุดในแผนนี้)
- ถ้าจะให้พนักงานสมัครเองได้ ต้องเปิด Email/Password **และ** เปิด "Enable create (sign-up)" (Authentication > Settings > User actions) ผลคือใครก็ได้บนอินเทอร์เน็ตที่มี apiKey (ค่าสาธารณะใน HTML) สร้างบัญชีรหัสผ่านด้วยอีเมลอะไรก็ได้ แล้วจะได้ `auth != null` และ `sign_in_provider === 'password'`
- **คำแนะนำเดิมใน README ขั้นที่ 0 ข้อ 3 (`sign_in_provider !== 'anonymous'`) จึงใช้กันไม่ได้แล้ว** และจริงๆ ใช้ไม่ได้มาตั้งแต่เฟส 1 ที่เปิด Email/Password ไว้สำหรับแอดมิน (ถ้าตอนนั้นยังไม่ได้ปิด sign-up) การเช็กโดเมนอีเมลก็ไม่ช่วย เพราะคนแปลกหน้าสมัครด้วย `x@gmail.com` ได้
- ไม่มี Admin SDK ก็ตั้ง custom claims ไม่ได้ ทางที่แข็งแรงพอจึงมีแค่ **allowlist ที่เขียนได้จาก Console เท่านั้น**

**ข้อความใหม่ของ README "ขั้นที่ 0" (ให้ code-builder ใส่ตามนี้ทุกคำ):**
> ## ขั้นที่ 0 ตรวจกฎ Firebase เดิมก่อน (สำคัญมาก ทำก่อนเปิดให้พนักงานสมัคร)
>
> ระบบนี้ให้พนักงานสมัครบัญชีเองด้วยชื่อผู้ใช้และรหัสผ่าน จึงต้องเปิด Email/Password และการสมัคร (sign-up) ไว้ ผลคือ **ใครก็ได้บนอินเทอร์เน็ตสร้างบัญชีในโปรเจกต์นี้ได้** ถ้ากฎของข้อมูลเดิม (เช่น STOCK MASTER) ใช้ `auth != null` หรือ `auth.token.firebase.sign_in_provider !== 'anonymous'` หรือเช็กโดเมนอีเมล คนแปลกหน้าจะอ่าน/เขียนข้อมูลเดิมได้ทันที
>
> 1. Firebase Console > Realtime Database > Rules > คัดลอกกฎเดิมทั้งหมดเก็บสำรองไว้ก่อน
> 2. ดูที่ระดับบนสุดของ `"rules"` ถ้ามี `".read"` หรือ `".write"` อยู่ตรงนั้น (เช่น `true` หรือ `"auth != null"`) กฎของ attendance จะไม่มีผล เพราะสิทธิ์ของ RTDB ไหลลงไปยังลูกทั้งหมดและเพิกถอนที่ชั้นล่างไม่ได้ ต้องย้ายสิทธิ์นั้นลงไปไว้ที่ node ของข้อมูลเดิมแต่ละตัวก่อน
> 3. ทุก node ของข้อมูลเดิมที่ใช้ `auth != null` (หรือ `sign_in_provider !== 'anonymous'`) ให้เปลี่ยนเป็น allowlist:
>    `"auth != null && root.child('shopUsers/' + auth.uid).val() === true"`
>    แล้วเพิ่ม uid ของทุกบัญชีที่โปรแกรมเดิมใช้ล็อกอิน (เช่น บัญชีของ STOCK MASTER/POS) ลงใน `shopUsers/<UID>` = `true` (boolean) ทาง Console > Data ส่วน `shopUsers` ให้ตั้งกฎ `".read": false, ".write": false` (Console เขียนได้เสมอเพราะไม่ผ่านกฎ)
> 4. ถ้าข้อมูลเดิมเปิดแบบ `true` (ไม่ต้องล็อกอิน) อยู่แล้ว ระบบนี้ไม่ได้ทำให้แย่ลง แต่ควรแก้แยกต่างหาก
> 5. ปิดวิธีล็อกอิน **Anonymous** (ระบบนี้ไม่ใช้แล้ว)
> 6. ห้ามแตะ node อื่นนอกจาก `attendance` และ `shopUsers` ที่เพิ่มในข้อ 3
> 7. ทดสอบใน Rules Playground: ผู้ใช้ provider `password` uid ใหม่ที่ไม่อยู่ใน `shopUsers` ต้องอ่าน/เขียน node เดิมไม่ได้

- ถ้าโปรแกรมเดิมไม่ได้ใช้ Firebase Auth เลย (กฎเปิด `true`) ข้อ 3 ไม่เกี่ยว แต่ต้องรายงานให้ Boss รู้
- **ข้อนี้ไม่ขวางการเขียนโค้ด แต่ขวางการเปิดใช้งานจริง** (แบบเดียวกับคำถามข้อ 8.1 ของเฟส 1)

---

## 5. ลืมรหัสผ่าน / เปลี่ยนบัญชี (ไม่มี Admin SDK และไม่มีอีเมลจริง)

ใช้ "relink" = ย้าย `staff/{sid}` ไปผูกกับ uid ใหม่ ส่วน sid, logs, state, corrections และรายงานยังเหมือนเดิม

**ทาง A (พนักงานทำเอง ค่าเริ่มต้น):**
1. แอป > "ลืมรหัสผ่าน?" > คำอธิบาย: "สมัครชื่อผู้ใช้ใหม่ (ห้ามซ้ำชื่อเดิม) แล้วเจ้าของจะเชื่อมกับประวัติเดิมให้" > ฟอร์มสมัครที่ติ๊ก "เคยมีบัญชีแล้ว" ไว้ให้ (`relink: true`) + ช่อง "ชื่อผู้ใช้เดิม (ถ้าจำได้)" (`oldUsername`)
2. ใน master การ์ดคำขอขึ้นป้าย "อ้างว่าเป็นพนักงานเดิม" และมีตัวเลือก **"เชื่อมกับพนักงานเดิม: [รายชื่อ]"** (ถ้า `oldUsername` ตรงกับใครจะเลือกให้อัตโนมัติ) แล้วกดอนุมัติ หน้าต่างยืนยันบอกว่า "บัญชีเดิม `<username เดิม>` จะใช้ไม่ได้อีก"
3. update เดียว: `staff/{sid}/uid = newUid`, `staff/{sid}/username = new`, `staff/{sid}/deviceId = info.did`, `staff/{sid}/deviceAt = now`, `deviceKeys/{sid} = {k: key, did, at: now}`, `accounts/{oldUid} = null`, `accounts/{newUid} = sid`, `deviceRequests/{newUid} = null`, `deviceRequests/{oldUid} = null` + audit `op: relink_account` (before `{uid, username}` / after `{uid, username}`)

**ทาง B (เจ้าของทำให้):** แท็บพนักงาน > "ตั้งบัญชีใหม่ (ลืมรหัส)" > ใส่ username ใหม่ (แนะนำ `<เดิม>2`) + รหัสผ่าน 2 ครั้ง > master สร้างบัญชีด้วย app `'provision'` (ข้อ 8.4) > update เดียวเหมือนทาง A แต่ **ไม่เปลี่ยน** `deviceKeys`/`deviceId` (มือถือเครื่องเดิมใช้ต่อได้ทันทีหลังล็อกอินด้วยชื่อใหม่ ข้อ 3.2) แล้วเจ้าของบอก username/รหัสใหม่กับพนักงาน

**หลัง relink:** uid เดิมไม่อยู่ใน `accounts` และ `staff.uid` ไม่ตรงแล้ว จึงอ่าน/เขียนอะไรของ sid นั้นไม่ได้อีก (R71) มือถือที่ยังล็อกอิน uid เดิมอยู่จะเห็นหน้า ACCOUNT_MOVED "บัญชีนี้ถูกเปลี่ยนแล้ว เข้าสู่ระบบด้วยชื่อผู้ใช้ใหม่" + ปุ่มออกจากระบบ ส่วน `uid` ใน log เก่ายังเป็น uid เดิม (เป็นหลักฐาน rules ห้ามแก้อยู่แล้ว) บัญชีเดิมใน Auth ลบได้ใน Console (ไม่บังคับ)

---

## 6. Security Rules (รายละเอียด)

ตัวย่อในข้อนี้ใช้ในเอกสารเท่านั้น ไฟล์จริงต้องเขียนเต็ม: `KEY_RE = /^[-_A-Za-z0-9]{1,40}$/`, `DID_RE = /^[A-Za-z0-9_-]{16,40}$/`, `K_RE = /^[A-Za-z0-9_-]{43}$/`, `UN_RE = /^[a-z0-9_]{3,20}$/`, โดเมน = `'@staff.ngluckseng.invalid'`, ADMIN/STAFF_TOKEN/MEMBER ตามข้อ 4

### 6.1 โหนดที่เปลี่ยนเฉพาะ ADMIN macro
`admins`, `calendar`, `days`, `audit` และส่วนแอดมินของ `state`/`logs`/`corrections` (audit binding, prevLogId CAS, origTs, movedFrom, การตัดสินคำขอ) **ไม่เปลี่ยนตรรกะ**

### 6.2 `settings`
```
"settings": {
  ".read": "ADMIN || MEMBER",                       (เดิม auth != null)
  ".write": "ADMIN",
  lateGraceMin / reviewDays / correctionDays / calendarEnforced / calendarLast   (เดิม)
  "registrationOpen": { ".validate": "newData.isBoolean()" },                    ใหม่
  "$other": { ".validate": false }
}
```

### 6.3 `branches`
`.read`: `ADMIN || MEMBER` (เดิม `auth != null`) ส่วนที่เหลือเหมือนเดิม

### 6.4 `accounts` (ใหม่)
```
"accounts": {
  ".read": "ADMIN",
  "$uid": {
    ".read": "ADMIN || (auth != null && auth.uid === $uid)",
    ".write": "ADMIN",
    ".validate": "newData.isString() && newData.val().matches(KEY_RE)
                  && newData.parent().parent().child('staff/' + newData.val() + '/uid').val() === $uid"
  }
}
```
บังคับให้ `accounts/{uid}` กับ `staff/{sid}/uid` ตรงกันในสถานะหลังเขียน (master เขียนทั้งสองที่ใน update เดียว)

### 6.5 `staff`
```
"staff": {
  ".read": "ADMIN",                                     (เดิม auth != null)
  "$sid": {
    ".read": "ADMIN || (auth != null && root.child('attendance/staff/' + $sid + '/uid').val() === auth.uid)",
    ".write": "ADMIN",
    ".validate": "$sid.matches(KEY_RE) && newData.hasChildren(['nickname','username','branchId','shiftStart','active'])",
    nickname, branchId, shiftStart, shiftEnd, active, createdAt   (เดิม)
    "username": { ".validate": "newData.isString() && newData.val().matches(UN_RE)" },
    "uid":      { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 128
                                && newData.parent().parent().parent().child('accounts/' + newData.val()).val() === $sid" },
    "deviceId": { ".validate": "newData.isString() && newData.val().matches(DID_RE)
                                && newData.parent().parent().parent().child('deviceKeys/' + $sid + '/did').val() === newData.val()" },
    "deviceAt": { ".validate": "newData.isNumber()" },
    "$other":   { ".validate": false }        <- deviceApproved, deviceApprovedAt, pinHash ถูกปฏิเสธ
  }
}
```
`.validate` ของลูกทำงานเฉพาะลูกที่ถูกเขียน การแก้ shiftEnd อย่างเดียวจึงไม่ไปตรวจ uid/deviceId ซ้ำ (R58/R60 ยังผ่าน แต่ seed ต้องมี username)

### 6.6 `deviceKeys` (ใหม่) ไม่มี `.read` ที่ไหนเลย
```
"deviceKeys": {
  "$sid": {
    ".write": "ADMIN",
    ".validate": "$sid.matches(KEY_RE) && newData.hasChildren(['k','did','at'])
                  && newData.parent().parent().child('staff/' + $sid + '/deviceId').val() === newData.child('did').val()",
    "k":   { ".validate": "newData.isString() && newData.val().matches(K_RE)" },
    "did": { ".validate": "newData.isString() && newData.val().matches(DID_RE)" },
    "at":  { ".validate": "newData.val() === now" },
    "$other": { ".validate": false }
  }
}
```
ยกเลิกผูกเครื่อง = `deviceKeys/{sid}: null` + `staff/{sid}/deviceId: null` + `staff/{sid}/deviceAt: null` (การลบไม่ผ่าน `.validate`)

### 6.7 `devproof` (ใหม่) ไม่มี `.read`
```
"devproof": {
  "$sid": {
    ".write": "auth != null && newData.exists()
               && root.child('attendance/staff/' + $sid + '/uid').val() === auth.uid
               && root.child('attendance/staff/' + $sid + '/active').val() === true",
    ".validate": "newData.hasChildren(['k','at'])
                  && root.child('attendance/deviceKeys/' + $sid + '/k').isString()
                  && newData.child('k').val() === root.child('attendance/deviceKeys/' + $sid + '/k').val()
                  && newData.child('at').val() === now",
    "k":  { ".validate": "newData.isString()" },
    "at": { ".validate": "newData.isNumber()" },
    "$other": { ".validate": false }
  }
}
```
ตั้งใจใช้ `root.child(...)` (ค่าก่อนเขียน) ของ deviceKeys การหมุนกุญแจกับการเขียน proof จึงอยู่ใน request เดียวกันไม่ได้ และแอดมินก็ไม่มีสิทธิ์ `.write` ที่นี่

### 6.8 `deviceRequests` (เขียนใหม่ทั้งก้อน)
```
"deviceRequests": {
  ".read": "ADMIN",
  "$uid": {
    ".write": "ADMIN || (STAFF_TOKEN && auth.uid === $uid
               && (!newData.exists() || !data.exists() || data.child('info/status').val() === 'rejected'))",
    ".validate": "newData.hasChildren(['info','key'])",
    "info": {
      ".read": "ADMIN || (auth != null && auth.uid === $uid)",
      ".validate": "newData.hasChildren(['kind','did','status','requestedAt'])
        && (newData.child('kind').val() === 'device'
            || (newData.child('kind').val() === 'register' && newData.hasChildren(['username','nickname'])))
        && ( ADMIN
          || ( newData.child('kind').val() === 'register'
               && !root.child('attendance/accounts/' + $uid).exists()
               && root.child('attendance/settings/registrationOpen').val() !== false
               && auth.token.email === newData.child('username').val() + '@staff.ngluckseng.invalid' )
          || ( newData.child('kind').val() === 'device'
               && root.child('attendance/accounts/' + $uid).isString()
               && root.child('attendance/staff/' + root.child('attendance/accounts/' + $uid).val() + '/active').val() === true ) )",
      "kind":        { ".validate": "newData.val() === 'register' || newData.val() === 'device'" },
      "did":         { ".validate": "newData.isString() && newData.val().matches(DID_RE)" },
      "status":      { ".validate": "newData.val() === 'pending' || (ADMIN && newData.val() === 'rejected')" },
      "requestedAt": { ".validate": "newData.isNumber() && (newData.val() === now || ADMIN || newData.val() === data.val())" },
      "username":    { ".validate": "newData.isString() && newData.val().matches(UN_RE)" },
      "nickname":    { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 20" },
      "relink":      { ".validate": "newData.isBoolean()" },
      "oldUsername": { ".validate": "newData.isString() && newData.val().matches(UN_RE)" },
      "userAgent":   { ".validate": "newData.isString() && newData.val().length <= 300" },
      "standalone":  { ".validate": "newData.isBoolean()" },
      "$other":      { ".validate": false }
    },
    "key":    { ".validate": "newData.isString() && newData.val().matches(K_RE)" },
    "$other": { ".validate": false }
  }
}
```
- พนักงานอ่าน `deviceRequests/{uid}/info` ของตัวเองได้ แต่อ่าน `deviceRequests/{uid}` ทั้งก้อนหรือ `/key` ไม่ได้ (เพื่อนที่ล็อกอินด้วย uid เดียวกันจึงไม่เห็น `k` ในคำขอที่เจ้าของบัญชีส่ง)
- 1 คำขอต่อ uid: ทับคำขอ pending ไม่ได้ ลบของตัวเองได้ และสร้างใหม่ได้หลังลบหรือหลังถูกปฏิเสธ
- `register` ใช้ไม่ได้ถ้ามี `accounts/{uid}` แล้ว และใช้ไม่ได้ตอนปิดรับสมัคร ส่วน `device` ใช้ได้เฉพาะคนที่มีบัญชีแล้วและบัญชียังเปิดอยู่ (ตรวจว่า `accounts` เป็น string ก่อนนำไปต่อ path เพื่อไม่ให้ได้ `staff/null`)
- ตอนปิดรับสมัคร แอปที่เพิ่งสร้างบัญชีแล้วเขียนคำขอไม่ผ่าน จะเรียก `deleteUser(auth.currentUser)` เพื่อไม่ให้เหลือบัญชีกำพร้า (ข้อ 7.3)
- `requestedAt` เปิด `ADMIN ||` ไว้กว้างเหมือนเฟส 1 เพื่อให้แอดมินแก้ status ได้

### 6.9 `state/$sid` (ส่วนของพนักงาน)
ในข้อความ `.write` เดิม แทน
`root.child('attendance/staff/' + $sid + '/deviceApproved').val() === true`
ด้วย
`newData.parent().parent().child('devproof/' + $sid + '/at').val() === now`
ส่วนอื่น (ADMIN + audit + prevLogId CAS, `newData.exists()`, `.validate` ที่บังคับ log ts===now) **ห้ามเปลี่ยน**
`$sid/.read` ยังตรวจแค่ uid จึงอ่านได้โดยไม่ต้องมี proof (การอ่านพิสูจน์เครื่องไม่ได้ และไม่จำเป็น)

### 6.10 `logs/$d/$sid/$lid` (ส่วนของพนักงาน)
ในข้อความ `.write` เดิม แทน
`root.child('attendance/staff/' + $sid + '/deviceApproved').val() === true`
ด้วย
`newData.parent().parent().parent().parent().child('devproof/' + $sid + '/at').val() === now`
ส่วนอื่นเหมือนเดิมทั้งหมด: create-only, `ts === now`, state machine, 30 วิ, STALE 16 ชม., distance ≤ radius×grace, calendarEnforced, `days.confirmed`, `uid === auth.uid`, หลักฐานที่แก้ไม่ได้, movedFrom

### 6.11 `corrections/$cid`
- กิ่งสร้างของพนักงาน: แทน `root.child('attendance/staff/' + newData.child('staffId').val() + '/deviceApproved').val() === true` ด้วย `newData.parent().parent().child('devproof/' + newData.child('staffId').val() + '/at').val() === now`
- กิ่งลบคำขอ pending ของตัวเอง: เพิ่ม `&& newData.parent().parent().child('devproof/' + data.child('staffId').val() + '/at').val() === now`
- `.read` แบบ query (`orderByChild staffId` + `staff/{equalTo}/uid === auth.uid`) และ `.validate` ทั้งหมดเหมือนเดิม

### 6.12 ลบทิ้ง
`staffSecret` ทั้งก้อน เมื่อไม่มีกฎ การอ่าน/เขียนจะถูกปฏิเสธเป็นค่าตั้งต้น (R74)

### 6.13 สิ่งที่ต้องยังเป็นจริง (invariants) ตรวจด้วยเทสชุดเดิม R5-R14, R19-R60
create-only logs, `ts === now`, state machine + `lastLogId`/`since`/`inAt`, กันกดซ้ำ 30 วิ, audit binding ของแอดมิน, prevLogId CAS, origTs/movedFrom, การตัดสิน corrections ทำได้ครั้งเดียว, ห้ามลบ audit, วันที่ล็อกแล้วแก้ไม่ได้

### 6.14 ขนาดไฟล์
ADMIN ยาวขึ้นราว 70 ตัวอักษร × 54 จุด ≈ +4 KB รวมโหนดใหม่แล้วไฟล์จะราว 45 KB (ขีดจำกัด 256 KB)

---

## 7. `clock.html`

### 7.1 ลบออก
`signInAnonymously`, PICK/PIN/แป้นตัวเลข, `submitRegistration` แบบ PIN, `sha256Hex` (ถ้าไม่มีที่อื่นใช้แล้ว), การฟัง `attendance/staff` ทั้งก้อน, `reg.sid/pin`, การค้นหา `s.uid === user.uid && s.deviceApproved`

### 7.2 การโหลดและตัวตน
1. `onAuthStateChanged`: ไม่มีผู้ใช้ → AUTH (ไม่อ่านฐานข้อมูลเลย) ถ้าเป็น iOS ที่ยังไม่ได้ติดตั้งและยังไม่เคยกดข้าม → INSTALL ก่อน
2. มีผู้ใช้แต่อีเมลไม่ได้ลงท้ายด้วย `STAFF_EMAIL_DOMAIN` (หรือ `isAnonymous`) → NOT_STAFF ("บัญชีนี้ไม่ใช่บัญชีพนักงาน" + ปุ่มออกจากระบบ)
3. ฟัง `accounts/{uid}` และ `deviceRequests/{uid}/info` (+ `.info/connected`, `.info/serverTimeOffset`)
4. เมื่อได้ sid แล้ว ฟัง `staff/{sid}`, `branches`, `settings` แล้วตามด้วย state/logs/corrections แบบเดิม (branches/settings อ่านได้หลังเป็นสมาชิกแล้วเท่านั้น)
5. `myDev()` = `clock.dev`; ถ้ามี `clock.devPending` และ `staff.deviceId === devPending.did` ให้ย้ายไปเป็น `clock.dev` แล้วลบ pending
6. `localStorage['clock.last'] = {uid, sid, nickname, did}` ใช้แสดงชื่อตอนโหลดเร็ว และใช้แยก REPLACED / ACCOUNT_MOVED ออกจาก NEW_DEVICE

### 7.3 state machine ของหน้าจอ
```
BOOT → CONFIG_MISSING | UNSUPPORTED
     → ไม่มี user → [INSTALL (iOS)] → AUTH
         AUTH = แท็บ "เข้าสู่ระบบ" (ค่าเริ่มต้นถ้าเคยล็อกอินบนเครื่องนี้) | "สมัครใช้งาน"
           LOGIN : ชื่อผู้ใช้ + รหัสผ่าน [แสดงรหัส] → signInWithEmailAndPassword(staffEmail(u), pw)
           SIGNUP: ชื่อผู้ใช้ + ชื่อเล่น + รหัสผ่าน + รหัสผ่านอีกครั้ง [แสดงรหัส]
                   → ตรวจในเครื่อง → LOCATION_EXPLAIN (อธิบาย + ขอสิทธิ์ เหมือนเดิม ข้ามได้)
                   → createUserWithEmailAndPassword → สร้าง devPending → set deviceRequests/{uid}
                     (kind register) → WAIT_ACCOUNT
                   เขียนคำขอไม่ได้เพราะ PERMISSION_DENIED → deleteUser(currentUser) → "ร้านปิดรับสมัครชั่วคราว"
                   เขียนไม่ได้เพราะเน็ต → เก็บ draft ใน localStorage แล้วไป NEED_REQUEST (ส่งใหม่เองเมื่อกลับมาออนไลน์)
           FORGOT: คำอธิบายข้อ 5 ทาง A → SIGNUP (relink=true + ช่องชื่อผู้ใช้เดิม)
     → มี user (โดเมนพนักงาน) → LOADING
         accounts/{uid} ไม่มี:
           clock.last.uid === uid และเคยมี sid → ACCOUNT_MOVED (ข้อ 5)
           info ไม่มี            → NEED_REQUEST (ชื่อเล่นจาก draft หรือให้กรอก + ปุ่ม "ส่งคำขอให้เจ้าของ")
           info pending register → WAIT_ACCOUNT ("ส่งคำขอแล้ว รอเจ้าของอนุมัติ" ถ้า info.did ≠ devPending.did
                                    แสดงเพิ่ม "คำขอนี้ส่งจากมือถือเครื่องอื่น" + ปุ่ม "ส่งจากเครื่องนี้แทน" = ลบแล้วสร้างใหม่)
           info rejected         → REJECTED_ACCOUNT ("เจ้าของไม่อนุมัติ" + "ส่งคำขอใหม่" + "ออกจากระบบ")
         accounts/{uid} = sid → ฟัง staff/{sid}:
           staff.active === false                            → DISABLED
           staff.deviceId && staff.deviceId === myDev().did  → MAIN / HIST / CORR_* (เดิม)
           info pending device && info.did === devPending.did → WAIT_DEVICE ("รอเจ้าของอนุมัติมือถือเครื่องนี้")
           info rejected (kind device)                       → REJECTED_DEVICE (+ "ขอใหม่")
           clock.last.did เคยเท่ากับ staff.deviceId แต่ตอนนี้ไม่ตรงแล้ว → REPLACED
                 ("มีการอนุมัติมือถือเครื่องอื่นแทนเครื่องนี้แล้ว" + "ขอใช้เครื่องนี้แทน")
           อื่นๆ → NEW_DEVICE ("มือถือเครื่องนี้ยังไม่ได้ผูกกับบัญชีของคุณ"
                 + ถ้า staff.deviceId มีค่า: "ถ้าขอใช้เครื่องนี้ เครื่องเดิมจะลงเวลาไม่ได้"
                 + ปุ่ม "ขอใช้เครื่องนี้" (kind device) + "ออกจากระบบ")
MAIN: ถ้า info pending device และ info.did ≠ myDev().did → แถบเหลือง
      "มีคนขอใช้บัญชีของคุณบนมือถือเครื่องอื่น — ถ้าไม่ใช่คุณ แจ้งเจ้าของทันที"
```
- ปุ่ม "ออกจากระบบ" อยู่ทุกหน้าที่ไม่ใช่ MAIN และอยู่ท้ายหน้าประวัติ (ตัวเล็ก ต้องกดยืนยัน) หน้า MAIN ไม่มีปุ่มนี้ตามหลัก "ปุ่มใหญ่ปุ่มเดียว"
- คำขอทุกแบบส่ง: `info.did`, `requestedAt: serverTimestamp()`, `status: 'pending'`, `userAgent` (≤300), `standalone` (`navigator.standalone === true || matchMedia('(display-mode: standalone)').matches`), `key` จาก devPending
- ก่อนส่งคำขอใหม่ ถ้ามีคำขอเดิมของ uid นี้ ให้ `remove(deviceRequests/{uid})` ก่อน (rules ยอมให้ลบของตัวเอง)

### 7.4 ฟอร์มและข้อความ
- ช่องชื่อผู้ใช้: `autocomplete="username" autocapitalize="none" spellcheck="false"` แสดงค่าที่แปลงเป็นตัวเล็กแล้ว; ช่องรหัสผ่าน: `autocomplete="current-password"` (เข้าสู่ระบบ) / `"new-password"` (สมัคร) เพื่อให้มือถือจำรหัสให้
- ตัวอักษร ≥ 20px ปุ่ม ≥ 56px ปุ่มหลักเต็มความกว้าง ข้อความผิดพลาดอยู่ใต้ช่องนั้น

| กรณี | ข้อความ |
|---|---|
| username ไม่ผ่าน `USERNAME_RE` | "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9 และ _ ยาว 3-20 ตัว (ไม่ใช้ภาษาไทย/ช่องว่าง)" |
| ชื่อเล่นว่าง/ยาวเกิน | "ใส่ชื่อเล่น (ไม่เกิน 20 ตัว)" |
| รหัสสั้นกว่า 6 / `auth/weak-password` / `auth/password-does-not-meet-requirements` | "รหัสผ่านต้องมีอย่างน้อย 6 ตัว" |
| รหัส 2 ช่องไม่ตรง | "รหัสผ่านสองช่องไม่ตรงกัน" |
| `auth/email-already-in-use` | "ชื่อผู้ใช้นี้มีคนใช้แล้ว — ลองชื่ออื่น ถ้าเป็นของคุณให้กด 'เข้าสู่ระบบ'" |
| `auth/invalid-credential` / `wrong-password` / `user-not-found` / `invalid-email` | "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" |
| `auth/too-many-requests` | "ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่" |
| `auth/network-request-failed` | "ไม่มีอินเทอร์เน็ต — ต่อเน็ตแล้วลองใหม่" |
| `auth/operation-not-allowed` / `auth/admin-restricted-operation` | "ร้านยังไม่เปิดให้สมัคร — แจ้งเจ้าของร้าน" |
| `auth/user-disabled` | "บัญชีนี้ถูกปิด — แจ้งเจ้าของร้าน" |
| `auth/user-token-expired` / ถูกล็อกเอาต์เอง | "กรุณาเข้าสู่ระบบอีกครั้ง (ถ้าไม่ได้เปลี่ยนรหัสผ่านเอง ให้แจ้งเจ้าของ)" |
| เขียนคำขอสมัครแล้วถูกปฏิเสธ | "ร้านปิดรับสมัครชั่วคราว — แจ้งเจ้าของร้าน" |
| ส่งคำขอเครื่องแล้วถูกปฏิเสธ | "ส่งคำขอไม่สำเร็จ — ถ้ามีคำขอค้างอยู่ให้รอเจ้าของ หรือแจ้งเจ้าของ" |
| บันทึกเวลาแล้วได้ PERMISSION_DENIED ขณะอยู่หน้า MAIN | อ่าน `staff/{sid}` ใหม่ ถ้า deviceId ไม่ตรงแล้ว → REPLACED ถ้าตรง → ข้อความเดิม "บันทึกไม่สำเร็จ…" |

### 7.5 การเขียนที่ต้องแนบ proof
- `save()` (ข้อ 2.5 เฟส 1): เพิ่ม `` [`devproof/${sid}`]: { k: myDev().k, at: serverTimestamp() } `` ใน update เดิม
- ส่งคำขอแก้เวลา: เปลี่ยนจาก `set(corrections/cid)` เป็น `update(A(''), { ['corrections/'+cid]: body, ['devproof/'+sid]: proof })`
- ลบคำขอแก้เวลา: `update(A(''), { ['corrections/'+cid]: null, ['devproof/'+sid]: proof })`
- การอ่าน (history/logs/state/corrections query) ไม่ต้องแนบ proof
- ห้าม `console.log` ค่า `k` หรือใส่ลงในข้อความ error

### 7.6 INSTALL (iOS)
ใช้การ์ดเดิม เปลี่ยนข้อความเป็น "ติดตั้งก่อน แล้วค่อยสมัคร/เข้าสู่ระบบจากไอคอน (ถ้าทำใน Safari ก่อน ต้องให้เจ้าของอนุมัติเครื่องซ้ำ)"

---

## 8. `clock-master.html`

### 8.1 ลบออก
`listen('staffSecret')`, `D.secret` (รวมเงื่อนไขใน `renderPending` ที่รอ `D.secret`), ป้าย PIN, `approve(..., pinOk)`, `PIN_RE`, ช่อง PIN ในฟอร์มเพิ่ม, `resetPin`, การใช้ `deviceApproved`

### 8.2 รอตรวจ > ส่วน "คำขอสมัคร / ผูกเครื่อง" (ตัวเลขบนแท็บนับเฉพาะ pending)
**การ์ด kind `register`:**
- แสดง: ชื่อผู้ใช้ (ตัวหนา), ชื่อเล่น (แก้ได้ในการ์ด), เวลาที่ขอ, รุ่นเครื่อง (ย่อ userAgent ให้อ่านง่าย + ข้อความเต็ม), ป้าย "ยังไม่ได้ติดตั้งเป็นแอป" ถ้า `standalone` ไม่ใช่ true, ป้าย "อ้างว่าเป็นพนักงานเดิม (ชื่อเดิม: x)" ถ้ามี `relink`
- ตัวเลือก: ◉ สร้างพนักงานใหม่ / ○ เชื่อมกับพนักงานเดิม [dropdown พนักงาน เลือกให้อัตโนมัติถ้า `oldUsername` ตรงกับใคร]
- ถ้าสร้างใหม่: สาขาหลัก (dropdown ค่าเริ่มต้น = สาขาแรก), เวลาเข้ากะ (07:00), เวลาเลิกกะ (18:00) ตรวจด้วย `SHIFT_RE`
- ปุ่ม: ✔ อนุมัติ / ✘ ไม่อนุมัติ / ลบ
- อนุมัติ (สร้างใหม่) = update เดียว: `sid = push(A('staff')).key`;
  `staff/{sid} = {nickname, username: info.username, branchId, shiftStart, shiftEnd, active: true, uid, deviceId: info.did, deviceAt: now, createdAt: now}`,
  `accounts/{uid} = sid`, `deviceKeys/{sid} = {k: req.key, did: info.did, at: now}`, `deviceRequests/{uid} = null` + audit แบบ best-effort `op: approve_register`
- อนุมัติ (เชื่อมกับพนักงานเดิม) = ข้อ 5 ทาง A ต้องกดยืนยันอีกครั้ง

**การ์ด kind `device`:**
- แสดง: ชื่อเล่น + ชื่อผู้ใช้ของ `accounts[uid]`, เวลาที่ขอ, รุ่นเครื่อง, ป้าย "จะแทนเครื่องเดิม (ผูกตั้งแต่ dd/mm)" ถ้า `staff.deviceId` มีค่า, ป้าย "ยังไม่ได้ติดตั้งเป็นแอป"
- อนุมัติ = `deviceKeys/{sid} = {k, did, at: now}`, `staff/{sid}/deviceId = did`, `staff/{sid}/deviceAt = now`, `deviceRequests/{uid} = null` + audit `op: approve_device` (ถ้าจะแทนเครื่องเดิมต้องกดยืนยัน "เครื่องเดิมของ X จะลงเวลาไม่ได้ทันที")
- ไม่อนุมัติ = `deviceRequests/{uid}/info/status = 'rejected'`; ลบ = `deviceRequests/{uid} = null`

**ปุ่มรวมท้ายส่วน:** "ลบคำขอที่ไม่อนุมัติทั้งหมด" และ "ลบคำขอสมัครที่ค้างเกิน 14 วัน" (update เดียวที่ใส่ null หลาย path และต้องกดยืนยัน) ถ้ามีคำขอสมัคร pending มากกว่า 10 รายการ ให้ขึ้นแถบเตือน "อาจเป็นสแปม — ปิดรับสมัครได้ที่ ตั้งค่าสาขา > ค่าทั่วไป"
- ข้อมูลที่มาจากพนักงาน (username/nickname/userAgent/oldUsername) แสดงด้วย `textContent` เท่านั้น
- `key` ห้ามแสดงบนจอหรือ log

### 8.3 แท็บ พนักงาน
- คอลัมน์: ชื่อเล่น | ชื่อผู้ใช้ | สาขาหลัก | เวลาเข้ากะ | เวลาเลิกกะ | บัญชี | เครื่อง ("ผูกแล้ว dd/mm" / "ยังไม่ผูกเครื่อง" / "ยังไม่มีบัญชี" ถ้าไม่มี uid)
- ปุ่มต่อแถว: แก้ไข (ชื่อเล่น/สาขา/กะ; username แก้ไม่ได้เพราะผูกกับบัญชี), ยกเลิกผูกเครื่อง (`deviceKeys/{sid}: null, staff/{sid}/deviceId: null, deviceAt: null` + กดยืนยัน), ตั้งบัญชีใหม่ (ลืมรหัส) (ข้อ 5 ทาง B), ปิด/เปิดบัญชี (เดิม) **ลบปุ่ม "รีเซ็ต PIN"**
- ฟอร์มด้านบนเปลี่ยนเป็น **"สร้างบัญชีให้พนักงาน"**: ชื่อผู้ใช้, ชื่อเล่น, รหัสผ่าน ×2, สาขา, เข้ากะ, เลิกกะ → ข้อ 8.4 → update เดียว `staff/{sid}` (ไม่มี deviceId) + `accounts/{uid} = sid` แล้วแสดง "บอกพนักงาน: ชื่อผู้ใช้ X และรหัสผ่านที่ตั้งไว้ เปิดแอปแล้วกด 'เข้าสู่ระบบ' จากนั้นกด 'ขอใช้เครื่องนี้'" พร้อมหมายเหตุว่าพนักงานสมัครเองได้ด้วย
- ไม่มีปุ่มลบพนักงาน (log อ้างถึง sid) เหมือนเดิม

### 8.4 สร้างบัญชีโดยแอดมินไม่หลุด
```js
let provAuth = null;
async function provisionAccount(username, password) {
  if (!provAuth) {
    const pApp = initializeApp(DEMO ? { demo: true } : EMU ? EMU_CFG : FIREBASE_CONFIG, 'provision');
    provAuth = initializeAuth(pApp, { persistence: inMemoryPersistence });
    if (EMU) connectAuthEmulator(provAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  try { return (await createUserWithEmailAndPassword(provAuth, staffEmail(username), password)).user.uid; }
  finally { await signOut(provAuth).catch(() => {}); }
}
```
- import เพิ่มจาก firebase-auth 13.1.0 เดิม: `initializeAuth`, `inMemoryPersistence`, `createUserWithEmailAndPassword` (`EMU_CFG` = config emulator ที่มีอยู่แล้ว ดึงออกมาเป็นค่าคงที่)
- ถ้าสร้างบัญชีได้แต่เขียนฐานข้อมูลไม่ได้ ให้แสดง uid + username พร้อมปุ่ม "เขียนข้อมูลอีกครั้ง" (บัญชีมีอยู่แล้ว ถ้าสร้างซ้ำจะได้ email-already-in-use)
- ใช้ข้อความ error ชุดเดียวกับข้อ 7.4

### 8.5 ตั้งค่าสาขา > ค่าทั่วไป
สวิตช์ "เปิดรับสมัครพนักงานใหม่ในแอป" → `settings/registrationOpen` (ไม่ได้ตั้งค่า = เปิด) ตอนปิดจะสมัครใหม่ไม่ได้ ส่วนคำขอใช้เครื่องของพนักงานเดิมยังส่งได้

### 8.6 ส่วนอื่น
สถานะวันนี้ / รอตรวจ log / บันทึกเวลา / รายงาน / CSV อ่าน `D.staff` ด้วยสิทธิ์แอดมินอยู่แล้ว ไม่ต้องแก้ (นอกจากตัดการรอ `D.secret`) ถ้าอยากแสดง username ในรายงานให้ถือเป็นงานแยก

---

## 9. DEMO MODE (สิ่งที่ shim ต้องรองรับ ทำหลังงานเดโมของอีก agent commit แล้ว)

ตอนนี้ `demo/firebase-demo.mjs` มี `signInAnonymously`, `signInWithEmailAndPassword` (เฉพาะใน `__users`), `signOut`, persistence แยกตามชื่อ app และฐานข้อมูลใน localStorage **ที่ไม่ตรวจ rules** สิ่งที่ต้องเพิ่ม/เปลี่ยน:
1. `createUserWithEmailAndPassword(auth, email, password)`: อีเมลซ้ำ → `auth/email-already-in-use`, รหัสสั้นกว่า 6 → `auth/weak-password`, อีเมลผิดรูปแบบ → `auth/invalid-email`; สร้าง uid สุ่ม (28 ตัว) เก็บใน `__users` ล็อกอินให้ auth ตัวนั้น และคืน `{ user }`
2. `signInWithEmailAndPassword` ต้องใช้ได้กับ app ค่าเริ่มต้น (`clock.html`) และเคารพ persistence (LOCAL = อยู่ข้ามแท็บ/รีโหลด, SESSION = ต่อแท็บ, NONE = ในหน่วยความจำ) user object = `{ uid, email, isAnonymous: false }`; ผิด → `auth/invalid-credential`
3. `initializeAuth(app, { persistence })` + `inMemoryPersistence` (ใช้กับ app `'provision'`), `deleteUser(user)` (ลบจาก `__users` แล้วล็อกเอาต์)
4. เลิกใช้ `signInAnonymously` (จะคงไว้ก็ได้ แต่แอปไม่เรียกแล้ว)
5. `crypto.getRandomValues` มีอยู่แล้วในหน้า http ไม่ต้องทำ fallback; คีย์ใหม่ `clock.dev` / `clock.devPending` ถูก shim แปลงเป็น `clockdemo.ls.clock.*` ให้อยู่แล้ว (`firebase-demo.mjs` บรรทัด 5-9) แอปจึงไม่ต้องแก้อะไรเพื่อเดโม แต่ seed ที่เขียนกุญแจของ บี ต้องเขียนลงคีย์ `clockdemo.ls.clock.dev` และ "ล้างข้อมูลเดโม" ล้างให้อยู่แล้ว (ลบทุกคีย์ `clockdemo.`)
   - README หัวข้อ "โหมดเดโม" (เพิ่มใน `bfde3b5`) ต้องเปลี่ยนบรรทัดบัญชีตัวอย่างจาก PIN เป็นชื่อผู้ใช้/รหัสผ่านตามข้อ 6
6. **seed ใหม่** (แทน PIN):
   - เจ้าของ: `admin@demo` / `demo1234` (เดิม)
   - เอ `nong_a` / `111111`: มีบัญชีและ staff แล้ว **ยังไม่ผูกเครื่อง** (สาธิต "ขอใช้เครื่องนี้" แล้วอนุมัติ)
   - บี `nong_b` / `222222`: ผูกเครื่องกับเบราว์เซอร์นี้แล้ว (seed `deviceKeys` + `staff.deviceId` และเขียน `localStorage['clock.dev']` ให้ตรงกัน) ล็อกอินแล้วกดเข้างานได้ทันที
   - ซี `nong_c` / `333333`: ปิดบัญชี (สาธิต DISABLED)
   - คำขอสมัครค้าง 1 รายการ: `newbie` ชื่อเล่น "ใหม่" (สาธิตการ์ดอนุมัติพร้อมเลือกสาขา/กะ)
   - `accounts/{uid}` ของทุกคนที่มีบัญชี และอีเมลทุกบัญชีใช้ `STAFF_EMAIL_DOMAIN`
7. ปุ่มบนแถบเดโม **"จำลองมือถือเครื่องใหม่"** = ลบ `clock.dev`/`clock.devPending` + ล็อกเอาต์ app ค่าเริ่มต้น (ใช้สาธิต NEW_DEVICE / REPLACED / ลืมรหัส)
8. `demo.html` ตารางบัญชี + ขั้นตอนใหม่: (ก) สมัครชื่อใหม่ในแท็บแอปพนักงาน → อนุมัติในแท็บ master (เลือกสาขา/กะ) → กดเข้างาน (ข) ล็อกอิน `nong_a` → ขอใช้เครื่องนี้ → อนุมัติ (ค) ล็อกอิน `nong_b` แล้วกดได้เลย (ง) ลืมรหัส: กดจำลองเครื่องใหม่ → ลืมรหัสผ่าน → สมัคร `nong_b2` → master เชื่อมกับ บี (จ) master สร้างบัญชีให้พนักงาน
9. ข้อจำกัดที่ต้องเขียนใน demo.html: เดโมไม่ตรวจ Security Rules จึงไม่ได้แสดงว่า "เครื่องที่ไม่มีกุญแจถูกปฏิเสธ" (เห็นได้บน emulator/ของจริงเท่านั้น) ขั้นตอนบนหน้าจอเหมือนของจริงทุกอย่าง

---

## 10. เทส

### 10.1 helper และ seed ใน `tests/rules.test.mjs` (ทำก่อนเขียนเทสใหม่)
```js
const DOM = '@staff.ngluckseng.invalid';
const UN = { u1: 'nong_a', u2: 'nong_b', u3: 'nong_c', u5: 'nong_e', u7: 'nong_a2', u9: 'newbie' };
const KEYOF = { s1: 'a'.repeat(43), s2: 'b'.repeat(43), s3: 'c'.repeat(43) };
const DID = { s1: 'did_s1_000000000000', s2: 'did_s2_000000000000', s3: 'did_s3_000000000000' };
const staffDb = (uid) => env.authenticatedContext(uid, { email: (UN[uid] || uid) + DOM, firebase: { sign_in_provider: 'password' } }).database();
const stranger = (uid) => env.authenticatedContext(uid, { email: uid + '@gmail.com', firebase: { sign_in_provider: 'password' } }).database();
const admin = () => env.authenticatedContext('adm', { email: 'boss@test.com', firebase: { sign_in_provider: 'password' } }).database();   // ต้องมี email แล้ว
// anon(), anonAsAdminUid(), guest() คงไว้ใช้ทดสอบว่า "ถูกปฏิเสธ"
```
- seed: `admins/adm`, `branches/b1` (เดิม), `staff/s1..s5` ให้มี `username` และไม่มี `deviceApproved`; s1/s2/s3 มี `uid`, `deviceId`, `deviceKeys`; s4 ไม่มี uid (บัญชีที่ยังไม่มีเจ้าของ); s5 มี uid u5 + `accounts/u5` แต่ไม่มี `deviceKeys` (แทนกรณี deviceApproved=false); `accounts/u1..u3,u5`; ไม่มี `staffSecret`
- `build()` เพิ่มตัวเลือก `proof` (ค่าเริ่มต้น = ส่ง `devproof/{sid} = {k: KEYOF[sid], at: serverTimestamp()}`; `proof: false` = ไม่ส่ง; `proof: {k}` = กุญแจที่กำหนด) และเพิ่ม helper `corrCreate(db, cid, body, {proof})` / `corrDelete(db, cid, sid, {proof})`
- แทน `anon('uX')` ทุกจุดที่ใช้เป็น "พนักงาน" ด้วย `staffDb('uX')` (ค้นด้วย `anon('u`)

### 10.2 เทสเดิมที่เขียนใหม่หรือเลิกใช้
| เทส | เดิม | ตอนนี้ | เหตุผล |
|---|---|---|---|
| R2 | anonymous อ่าน staff/branches ได้ | สมาชิกอ่าน branches/settings/`staff/{ตัวเอง}` ได้; อ่าน `staff` ทั้งก้อนไม่ได้ | staff/branches ไม่เปิดให้ทุกคนแล้ว |
| R3 | anonymous อ่านโหนดลับไม่ได้ (รวม staffSecret) | `stranger` + `anon` อ่าน admins/deviceRequests/state/logs/accounts/deviceKeys/devproof ไม่ได้; ตัด staffSecret | staffSecret ถูกลบ และมีโหนดใหม่ |
| R4 | เครื่องที่ยังไม่อนุมัติ (s5 deviceApproved=false) | s5 ไม่มี deviceKeys / s4 ไม่มี uid / uid ไม่ตรง / guest → ปฏิเสธ | deviceApproved ถูกลบ |
| R15 | deviceRequests แบบ PIN | **เลิกใช้** แทนด้วย R62-R65 | รูปแบบคำขอใหม่ทั้งหมด |
| R16 | anonymous เขียน staff/uid เอง | `staffDb`/`stranger` เขียน `staff/s4/uid`, `accounts/{ตัวเอง}`, `deviceKeys` ไม่ได้ | ตัวตนแบบใหม่ |
| R17 | แอดมินเพิ่ม staff+staffSecret และอนุมัติด้วย uid | แอดมินอนุมัติคำขอ register (update เดียว 4 path) แล้วพนักงานกด in ได้; ยกเลิกผูกเครื่อง; ส่วนเฟส 2 (state + audit) คงเดิม | flow ใหม่ |
| R18 | admin uid แบบ anonymous อ่าน staffSecret | admin uid แบบ anonymous อ่าน logs/เขียน staff/branches ไม่ได้ (ตัด staffSecret) | staffSecret ถูกลบ |
| R21 | ห้าม pinHash ใน staff และ pinHash ผิดรูปแบบใน staffSecret | ห้าม pinHash / deviceApproved ใน staff, branchId/shiftStart ผิด (เดิม); บรรทัด staffSecret ย้ายไป R74 | — |
| R27 | anonymous เขียน settings/days/branches/admins/staffSecret | ใช้ `staffDb('u1')` และตัด staffSecret | — |
| R53 | correction จาก s5 (deviceApproved=false) | s5 ไม่มีกุญแจ, s3 ปิดบัญชี, s4 ไม่ผูก, s1 ไม่ส่ง proof → ปฏิเสธ; s1 ส่ง proof → ผ่าน | — |
| R59 | บรรทัดสุดท้าย `anon('u9')` อ่าน `staff/s1` ได้ | `staffDb('u1')` อ่าน `staff/s1` ได้ และ `stranger('x')` อ่านไม่ได้ (บรรทัดอื่นคงเดิม) | staff ไม่เปิดให้ทุกคนอ่านแล้ว |
| R5-R14, R19-R20, R22-R26, R28-R52, R54-R58, R60 | — | ตรรกะเดิม เปลี่ยนแค่ context เป็น `staffDb` และ `build()` ส่ง proof | regression ของเฟส 1-3 |

### 10.3 เทสใหม่ R61-R76
| # | ผู้ใช้ | การกระทำ | ผลที่ต้องได้ |
|---|---|---|---|
| R61 | หลายแบบ | ADMIN: แอดมิน password + อีเมลปกติ อ่าน logs/staff ได้; uid ใน admins แต่อีเมลเป็นโดเมนพนักงาน อ่าน logs/staff/deviceRequests และเขียน branches ไม่ได้; uid ใน admins แบบ anonymous ไม่ได้; uid ใน admins ที่ provider เป็น `google.com` ไม่ได้ | ผ่าน / ปฏิเสธ ×3 |
| R62 | `staffDb('u9')` (newbie ยังไม่มีบัญชี) | สร้างคำขอ register ถูกต้อง; username ไม่ตรง token; username ตัวใหญ่/สั้น/มีจุด; ชื่อเล่น 21 ตัว; ไม่มี nickname; `key` ผิดรูปแบบ; ไม่มี key; did สั้น; status rejected/approved; requestedAt=123; ฟิลด์แปลกใน info และที่ระดับ `$uid`; เขียน path ของ uid อื่น; `stranger` (อีเมล gmail) สร้าง register; guest | ผ่าน / ที่เหลือปฏิเสธทั้งหมด |
| R63 | ตัวเอง/คนอื่น/แอดมิน | ตัวเองอ่าน `info` ได้ แต่อ่าน `deviceRequests/u9` ทั้งก้อนและ `/key` ไม่ได้; uid อื่นอ่าน `info` ไม่ได้; แอดมินอ่าน `deviceRequests` ทั้งหมด (รวม key) ได้ | ผ่าน / ปฏิเสธ ×2 / ปฏิเสธ / ผ่าน |
| R64 | `staffDb('u9')` + แอดมิน | ทับคำขอ pending ไม่ได้; update `info/status` เองไม่ได้; ลบของตัวเองได้; สร้างใหม่ได้; แอดมินตั้ง rejected ได้; หลัง rejected ตัวเองสร้างทับได้; แอดมินลบได้ | ตามที่ระบุ |
| R65 | `staffDb('u1')`, `u3`, `u9` | register เมื่อมี accounts แล้ว (u1) → ปฏิเสธ; device ของ u1 (active) → ผ่าน; device ของ u3 (ปิดบัญชี) → ปฏิเสธ; device ของ u9 (ยังไม่มีบัญชี) → ปฏิเสธ; ตั้ง `registrationOpen=false` แล้ว u9 register → ปฏิเสธ แต่ u1 device → ผ่าน | ตามที่ระบุ |
| R66 | แอดมิน | อนุมัติ register: update เดียว staff+accounts+deviceKeys+ลบคำขอ → ผ่าน; ไม่เขียน accounts → ปฏิเสธ; accounts ชี้ sid ที่ uid ต่างกัน → ปฏิเสธ; deviceKeys.did ≠ staff.deviceId → ปฏิเสธ; staff.deviceId โดยไม่มี deviceKeys → ปฏิเสธ; staff ไม่มี username / username ผิดรูปแบบ → ปฏิเสธ; deviceKeys.at ≠ now / k สั้น → ปฏิเสธ; หลังอนุมัติ u9 กด in พร้อม proof ได้ | ตามที่ระบุ |
| R67 | `staffDb('u9')` (pending), `staffDb('u1')` | เขียน `accounts/u9`, `deviceKeys/s4`, `staff/s4` (อนุมัติตัวเอง) ไม่ได้; อ่าน `accounts/u1` ของตัวเองได้ แต่ `accounts/u2` และ `accounts` ทั้งก้อนไม่ได้; อ่าน `deviceKeys/s1`, `devproof/s1` ไม่ได้ (แอดมินก็ไม่ได้) | ตามที่ระบุ |
| R68 | `staffDb('u1')` | in พร้อม proof ถูก → ผ่าน; ไม่มี proof → ปฏิเสธ; กุญแจผิด → ปฏิเสธ; มี devproof เก่าค้างใน DB (seed `at` ย้อนหลัง k ถูก) แต่ไม่ส่ง proof → ปฏิเสธ; ส่ง proof ผิด sid (`devproof/s2`) → ปฏิเสธ; เขียน devproof เดี่ยวๆ (k ถูก) → ผ่าน (ไม่มีผลอะไร); devproof `at`=123 / ฟิลด์แปลก → ปฏิเสธ; `staffDb('u2')` เขียน `devproof/s1` ด้วย k ที่ถูก → ปฏิเสธ; ลบ `deviceKeys/s1` แล้วส่ง proof ที่ไม่มี k (`null === null`) → ปฏิเสธ | ตามที่ระบุ |
| R69 | "เพื่อนที่รู้รหัส" = `staffDb('u1')` ที่ไม่มี k | อ่าน state/logs/corrections ของ s1 ได้ (ข้อจำกัดที่ยอมรับ); in/break/out ไม่ได้; สร้าง correction ไม่ได้; ลบ correction pending ของ s1 ไม่ได้; ส่งคำขอ device ได้เมื่อยังไม่มีคำขอ pending และทับคำขอ pending ไม่ได้ | ตามที่ระบุ |
| R70 | แอดมิน + `staffDb('u1')` | แอดมินอนุมัติเครื่องใหม่ (deviceKeys k ใหม่ + deviceId ใหม่) แล้วกุญแจเก่ากด in ไม่ได้ กุญแจใหม่กดได้ | ตามที่ระบุ |
| R71 | แอดมิน, u1 (เดิม), u7 (ใหม่) | relink s1 จาก u1 ไป u7 (accounts u1=null, u7=s1, staff uid/username, deviceKeys ใหม่, ลบคำขอ) → ผ่าน; จากนั้น u1 อ่าน state/logs/corrections query ของ s1 ไม่ได้และกด in ไม่ได้; u7 ทำได้ทั้งหมด; log เก่า (uid u1) แอดมินยังแก้ ts พร้อม audit ได้และเปลี่ยน uid ใน log ไม่ได้ | ตามที่ระบุ |
| R72 | แอดมิน + `staffDb('u1')` | ยกเลิกผูกเครื่อง (ลบ deviceKeys + deviceId) แล้ว in/correction ไม่ได้ แต่ส่งคำขอ device ได้; ปิดบัญชีแล้ว in ไม่ได้แม้ k ถูก, devproof ไม่ได้, คำขอ device ไม่ได้; เปิดบัญชีกลับแล้วกดได้ | ตามที่ระบุ |
| R73 | `stranger`, `staffDb('u9')`, `staffDb('u1')` | stranger และ u9 (pending) อ่าน branches/settings/staff ไม่ได้; u1 อ่าน branches/settings/staff/s1 ได้แต่ staff/s2 ไม่ได้; หลังแอดมินอนุมัติ u9 อ่าน branches ได้ | ตามที่ระบุ |
| R74 | แอดมิน/พนักงาน | ลบ staffSecret แล้ว: แอดมินอ่าน/เขียน `staffSecret/s1` ไม่ได้; แอดมินเขียน `staff/s1/deviceApproved` / `deviceApprovedAt` / `pinHash` ไม่ได้ | ปฏิเสธทั้งหมด |
| R75 | แอดมิน/พนักงาน | `settings/registrationOpen`: แอดมินตั้ง true/false ได้, "no" ไม่ได้, `staffDb('u1')` ตั้งไม่ได้ | ผ่าน ×2 / ปฏิเสธ ×2 |
| R76 | แอดมิน + บัญชีที่เจ้าของสร้าง | staff ใหม่ + accounts (ไม่มี deviceId/deviceKeys) → ผ่าน; พนักงานคนนั้นกด in ไม่ได้ (ยังไม่มีกุญแจ); ส่งคำขอ device แล้วแอดมินอนุมัติ → กด in ได้ | ตามที่ระบุ |

- เมื่อเสร็จ `npm test` ต้องผ่าน R1-R14, R16-R60 (ที่ปรับแล้ว) + R61-R76 + U1-U25 แล้วอัปเดตตัวเลข `pass N` ใน docs/testing.md ตามผลจริง
- `docs/testing.md` ข้อ 4 (Rules Playground): เปลี่ยน provider `anonymous` เป็น `password` + email ของพนักงาน เพิ่มเคส R61 (แอดมินที่ใช้อีเมลพนักงาน), R63 (อ่าน key ไม่ได้), R67, R73 และระบุว่าเคส proof (R68) ทดสอบได้เฉพาะใน emulator เพราะเป็น multi-path

### 10.4 `tests/seed-phase3.mjs`
- สร้างผู้ใช้ใน Auth emulator ผ่าน REST `accounts:signUp` (`nong_a`/`nong_b`/`nong_c` รหัส `111111`) แล้วเอา `localId` ไปใส่ `staff/{sid}/uid` และ `accounts/{uid}`
- ค่าเริ่มต้นไม่ seed deviceKeys (ให้ล็อกอินในเบราว์เซอร์แล้วขอใช้เครื่อง จากนั้นอนุมัติใน master) ถ้าใส่ `--bind` ให้ seed `deviceKeys` แล้วพิมพ์บรรทัด JS สำหรับวางใน DevTools เพื่อตั้ง `localStorage['clock.dev']`
- ตัด `staffSecret` และ PIN ออก, `--clean` ให้ลบ `accounts`, `deviceKeys`, `devproof`, `deviceRequests` ด้วย

### 10.5 E2E (emulator auth+database + เบราว์เซอร์ ใส่ใน docs/testing.md)
ใช้ Chrome โปรไฟล์ปกติ = "มือถือ 1", หน้าต่าง Incognito = "มือถือ 2", อีกหน้าต่าง = master (`?emu=1`) Auth emulator รองรับ email/password อยู่แล้ว (`tests/firebase.json` เปิด port 9099 ไว้)
| # | ขั้นตอน | ที่ต้องเห็น |
|---|---|---|
| E1 | มือถือ 1 สมัคร `nok` / ชื่อเล่น "นก" / `123456` | WAIT_ACCOUNT; master มีการ์ดสมัคร (ตัวเลขบนแท็บ +1) |
| E2 | master เลือกสาขา/กะ แล้วอนุมัติ | มือถือ 1 เข้า MAIN เองภายใน 2 วิ; กด in/พัก/กลับ/ออกได้ (Sensors อยู่ในรัศมี) |
| E3 | สมัครชื่อซ้ำ `nok` จากมือถือ 2 | "ชื่อผู้ใช้นี้มีคนใช้แล้ว…" |
| E4 | มือถือ 2 ล็อกอิน `nok` | NEW_DEVICE; หลังมือถือ 2 กด "ขอใช้เครื่องนี้" มือถือ 1 ขึ้นแถบเหลือง; ก่อนอนุมัติมือถือ 2 ไม่มีปุ่มลงเวลา (ถ้าลองยิง update เองจาก DevTools ต้องได้ PERMISSION_DENIED) |
| E5 | master อนุมัติเครื่องของมือถือ 2 (มีป้าย "จะแทนเครื่องเดิม") | มือถือ 2 → MAIN; มือถือ 1 → REPLACED และกดไม่ได้ |
| E6 | มือถือ 1 ออกจากระบบแล้วล็อกอินใหม่ / มือถือ 2 ออกแล้วล็อกอินใหม่ | มือถือ 1 ยังเป็น REPLACED; มือถือ 2 → MAIN ทันที (กุญแจยังอยู่) |
| E7 | ล้างข้อมูลไซต์ของมือถือ 2 (DevTools > Application > Clear site data) | ต้องล็อกอินใหม่ แล้วเป็น NEW_DEVICE |
| E8 | ลืมรหัส: มือถือ 2 → ลืมรหัสผ่าน → สมัคร `nok2` (ชื่อเดิม `nok`) → master เชื่อมกับ "นก" | มือถือ 2 → MAIN; ประวัติเดิมยังอยู่; หน้าต่างที่ยังล็อกอิน `nok` อยู่เป็น ACCOUNT_MOVED |
| E9 | master > พนักงาน > สร้างบัญชี `dao` / `654321` | แอดมินไม่หลุด; มือถือ 1 ล็อกอิน `dao` → NEW_DEVICE → อนุมัติ → MAIN |
| E10 | master > ตั้งบัญชีใหม่ (ลืมรหัส) ให้ `dao` เป็น `dao2` | มือถือ 1 (ยังล็อกอิน `dao`) → ACCOUNT_MOVED; ล็อกอิน `dao2` → MAIN ทันทีโดยไม่ต้องอนุมัติเครื่อง |
| E11 | ปิดรับสมัคร แล้วสมัครชื่อใหม่ | "ร้านปิดรับสมัครชั่วคราว" และบัญชีที่เพิ่งสร้างถูกลบ (ไม่มีใน Auth emulator) |
| E12 | ปิดบัญชี "นก" ระหว่างกะ | มือถือ → DISABLED |
| E13 | ใส่ uid ของ `nok2` ลงใน `admins` ด้วย REST แล้วล็อกอิน master ด้วย `nok2@staff.ngluckseng.invalid` | "บัญชีนี้ไม่มีสิทธิ์เจ้าของร้าน" |
| E14 | regression เฟส 2-3: สร้าง/ลบคำขอแก้เวลาจากมือถือที่ผูกแล้ว, แก้เวลา/ยืนยันวันใน master, รายงาน/CSV, ประวัติ 30 วัน | ทำงานเหมือนเดิม |
| E15 | `?demo=1` ทั้งสองหน้า ตาม demo.html ใหม่ | ทำได้ทุกขั้นตอนในข้อ 9.8 |
| E16 | มือถือจริง: iPhone ติดตั้งก่อนแล้วสมัครในแอป / Android Chrome | ผ่านเกณฑ์ "ลงทะเบียนจนเข้างานได้ภายใน 1 นาที" (นับเวลาที่เจ้าของอนุมัติด้วย) |

---

## 11. ความเสี่ยง

| ความเสี่ยง | ระดับ | วิธีกัน |
|---|---|---|
| กฎของ STOCK MASTER ใช้ `auth != null` หรือเช็กแค่ provider/โดเมน | **สูง (ขวางการเปิดใช้)** | README ขั้นที่ 0 ใหม่ (allowlist `shopUsers`) + ให้ Boss ตรวจก่อนเปิด sign-up; ห้าม publish rules ของ attendance ก่อนแก้ข้อนี้ |
| แก้ข้อความ rules ยาวๆ ผิด (54 จุด + 4 จุด proof) | สูง | แทนข้อความแบบตรงตัว (ข้อ 4.1, 6.9-6.11) แล้วตรวจจำนวนด้วย grep + JSON.parse + รันเทสเดิมทั้งหมด |
| ลืมตรวจ `at === now` หรือลืมเช็กว่า deviceKeys เป็น string (`null === null`) | สูง | R68 ครอบคลุมทั้ง 2 กรณี |
| Firebase ไม่ยอมรับอีเมล `.invalid` | กลาง | ขั้น 0 ทดสอบกับโปรเจกต์จริงก่อน ถ้าไม่ได้ใช้ `.example` แทน |
| สแปมการสมัคร | กลาง | 1 คำขอ/uid, สวิตช์ปิดรับสมัคร, ลบทีละหลายรายการ, ผู้สมัครที่ยังไม่อนุมัติอ่านอะไรไม่ได้, Auth จำกัดจำนวนต่อ IP; ภายหลังเปิด App Check ได้ |
| คนที่รู้รหัสผ่านเปลี่ยนรหัส/ลบบัญชีพนักงานได้ (DoS) | กลาง | ใช้ทางลืมรหัส (relink) + README เตือน; เขียนไว้เป็นข้อจำกัด |
| iOS แยกที่เก็บข้อมูล/ITP ทำกุญแจหาย | กลาง | การ์ด INSTALL, ป้าย `standalone` ในการ์ดอนุมัติ, เขียนใน README |
| relink ผิดคน (เจ้าของเลือกพนักงานผิด) | กลาง | กดยืนยันอีกครั้งโดยแสดงชื่อและชื่อผู้ใช้เดิม-ใหม่ + audit `relink_account` (แก้กลับได้ด้วยการ relink อีกครั้ง) |
| ชนกับงานเดโม (ส่วน import ของ `clock.html`/`clock-master.html`) | กลาง | เริ่มงานนี้หลังงานเดโม commit แล้วและแตก branch จากตรงนั้น; ใช้รูปแบบ import ที่เดโมทำไว้ (`FBM ? [FBM,FBM,FBM] : await Promise.all([...])`) แล้วเพิ่มชื่อฟังก์ชันใหม่ทั้งฝั่ง SDK และ shim |
| ADMIN ใหม่ทำให้แอดมินที่ไม่มี email ใน token ถูกปฏิเสธ | ต่ำ | แอดมินสร้างด้วย Email/Password เสมอ (README ติดตั้งข้อ 3) และ helper ของเทสใส่ email แล้ว |
| deviceKeys เก็บแบบ plaintext | ต่ำ | ไม่มีกฎให้อ่าน มีแค่ Console และแอดมินที่เห็นตอนยังเป็นคำขอ ถ้าบัญชีแอดมินหลุดก็หลุดทั้งระบบอยู่แล้ว |

---

## 12. ลำดับงานสำหรับ code-builder (ทำทีละขั้นและรันเทสทุกขั้น ยังไม่มอบงานจนกว่าจะอนุมัติแผน)

0. **ตรวจโดเมนอีเมล** (ข้อ 2.1) กับ Auth emulator ใน `tests/` และกับโปรเจกต์จริงถ้าเจ้าของตั้งค่าแล้ว ถ้ายังไม่ได้ตั้งค่า Firebase ให้ใส่เป็นข้อในเช็กลิสต์ติดตั้งของ README
1. **ยืนยันว่างานเดโมจบแล้ว** (`bfde3b5` หรือใหม่กว่า, working tree สะอาด, ไม่มี agent อื่นแก้ `clock*.html`/`demo/` อยู่) แล้วแตก branch `auth-v2` จาก HEAD นั้น README ที่งานเดโมเพิ่มเข้ามาต้องคงไว้และปรับบัญชีเดโมให้ตรงกับข้อ 9
2. `database.rules.json` ตามข้อ 4.1 และ 6 → `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'))"` → นับด้วย grep (ข้อ 4.1)
3. `tests/rules.test.mjs`: helper/seed (10.1) → ปรับเทสเดิม (10.2) → R61-R76 (10.3) → `cd tests && npm test` ต้องผ่านทั้งหมด ถ้า emulator รันไม่ได้ (Java) ให้รายงานกลับ ห้ามข้าม
4. `clock-master.html` (ทำก่อน clock.html เพราะต้องใช้อนุมัติ): ลบ PIN/staffSecret (8.1) → การ์ดคำขอ (8.2) → แท็บพนักงาน + provisioning (8.3-8.4) → สวิตช์รับสมัคร (8.5)
5. `clock.html`: ค่าคงที่ + helper กุญแจ (2.1, 3.1-3.2) → AUTH/SIGNUP/LOGIN/FORGOT (7.3-7.4) → ระบุตัวตนด้วย accounts (7.2) → หน้าสถานะเครื่อง → แนบ proof (7.5) → INSTALL (7.6) แล้วยืนยันว่า SHARED CORE ไม่ถูกแตะ (`npm run test:core`)
6. demo shim / seed / `demo.html` ตามข้อ 9 (ไฟล์ของงานเดโม ทำหลังขั้น 1 เท่านั้น)
7. `tests/seed-phase3.mjs` (10.4); README: ขั้นที่ 0 ตามข้อ 4.3 ทุกคำ / ติดตั้ง: ปิด Anonymous, เปิด Email/Password + sign-up, (ไม่บังคับ) Password policy / เริ่มใช้: ให้พนักงานสมัครเอง → รอตรวจ → อนุมัติ + เลือกสาขา/กะ / ติดตั้งบนมือถือ / แก้ปัญหา: ลืมรหัส, เปลี่ยนมือถือ, ล้างข้อมูล, "มีคนขอใช้บัญชีของคุณ" / ข้อจำกัด: บอกรหัสผ่านให้คนอื่นแล้วเขาอ่านข้อมูลและเปลี่ยนรหัสได้, ใช้ได้มือถือเดียว; `docs/testing.md` (10.3 Playground + 10.5 E2E + ตัวเลข pass); ติดป้ายบรรทัดแรกของข้อ 3 ใน `docs/plan-phase1.md` และหน้าจอ A / ข้อ 5 / ข้อ 6 ใน `docs/clock-brief.md` ว่า "ถูกแทนด้วย docs/plan-auth-v2.md"
8. เพิ่ม `CACHE_VERSION` ใน `sw.js` เป็น `clock-v2` เพื่อให้ PWA ที่เคยติดตั้งไว้โหลดหน้าใหม่แน่นอน
9. E2E ตามข้อ 10.5 (E1-E15) บน emulator แล้วรายงานผล พร้อมรายการที่ยังทดสอบไม่ได้ (E16 มือถือจริง)

จากนั้น **code-reviewer** เน้น: การยกระดับสิทธิ์ (staff → admin, pending → member), ทางเลี่ยงการตรวจกุญแจ (proof เก่า, `null === null`, multi-path ที่เขียน deviceKeys เอง), การรั่วของ `k` (การอ่าน, log, console.log, ข้อความ error), XSS จาก username/nickname/userAgent, การชนกับงานเดโม และ regression ของ invariants ในข้อ 6.13 → แก้ตามรีวิว → **git-publisher** (commit บน branch `auth-v2` แล้วเปิด PR ไป `main`) **ทุกขั้นที่ publish ต้องให้ผู้ใช้ยืนยันก่อน** และห้าม publish rules ขึ้น Firebase จริงจนกว่าข้อ 4.3 จะเสร็จ

---

## 13. คำถามที่เหลือ (มีค่าเริ่มต้นแล้ว ไม่ตอบก็สร้างต่อได้)
1. **กฎของ STOCK MASTER / โปรแกรมอื่นของร้านใช้อะไรล็อกอิน และกฎเป็นแบบไหน** → *ค่าเริ่มต้น:* README บังคับให้ใช้ allowlist `shopUsers` ก่อนเปิด sign-up **ขวางการเปิดใช้จริง แต่ไม่ขวางการเขียนโค้ด**
2. **รหัสผ่านขั้นต่ำ** → *ค่าเริ่มต้น:* 6 ตัว ตัวเลขล้วนได้ (เปลี่ยนได้ที่ `PW_MIN` + Password policy ใน Console)
3. **เปิดรับสมัครเป็นค่าเริ่มต้นไหม** → *ค่าเริ่มต้น:* เปิด (`registrationOpen` ไม่ได้ตั้ง = เปิด) ปิดได้ในแท็บตั้งค่า
4. **ให้พนักงานเปลี่ยนรหัสผ่านเองในแอปไหม** → *ค่าเริ่มต้น:* ไม่มีในเวอร์ชันนี้ (ใช้ "ตั้งบัญชีใหม่" ผ่านเจ้าของ) ถ้าต้องการ เพิ่มปุ่มในหน้าประวัติที่เรียก `reauthenticateWithCredential` + `updatePassword` ได้ภายหลังโดยไม่ต้องแก้ rules
