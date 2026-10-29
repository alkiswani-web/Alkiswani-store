// صفحة صغيرة لكل منتج ألوان: c/<المنتج>.html — فيها اسم المنتج وصورته
// عشان معاينة الرابط بالواتساب/الماسنجر تطلع «ألوان baby-best» بصورته،
// وبتحوّل الزبون فوراً على /?p=<المنتج> (الكتالوج صار الصفحة الرئيسية — مع c و e زي ما هم).
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

// 1200×630 (مقاس معاينة الواتساب الكبيرة): صور المنتجات مربّعات مرتّبة على خلفية الموقع
async function collage(list) {
  if (list.length < 2) return null;
  let sharp; try { sharp = require('sharp'); } catch (e) { return null; }
  const W = 1200, H = 630, GAP = 18, PAD = 30;
  const rows = list.length > 4 ? 2 : list.length === 4 ? 2 : 1, cols = Math.ceil(list.length / rows);
  const t = Math.floor(Math.min((W - PAD * 2 - GAP * (cols - 1)) / cols, (H - PAD * 2 - GAP * (rows - 1)) / rows));
  const mask = Buffer.from(`<svg width="${t}" height="${t}"><rect width="${t}" height="${t}" rx="${Math.round(t * .09)}" fill="#fff"/></svg>`);
  const comps = [];
  for (let i = 0; i < list.length; i++) {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? list.length - cols * (rows - 1) : cols;
    const rowW = inRow * t + (inRow - 1) * GAP, x0 = Math.round((W - rowW) / 2), y0 = Math.round((H - (rows * t + (rows - 1) * GAP)) / 2);
    const c = i - r * cols;
    const buf = Buffer.from(list[i].img.split(',')[1], 'base64');
    const tile = await sharp(buf).resize(t, t, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    comps.push({ input: tile, left: W - x0 - (c + 1) * t - c * GAP, top: y0 + r * (t + GAP) });   // من اليمين لليسار زي الصفحة
  }
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: '#1a3a2a' } }).composite(comps).jpeg({ quality: 84 }).toBuffer();
  fs.writeFileSync(path.join(OUT, 'img', '_catalog.jpg'), out);
  const v = require('crypto').createHash('md5').update(out).digest('hex').slice(0, 8);
  return { url: `${SITE}/c/img/_catalog.jpg?v=${v}`, size: { w: W, h: H } };
}

async function main() {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/alkiswani-store/databases/(default)/documents:runQuery?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'operator_products' }],
      select: { fields: ['name', 'hasColorNumbers', 'isRawMaterial', 'imageDataUrl', 'sellPrice'].map(f => ({ fieldPath: f })) } } })
  });
  if (!res.ok) throw new Error('firestore ' + res.status);
  const all = (await res.json()).filter(r => r.document).map(r => {
    const f = r.document.fields || {};
    return { id: r.document.name.split('/').pop(), name: val(f.name) || '', has: val(f.hasColorNumbers) === true,
      raw: val(f.isRawMaterial) === true, img: val(f.imageDataUrl) || '', price: Number(val(f.sellPrice)) || 0 };
  });
  const rows = all.filter(p => p.has && !p.raw && p.name);
  // إعدادات الكتالوج الموحّد: اسمه ومنتجاته
  let cfg = {};
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/alkiswani-store/databases/(default)/documents/operator_config/catalog_cfg?key=${KEY}`);
    if (r.ok) { const f = (await r.json()).fields || {};
      cfg.title = val(f.title) || '';
      if (f.products && f.products.arrayValue) cfg.products = (f.products.arrayValue.values || []).map(val).filter(Boolean); }
  } catch (e) {}

  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const keep = new Set(['index.json']);
  const ogOf = p => {
    const m = /^data:image\/jpe?g;base64,(.+)$/.exec(p.img);
    if (!m) return /^https:\/\//.test(p.img) ? { url: p.img, size: null } : null;
    const buf = Buffer.from(m[1], 'base64');
    fs.writeFileSync(path.join(OUT, 'img', p.id + '.jpg'), buf);
    keep.add('img/' + p.id + '.jpg');
    const v = require('crypto').createHash('md5').update(buf).digest('hex').slice(0, 8);
    return { url: `${SITE}/c/img/${p.id}.jpg?v=${v}`, size: jpegSize(buf) };
  };
  for (const p of rows) {
    let og = `${SITE}/icon-512.png`, size = { w: 512, h: 512 };
    const o = ogOf(p);
    if (o) { og = o.url; size = o.size; }
    const title = 'ألوان ' + p.name;
    const desc = 'اختار ألوانك من الصور واطلب من هون' + (p.price > 0 ? ` — سعر القطعة ${p.price.toFixed(2)} د.أ` : '');
    const to = '/?p=' + encodeURIComponent(p.id);
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
  // الكتالوج الموحّد: c/index.html ⇒ /c/?c=…&e=…
  const home = (Array.isArray(cfg.products) ? cfg.products.map(id => all.find(p => p.id === id)) : rows).filter(p => p && !p.raw && p.name);
  // صورة المعاينة: كولاج من صور كل منتجات الكتالوج (مش أوّل منتج بس — عشان ما يبيّن إنه للصوف بس)
  let cover = null;
  try { cover = await collage(home.filter(p => /^data:image\//.test(p.img)).slice(0, 8)); } catch (e) { console.error('collage:', e.message); }
  if (cover) keep.add('img/_catalog.jpg');
  cover = cover || home.map(ogOf).find(Boolean) || { url: `${SITE}/icon-512.png`, size: { w: 512, h: 512 } };
  const hTitle = (cfg.title || '').trim() || 'كتالوج المنتجات';
  const hDesc = home.length ? home.map(p => p.name).join(' · ') + ' — اختار واطلب من هون' : 'اختار المنتج وألوانه من الصور واطلب من هون';
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(hTitle)}</title>
<meta name="description" content="${esc(hDesc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(hTitle)}">
<meta property="og:description" content="${esc(hDesc)}">
<meta property="og:url" content="${SITE}/c/">
<meta property="og:image" content="${esc(cover.url)}">
${cover.size ? `<meta property="og:image:width" content="${cover.size.w}">\n<meta property="og:image:height" content="${cover.size.h}">\n` : ''}<meta name="twitter:card" content="summary">
<script>location.replace('/'+location.search+location.hash);</script>
<noscript><meta http-equiv="refresh" content="0;url=/"></noscript>
</head><body style="font-family:Tahoma,sans-serif;text-align:center;padding:40px 16px;"><a href="/">${esc(hTitle)}</a></body></html>
`);
  keep.add('index.html');
  // نسخة المعاينة: بتتغيّر لما تتغيّر صورة الكتالوج أو اسمه أو منتجاته — التطبيق بيحطّها
  // بالرابط (&v=…) فالواتساب بيجيب معاينة جديدة بدل اللي حافظها للرابط القديم
  const ver = require('crypto').createHash('md5').update(JSON.stringify([cover.url, hTitle, hDesc])).digest('hex').slice(0, 6);
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ v: ver }) + '\n');
  keep.add('meta.json');
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(rows.map(p => p.id).sort()) + '\n');
  // منتج انحذف أو انشالت ألوانه ⇒ منشيل صفحته
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html') && !keep.has(f)) fs.unlinkSync(path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(OUT, 'img'))) if (!keep.has('img/' + f)) fs.unlinkSync(path.join(OUT, 'img', f));
  console.log('✓', rows.length, 'صفحة:', rows.map(p => p.name).join('، '), '| الكتالوج:', hTitle, '—', home.map(p => p.name).join('، '));
}
main().catch(e => { console.error(e); process.exit(1); });
