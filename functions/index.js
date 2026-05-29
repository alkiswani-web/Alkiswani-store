/**
 * Cloud Functions for Alkiswani Store.
 *
 * parseOrder: receives a free-text customer message and returns structured
 * order fields (name, phone, address, area, product, qty, notes) using Claude.
 * The Anthropic API key is stored as a secret and never exposed to the client.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
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
