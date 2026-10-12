// صفحة صغيرة لكل منتج ألوان: c/<المنتج>.html — فيها اسم المنتج وصورته
// عشان معاينة الرابط بالواتساب/الماسنجر تطلع «ألوان baby-best» بصورته،
// وبتحوّل الزبون فوراً على colors.html?p=<المنتج> (مع c و e زي ما هم).
// تشغيل: node tools/catalog-pages.js   (بيقرا من فايرستور بالمفتاح العام نفسه اللي بالموقع)
const fs = require('fs'), path = require('path');
const KEY = 'AIzaSyAD1KJbggqncxkiqMWna8HaZdtjWHIvzpU';
const SITE = 'https://alkiswanirosemary.com';
const OUT = path.join(__dirname, '..', 'c');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => v == null ? undefined : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : undefined;

// أبعاد الـ JPEG من ترويسة SOF — الواتساب بيحب يعرفها
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

async function main() {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/alkiswani-store/databases/(default)/documents:runQuery?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'operator_products' }],
      select: { fields: ['name', 'hasColorNumbers', 'isRawMaterial', 'imageDataUrl', 'sellPrice'].map(f => ({ fieldPath: f })) } } })
  });
  if (!res.ok) throw new Error('firestore ' + res.status);
  const rows = (await res.json()).filter(r => r.document).map(r => {
    const f = r.document.fields || {};
    return { id: r.document.name.split('/').pop(), name: val(f.name) || '', has: val(f.hasColorNumbers) === true,
      raw: val(f.isRawMaterial) === true, img: val(f.imageDataUrl) || '', price: Number(val(f.sellPrice)) || 0 };
  }).filter(p => p.has && !p.raw && p.name);

  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const keep = new Set(['index.json']);
  for (const p of rows) {
    let og = `${SITE}/icon-512.png`, size = { w: 512, h: 512 };
    const m = /^data:image\/jpe?g;base64,(.+)$/.exec(p.img);
    if (m) {
      const buf = Buffer.from(m[1], 'base64');
      fs.writeFileSync(path.join(OUT, 'img', p.id + '.jpg'), buf);
      keep.add('img/' + p.id + '.jpg');
      const v = require('crypto').createHash('md5').update(buf).digest('hex').slice(0, 8);
      og = `${SITE}/c/img/${p.id}.jpg?v=${v}`; size = jpegSize(buf) || size;
    } else if (/^https:\/\//.test(p.img)) { og = p.img; size = null; }
    const title = 'ألوان ' + p.name;
    const desc = 'اختار ألوانك من الصور واطلب من هون' + (p.price > 0 ? ` — سعر القطعة ${p.price.toFixed(2)} د.أ` : '');
    const to = '/colors.html?p=' + encodeURIComponent(p.id);
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}/c/${p.id}">
<meta property="og:image" content="${esc(og)}">
${size ? `<meta property="og:image:width" content="${size.w}">\n<meta property="og:image:height" content="${size.h}">\n` : ''}<meta name="twitter:card" content="summary">
<script>location.replace(${JSON.stringify(to)}+(location.search?'&'+location.search.slice(1):'')+location.hash);</script>
<noscript><meta http-equiv="refresh" content="0;url=${to}"></noscript>
</head><body style="font-family:Tahoma,sans-serif;text-align:center;padding:40px 16px;"><a href="${to}">${esc(title)}</a></body></html>
`;
    fs.writeFileSync(path.join(OUT, p.id + '.html'), html);
    keep.add(p.id + '.html');
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(rows.map(p => p.id).sort()) + '\n');
  // منتج انحذف أو انشالت ألوانه ⇒ منشيل صفحته
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html') && !keep.has(f)) fs.unlinkSync(path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(OUT, 'img'))) if (!keep.has('img/' + f)) fs.unlinkSync(path.join(OUT, 'img', f));
  console.log('✓', rows.length, 'صفحة:', rows.map(p => p.name).join('، '));
}
main().catch(e => { console.error(e); process.exit(1); });
