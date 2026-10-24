# เช็กลิสต์ทดสอบ (เฟส 1)

## 1. เทสกฎอัตโนมัติ

```
cd tests
npm install
npm test
```

ต้องมี Java 17 ขึ้นไป (`firebase-tools@14.27.0` ที่ล็อกไว้ใช้ JDK 17 ได้ รุ่น 15 ต้องใช้ JDK 21) ผลที่ต้องได้: `pass 21 / fail 0` (R1-R21)

## 2. ทดสอบในเครื่อง (หน้าเว็บ + emulator)

```
# หน้าต่างที่ 1: emulator
cd tests && npm install && npm run pretest
npx firebase emulators:start --only auth,database --project demo-clock

# หน้าต่างที่ 2: เสิร์ฟไฟล์
npx http-server D:\Claude\ngluckseng-clock -p 8080 -c-1
```

- เปิด `http://localhost:8080/clock-master.html?emu=1` และ `http://localhost:8080/clock.html?emu=1` (พารามิเตอร์ `emu=1` ใช้ได้เฉพาะ localhost เท่านั้น จะต่อกับ emulator ไม่แตะฐานข้อมูลจริง)
- สร้างแอดมินใน Auth emulator: ส่ง `POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x` พร้อม `{"email":"boss@test.com","password":"secret12"}` แล้วเขียน `attendance/admins/<localId>` = `true` ด้วย REST (`PUT http://127.0.0.1:9000/attendance/admins/<localId>.json?ns=demo-clock-default-rtdb` พร้อมหัว `Authorization: Bearer owner`)
- จำลองตำแหน่ง: Chrome DevTools > More tools > Sensors > Location (ใส่พิกัดในและนอกรัศมี และลองตั้ง accuracy ให้แย่)
- PWA: DevTools > Application > Manifest / Service workers, Network > Offline
- ทดสอบบนมือถือจริงต้องเป็น HTTPS: push ไป GitHub Pages (หรือ `npx cloudflared tunnel --url http://localhost:8080` ชั่วคราว)

## 3. เกณฑ์ตรวจรับ เฟส 1 (ทดสอบด้วยมือบนเครื่องจริง)

| เกณฑ์ | วิธีทดสอบ | ผ่าน |
|---|---|---|
| ติดตั้งเป็นแอปเต็มจอ Android/iPhone | ติดตั้งจาก Pages เปิดจากไอคอนแล้วไม่มีแถบ URL | [ ] |
| ลงทะเบียนจนเข้างานได้ภายใน 1 นาที | ให้คนที่ไม่เคยเห็นแอปลองเอง จับเวลา (รวมเวลาแอดมินกดอนุมัติ) | [ ] |
| นอกรัศมีกดไม่ได้และเห็นระยะ / ในรัศมีกดได้ | เดินจริงที่ร้าน หรือ Sensors | [ ] |
| เปลี่ยนนาฬิกามือถือแล้วเวลาไม่เปลี่ยน | ตั้งนาฬิกาเครื่องเลื่อน +2 ชม. กดเข้างาน ดูเวลาใน master/Console | [ ] |
| เครื่องที่ยังไม่อนุมัติเขียน log ไม่ได้ | เคส R4 | [ ] |
| พนักงานแก้/ลบ log ย้อนหลังไม่ได้ | เคส R8 | [ ] |
| master ไม่ล็อกอินอ่านข้อมูลไม่ได้ | เปิดหน้าโดยไม่ล็อกอิน + R1 + ล็อกอินด้วยบัญชีที่ไม่ใช่แอดมิน | [ ] |
| ปรับรัศมีแล้วมือถือใช้ค่าใหม่ทันที | เปิดมือถือค้างไว้ แก้รัศมีใน master แถบระยะเปลี่ยนสีภายใน 5 วิ | [ ] |

## 4. เคสสำหรับ Rules Playground

Playground จำลอง multi-path update ไม่ได้ (ทีละ path) จึงยืนยันเคส R5/R6/R9-R11 ได้เฉพาะในเทส emulator ใน Playground ให้ลองเคสต่อไปนี้ ใช้ path ใต้ `attendance/` เสมอ

| # | ผู้ใช้ (Authenticated / provider) | การกระทำ | ผลที่ต้องได้ |
|---|---|---|---|
| R1 | ไม่ล็อกอิน | read `/attendance/staff`, `/attendance/logs` | ปฏิเสธ |
| R2 | uid ใดๆ, provider `anonymous` | read `/attendance/staff`, `/attendance/branches` | ผ่าน |
| R3 | anonymous | read `/attendance/staffSecret`, `/attendance/admins`, `/attendance/deviceRequests`, `/attendance/state`, `/attendance/logs/2026-01-01` | ปฏิเสธ |
| R4 | anonymous ที่ staff ยังไม่ผูก uid | write `/attendance/logs/<วัน>/<sid>/<id>` | ปฏิเสธ |
| R7 | พนักงานที่อนุมัติแล้ว | write log ที่ `ts` เป็นตัวเลขที่กำหนดเอง | ปฏิเสธ |
| R8 | พนักงานที่อนุมัติแล้ว | write ทับ หรือ delete log เดิม, delete `/attendance/state/<sid>` | ปฏิเสธ |
| R12 | พนักงาน A | write log/state ของ B | ปฏิเสธ |
| R13 | พนักงานที่ `active=false` | write log | ปฏิเสธ |
| R14 | พนักงาน | write log ที่มี `source:"admin"`, `review`, ฟิลด์แปลก | ปฏิเสธ |
| R15 | anonymous | write `/attendance/deviceRequests/<uid ตัวเอง>` pending / ของ uid อื่น / status rejected | ผ่าน / ปฏิเสธ / ปฏิเสธ |
| R16 | anonymous | write `/attendance/staff/<sid>/uid` | ปฏิเสธ |
| R17 | แอดมิน provider `password` และมี `admins/<uid>=true` | read/write ทุก node ของ attendance | ผ่าน |
| R18 | uid ที่อยู่ใน admins แต่ provider `anonymous` | read `/attendance/staffSecret` | ปฏิเสธ |

## 5. เช็กลิสต์ทดสอบด้วยมือเพิ่มเติม

- ปฏิเสธตำแหน่งตอนที่เบราว์เซอร์ถาม > เห็นคำอธิบายและปุ่มลองใหม่
- ปิดอินเทอร์เน็ต > แถบเหลือง ปุ่มเทา กดไม่ได้
- ตำแหน่งในรัศมีแต่ accuracy อยู่ระหว่าง 1-2 เท่าของเกณฑ์ > บันทึกได้ log ติดธง `borderline` (เจ้าของเห็นป้าย "ใกล้ขอบเขต")
- นอกรัศมี และ accuracy แย่พร้อมกัน > ไม่บันทึก
- เปิดบัญชีที่ปิดแล้ว/ปิดบัญชีขณะแอปเปิดอยู่ > หน้าจอเปลี่ยนเป็น "บัญชีนี้ถูกปิดใช้งาน"
- ยกเลิกผูกเครื่องใน master ขณะมือถือเปิดอยู่ > มือถือเปลี่ยนเป็น "เครื่องนี้ถูกยกเลิกการผูกแล้ว"
- master: ไม่ขยับ 29 นาที > มีแถบเตือน, 30 นาที > ออกจากระบบ
- กะข้ามเที่ยงคืน: เข้างาน 22:00, กดพัก/ออกหลังเที่ยงคืน > log อยู่ในวันทำงานเดิม
