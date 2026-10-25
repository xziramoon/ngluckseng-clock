# แผนงานเฟส 2: ตรวจธง, รอตรวจ, คำขอแก้เวลา, บันทึกเวลา, audit

> ยึด `docs/clock-brief.md` ข้อ 7 ข้อ 2 เป็นขอบเขต และต่อยอดจาก `docs/plan-phase1.md` (ตัวย่อ ADMIN/OWNS/STAFF_OK/DATE_RE/KEY_RE ใช้ความหมายเดิม)
> สถานะ: **รออนุมัติ** ยังไม่เริ่มเขียนโค้ด · Firebase จริงยังไม่ได้ตั้งค่า ทุกการทดสอบใช้ emulator เท่านั้น
> ไม่แตะ `gps-test.html` · UI ภาษาไทย · single-file HTML ไม่มี build tool · ข้อมูลจาก DB แสดงด้วย `textContent` เท่านั้น

## 0. สรุปการตัดสินใจหลัก

| เรื่อง | ที่เลือก | เหตุผลสั้นๆ |
|---|---|---|
| audit (review finding #7) | **บังคับใน rules**: การเขียนของแอดมินที่ `logs/…`, `state/…`, `days/…` ต้องสร้าง `audit/{aid}` ใหม่ใน multi-path update เดียวกัน node ที่ถูกแก้ต้องมี `auditId` ชี้ไป audit ที่ **ยังไม่เคยมี** และ `audit/{aid}/path` ต้องตรงกับ path ของ node นั้นพอดี และค่าสำคัญใน `before`/`after` ต้องตรงกับข้อมูลจริง | ทำได้จริงด้วยกลไกเดียวกับ log+state ของเฟส 1 (newData มองเห็นทั้ง update) ดูข้อ 4 |
| การลบ | **แอดมินลบ log/state/days ไม่ได้** ใช้ `voided:true` (ลบแบบเก็บหลักฐาน) และ `confirmed:false` (ปลดล็อก) | `.validate` ไม่ทำงานตอนลบ จึงผูก audit กับการลบไม่ได้ และหลักฐานไม่ควรหาย |
| หลักฐานจากเครื่อง | log ที่ `source:"app"` แอดมินแก้ได้แค่ `ts` (เก็บค่าเดิมใน `origTs` ครั้งแรก บังคับใน rules), `review`, `voided`, `note`, `correctionId`; ห้ามแก้ lat/lng/accuracy/distance/uid/type/branchId/flag | เวลาจริงจากเซิร์ฟเวอร์และพิกัดตอนกดต้องไม่หายแม้แต่แอดมินแก้ |
| ✘ ไม่ยืนยัน | `review:"rejected"` = **ไม่นับ** รายการนั้น (เหมือน voided) ทั้งไทม์ไลน์และชั่วโมง | ตรงกับความหมาย "ไม่ได้อยู่ที่ร้านจริง" (คำถามข้อ 13.1) |
| state หลังแอดมินแก้ | คำนวณ state ใหม่จาก log ของ "วันทำงานล่าสุด" เท่านั้น (`d >= state.workDate`) วันเก่ากว่าไม่แตะ state | ทำให้ STALE/ข้ามคืน/กะเดียวต่อวันยังทำงานถูกหลังแก้ ดูข้อ 7 |
| แข่งกันเขียน (แอดมินแก้ขณะพนักงานกด) | state ที่แอดมินเขียนต้องมี `prevLogId` = `lastLogId` ปัจจุบัน (compare-and-set ใน rules) | ถ้าพนักงานกดแทรก การเขียนของแอดมินจะถูกปฏิเสธ แล้ว master โหลดใหม่ |
| ล็อกวัน | `days/{d}/{sid}.confirmed === true` (ค่า **ก่อน** เขียน) ห้ามทั้งพนักงานและแอดมินเขียน log ของวันนั้น ต้องปลดล็อกแยกอีก write (มี audit) | "ล็อกไม่ให้แก้ต่อ เว้นแต่ปลดล็อก" ตาม brief; ยืนยันพร้อมแก้ใน write เดียวยังทำได้ |
| ยืนยันวันที่กะยังเปิด | rules ห้าม `confirmed:true` ถ้า state ของคนนั้นยัง working/on_break บนวันนั้น | กันพนักงานติดตาย (กดพัก/ออกไม่ได้เพราะวันถูกล็อก) |
| คำขอแก้เวลา | เพิ่ม type `break` (เริ่ม+จบพักในคำขอเดียว), `endTime`, `nextDay`/`endNextDay` (หลังเที่ยงคืน); พนักงานลบคำขอที่ยัง pending ของตัวเองได้; แอดมินตัดสินได้ครั้งเดียว ฟิลด์คำขอเดิมแก้ไม่ได้ (✎ แก้ = อนุมัติด้วยเวลาที่ปรับ เก็บใน `appliedTs`) | พนักงานเห็นทั้งเวลาที่ขอและเวลาที่อนุมัติจริง |
| `$d` ที่เลือกเองได้ (ข้อจำกัดเฟส 1) | (ก) **ทำแน่นอน**: คิวรอตรวจติดธง `bangkokDate(in.ts) !== workDate` (ผ่อนผัน 15 นาทีหลังเที่ยงคืน) และ `workDate` ในอนาคต; (ข) **ทำแต่ปิดไว้ก่อน**: ตาราง `calendar/{d}` = เวลาเที่ยงคืนกรุงเทพฯ + สวิตช์ `settings/calendarEnforced` ทำให้ rules ปฏิเสธ `in` ที่ `$d` ไม่ตรงวันจริงได้ | (ข) ปิดช่องโหว่ได้จริงใน rules แต่ถ้าปฏิทินไม่ครอบคลุม พนักงานทุกคนจะกดเข้างานไม่ได้ จึงให้เจ้าของเปิดเอง (คำถามข้อ 13.4) |
| ข้อมูลที่ master ฟัง | `logs` แบบ query `orderByKey().startAt(วันนี้−reviewDays)` **ไม่มี endAt** (จับวันในอนาคตได้), `days` ช่วงเดียวกัน, `corrections` ที่ `status == pending` | ร้านเล็ก ข้อมูล 31 วันมีไม่กี่พันรายการ |
| แผนที่ในรอตรวจ | Leaflet **แผนที่เดียว** ด้านขวา เปลี่ยนตามรายการที่เลือก | ไม่สร้างแผนที่ต่อการ์ด (หนัก) |
| audit ของ staff/branches | เขียน audit แบบ best-effort ฝั่ง client (ไม่บังคับใน rules) | ต้องแก้ทุก path ของเฟส 1 ถ้าจะบังคับ ความเสี่ยงไม่คุ้ม (คำถามข้อ 13.5) |

---

## 1. ขอบเขต

ทำในเฟส 2
1. `clock-master.html`: แท็บ **รอตรวจ** ครบ 3 กลุ่ม (รายการที่ต้องตรวจ + แผนที่, คำขอแก้เวลา, คำขอผูกเครื่องเดิม) + ตัวเลขบนแท็บ; แท็บใหม่ **บันทึกเวลา**; การ์ด **ปฏิทินวันทำงาน** และค่าใหม่ในแท็บตั้งค่าสาขา; ปรับแท็บสถานะวันนี้ให้ไม่นับรายการที่ถูกยกเลิก/ไม่ยืนยัน
2. `clock.html`: หน้า **D แจ้งแก้เวลา** + รายการคำขอของตัวเองพร้อมสถานะ + ลิงก์ที่หน้าหลัก + ทางลัดจากการ์ด STALE; ไทม์ไลน์ไม่นับรายการที่ถูกยกเลิก
3. `database.rules.json` + `tests/rules.test.mjs` (R29–R48 + ปรับ R17, R28)
4. `README.md`, `docs/testing.md`

ไม่ทำ (เฟส 3 / ภายหลัง): หน้า C ประวัติ, รายงาน/CSV, แจ้งเตือน LINE, เซลฟี่/QR, การล็อกกันแอดมิน 2 คนแก้พร้อมกัน (ดูข้อ 10)

---

## 2. โครงสร้างข้อมูลที่เพิ่ม (เข้ากันได้กับข้อมูลเฟส 1 ทั้งหมด)

ทุกฟิลด์ใหม่เป็น optional ตอนเก็บ ข้อมูลเฟส 1 ที่มีอยู่จึงยังผ่าน rules และ path การเขียนของพนักงานเฟส 1 ไม่เปลี่ยน (ยกเว้นเมื่อเปิด calendarEnforced) แอป `clock.html` รุ่นเก่าที่ค้าง cache ยังกดได้ตามปกติ

```
attendance/
  settings/
      lateGraceMin                       (เดิม)
      reviewDays: 31                     ใหม่ 7..92  ช่วงวันย้อนหลังที่คิวรอตรวจดู
      correctionDays: 7                  ใหม่ 1..62  พนักงานขอแก้ย้อนหลังได้กี่วัน (ตรวจฝั่ง client)
      calendarEnforced: false            ใหม่ bool   เปิดแล้ว rules บังคับ $d ของ in ให้ตรงวันจริง
  calendar/{YYYY-MM-DD}: <ms>            ใหม่  เวลา 00:00 กรุงเทพฯ ของวันนั้น (= Date.UTC(y,m-1,d) − 7 ชม.) แอดมินเขียน
  state/{sid}:
      status, workDate, since, inAt, lastLogId, lastLat, lastLng, lastBranchId   (เดิม)
      auditId        ใหม่ แอดมินเท่านั้น: audit ของการเขียนครั้งนี้
      prevLogId      ใหม่ แอดมินเท่านั้น: lastLogId ที่เห็นก่อนแก้ ("-" ถ้าไม่มี) ใช้ทำ compare-and-set
      (พนักงานเขียน state ทั้งก้อนแทนที่ทุกครั้ง สองฟิลด์นี้จึงหายไปเองเมื่อพนักงานกดครั้งต่อไป)
  logs/{d}/{sid}/{lid}:
      type, ts, lat, lng, accuracy, distance, branchId, uid, source, flag, flagReason, clientTs, review   (เดิม)
      auditId        ใหม่ แอดมิน: audit ล่าสุดของ node นี้ (ต้องใหม่ทุกครั้งที่แอดมินเขียน)
      editedBy       ใหม่ แอดมิน: = auth.uid ของคนที่เขียนล่าสุด
      editedAt       ใหม่ แอดมิน: = now
      origTs         ใหม่ แอดมิน: ts เดิมจากเซิร์ฟเวอร์ ตั้งได้ครั้งเดียวตอนแก้ ts ของ log app ครั้งแรก แก้/ลบไม่ได้
      voided         ใหม่ แอดมิน: true = ยกเลิก (ไม่นับ) แทนการลบ
      note           ใหม่ แอดมิน: หมายเหตุ 1..200
      correctionId   ใหม่ แอดมิน: คำขอที่ทำให้เกิด/แก้ log นี้
      movedFrom      ใหม่ แอดมิน: path เดิม เมื่อย้าย log ไปวันทำงานที่ถูกต้อง (ข้อ 8.1.4)
      ** source "admin" = แอดมินบันทึกแทน: มีแค่ type, ts, branchId, source, auditId, editedBy, editedAt (+note, correctionId) ไม่มี lat/lng/uid
  days/{d}/{sid}:
      confirmed, confirmedBy, confirmedAt  (เดิม แต่เฟส 1 ไม่เคยเขียน)
      auditId        ใหม่ บังคับทุกครั้งที่เขียน
      note           ใหม่ 1..200
  corrections/{cid}:
      staffId, workDate, type, time, reason, status, createdAt, decidedBy, decidedAt   (เดิม)
      type           เพิ่มค่า "break" (ลืมกดพักทั้งช่วง: time = เริ่มพัก, endTime = กลับจากพัก)
      endTime        ใหม่ HH:MM (บังคับเมื่อ type = break)
      nextDay        ใหม่ bool: time เป็นเวลาของวันถัดไป (หลังเที่ยงคืนของกะข้ามคืน)
      endNextDay     ใหม่ bool: เหมือนกันสำหรับ endTime
      resultNote     ใหม่ แอดมิน: ข้อความถึงพนักงาน 1..200
      appliedTs, appliedEndTs         ใหม่ แอดมิน: เวลาที่ใช้จริง (ms) อาจต่างจากที่ขอ (✎)
      appliedLogId, appliedEndLogId   ใหม่ แอดมิน: log ที่สร้าง/แก้
  audit/{aid}:
      path, before, after, by, at   (เดิม)
      op       ใหม่ เช่น edit_log, add_log, void_log, review_log, move_log, set_state, rebuild_state,
               confirm_day, unlock_day, decide_correction, edit_staff, edit_branch
      group    ใหม่ KEY: รหัสเดียวกันสำหรับ audit หลายรายการที่เกิดจากการกดครั้งเดียว
      ref      ใหม่ เช่น correctionId
      reason   ใหม่ เหตุผลที่แอดมินพิมพ์ ≤300
      byEmail  ใหม่ = auth.token.email (ให้ดูง่ายว่าใครแก้)
```

กติกาการตีความ (ใช้เหมือนกันทั้ง 2 ไฟล์)
- **รายการที่ไม่นับ** `isExcluded(l) = l.voided === true || l.review === 'rejected'`
- **ป้าย** "แอดมินบันทึก" = `source === 'admin'`; "แก้เวลาแล้ว" = มี `origTs`; "ยกเลิก" = voided; "ไม่ยืนยัน" = rejected; "ยืนยันแล้ว" = approved
- `flagReason` แปลเป็นภาษาไทย (ขึ้นกับ flag เพราะ `acc` ใช้ทั้ง 2 แบบ):
  borderline: `dist` = "อยู่นอกรัศมีเล็กน้อย", `acc` = "สัญญาณตำแหน่งไม่ชัด";
  suspect (คั่นด้วยจุลภาค): `acc` = "ความแม่นยำสูงผิดปกติ (< 3 ม.) อาจใช้แอปปลอมตำแหน่ง", `same` = "พิกัดซ้ำกับครั้งก่อนทุกหลัก", `hop` = "กดต่างสาขาภายใน 10 นาที"
- `clientTs` เทียบ `ts`: แสดงเป็นข้อมูลประกอบ "นาฬิกาเครื่องต่าง N นาที / ส่งช้า (ออฟไลน์)" เมื่อต่างเกิน 5 นาที ไม่ใช้เป็นเงื่อนไขเข้าคิว (เน็ตหลุดทำให้ต่างได้จริง)

---

## 3. Security Rules

### 3.1 ตัวย่อเพิ่มเติม (ใช้ในเอกสารนี้เท่านั้น ไฟล์จริงต้องเขียนเต็ม)
```
ROOT_L  = newData.parent().parent().parent().parent()      // attendance หลังเขียน มองจาก logs/$d/$sid/$lid
ROOT_S  = newData.parent().parent()                        // จาก state/$sid
ROOT_D  = newData.parent().parent().parent()               // จาก days/$d/$sid
ROOT_C  = newData.parent().parent()                        // จาก corrections/$cid
AID     = newData.child('auditId').val()
AUD(R)  = R.child('audit/' + AID)
NEW_AUDIT(R, P) =
     newData.child('auditId').isString()
  && !root.child('attendance/audit/' + AID).exists()       // audit ต้องไม่มีก่อน write นี้ ...
  && AUD(R).child('path').val() === P                      // ... แต่มีหลัง write และ path ตรงพอดี
EVIDENCE_SAME =                                            // log app: หลักฐานห้ามเปลี่ยน
     newData.child('source').val() === 'app'
  && newData.child('type').val()       === data.child('type').val()
  && newData.child('uid').val()        === data.child('uid').val()
  && newData.child('branchId').val()   === data.child('branchId').val()
  && newData.child('lat').val()        === data.child('lat').val()
  && newData.child('lng').val()        === data.child('lng').val()
  && newData.child('accuracy').val()   === data.child('accuracy').val()
  && newData.child('distance').val()   === data.child('distance').val()
  && newData.child('clientTs').val()   === data.child('clientTs').val()
  && newData.child('flag').val()       === data.child('flag').val()
  && newData.child('flagReason').val() === data.child('flagReason').val()
CAL     = root.child('attendance/calendar/' + $d)
```
หมายเหตุ: การเทียบ `null === null` (ฟิลด์ไม่มีทั้งสองฝั่ง) ใน RTDB rules ควรได้ true ถ้า emulator ไม่เป็นอย่างนั้น ให้เปลี่ยนเป็น `(a.exists() === b.exists()) && (!a.exists() || a.val() === b.val())` เทส R31/R33 จะจับได้

### 3.2 การเปลี่ยนแปลงทีละ node

**settings** (เพิ่มลูก ก่อน `$other`)
```
reviewDays        isNumber && 7..92
correctionDays    isNumber && 1..62
calendarEnforced  isBoolean
```

**calendar** (ใหม่)
```
calendar   .read: ADMIN
  $d       .write: ADMIN
           .validate: $d.matches(DATE_RE) && newData.isNumber() && newData.val() % 86400000 === 61200000
           // เที่ยงคืนกรุงเทพฯ = 17:00 UTC ของวันก่อน; ตรวจได้แค่ว่าเป็นเวลาเที่ยงคืน ตรวจไม่ได้ว่าตรงวันที่ใน key (แอดมินเชื่อถือได้)
```

**state/$sid** (แก้ `.write` และ `.validate`, เพิ่มลูก)
```
.write: ( ADMIN && newData.exists()
          && NEW_AUDIT(ROOT_S, 'state/' + $sid)
          && AUD(ROOT_S).child('after/status').val()   === newData.child('status').val()
          && AUD(ROOT_S).child('after/workDate').val() === newData.child('workDate').val()
          && ( (data.child('lastLogId').exists() && newData.child('prevLogId').val() === data.child('lastLogId').val())
            || (!data.child('lastLogId').exists() && newData.child('prevLogId').val() === '-') ) )
     || ( ของพนักงานเหมือนเฟส 1: OWNS && active && deviceApproved && newData.exists() )
.validate: newData.hasChildren(['status','workDate','since']) && (
     ( ADMIN && newData.hasChildren(['auditId','prevLogId'])
       && (newData.child('status').val() === 'off' || newData.child('inAt').isNumber())
       && (!newData.hasChild('lastLogId')
           || ROOT_S.child('logs/' + newData.child('workDate').val() + '/' + $sid + '/' + newData.child('lastLogId').val()).exists()) )
  || ( เงื่อนไขพนักงานของเฟส 1 เหมือนเดิม: hasChildren(inAt,lastLogId) && since === now && log[lastLogId].ts === now ) )
auditId    .validate: ADMIN && newData.isString() && newData.val().matches(KEY_RE)
prevLogId  .validate: ADMIN && newData.isString() && newData.val().matches(KEY_RE)      // "-" ผ่าน KEY_RE
```
ผล: แอดมินเขียน state บางส่วนไม่ได้แล้ว (auditId เดิมมีอยู่ใน root ทำให้ NEW_AUDIT ไม่ผ่าน) ต้องเขียนทั้งก้อนพร้อม audit ใหม่; ลบ state ไม่ได้; state ที่ working/on_break/done ต้องมี `inAt` เสมอ (ปิดปัญหาที่เฟส 1 ข้อ 5.4 เตือนไว้); `lastLogId` ต้องชี้ log ที่มีจริง

**logs/$d/$sid/$lid** (แก้ `.write`, เติม `.validate`, เพิ่มลูก)
```
.write: ( ADMIN && newData.exists()
          && root.child('attendance/days/' + $d + '/' + $sid + '/confirmed').val() !== true      // ค่าก่อนเขียน
          && NEW_AUDIT(ROOT_L, 'logs/' + $d + '/' + $sid + '/' + $lid)
          && AUD(ROOT_L).child('after/ts').val()     === newData.child('ts').val()
          && AUD(ROOT_L).child('after/voided').val() === newData.child('voided').val()
          && AUD(ROOT_L).child('after/review').val() === newData.child('review').val()
          && ( (data.exists() && AUD(ROOT_L).child('before/ts').val() === data.child('ts').val())
            || (!data.exists() && !AUD(ROOT_L).child('before').exists()) )
          && newData.child('editedBy').val() === auth.uid
          && newData.child('editedAt').val() === now )
     || ( ของพนักงานเหมือนเฟส 1 ทั้งหมด )
.validate: (เดิมทั้งหมด) && (
     !data.exists() || data.child('source').val() !== 'app'
     || ( EVIDENCE_SAME && (newData.child('ts').val() === data.child('ts').val() || newData.hasChild('origTs')) ) )
  && (!data.child('origTs').exists() || newData.child('origTs').val() === data.child('origTs').val())
  และในกิ่ง type === 'in' ของ STAFF_LOG ต่อท้ายด้วย
     && ( root.child('attendance/settings/calendarEnforced').val() !== true
       || ( CAL.isNumber() && now >= CAL.val() - 900000 && now < CAL.val() + 87300000 ) )
     // ผ่อนผัน 15 นาทีทั้งสองฝั่ง: กดก่อนเที่ยงคืนแล้วไปถึงเซิร์ฟเวอร์หลังเที่ยงคืน / serverOffset คลาดเล็กน้อย
ts           .validate: newData.isNumber() && (newData.val() === now
                          || (ADMIN && newData.val() <= now && newData.val() >= 1577836800000))   // แอดมินห้ามใส่เวลาอนาคต
auditId      .validate: ADMIN && newData.isString() && newData.val().matches(KEY_RE)
editedBy     .validate: ADMIN && newData.val() === auth.uid
editedAt     .validate: ADMIN && newData.val() === now
origTs       .validate: ADMIN && newData.isNumber()
                        && ((data.exists() && newData.val() === data.val())
                         || (!data.exists() && newData.val() === data.parent().child('ts').val()))   // ครั้งแรก = ts เดิมพอดี
voided       .validate: ADMIN && newData.isBoolean()
note         .validate: ADMIN && newData.isString() && newData.val().length >= 1 && newData.val().length <= 200
correctionId .validate: ADMIN && newData.isString() && newData.val().matches(KEY_RE)
                        && newData.parent().parent().parent().parent().parent().child('corrections/' + newData.val()).exists()
movedFrom    .validate: ADMIN && newData.isString() && newData.val().length <= 80
review       (เดิม: ADMIN && approved|rejected)
```
ผล: แอดมินแก้ log ได้เฉพาะเมื่อมี audit ใหม่ที่ path ตรง และ ts/review/voided ใน audit ตรงของจริง; ลบไม่ได้; วันที่ยืนยันแล้วแก้ไม่ได้; หลักฐานของ log app แก้ไม่ได้; แก้ ts ของ log app แล้ว ts เดิมถูกเก็บถาวรใน `origTs`

**days** (ย้ายสิทธิ์เขียนลงไปที่ `$d/$sid` — **ต้องลบ `.write` ที่ระดับ `days` ออก** ไม่อย่างนั้นสิทธิ์จากชั้นบนจะไหลลงมาข้าม audit ทั้งหมด)
```
days       .read: ADMIN          (ไม่มี .write)
  $d
    $sid   .write: ADMIN && newData.exists()
                   && NEW_AUDIT(ROOT_D, 'days/' + $d + '/' + $sid)
                   && AUD(ROOT_D).child('after/confirmed').val() === newData.child('confirmed').val()
           .validate: $d.matches(DATE_RE) && $sid.matches(KEY_RE) && newData.hasChildren(['confirmed','auditId'])
                   && ( newData.child('confirmed').val() !== true
                     || ( newData.child('confirmedBy').val() === auth.uid
                       && newData.child('confirmedAt').val() === now
                       && !( ROOT_D.child('state/' + $sid + '/workDate').val() === $d
                             && ( ROOT_D.child('state/' + $sid + '/status').val() === 'working'
                               || ROOT_D.child('state/' + $sid + '/status').val() === 'on_break') ) ) )
      confirmed bool | confirmedBy string | confirmedAt number | auditId KEY_RE | note 1..200 | $other false
```
(ใช้ state **หลังเขียน** จึง "ใส่ out + ปรับ state + ยืนยัน" ใน update เดียวได้)

**corrections/$cid**
```
corrections .indexOn: ['staffId','status','createdAt']      (.read เดิม)
  $cid .write:
        ( ADMIN && data.exists() && newData.exists() && data.child('status').val() === 'pending' )   // ตัดสินได้ครั้งเดียว สร้าง/ลบไม่ได้
     || ( !data.exists() && newData.exists() && STAFF_OK(newData.child('staffId').val()) )            // เดิม
     || ( data.exists() && !newData.exists() && data.child('status').val() === 'pending'
          && OWNS(data.child('staffId').val()) )                                                       // พนักงานยกเลิกคำขอที่ยังรอ
   .validate: (เดิม) && (newData.child('type').val() !== 'break' || newData.hasChild('endTime'))
     && ( newData.child('status').val() === 'pending'
       || (newData.child('decidedBy').val() === auth.uid && newData.child('decidedAt').val() === now) )
     && ( !data.exists() || (                                    // ตัวคำขอแก้ไม่ได้
           newData.child('staffId').val()    === data.child('staffId').val()
        && newData.child('workDate').val()   === data.child('workDate').val()
        && newData.child('type').val()       === data.child('type').val()
        && newData.child('time').val()       === data.child('time').val()
        && newData.child('endTime').val()    === data.child('endTime').val()
        && newData.child('nextDay').val()    === data.child('nextDay').val()
        && newData.child('endNextDay').val() === data.child('endNextDay').val()
        && newData.child('reason').val()     === data.child('reason').val()
        && newData.child('createdAt').val()  === data.child('createdAt').val() ) )
     && ( !newData.hasChild('appliedLogId')
       || ROOT_C.child('logs/' + newData.child('workDate').val() + '/' + newData.child('staffId').val() + '/'
                       + newData.child('appliedLogId').val() + '/correctionId').val() === $cid )
     && ( !newData.hasChild('appliedEndLogId') || (เงื่อนไขเดียวกันกับ appliedEndLogId) )
   type                          in | break_start | break_end | out | break
   endTime                       isString && HH:MM
   nextDay, endNextDay           isBoolean
   resultNote                    ADMIN && isString && 1..200
   appliedTs, appliedEndTs       ADMIN && isNumber
   appliedLogId, appliedEndLogId ADMIN && isString && matches(KEY_RE)
   decidedBy                     ADMIN && isString           (เดิมไม่มี ADMIN)
   decidedAt                     ADMIN && isNumber           (เดิมไม่มี ADMIN)
```

**audit**
```
audit   .read: ADMIN   .indexOn: ['path','at']
  $aid  .write: ADMIN && !data.exists() && newData.exists()
        .validate: $aid.matches(KEY_RE) && newData.hasChildren(['path','by','at'])
                   && newData.child('by').val() === auth.uid && newData.child('at').val() === now
     path    isString && length 1..120
     op      isString && matches(/^[a-z_]{1,30}$/)      (optional เพื่อให้ R20 เดิมผ่าน แต่ master ใส่ทุกครั้ง)
     group   isString && matches(KEY_RE)
     ref     isString && length <= 60
     reason  isString && length <= 300
     byEmail newData.val() === auth.token.email
     before, after  true
     $other  false
```

### 3.3 สิ่งที่ rules ยังรับประกันไม่ได้
- ตรวจลำดับเหตุการณ์ของวันที่แอดมินแก้ไม่ได้ (เช่น ออกก่อนเข้า) → master ตรวจด้วย `validateSeq` (ข้อ 5.3) ก่อนส่ง
- ตรวจไม่ได้ว่า `before`/`after` ใน audit ตรงทุกฟิลด์ (ตรวจแค่ ts/review/voided, status/workDate, confirmed)
- การเขียนผ่าน Firebase Console ข้าม rules ทั้งหมด (รวม audit) — ข้อจำกัดของ Firebase
- compare-and-set ใช้ `lastLogId` จึงจับกรณี "พนักงานกดแทรก" ได้ แต่แอดมิน 2 คนแก้ state พร้อมกันโดยไม่เปลี่ยน lastLogId คนหลังจะชนะ (ร้านมีแอดมินคนเดียว ยอมรับได้)
- `calendar` ตรวจได้แค่ว่าเป็นเวลาเที่ยงคืน ตรวจไม่ได้ว่าตรงกับวันที่ใน key

---

## 4. กลยุทธ์ audit (ประเมิน review finding #7)

**ทำได้และแนะนำให้ทำ** แบบ "audit ต่อ node + ตัวชี้ `auditId`"
1. ทุก node ที่แอดมินแก้ใน logs/state/days ต้องพกฟิลด์ `auditId` ใหม่ทุกครั้ง rules ตรวจว่า `audit/{auditId}` **ไม่มีอยู่ก่อน write** แต่ **มีหลัง write** และ `path` ตรงกับ node นี้พอดี → audit ถูกสร้างใน multi-path update เดียวกันแน่นอน ใช้ audit ซ้ำไม่ได้ ชี้ audit ของ node อื่นไม่ได้
2. audit สร้างได้ครั้งเดียว แก้/ลบไม่ได้ (เฟส 1) และ `by === auth.uid`, `at === now`, `byEmail === auth.token.email`
3. ตรวจค่าสำคัญใน `before`/`after` กับข้อมูลจริง (ts/review/voided, status/workDate, confirmed) audit จึงโกหกในเรื่องที่สำคัญที่สุดไม่ได้
4. ห้ามลบ (ใช้ voided / confirmed:false) เพราะตอนลบ `newData` ว่าง จึงผูก audit ไม่ได้
5. เอา `.write` ระดับ `days` ออก (สิทธิ์ไหลลงลูก) ส่วน `logs`, `state` ไม่มี `.write` ระดับบนอยู่แล้ว
6. การกดครั้งเดียวที่แก้หลาย node (เช่น ใช้คำขอ = log + state + correction) สร้าง audit หลายรายการที่มี `group` เดียวกัน
7. corrections ไม่ผูก audit ใน rules (ใช้ `decidedBy === auth.uid` + `decidedAt === now` + ห้ามตัดสินซ้ำ เป็นบันทึกในตัว) แต่ master เขียน audit `op:decide_correction` ด้วยเสมอ
8. staff/branches/settings/deviceRequests: audit แบบ best-effort ใส่ใน update เดียวกันจากฝั่ง client (ไม่บังคับ)

ทางเลือกที่ไม่เลือก: (ก) audit ก้อนเดียวต่อการกด → rules ตรวจไม่ได้ว่า path ของทุก node อยู่ในก้อนนั้น (ไม่มี loop/contains) (ข) audit ฝั่ง client อย่างเดียว → แอดมินที่แก้โค้ดเลี่ยงได้ ไม่ตอบ finding #7

ต้นทุน: rules ของ logs ยาวขึ้น, แอดมินต้องเขียน node ทั้งก้อนทุกครั้ง, audit โตราว 1–3 รายการต่อการแก้ (หลักร้อยต่อเดือน ไม่เป็นปัญหา)

helper ใน master (ทุกการแก้ใช้ตัวนี้ตัวเดียว) — items คือรายการ path, before, after, op; เติม auditId (และ editedBy/editedAt ถ้าเป็น log) ลงใน after แล้วสร้าง audit/{aid}
```js
function withAudit(updates, items, opts) {
  for (const it of items) {
    const aid = push(A('audit')).key;
    const bound = it.path.startsWith("logs/") || it.path.startsWith("state/") || it.path.startsWith("days/");
    const after = bound ? Object.assign({}, it.after, { auditId: aid }) : it.after;   // corrections/staff/branches ไม่มีฟิลด์ auditId ($other false)
    if (it.path.startsWith('logs/')) { after.editedBy = uidNow; after.editedAt = serverTimestamp(); }
    updates[it.path] = after;
    const a = { path: it.path, after, by: uidNow, byEmail: auth.currentUser.email, at: serverTimestamp(), op: it.op, group: opts.group };
    if (it.before) a.before = it.before;
    if (opts.refId) a.ref = opts.refId;
    if (opts.reason) a.reason = opts.reason;
    updates['audit/' + aid] = a;
  }
  return updates;
}
```
node ใหม่ต้องไม่มี key `before` เลย (rules ตรวจว่า before ไม่มีอยู่) และ RTDB ไม่เก็บค่า null ใน object ซ้อน จึงต้องข้าม key แทนการใส่ null

---

## 5. ตรรกะกลาง (master ใช้ร่วมกัน; summarize v2 กับ isExcluded ใช้ทั้ง 2 ไฟล์)

### 5.1 เวลา
- `tsOf(d, hhmm, plusDay)` = `Date.parse(d + 'T' + hhmm + ':00+07:00') + (plusDay ? 86400000 : 0)` — ไทยไม่มี DST ใช้ +07:00 ตายตัว ไม่ขึ้นกับ timezone ของ PC
- `midnightAfter(d)` = `Date.parse(d + 'T00:00:00+07:00') + 86400000`; `plusDayOf(d, ts)` = `bangkokDate(ts) > d`
- ช่องเวลาใช้ `<input type="time">` ค่าเป็นเวลากรุงเทพฯ เสมอ
- ถ้าแอดมินไม่ได้เปลี่ยน HH:MM ของ log app ให้ใช้ `ts` เดิม (ไม่ปัดวินาทีทิ้ง และไม่ตั้ง origTs)
- เวลาที่กรอกเกิน `serverNow()`: ถ้าอยู่ในนาทีปัจจุบันใช้ `serverNow() − 5000` ไม่อย่างนั้นแจ้ง "เวลาอยู่ในอนาคต"

### 5.2 summarize v2 (แทนของเดิมทั้ง 2 ไฟล์)
- `ev` = log ที่มี ts เป็นตัวเลขและ `!isExcluded` เรียงตาม ts (เท่ากันเรียง in < break_start < break_end < out)
- เดินทีละรายการ แบ่งเป็น segment ที่เริ่มด้วย `in`; คืน `{ ev, segments: [{inTs, outTs, breakMs, openBreak}], inTs (segment แรก), outTs (segment สุดท้าย), breakMs (รวม), openBreak (segment สุดท้าย), netMs (รวม out − in − พัก ของ segment ที่ปิดแล้ว), flags }`
- กรณีปกติ (1 กะ/วัน) ค่า `inTs/outTs/breakMs/openBreak` เท่ากับของเดิม โค้ดที่เรียกใช้อยู่ไม่ต้องเปลี่ยน

### 5.3 validateSeq(d, ev, now) คืน errors, warnings, closed, segments
- **error**: เวลาเกิน now; เวลาเท่ากันหรือไม่เรียง ("เวลาต้องเรียงจากก่อนไปหลัง"); รายการแรกไม่ใช่ in; ลำดับผิดตาม state machine `off→in→working⇄พัก→out→done` (`in` ขณะ working/on_break = "เข้างานซ้ำโดยยังไม่ออกงาน", `out` ขณะพัก = "ต้องกลับจากพักก่อนออกงาน", `break_end` โดยไม่มีเริ่มพัก); segment ยาวเกิน 24 ชม.
- **warning**: segment ยาวเกิน 16 ชม.; มีมากกว่า 1 กะในวันเดียว; `in` แรกไม่อยู่ในวัน d (เกินผ่อนผัน 15 นาที); ยังไม่มีเวลาออก (`closed = false`)
- ใช้กับ: ตัวแก้ไขวัน, ใช้คำขอ, ไม่ยืนยันรายการ, ยืนยันวัน (ยืนยันได้เมื่อไม่มี error และ `closed` หรือวันว่าง)

### 5.4 deriveState(sid, d, evAfter, oldState, now)
```
affects = ไม่มี oldState || ไม่มี oldState.workDate || d >= oldState.workDate
ถ้าไม่ affects → คืน null                         (แก้วันที่เก่ากว่ากะปัจจุบัน ไม่แตะ state)
oldLive = oldState.status เป็น working/on_break และ now − oldState.inAt <= STALE_MS
ถ้า d > oldState.workDate และ oldLive → error "กะวันที่ X ยังไม่ปิด — เพิ่มเวลาออกของกะนั้นก่อน"
ถ้า evAfter ว่าง:
    oldState.workDate === d → { status:'off', workDate:d, since: serverTimestamp() }
    ไม่อย่างนั้น → null
last = รายการสุดท้าย, seg = segment สุดท้าย
st = { status: NEXT[last.type], workDate: d, since: last.ts, inAt: seg.inTs, lastLogId: last.id,
       lastBranchId: last.branchId } และถ้ามี log app ใน evAfter ใส่ lastLat/lastLng ของตัวล่าสุด
ถ้า status, workDate, inAt, lastLogId, since เท่ากับ oldState ทุกตัว → null (ไม่ต้องเขียน)
เติม prevLogId = oldState.lastLogId หรือ '-' ถ้าไม่มี
```
เหตุผลที่ `since = last.ts` (ไม่ใช่ now): ไม่ให้เกิดธง `hop` ปลอม และไม่ติดกันกดซ้ำ 30 วิ หลังแอดมินแก้; สำหรับ log app ปกติ `since === ts` อยู่แล้ว

### 5.5 ขั้นตอนบันทึกแบบเดียวกันทุกการแก้ (`commitDayChange`)
1. `get` สดของ `logs/{d}/{sid}`, `state/{sid}`, `days/{d}/{sid}` (ไม่ใช้ค่าจาก listener)
2. ถ้า `days.confirmed === true` → หยุด แสดง "วันนี้ยืนยันแล้ว ต้องปลดล็อกก่อน" + ปุ่ม "ปลดล็อก" (write แยก)
3. ประกอบรายการหลังแก้ → `validateSeq` → error = หยุด; warning = ต้องกดยืนยันอีกครั้ง
4. `deriveState` → ถ้า state จะเปลี่ยน แสดงในตัวอย่าง "สถานะพนักงานจะเป็น: ..."
5. `withAudit` ทุก log ที่เปลี่ยน + state (ถ้ามี) + node อื่นที่เกี่ยว (correction, days) ด้วย `group` เดียวกัน → `update(A(''), updates)` ครั้งเดียว
6. ถ้า `PERMISSION_DENIED`: โหลดใหม่และแจ้ง "ข้อมูลเปลี่ยนระหว่างแก้ (พนักงานอาจเพิ่งกด) หรือวันถูกยืนยันแล้ว — ตรวจแล้วลองอีกครั้ง"

---

## 6. อัลกอริทึมใช้คำขอแก้เวลา (apply correction)

อินพุต: correction `c` + ค่าที่แอดมินอาจปรับใน ✎ (`time`, `endTime`, `nextDay`, `endNextDay`, เป้าหมาย "แก้รายการเดิม/สร้างใหม่")

1. `t1 = tsOf(c.workDate, time, nextDay)`; ถ้า `c.type === 'break'` → `t2 = tsOf(c.workDate, endTime, endNextDay)`
2. โหลดสดตามข้อ 5.5 ข้อ 1–2 แล้ว `ev` = รายการที่นับของวันนั้น
3. การกระทำเริ่มต้น (แอดมินเปลี่ยนได้ใน dropdown "แก้รายการเดิม: [รายการประเภทเดียวกัน] / สร้างรายการใหม่")
   - `in`: มี `in` ที่นับอยู่ → แก้ ts ของ `in` ตัวแรก; ไม่มี → สร้าง `in`
   - `out`: segment สุดท้ายมี `out` → แก้ ts; ไม่มี → สร้าง `out`
   - `break`: สร้าง `break_start` ที่ t1 + `break_end` ที่ t2
   - `break_end`: ถ้ารายการสุดท้ายของ segment เป็น `break_start` (พักค้าง) → สร้าง; ไม่อย่างนั้น → แก้ `break_end` ที่อยู่หลัง `break_start` ตัวที่ใกล้ t1 ที่สุด
   - `break_start`: สร้าง
4. log ที่สร้าง: `type, ts, branchId, source 'admin', correctionId = c.id, note 'จากคำขอแก้เวลา'` โดย `branchId` = สาขาของ log app ล่าสุดในวันนั้น ถ้าไม่มีใช้ `staff.branchId`
   log ที่แก้: เปลี่ยน `ts` (ตั้ง `origTs` ถ้าเป็น log app และยังไม่มี) และใส่ `correctionId`
5. `validateSeq` บนรายการหลังแก้ แสดงตัวอย่างไทม์ไลน์ "ก่อน → หลัง" พร้อม error/warning (เช่น ขอ `out` ขณะพักค้าง → error "ต้องกลับจากพักก่อนออกงาน" แอดมินต้องเพิ่มกลับจากพักเองในตัวแก้ไขวัน — ไม่ทำตัวช่วยอัตโนมัติ)
6. `deriveState` (ข้อ 5.4)
7. update เดียว: log + audit ต่อ log, state + audit (ถ้าเปลี่ยน), `corrections/{cid}` = ของเดิมทั้งก้อน + `status 'approved', decidedBy, decidedAt (serverTimestamp), appliedTs, appliedLogId` (+ `appliedEndTs, appliedEndLogId` ถ้าเป็นพัก, + `resultNote` ถ้ามี) + audit `op decide_correction` (path `corrections/{cid}`) ทั้งหมด `group` เดียวกัน `ref = cid`
8. ✘ ไม่ยืนยัน = correction เป็น `rejected` + `resultNote` (ไม่บังคับ ปุ่มสำเร็จรูป "เวลาไม่ตรงกับที่เห็น", "ไม่มีเหตุผลพอ", "แก้ให้แล้วด้วยวิธีอื่น")
9. "อนุมัติโดยไม่แก้บันทึก" (เช่น แก้เองไปแล้วในบันทึกเวลา) = approved ไม่มี appliedLogId (ปุ่มรองในหน้าต่าง ✎)

ตัวอย่างที่ต้องได้ผลถูก
- **ลืมกดออกเมื่อวาน และวันนี้ยังไม่กดเข้า** (state working, workDate เมื่อวาน): สร้าง `out` เมื่อวาน → `d === state.workDate` → state done/เมื่อวาน → แอปพนักงานเป็น OFF กดเข้าวันนี้ได้ (rules: done และ workDate ≠ $d)
- **ลืมกดออกเมื่อวาน แต่วันนี้กดเข้าแล้ว (ผ่าน STALE)**: state.workDate = วันนี้ → `d < workDate` → ไม่แตะ state
- **ลืมกดเข้าวันนี้ แต่ทำงานอยู่** (state done ของเมื่อวาน): สร้าง `in` วันนี้ → `d > workDate` และกะเก่าไม่ live → state working/วันนี้ inAt = t1 → พนักงานกดเริ่มพัก/ออกงานต่อได้ (rules `N.inAt === S.inAt` ใช้ค่าที่แอดมินตั้ง)
- **กะข้ามคืน** เข้า 20:00 ขอออก 02:00 `nextDay` → ts = วันถัดไป 02:00 อยู่ใน logs ของวันที่เริ่มกะ
- **แก้เวลาเข้าของกะที่ยังทำงานอยู่** → inAt ใหม่ → STALE นับจาก inAt ใหม่

---

## 7. ผลต่อ state, STALE, ข้ามคืน และ "workDate ไม่ตรง"

| สถานการณ์ | ผล |
|---|---|
| แก้ log ของวันที่เก่ากว่า `state.workDate` | ไม่แตะ state |
| แก้ log ของ `state.workDate` | state คำนวณใหม่จากรายการที่นับ (ข้อ 5.4) รวม inAt/lastLogId/since |
| เพิ่ม log ในวันที่ใหม่กว่า `state.workDate` | ถ้ากะเก่ายัง live และไม่ STALE → ห้าม (ปิดกะเก่าก่อน); ไม่อย่างนั้น state ย้ายไปวันใหม่ |
| ยกเลิก/ไม่ยืนยันทุกรายการของ `state.workDate` | state = off บนวันนั้น พนักงานกดเข้างานใหม่ได้ |
| ไม่ยืนยัน `in` ของกะที่กำลังทำ (เช่น กดจากบ้าน) | ตัวตรวจลำดับเตือนว่ารายการหลังจากนั้นกำพร้า → UI เสนอ "ไม่ยืนยันทั้งกะ" (ทุกรายการของ segment) → state = off |
| STALE (ทำงานเกิน 16 ชม.) | กติกา rules เดิมไม่เปลี่ยน คิวรอตรวจแสดง "ลืมออกงาน" ปุ่ม ✎ = เพิ่มเวลาออก |
| กะข้ามคืน | ทุกเวลาอยู่ใน `logs/{วันที่เริ่มกะ}` ช่องเวลามีติ๊ก "+1 วัน" (ตั้งอัตโนมัติเมื่อเวลาน้อยกว่าเวลาเข้า) ตัวกรองวันในบันทึกเวลา = วันที่เริ่มกะ |
| ยืนยันวัน | ห้ามถ้ากะยัง working/on_break บนวันนั้น (rules) — STALE ก็ถือว่ายังเปิด ต้องเพิ่มเวลาออกก่อน |
| state เสีย/ไม่ตรงกับ log | ปุ่ม "ซ่อมสถานะ" (op `rebuild_state`) หาวันล่าสุดที่มีรายการที่นับในช่วง reviewDays (ไม่เกินวันนี้+1) แล้ว `deriveState` |

**ตรวจ workDate ไม่ตรง** (ใช้ทั้งคิวรอตรวจและป้ายในสถานะวันนี้)
```
dateMismatch(d, inLog) =
     d > bangkokDate(now)                                                      // วันในอนาคต
  || ( bangkokDate(inLog.ts) !== d
       && !(inLog.ts >= midnightAfter(d) && inLog.ts < midnightAfter(d) + 900000) )   // ผ่อนผัน 15 นาทีหลังเที่ยงคืน
```
- ตรวจเฉพาะ `in` เพราะ break/out ถูก rules ผูกกับ `S.workDate` อยู่แล้ว และกะข้ามคืนที่ถูกต้อง `in` อยู่ในวัน d เสมอ จึงไม่ติดธง
- ถ้า `in` นั้น `review === 'approved'` แล้ว → ไม่ติดธง (ทั้งคิวและป้ายแดงในสถานะวันนี้)
- วันที่เก่ากว่าหน้าต่าง reviewDays listener มองไม่เห็น จึงเพิ่มรายการจาก state: ถ้า `state.workDate` น้อยกว่า วันนี้−1 หรือมากกว่าวันนี้ และ state ไม่ใช่ off → รายการ "สถานะผิดปกติ"
- ถ้าเปิด `calendarEnforced` กรณีนี้ถูกปฏิเสธตั้งแต่ตอนเขียน (ข้อ 3.2) การตรวจนี้ยังคงไว้สำหรับข้อมูลเก่า
- ทางแก้ (✎) "ย้ายไปวันที่ถูกต้อง" ข้อ 8.1.4

---

## 8. UI: `clock-master.html`

แท็บด้านซ้ายใหม่: สถานะวันนี้ / **รอตรวจ (N)** / **บันทึกเวลา** / พนักงาน / ตั้งค่าสาขา

listener ที่เพิ่ม (เปิดตอน startApp ปิดตอน teardown เปลี่ยนช่วงเมื่อข้ามวัน)
- `query(A('logs'), orderByKey(), startAt(from))` โดย `from = bangkokDate(now − reviewDays วัน)` → `D.logsWin` (ใช้แทน listener วันนี้/เมื่อวานเดิม หน้าสถานะวันนี้อ่านจาก `D.logsWin`)
- `query(A('days'), orderByKey(), startAt(from))` → `D.days`
- `query(A('corrections'), orderByChild('status'), equalTo('pending'))` → `D.corrPending`
- `query(A('calendar'), orderByKey(), limitToLast(1))` → `D.calLast` (ปฏิทินมีถึงวันไหน)
- บันทึกเวลาช่วงที่เก่ากว่าหน้าต่าง: `get` ตามช่วงที่เลือก (ไม่ฟังค้าง)

### 8.1 แท็บ รอตรวจ
โครงหน้า: ซ้าย = รายการ 3 หัวข้อ (แต่ละหัวข้อมีตัวเลข) / ขวา = แผนที่ Leaflet ติดหน้าจอ (sticky) ราว 420×420
ตัวเลขบนแท็บ = คำขอแก้เวลา pending + รายการที่ต้องตรวจ + คำขอผูกเครื่อง pending (ใส่ใน `document.title` ด้วย "(N) จัดการลงเวลา")

**8.1.1 รายการที่ต้องตรวจ** (สร้างจาก `D.logsWin`, `D.state`, `D.days` ข้ามวันที่ `confirmed === true` และรายการที่ `isExcluded`)

| ชนิด | เงื่อนไข | การ์ดแสดง | ✔ ยืนยัน | ✘ ไม่ยืนยัน | ✎ แก้ |
|---|---|---|---|---|---|
| ธง | มี `flag` และไม่มี `review` | ชื่อ วันที่ ประเภท+เวลา สาขา ระยะตอนกด/accuracy ป้ายเหตุผลภาษาไทย เวลาเครื่องต่าง | `review` = approved | `review` = rejected (+state ถ้ากระทบ; ถ้าทำให้ลำดับเสีย เสนอ "ไม่ยืนยันทั้งกะ") | เปิดตัวแก้ไขวัน โฟกัสรายการนี้ บันทึกแล้วตั้ง approved |
| วันไม่ตรง | `dateMismatch` และ `in` ไม่มี `review` | "บันทึกเป็นวันที่ X แต่เวลาจริงคือ วันที่ Y HH:MM" | approved บน `in` | ไม่ยืนยันทั้งกะ | **ย้ายไปวันที่ถูกต้อง** (8.1.4) หรือเปิดตัวแก้ไขวัน |
| กะยาวผิดปกติ | segment ปิดแล้วแต่ out − in เกิน 16 ชม. และ `out` ไม่มี review | "ทำงาน 20 ชม. 10 น." | approved บน `out` | ไม่ยืนยัน `out` (กะกลายเป็นเปิด) | แก้เวลาออก |
| ลืมออกงาน | segment ไม่มี out และ (state.workDate ≠ d หรือ STALE) | "เข้า 08:02 ไม่มีเวลาออก" | ไม่มี (ต้องใส่เวลาออก) | ไม่ยืนยันทั้งกะ | เพิ่มเวลาออก (ช่องเวลา + "+1 วัน") |
| สถานะผิดปกติ | ตามข้อ 7 | "สถานะอ้างวันที่ X" | — | — | "ซ่อมสถานะ" |

- การ์ดเดียวต่อ log ถ้าติดหลายเหตุให้รวมป้าย (เช่น ธง + วันไม่ตรง)
- คลิกการ์ด → แผนที่: วงรัศมีสาขา (เขียว `radius`), วงชายขอบ (ส้มเส้นประ `radius × graceFactor`), หมุดจุดที่กด, วงความแม่นยำ (ฟ้าโปร่ง `accuracy`), fitBounds; ใต้แผนที่ "ระยะตอนกด 14 ม. · เทียบตำแหน่งร้านปัจจุบัน 15 ม." (หมุดสาขาอาจถูกย้ายหลังจากนั้น); log ที่ไม่มีพิกัด (แอดมินบันทึก) แสดง "ไม่มีพิกัด"; ใช้ชั้นภาพดาวเทียม Esri เหมือนแท็บสาขา และ `invalidateSize()` ตอนเปิดแท็บ
- เรียงวันที่ใหม่ก่อน ปุ่ม ✘ ต้องยืนยันซ้ำ (เปลี่ยนชั่วโมงทำงาน)
- ทุกปุ่มใช้ `commitDayChange` (✔ ก็ผ่าน audit `op review_log`)

**8.1.2 คำขอแก้เวลา** (จาก `D.corrPending` เก่าก่อน)
- การ์ด: ชื่อ, "ลืมกดออกงาน · วันที่ 20 ต.ค. (จ.) · 17:30" (+ "เช้าวันถัดไป" ถ้า nextDay), เหตุผล, ส่งเมื่อ, ไทม์ไลน์ปัจจุบันของวันนั้น, ป้าย "วันนี้ยืนยันแล้ว" ถ้าล็อก, ป้าย "มีคำขอซ้ำ" ถ้าวัน+ประเภทเดียวกันมีหลายรายการ
- ✔ ยืนยัน = ใช้ตามที่ขอ (ข้อ 6): หน้าต่างตัวอย่าง "ก่อน → หลัง" + ช่องข้อความถึงพนักงาน แล้วกดยืนยัน
- ✎ แก้ = หน้าต่างเดียวกันแต่ช่องเวลา/+1 วัน/เป้าหมายแก้ได้ ปุ่ม "อนุมัติตามนี้" และปุ่มรอง "อนุมัติโดยไม่แก้บันทึก"
- ✘ ไม่ยืนยัน = หน้าต่างข้อความถึงพนักงาน (ปุ่มสำเร็จรูป + พิมพ์เอง) → rejected
- ถ้าวันล็อก: ปุ่ม ✔/✎ เปลี่ยนเป็น "ปลดล็อกแล้วตรวจ" (write ปลดล็อกแยก แล้วเปิดหน้าต่าง)

**8.1.3 คำขอผูกเครื่อง** ของเดิมไม่เปลี่ยน (ย้ายเป็นหัวข้อที่ 3) และลบข้อความ "หน้าตรวจละเอียดจะมาในเฟสถัดไป"

**8.1.4 ย้ายไปวันที่ถูกต้อง** (สำหรับวันไม่ตรง)
- วันเป้าหมาย `d2 = bangkokDate(in.ts)` ทุก log ของ segment นั้นคัดลอกไป `logs/{d2}/{sid}/{lid ใหม่}` (ฟิลด์เดิมทั้งหมด + `movedFrom`, ts เดิม) และ log เดิมตั้ง `voided true, note 'ย้ายไป d2'` ทั้งหมดใน update เดียว (audit `op move_log`)
- ถ้า d2 มีรายการที่นับอยู่แล้ว (กะซ้อน) → `validateSeq` ของ d2 error → แจ้ง "วันที่ d2 มีกะอยู่แล้ว ใช้ ✘ หรือแก้ในบันทึกเวลา"
- state: ถ้า `state.workDate === d` → ย้ายไป d2 (`lastLogId` = id ใหม่) ผ่าน deriveState ของ d2 (และ d ว่าง)
- ทั้ง d และ d2 ต้องไม่ถูกล็อก (rules ตรวจทุก path เอง)
- ขั้นนี้ตัดออกได้ถ้าเวลาไม่พอ (ข้อ 14 ขั้น 9) แล้ว ✎ ของวันไม่ตรงเปิดตัวแก้ไขวันแทน

### 8.2 แท็บ บันทึกเวลา
**แถบตัวกรอง**: วันเดียว / ช่วงวัน (จาก–ถึง ไม่เกิน 31 วัน ปุ่มลัด วันนี้ / เมื่อวาน / 7 วัน / เดือนนี้), พนักงาน (ทั้งหมด/คนเดียว ติ๊ก "รวมคนที่ปิดบัญชี"), สาขา (ทั้งหมด/สาขาเดียว — ใช้สาขาของ `in` แรกของวันนั้น ถ้าไม่มีใช้สาขาหลัก), ติ๊ก "เฉพาะที่ยังไม่ยืนยัน"
ปุ่มด้านบน: "+ เพิ่มวันทำงาน", "ยืนยันที่เลือก (N)"

**ตาราง** 1 แถว = พนักงาน 1 คน × วันทำงาน 1 วัน (เลือกวันเดียว: แสดงพนักงาน active ทุกคน รวมคนที่ "ไม่มีบันทึก" เพื่อเพิ่มแทนได้; เลือกช่วง: แสดงเฉพาะวันที่มีรายการ)
คอลัมน์: ☐ | วันที่ (วันในสัปดาห์) | ชื่อ | สาขา | เข้า | พัก (เช่น "12:00–12:45, 15:00–15:10") | ออก | พักรวม | สุทธิ | ป้าย | สถานะวัน | ปุ่ม
- เวลาหลังเที่ยงคืนแสดง "02:00 (+1)"
- ป้าย: สาย N นาที, ใกล้ขอบเขต, น่าสงสัย, วันไม่ตรง, แอดมินบันทึก, แก้เวลาแล้ว, มีรายการไม่นับ, ไม่มีเวลาออก, คำขอรอ N
- สถานะวัน: "🔒 ยืนยันแล้ว (อีเมล, เวลา)" / "ยังไม่ยืนยัน"
- ปุ่ม: แก้ | ยืนยัน | ปลดล็อก (เฉพาะที่ล็อก) | ประวัติ
- **แก้ในช่อง**: ดับเบิลคลิกช่อง "เข้า" หรือ "ออก" → กลายเป็น `<input type="time">` Enter = บันทึกผ่าน `commitDayChange` (แก้รายการนั้น หรือสร้างใหม่ถ้ายังไม่มี) Esc = ยกเลิก; ช่วงพักแก้ในตัวแก้ไขวันเท่านั้น
- แถวที่ล็อก: สีเทา แก้ในช่องไม่ได้

**ตัวแก้ไขวัน** (กด "แก้" แล้วแถวขยายลงมาด้านล่าง)
- ตารางย่อย 1 แถวต่อรายการ (เรียงตามเวลา รวมรายการที่ไม่นับแบบขีดฆ่า): ประเภท (select) | เวลา (time) | +1 วัน (checkbox) | สาขา (select) | ที่มา ("เครื่องพนักงาน ±acc ม. ห่าง d ม." หรือ "แอดมินบันทึก") | ธง | หมายเหตุ | [ยกเลิกรายการ] / [กู้คืน]
- log app: ประเภทและสาขา disabled (หลักฐานแก้ไม่ได้) แก้ได้แค่เวลา/ยกเลิก/หมายเหตุ; ถ้าเวลาเปลี่ยนแสดง "เดิม 08:31 (เวลาจริงจากเซิร์ฟเวอร์)"
- "+ เพิ่มรายการ" → แถวใหม่ (ประเภทเดาจากรายการก่อนหน้า สาขา = สาขาของวันนั้น)
- ข้อความตรวจสด (validateSeq) ด้านล่าง: error สีแดง (ปุ่มบันทึกกดไม่ได้) warning สีส้ม
- "เหตุผลการแก้" (ไม่บังคับ ปุ่มสำเร็จรูป: ลืมกด / แก้ตามที่พนักงานแจ้ง / เครื่องมีปัญหา / กดผิด) → audit `reason`
- ตัวอย่างผลต่อสถานะ: "สถานะของ เอ จะเปลี่ยนเป็น: ออกงานแล้ว (กะ 20 ต.ค.)" และคำเตือน "หลังบันทึก เอ จะกดเข้างานวันนี้ไม่ได้อีก" เมื่อปิดกะของวันนี้
- ถ้า state ไม่ตรงกับ log ของ state.workDate → แถบเตือน + ปุ่ม "ซ่อมสถานะ"
- ปุ่ม: บันทึก / ยกเลิก / บันทึกและยืนยันวัน (ส่ง days confirmed ใน update เดียวกัน — rules ใช้ค่าล็อกก่อนเขียนจึงผ่าน)

**+ เพิ่มวันทำงาน** (หน้าต่าง): พนักงาน, วันที่, เข้า, ออก (+1 วัน), พัก 0–3 ช่วง, สาขา, เหตุผล → สร้าง log `source admin` ทั้งชุดผ่าน `commitDayChange`

**ยืนยันวัน**: ต้องไม่มี error, กะปิดแล้ว (หรือวันว่าง), ไม่มีรายการรอตรวจ/คำขอ pending ของวันนั้น (ถ้ามีถามซ้ำ "ยังมีรายการรอตรวจ N รายการ ยืนยันต่อหรือไม่") → `days/{d}/{sid}` = confirmed true, confirmedBy uid, confirmedAt serverTimestamp + audit `op confirm_day`; ยืนยันหลายแถว = update เดียว (audit ต่อแถว) แถวที่ไม่ผ่านให้ข้ามและสรุปให้ทราบ
**ปลดล็อก**: ยืนยันซ้ำ → confirmed false (confirmedBy/At เดิมคงไว้) + audit `op unlock_day`
**ประวัติ**: query `audit` ด้วย `orderByChild('path')` ช่วง `startAt(P)` ถึง `endAt(P + "\uf8ff")` โดย `P = 'logs/' + d + '/' + sid + '/'` รวมกับ audit ของ `days/d/sid` และ `state/sid` ที่ `group` ตรงกัน แสดง เวลา / ผู้แก้ (byEmail) / op / ก่อน→หลัง (ts, type, review, voided) / เหตุผล

### 8.3 แท็บ สถานะวันนี้ (ปรับเล็กน้อย)
- ใช้ summarize v2 (ไม่นับ voided/rejected) และ `D.logsWin`
- ป้าย "วันทำงานไม่ตรงกับเวลาจริง" ใช้ `dateMismatch` และหายเมื่อ `in` ถูกยืนยันแล้ว
- ป้ายธงแสดงเฉพาะที่ยังไม่ review
- คลิกการ์ด → ไปบันทึกเวลาของคนนั้นวันนี้

### 8.4 แท็บ ตั้งค่าสาขา → การ์ด "ค่าทั่วไป" เพิ่ม
- reviewDays, correctionDays (ช่องตัวเลข + บันทึก)
- การ์ด **ปฏิทินวันทำงาน (กันเลือกวันเอง)**: แสดง "มีถึงวันที่ X" (จาก `D.calLast`), ปุ่ม "สร้าง/ต่ออายุ 5 ปี" (เขียน `calendar/{d}` ตั้งแต่วันนี้−7 ถึง 31 ธ.ค. ของปีที่ +5 ราว 1,900 รายการใน update เดียว), สวิตช์ "บังคับใช้" (เปิดได้เมื่อปฏิทินครอบคลุมอย่างน้อยวันนี้+365 และต้องยืนยันซ้ำ); ถ้าเปิดอยู่และเหลือไม่ถึง 60 วัน → แถบเตือนแดงบนทุกแท็บ "ปฏิทินใกล้หมด พนักงานจะกดเข้างานไม่ได้ — กดต่ออายุ"
- audit แบบ best-effort ตอนบันทึกสาขา/พนักงาน (`op edit_branch`, `edit_staff`) ใส่ใน update เดียวกัน

---

## 9. UI: `clock.html`

### 9.1 หน้าหลัก (B)
- ใต้ไทม์ไลน์เพิ่มลิงก์ `[แจ้งแก้เวลา]` (ปุ่ม `.btn.link` สูงอย่างน้อย 44px) ส่วน `[ประวัติ]` ยังซ่อนจนเฟส 3
- มีคำขอ pending: บรรทัดเล็ก "คำขอแก้เวลา รออนุมัติ 1 รายการ"; มีผลตัดสินที่ยังไม่เคยเปิดดู (`decidedAt` มากกว่า `localStorage['clock.corrSeen']`) → จุดแดงที่ลิงก์ + บรรทัด "เจ้าของตอบคำขอแล้ว — แตะเพื่อดู"
- การ์ด STALE: เพิ่มปุ่ม "แจ้งเวลาออกของกะก่อน" → เปิดหน้า D โดยเลือกวัน = `state.workDate` และประเภท = ลืมกดออกงาน ไว้ให้
- ไทม์ไลน์ใช้ summarize v2 ไม่แสดงรายการที่ไม่นับ รายการ `source admin` ต่อท้าย "(เจ้าของบันทึก)"
- listener เพิ่ม: `query(A('corrections'), orderByChild('staffId'), equalTo(me.sid))` (rules เฟส 1 รองรับแล้ว ดูเทส R28)

### 9.2 หน้า D: แจ้งแก้เวลา (ตามหลักออกแบบข้อ 2 ของ brief: ปุ่มใหญ่ ทีละขั้น ภาษาพูด)
view ใหม่ `CORR_LIST` และ `CORR_NEW` (ตัวแปร `corr` เก็บ step, d, type, time, endTime, nextDay, endNextDay, reason, err) ทุกขั้นมีปุ่ม "← กลับ" ใหญ่ด้านบน
1. **เลือกวัน** — ปุ่มใหญ่ "วันนี้ (ศ. 24 ต.ค.)", "เมื่อวาน (พฤ. 23 ต.ค.)" และย้อนได้ถึง `correctionDays` วัน (ค่าเริ่มต้น 7) ใต้ชื่อวันแสดงไทม์ไลน์สั้นของวันนั้น ("เข้า 08:02 · ออก —") อ่านจาก `logs/{d}/{sid}` (get ทีละวัน) ข้อความช่วย "กะข้ามคืน ให้เลือกวันที่เริ่มกะ"
2. **เลือกเรื่อง** — 4 ปุ่มใหญ่: ลืมกดเข้างาน (`in`) / ลืมกดออกงาน (`out`) / ลืมกดพัก (`break`) / ลืมกดกลับจากพัก (`break_end`)
3. **ใส่เวลา** — `<input type="time">` ตัวอักษรอย่างน้อย 32px (พักมี 2 ช่อง "เริ่มพัก" / "กลับจากพัก") ติ๊ก "หลังเที่ยงคืน (เช้าวันถัดไป)" ตั้งอัตโนมัติเมื่อเวลาน้อยกว่าเวลาเข้าของวันนั้น แสดงคำอธิบาย "= วันเสาร์ 25 ต.ค. เวลา 01:30"; ห้ามเวลาในอนาคต ("เวลานี้ยังมาไม่ถึง")
4. **เหตุผล** — ปุ่มสำเร็จรูป (เลือกได้ 1): "ลืมกด", "มือถือแบตหมด", "ไม่มีเน็ต", "หาตำแหน่งไม่ได้", "ไปทำงานนอกร้าน" + ช่องพิมพ์เพิ่ม (ไม่เกิน 200 ตัว) ต้องมีอย่างน้อยอย่างใดอย่างหนึ่ง → `reason` = ปุ่มที่เลือก + " — " + ข้อความ (ถ้ามี)
5. **ตรวจแล้วส่ง** — การ์ดสรุป "ขอแก้: ลืมกดออกงาน · ศ. 24 ต.ค. · 17:30 · เหตุผล: ลืมกด" ปุ่มเขียวใหญ่ "ส่งคำขอ" → `set(push(A('corrections')), { staffId, workDate, type, time, endTime?, nextDay?, endNextDay?, reason, status:'pending', createdAt: serverTimestamp() })` → เครื่องหมายถูก "ส่งแล้ว รอเจ้าของอนุมัติ" 2 วิ → `CORR_LIST`
- กันซ้ำ: มี pending วัน+ประเภทเดียวกันแล้ว → "มีคำขอเรื่องนี้รออยู่แล้ว" (ยกเลิกอันเดิมก่อนได้)
- ออฟไลน์: ส่งได้ (RTDB เข้าคิว) แสดง "จะส่งเมื่อมีเน็ต"; ส่งไม่สำเร็จ → "ส่งไม่สำเร็จ — ลองใหม่ ถ้ายังไม่ได้ให้แจ้งเจ้าของ"
- หน้า D ไม่ตรวจตำแหน่ง

**CORR_LIST (คำขอของฉัน)** — ปุ่มเขียวใหญ่ "แจ้งแก้เวลาใหม่" ด้านบน แล้วรายการ 30 อันล่าสุด (ใหม่ก่อน) การ์ดละ: เรื่อง + วัน + เวลา + เหตุผล + ป้ายสถานะ
- รออนุมัติ (เหลือง) + ปุ่ม "ยกเลิกคำขอ" (ยืนยันซ้ำ → `remove`)
- อนุมัติแล้ว (เขียว) + "บันทึกเป็น 17:40" ถ้า `appliedTs` ต่างจากที่ขอ + `resultNote`
- ไม่อนุมัติ (แดง) + `resultNote`
- เปิดหน้านี้แล้วตั้ง `clock.corrSeen` = decidedAt ล่าสุด

หมายเหตุโค้ด: `body` ตั้ง `user-select:none` ต้องเพิ่ม `input,textarea{user-select:text;-webkit-user-select:text}`; `render()` วาดใหม่เมื่อ viewKey เปลี่ยน → viewKey ของหน้า D รวมแค่ `step` (ไม่รวมค่าที่กำลังพิมพ์) ไม่อย่างนั้นช่องกรอกจะถูกสร้างใหม่ระหว่างพิมพ์

---

## 10. edge case และความเสี่ยง

1. **ลบ `.write` ระดับ `days` ไม่ครบ** = audit ของ days ไม่มีผลเลย (สิทธิ์ไหลลงลูก) — R35 ต้องมีกรณี `set(days/d)` ทั้งก้อนแล้วล้มเหลว
2. **rules ยาวขึ้นมาก** (logs) — เสี่ยงวงเล็บผิด ต้องรันเทสครบทุกครั้ง; ขนาดไฟล์ยังห่างเพดาน 256 KB
3. **แข่งกันเขียน** แอดมินกับพนักงาน: CAS `prevLogId` (R38); แอปพนักงานที่ถือ state เก่า → rules ปฏิเสธ (`N.inAt === S.inAt`) แอปแสดง "บันทึกไม่สำเร็จ" listener อัปเดตแล้วกดใหม่ได้
4. **แอดมิน 2 คน** แก้ state พร้อมกันโดย lastLogId ไม่เปลี่ยน → คนหลังชนะ (ยอมรับ)
5. **ยืนยันวันขณะกะเปิด** → rules ปฏิเสธ (R36) UI ปิดปุ่ม
6. **คำขอเป็นวันที่ยืนยันแล้ว** → ส่งได้ แอดมินต้องปลดล็อกก่อนใช้
7. **คำขอสแปม** → rules จำกัดจำนวนไม่ได้ แต่ต้องเป็นพนักงานที่อนุมัติแล้ว และลบของตัวเองได้แค่ที่ยังรอ แอดมินกดไม่อนุมัติ
8. **ปฏิทินไม่ครอบคลุมขณะเปิดบังคับ** = ทุกคนกดเข้างานไม่ได้ → ค่าเริ่มต้นปิด เปิดได้เมื่อครอบคลุม 365 วัน แถบเตือนเมื่อเหลือไม่ถึง 60 วัน ปิดสวิตช์ได้ทันที
9. **PC เจ้าของไม่ได้ตั้ง timezone ไทย** → ทุกการแปลงใช้ `Intl` timeZone Asia/Bangkok และ `+07:00` (E14)
10. **นาฬิกา PC คลาด** → ตรวจ "อนาคต" ด้วย `serverNow()`; rules ใช้ now ของเซิร์ฟเวอร์
11. **เวลาเท่ากัน/ซ้อนกัน** → validateSeq error
12. **หลายกะในวันเดียว** (เกิดได้จาก STALE ที่ `$d` เดียวกัน) → summarize v2 รองรับ validateSeq เตือน คิวรอตรวจแสดง "ลืมออกงาน" ของกะแรก
13. **ไม่ยืนยัน `in` แต่มี break/out ต่อท้าย** → ลำดับเสีย เสนอ "ไม่ยืนยันทั้งกะ"
14. **พนักงานถูกปิดบัญชี/ยกเลิกเครื่อง** → แอดมินยังแก้ log/state ได้ (กิ่ง ADMIN ไม่ใช้ STAFF_OK) พนักงานส่งคำขอไม่ได้
15. **หมุดสาขาถูกย้าย** → แผนที่รอตรวจแสดงทั้งระยะตอนกด (เก็บใน log) และระยะคำนวณใหม่
16. **`clock.html` รุ่นเก่าใน cache** → SW เป็น network-first ได้ไฟล์ใหม่เร็ว รุ่นเก่ายังเขียนได้ถูก แค่ไทม์ไลน์อาจนับรายการที่ถูกยกเลิกจนกว่าจะโหลดใหม่ (ไม่ต้องเพิ่ม CACHE_VERSION เพราะรายการ precache ไม่เปลี่ยน)
17. **audit โตเรื่อยๆ** → ไม่ลบ (ตั้งใจ) ปริมาณต่ำ ห้ามฟัง `audit` ทั้งก้อน ใช้ query ตาม path เท่านั้น
18. **XSS**: reason / note / resultNote / byEmail ใช้ textContent ทั้งหมด
19. **Leaflet ในแท็บที่ซ่อน** → `invalidateSize()` ตอนเปิดแท็บรอตรวจ
20. **`null === null` ใน rules** ถ้าไม่ทำงานตามคาด ใช้รูปแบบ exists() (ข้อ 3.1)

---

## 11. เคสเทส rules ใหม่ (ต่อจาก R28 ใน `tests/rules.test.mjs`)

helper ใหม่: `adminEmail()` = `env.authenticatedContext('adm', { email: 'boss@test.com', firebase: { sign_in_provider: 'password' } })`; `audited(db, path, before, after, op)` คืน updates ที่ใส่ auditId/editedBy/editedAt และ `audit/{aid}` แบบเดียวกับ `withAudit`

**เทสเดิมที่ต้องแก้** (พฤติกรรมเปลี่ยนโดยตั้งใจ)
- R17 บรรทัดสุดท้าย: แอดมินเขียน `state/s2` ต้องมี audit + prevLogId เป็นขีด (เพิ่ม assertFails แบบไม่มี audit ด้วย)
- R28 บรรทัดสุดท้าย: `decidedAt: serverTimestamp()` แทน `1`
- R23 คงไว้ (calendarEnforced ปิด) เพิ่มหมายเหตุอ้าง R45

| # | ผู้ใช้ | การกระทำ | ผลที่ต้องได้ |
|---|---|---|---|
| R29 | แอดมิน | แก้ ts ของ log app: ไม่มี audit / มี audit + origTs = ts เดิม | ปฏิเสธ / ผ่าน |
| R30 | แอดมิน | auditId ที่มีอยู่แล้ว; audit path ชี้ log อื่น; audit `after/ts` ไม่ตรง; `before/ts` ไม่ตรง; `editedBy` คนอื่น; `editedAt` ไม่ใช่ now; update `review` อย่างเดียวโดยไม่เปลี่ยน auditId | ปฏิเสธทั้งหมด |
| R31 | แอดมิน | log app: เปลี่ยน lat / distance / type / uid / branchId / flag / ไม่ส่ง lat (ลบ) / เปลี่ยน source เป็น admin; ตั้ง review / voided / note | 8 อย่างแรกปฏิเสธ / 3 อย่างหลังผ่าน |
| R32 | แอดมิน | `remove` log, `set(log, null)`; void ด้วย audit | ปฏิเสธ / ปฏิเสธ / ผ่าน |
| R33 | แอดมิน | สร้าง log `source admin` (type, ts อดีต, branchId) + audit ไม่มี before; ts อนาคต; ts ก่อนปี 2020; branchId ไม่มีจริง; ไม่มี audit | ผ่าน / ปฏิเสธ ×4 |
| R34 | แอดมิน | แก้ ts log app ไม่ใส่ origTs; origTs ≠ ts เดิม; ครั้งที่ 2 เปลี่ยน origTs; ครั้งที่ 2 ไม่ส่ง origTs; ครั้งที่ 2 origTs เท่าเดิม | ปฏิเสธ ×4 / ผ่าน |
| R35 | แอดมิน | days ยืนยัน + audit; ไม่มี audit; `set(days/d)` ทั้งก้อน; confirmedBy คนอื่น; confirmedAt ≠ now; ลบ days; ปลดล็อก (confirmed false + audit) | ผ่าน / ปฏิเสธ ×5 / ผ่าน |
| R36 | แอดมิน | ยืนยันวันที่ state working/on_break บนวันนั้น; หลังใส่ out (state done) ยืนยัน; ใส่ out + state + ยืนยันใน update เดียว | ปฏิเสธ / ผ่าน / ผ่าน |
| R37 | แอดมิน | แก้ log วันที่ล็อก; ปลดล็อก+แก้ใน update เดียว; ปลดล็อก (write 1) แล้วแก้ (write 2); แก้+ยืนยันใน update เดียวบนวันที่ยังไม่ล็อก | ปฏิเสธ / ปฏิเสธ / ผ่าน / ผ่าน |
| R38 | แอดมิน | state: ไม่มี audit; prevLogId ไม่ตรง (จำลองพนักงานกดแทรก); prevLogId เป็นขีด (-) เมื่อยังไม่มี state; working ไม่มี inAt; lastLogId ชี้ log ที่ไม่มี; off ไม่มี inAt; update บางฟิลด์; ลบ state; audit after/status ไม่ตรง | ปฏิเสธ / ปฏิเสธ / ผ่าน / ปฏิเสธ / ปฏิเสธ / ผ่าน / ปฏิเสธ / ปฏิเสธ / ปฏิเสธ |
| R39 | แอดมิน แล้วพนักงาน | (ก) แอดมินเพิ่ม out เมื่อวาน + state done/เมื่อวาน → พนักงาน in วันนี้; (ข) แอดมินเพิ่ม in วันนี้ + state working (inAt = ts ที่ตั้ง, since ย้อนหลัง) → พนักงาน break_start; (ค) แอดมินตั้ง state off บนวันนี้ (void ทุกรายการ) → พนักงาน in วันนี้ | ผ่านทุกขั้น |
| R40 | พนักงาน | ใส่ auditId / prevLogId ใน state; ใส่ auditId / editedBy / voided / origTs / note / correctionId / movedFrom ใน log ของตัวเอง | ปฏิเสธทั้งหมด |
| R41 | พนักงาน | correction type break มี endTime / ไม่มี endTime; nextDay true; ลบคำขอ pending ของตัวเอง; ลบคำขอที่ตัดสินแล้ว; ลบของคนอื่น; ใส่ resultNote / appliedTs / decidedBy เอง | ผ่าน / ปฏิเสธ / ผ่าน / ผ่าน / ปฏิเสธ / ปฏิเสธ / ปฏิเสธ |
| R42 | แอดมิน | ตัดสิน approved โดย decidedBy = ตัวเอง + decidedAt = now; decidedBy คนอื่น; decidedAt ไม่ใช่ now; ตัดสินซ้ำคำขอที่ตัดสินแล้ว; เปลี่ยน time/reason ของคำขอ; สร้าง correction ใหม่; ลบ correction | ผ่าน / ปฏิเสธ ×6 |
| R43 | แอดมิน | approved + appliedLogId โดย log ใน update เดียวกันมี correctionId = cid; appliedLogId ชี้ log ที่ไม่มี correctionId; log มี correctionId ชี้ correction ที่ไม่มี | ผ่าน / ปฏิเสธ / ปฏิเสธ |
| R44 | แอดมิน/anonymous | audit มี op/group/ref/reason/byEmail ถูกต้อง; byEmail ไม่ตรง token; op รูปแบบผิด; ฟิลด์แปลก; query audit ด้วย orderByChild path + startAt/endAt; anonymous อ่าน audit | ผ่าน / ปฏิเสธ ×3 / ผ่าน / ปฏิเสธ |
| R45 | แอดมิน/พนักงาน | calendar: แอดมินเขียนค่าเที่ยงคืนถูก / ค่าไม่ใช่เที่ยงคืน / anonymous เขียน; เปิด calendarEnforced แล้วพนักงาน in ที่ $d = วันนี้ / $d = 2020-01-01 / $d ที่ไม่มีในปฏิทิน / break_start ของกะเมื่อวาน (ไม่ถูกบังคับ) | ผ่าน / ปฏิเสธ / ปฏิเสธ / ผ่าน / ปฏิเสธ / ปฏิเสธ / ผ่าน |
| R46 | แอดมิน/anonymous | settings: reviewDays 31 / 1000; correctionDays 7 / 0; calendarEnforced true / ข้อความ "yes"; anonymous เขียน calendarEnforced | ผ่าน / ปฏิเสธ / ผ่าน / ปฏิเสธ / ผ่าน / ปฏิเสธ / ปฏิเสธ |
| R47 | พนักงาน | กดครบวงแบบ R11 หลังแอดมินเคยเขียน state (มี auditId/prevLogId ค้างอยู่) | ผ่านทุกขั้น |
| R48 | ทุกคน | ข้อมูลรูปแบบเฟส 1 (seed log/state/corrections ที่ไม่มีฟิลด์ใหม่) อ่านได้ตามสิทธิ์เดิม และพนักงานกดต่อจาก state เดิมได้ | ผ่าน |

เป้าหมาย: `npm test` ได้ pass 48 / fail 0 (R1–R48) ใน Rules Playground ทดสอบทีละ path ได้แค่ R32, R40 (บางส่วน), R41 (การลบ), R46 ที่เหลือเป็น multi-path ต้องใช้ emulator

---

## 12. แผนทดสอบ E2E (emulator + เบราว์เซอร์ ตาม docs/testing.md ข้อ 2)

เตรียม: master เปิดด้วย ?emu=1 สร้างสาขาเริ่มต้น (วงเวียน 17.318062, 99.832187 รัศมี 10 / maxAccuracy 30 / graceFactor 2), พนักงาน เอ และ บี; clock.html?emu=1 ใน Chrome 2 โปรไฟล์ ลงทะเบียนและอนุมัติ; DevTools Sensors ตั้งที่พิกัดร้าน (ถ้าตั้ง accuracy ไม่ได้ ให้ seed log ที่มี flag ผ่าน REST ด้วยหัว Authorization: Bearer owner)

| # | ขั้นตอน | ผลที่ต้องเห็น |
|---|---|---|
| E1 | เอ กดเข้างานที่ระยะราว 15 ม. (borderline) | รอตรวจ +1 การ์ดมีป้าย "อยู่นอกรัศมีเล็กน้อย" แผนที่มีวงเขียว 10 ม. วงส้ม 20 ม. หมุด + วงความแม่นยำ; ✔ → การ์ดหาย ตัวเลขลด มี audit op review_log |
| E2 | seed log suspect (flagReason acc และ same) ของ บี กะที่กำลังทำ | ป้าย 2 เหตุผลภาษาไทย; ✘ → ไม่ยืนยันทั้งกะ → แอป บี กลับเป็นปุ่ม "เข้างาน" กดใหม่ได้ |
| E3 | seed state เอ working เมื่อวาน inAt 17 ชม.ก่อน (STALE) | แอปแสดงการ์ด STALE + ปุ่ม "แจ้งเวลาออกของกะก่อน" → หน้า D เลือกไว้แล้ว ใส่ 17:30 เหตุผล "ลืมกด" ส่ง → master คำขอ +1 → ✔ → log source admin เมื่อวาน + state done/เมื่อวาน → แอป เอ กดเข้างานวันนี้ได้; คำขอในแอปเป็น "อนุมัติแล้ว" |
| E4 | ทำ E3 อีกครั้ง แต่ เอ กดเข้างานวันนี้ก่อน (ผ่าน STALE) แล้วค่อยอนุมัติ | state ของวันนี้ไม่เปลี่ยน กะเมื่อวานมีเวลาออก |
| E5 | กะข้ามคืน: seed in 20:00 ของวันก่อน ขอ out 02:00 "หลังเที่ยงคืน" | ts = วันถัดไป 02:00 อยู่ใน logs ของวันเริ่มกะ ตารางแสดง "02:00 (+1)" ชม.สุทธิถูก |
| E6 | คำขอลืมกดพัก 12:00–13:00 → ✎ แก้เป็น 12:10–13:00 แล้วอนุมัติ | สร้าง 2 log; แอปแสดง "อนุมัติแล้ว · บันทึกเป็น 12:10" |
| E7 | ✘ คำขอพร้อมข้อความ | แอปแสดง "ไม่อนุมัติ" + ข้อความ จุดแดงค้างจนกว่าจะเปิดดู |
| E8 | บันทึกเวลา: ช่วง 7 วัน กรองสาขา/คน; ดับเบิลคลิกแก้เวลาเข้าของกะที่กำลังทำ | ป้าย "แก้เวลาแล้ว", origTs เก็บเวลาเดิม, state.inAt เปลี่ยน แอปพนักงานยังกดพัก/ออกได้ |
| E9 | + เพิ่มวันทำงาน ให้ บี วันนี้ 08:00–17:00 | ป้าย "แอดมินบันทึก" แอป บี เป็น "ออกงานแล้ว" กดเข้าไม่ได้ |
| E10 | ยืนยันวันของ เอ → พยายามแก้ → ปลดล็อก → แก้ → ยืนยันอีกครั้ง | แก้ขณะล็อกถูกปฏิเสธ ประวัติแสดง confirm, unlock, edit, confirm |
| E11 | ยืนยันวันขณะ เอ ยังทำงาน | ปุ่มกดไม่ได้ (rules ปฏิเสธถ้ายิงตรง) |
| E12 | เปิดตัวแก้ไขวันของ เอ ค้าง → เอ กดเริ่มพักที่มือถือ → master กดบันทึก | master แจ้ง "ข้อมูลเปลี่ยนระหว่างแก้" ไม่ทับ state |
| E13 | ยิง in ด้วยวันทำงาน 2099-12-31 และ 2020-01-01 จาก console ของแอปพนักงาน (calendarEnforced ปิด) | รอตรวจมี "วันไม่ตรง" / "สถานะผิดปกติ" สถานะวันนี้มีป้ายแดง; ✎ ย้ายวัน → log ไปวันที่ถูก state ตาม; สร้างปฏิทินและเปิดบังคับ แล้วยิงซ้ำ → ถูกปฏิเสธ แต่กดปกติยังได้ |
| E14 | ตั้ง timezone Windows เป็น UTC แล้วทำ E5, E8 | เวลาที่แสดง/กรอกเป็นเวลาไทยทั้งหมด |
| E15 | แอปพนักงานออฟไลน์ ส่งคำขอ → ต่อเน็ต | คำขอถึง master และ createdAt เป็นเวลาที่ถึงเซิร์ฟเวอร์ |
| E16 | ยกเลิกรายการ (void) ในตัวแก้ไขวัน แล้วกู้คืน | ไทม์ไลน์ทั้ง 2 แอปไม่นับ ตารางแสดงขีดฆ่า กู้คืนแล้วกลับมานับ |
| E17 | ประวัติของแถว | เห็นทุกการแก้ เรียงเวลา พร้อม byEmail และเหตุผล |
| E18 | ทวนเช็กลิสต์เฟส 1 (docs/testing.md ข้อ 3 และ 5) | ผ่านเหมือนเดิม |

---

## 13. คำถามสำหรับเจ้าของ (มีค่าเริ่มต้นแล้ว ไม่ตอบก็สร้างต่อได้)
1. **✘ ไม่ยืนยัน = ไม่นับเวลานั้นเลย** ใช่ไหม → *ค่าเริ่มต้น:* ใช่ (ทั้งไทม์ไลน์และชั่วโมง พนักงานต้องกดใหม่หรือขอแก้)
2. **ขอแก้ย้อนหลังได้กี่วัน** → *ค่าเริ่มต้น:* 7 วัน (ปรับได้ที่ correctionDays)
3. **คิวรอตรวจดูย้อนหลังกี่วัน** → *ค่าเริ่มต้น:* 31 วัน (reviewDays)
4. **เปิดการบังคับปฏิทิน (กันเลือกวันทำงานเอง) ทันทีไหม** → *ค่าเริ่มต้น:* สร้างไว้แต่ปิด ให้เจ้าของเปิดหลังใช้จริง 1 สัปดาห์โดยไม่มีปัญหา (ถ้าปฏิทินหมดอายุขณะเปิด พนักงานทุกคนจะกดเข้างานไม่ได้)
5. **audit ของการแก้ข้อมูลพนักงาน/สาขา บังคับใน rules ด้วยไหม** → *ค่าเริ่มต้น:* ไม่บังคับ เขียนแบบ best-effort (บังคับเฉพาะ log/state/วัน)
6. **เหตุผลการแก้ของแอดมินต้องใส่ทุกครั้งไหม** → *ค่าเริ่มต้น:* ไม่บังคับ มีปุ่มสำเร็จรูป
7. **พนักงานยกเลิกคำขอที่ยังรอได้** → *ค่าเริ่มต้น:* ได้
8. **ยืนยันวันที่ยังไม่มีเวลาออก (กะไม่ปิด)** → *ค่าเริ่มต้น:* ไม่ได้ ต้องใส่เวลาออกก่อน หรือไม่ยืนยันทั้งกะ
9. **กะยาวเกินกี่ชั่วโมงจึงเข้าคิวตรวจ** → *ค่าเริ่มต้น:* 16 ชม. (เท่า STALE)
10. **ผ่อนผันเที่ยงคืนสำหรับ "วันไม่ตรง"** → *ค่าเริ่มต้น:* 15 นาที
11. **แจ้งผลคำขอให้พนักงาน** → *ค่าเริ่มต้น:* ในแอปเท่านั้น (จุดแดง + รายการ) LINE เป็นงานภายหลัง

---

## 14. ลำดับงานสำหรับ code-builder

ทำตามลำดับ แต่ละขั้นต้องรันเทสผ่านก่อนไปขั้นถัดไป **ห้ามแตะ gps-test.html** ไม่สร้างไฟล์ใหม่นอกจากที่ระบุ

1. **rules + เทส (ทำก่อนทุกอย่าง)** — database.rules.json ตามข้อ 3.2 (เขียน expression เต็ม ห้ามมีตัวย่อ และลบ .write ระดับ days) → tests/rules.test.mjs: ปรับ R17, R28 + เพิ่ม R29–R48 + helper adminEmail และ audited → รัน cd tests แล้ว npm test ต้องได้ pass 48 / fail 0; ถ้า null === null หรือตัวดำเนินการ % ไม่ทำงานใน emulator ให้ใช้ทางเลือกในข้อ 3.1 แล้วรายงาน
2. **ตรรกะกลางใน master** — tsOf, midnightAfter, isExcluded, summarize v2, validateSeq, deriveState, dateMismatch, withAudit, commitDayChange (ข้อ 4–5) เป็นฟังก์ชันล้วนไว้ส่วนบนของสคริปต์; ใส่ summarize v2 + isExcluded ใน clock.html ด้วย (เนื้อเดียวกัน)
3. **listener ใหม่ใน master** — logsWin, days, corrPending, calLast + เปลี่ยนสถานะวันนี้ให้อ่าน logsWin (ข้อ 8, 8.3) + ปิดทุกตัวใน teardown
4. **แท็บ บันทึกเวลา** — ตัวกรอง → ตาราง → ตัวแก้ไขวัน → แก้ในช่อง → เพิ่มวันทำงาน → ยืนยัน/ปลดล็อก (เดี่ยวและหลายแถว) → ประวัติ → ซ่อมสถานะ (ข้อ 8.2)
5. **แท็บ รอตรวจ** — สร้างรายการ (8.1.1) + แผนที่เดียว → ปุ่ม ✔ ✘ ✎ ผ่าน commitDayChange → คำขอแก้เวลา + apply (ข้อ 6, 8.1.2) → ย้ายคำขอผูกเครื่องลงล่าง → ตัวเลขบนแท็บรวม 3 กลุ่ม + document.title
6. **clock.html หน้า D + คำขอของฉัน** — listener corrections, ลิงก์ที่หน้าหลัก, จุดแดง, ทางลัด STALE, view CORR_LIST และ CORR_NEW ตามข้อ 9 + CSS ของ input
7. **ตั้งค่า** — reviewDays, correctionDays, การ์ดปฏิทิน (สร้าง/ต่ออายุ, สวิตช์บังคับ, แถบเตือน) (ข้อ 8.4)
8. **audit best-effort** ของการบันทึกพนักงาน/สาขา (ข้อ 8.4)
9. **ย้ายไปวันที่ถูกต้อง** (8.1.4) — ตัดได้ถ้าเวลาไม่พอ (ให้ ✎ เปิดตัวแก้ไขวันแทน) ต้องรายงานถ้าตัด
10. **เอกสาร** — README (อัปเดตบรรทัด "เฟส 1 (เวอร์ชันนี้)" เป็นเฟส 2, เพิ่มหัวข้อ "แก้ไขเวลาและการยืนยันวัน", แก้ "ข้อจำกัดที่ควรรู้" เรื่องวันทำงานให้อ้างคิวรอตรวจและปฏิทิน, ลบประโยค "การแก้ log ย้อนหลังอยู่ในเฟส 2"), docs/testing.md (ผลที่ต้องได้ pass 48, เคส Playground ใหม่, เช็กลิสต์ E1–E18); ไม่ต้องแก้ sw.js
11. **ทดสอบเองครบวง** บน emulator ตาม E1–E18 รายงานผลทีละข้อ + สิ่งที่ทดสอบไม่ได้ (เครื่องจริง iOS/Android, Firebase จริง)

จากนั้น **code-reviewer** (เน้น: มี path ไหนที่แอดมินเขียน logs/state/days ได้โดยไม่ผ่าน NEW_AUDIT, สิทธิ์ที่ไหลจากชั้นบน, การลบ, หลักฐานของ log app, CAS, การยกระดับสิทธิ์ของพนักงานผ่านฟิลด์ใหม่ของ corrections, การคำนวณเวลา/timezone, XSS ของ reason/note) → แก้ตามรีวิว → **git-publisher** commit ลง main ของ xziramoon/ngluckseng-clock (push ต้องให้ผู้ใช้ยืนยันก่อน)
