/**
 * Cloud Functions for Alkiswani Store.
 *
 * parseOrder: receives a free-text customer message and returns structured
 * order fields (name, phone, address, area, product, qty, notes) using Claude.
 * The Anthropic API key is stored as a secret and never exposed to the client.
 *
 * attendanceNotify: triggers on attendance check-in/check-out and sends
 * FCM push notifications to all registered operator devices.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {initializeApp, getApps} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

if (!getApps().length) initializeApp();
const {defineSecret} = require("firebase-functions/params");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.parseOrder = onCall(
    {secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10},
    async (request) => {
      const text = String(request.data && request.data.text || "")
          .trim().slice(0, 2000);
      const products = Array.isArray(request.data && request.data.products) ?
        request.data.products.slice(0, 400) : [];
      const areas = Array.isArray(request.data && request.data.areas) ?
        request.data.areas : [];
      if (!text) throw new HttpsError("invalid-argument", "النص فارغ");

      const productList = products.join("، ");
      const areaList = areas.join("، ");

      const system = `أنت مساعد متخصص باستخراج بيانات طلبات التوصيل في الأردن من رسائل الزبائن.
أعد JSON فقط دون أي شرح أو نص إضافي، بالشكل التالي بالضبط:
{"name":"","phone":"","address":"","area":"","product":"","qty":1,"notes":""}

القواعد:
- phone: رقم الهاتف الأردني بصيغة 07XXXXXXXX. أزل المسافات والرموز، وحوّل +962 أو 00962 إلى 0.
- area: يجب أن تكون واحدة من المحافظات التالية فقط إن أمكن استنتاجها من العنوان: ${areaList}. إن لم تستطع تحديدها بدقة اتركها فارغة.
- address: العنوان التفصيلي.
- product: طابق المنتج المطلوب مع أقرب اسم من هذه القائمة بالضبط إن وُجد: ${productList}. إن لم يُذكر منتج أو لا يوجد تطابق واضح اتركه فارغاً.
- qty: الكمية كرقم، الافتراضي 1.
- name: اسم الزبون إن ذُكر، وإلا فارغ.
- notes: أي ملاحظات إضافية (لون، كتابة مطلوبة، وقت التوصيل...). إن لا شيء اتركه فارغاً.
- لا تخترع أي معلومة غير موجودة في النص.`;

      let res;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY.value(),
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: system,
            messages: [{role: "user", content: text}],
          }),
        });
      } catch (e) {
        throw new HttpsError("unavailable", "تعذّر الاتصال بخدمة الذكاء الاصطناعي");
      }

      if (!res.ok) {
        throw new HttpsError("internal", "فشل تحليل الرسالة (" + res.status + ")");
      }

      const data = await res.json();
      let out = (data.content && data.content[0] && data.content[0].text) || "{}";
      out = out.replace(/```json/gi, "").replace(/```/g, "").trim();
      const m = out.match(/\{[\s\S]*\}/);
      if (m) out = m[0];
      let parsed = {};
      try {
        parsed = JSON.parse(out);
      } catch (e) {
        parsed = {};
      }

      return {
        name: String(parsed.name || ""),
        phone: String(parsed.phone || ""),
        address: String(parsed.address || ""),
        area: String(parsed.area || ""),
        product: String(parsed.product || ""),
        qty: Number(parsed.qty) || 1,
        notes: String(parsed.notes || ""),
      };
    },
);

// ===== Attendance push notifications =====

async function _sendAttendanceNotif(title, body) {
  const db = getFirestore();
  const messaging = getMessaging();
  const snap = await db.collection("fcm_tokens").get();
  const tokens = snap.docs.map((d) => d.data().token).filter(Boolean);
  if (!tokens.length) return;
  await Promise.allSettled(
      tokens.map((token) =>
        messaging.send({
          token,
          notification: {title, body},
          webpush: {
            notification: {icon: "/icon-192.png", requireInteraction: true},
            headers: {Urgency: "high"},
          },
        }).catch(() => {}),
      ),
  );
}

function _fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Amman",
  });
}

function _fmtDur(secs) {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}س ${m}د` : `${m}د`;
}

// Check-in: new attendance document created
exports.attendanceCheckIn = onDocumentCreated(
    {document: "attendance/{docId}", region: "us-central1"},
    async (event) => {
      const data = event.data.data();
      if (!data || !data.checkIn) return;
      const name = data.employeeName || data.employeeId || "موظف";
      const time = _fmtTime(data.checkIn);
      await _sendAttendanceNotif(
          `✅ دخول — ${name}`,
          `سجّل دخوله الساعة ${time}`,
      );
    },
);

// Check-out: attendance document updated with checkOut
exports.attendanceCheckOut = onDocumentUpdated(
    {document: "attendance/{docId}", region: "us-central1"},
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();
      if (!after || before.checkOut || !after.checkOut) return;
      const name = after.employeeName || after.employeeId || "موظف";
      const time = _fmtTime(after.checkOut);
      const dur = _fmtDur(after.secondsWorked);
      await _sendAttendanceNotif(
          `🔴 خروج — ${name}`,
          `خرج الساعة ${time}${dur ? ` · داوم ${dur}` : ""}`,
      );
    },
);
