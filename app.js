// Force reload if cached version is stale
(function(){
  const V='20260617-r4';
  if(sessionStorage.getItem('_av')!==V){
    sessionStorage.setItem('_av',V);
    location.reload(true);
  }
})();
// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyAD1KJbggqncxkiqMWna8HaZdtjWHIvzpU",
  authDomain: "alkiswani-store.firebaseapp.com",
  projectId: "alkiswani-store",
  storageBucket: "alkiswani-store.firebasestorage.app",
  messagingSenderId: "60330492719",
  appId: "1:60330492719:web:71e36dd5327db3e54017da"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();
let _akFunctions=null;
try{_akFunctions=firebase.functions();}catch(e){_akFunctions=null;}

// ===== PUSH NOTIFICATIONS (FCM v1 API) =====
let _fcmMessaging=null,_fcmVapidKey=null,_fcmReady=false;
let _fcmSA=null,_fcmAT=null,_fcmATExp=0;

async function _loadFCMConfig(){
  try{
    const doc=await db.collection('operator_config').doc('fcm_settings').get();
    if(doc.exists){
      const d=doc.data();
      _fcmVapidKey=d.vapidKey||null;
      _fcmSA=d.serviceAccount?JSON.parse(d.serviceAccount):null;
    }
  }catch(e){}
}

async function _b64url(buf){
  const bytes=new Uint8Array(buf);
  let s='';for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function _getFCMToken(){
  if(_fcmAT&&Date.now()<_fcmATExp)return _fcmAT;
  if(!_fcmSA)return null;
  try{
    const enc=new TextEncoder();
    const hdr=await _b64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
    const now=Math.floor(Date.now()/1000);
    const clm=await _b64url(enc.encode(JSON.stringify({
      iss:_fcmSA.client_email,
      scope:'https://www.googleapis.com/auth/firebase.messaging',
      aud:'https://oauth2.googleapis.com/token',
      exp:now+3600,iat:now
    })));
    const sigInput=hdr+'.'+clm;
    const pemRaw=_fcmSA.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    const keyDER=Uint8Array.from(atob(pemRaw),c=>c.charCodeAt(0));
    const pk=await crypto.subtle.importKey('pkcs8',keyDER.buffer,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pk,enc.encode(sigInput));
    const jwt=sigInput+'.'+await _b64url(sig);
    const res=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt
    });
    const j=await res.json();
    if(j.access_token){_fcmAT=j.access_token;_fcmATExp=Date.now()+(j.expires_in-60)*1000;return _fcmAT;}
  }catch(e){console.log('FCM AT:',e);}
  return null;
}

async function _initFCM(){
  if(_fcmReady||!('serviceWorker' in navigator)||!('Notification' in window))return;
  try{
    await _loadFCMConfig();
    if(!_fcmVapidKey)return;
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    _fcmMessaging=firebase.messaging();
    _fcmMessaging.onMessage(function(payload){
      const t=(payload.notification&&payload.notification.title)||'';
      const b=(payload.notification&&payload.notification.body)||'';
      toast('🔔 '+t+(b?' — '+b:''));
    });
    _fcmReady=true;
  }catch(e){console.log('FCM init:',e);}
}

async function _registerFCMToken(userId,role){
  if(!_fcmReady||!_fcmMessaging||!_fcmVapidKey)return;
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted')return;
    const swReg=await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    const token=await _fcmMessaging.getToken({vapidKey:_fcmVapidKey,serviceWorkerRegistration:swReg});
    if(token){
      await db.collection('fcm_tokens').doc(token.slice(-28)).set({
        token,userId:userId||'unknown',role:role||'user',
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }catch(e){console.log('FCM token:',e);}
}

async function sendPushNotification(title,body,data){
  if(!_fcmSA)return;
  try{
    const at=await _getFCMToken();
    if(!at)return;
    const snap=await db.collection('fcm_tokens').get();
    const tokens=snap.docs.map(d=>d.data().token).filter(Boolean);
    if(!tokens.length)return;
    const safeData=Object.fromEntries(Object.entries(data||{}).map(([k,v])=>[k,String(v)]));
    tokens.forEach(token=>{
      fetch('https://fcm.googleapis.com/v1/projects/alkiswani-store/messages:send',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+at},
        body:JSON.stringify({message:{
          token,
          notification:{title,body},
          webpush:{notification:{icon:'/icon-192.png',requireInteraction:true},headers:{Urgency:'high'}},
          data:safeData
        }})
      });
    });
  }catch(e){}
}

async function saveFCMSettings(){
  const vk=document.getElementById('fcmVapidKey').value.trim();
  const sa=document.getElementById('fcmServiceAccount').value.trim();
  if(!vk||!sa){toast('⚠️ أدخل VAPID Key وService Account JSON');return;}
  try{
    JSON.parse(sa); // validate JSON
    await db.collection('operator_config').doc('fcm_settings').set({vapidKey:vk,serviceAccount:sa,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    _fcmVapidKey=vk;_fcmSA=JSON.parse(sa);_fcmAT=null;
    toast('✅ تم حفظ إعدادات الإشعارات');
    _fcmReady=false;
    await _initFCM();
    await _registerFCMToken(_currentAdminUser||'admin','admin');
  }catch(e){toast('❌ '+(e.message.includes('JSON')?'Service Account JSON غير صحيح':e.message));}
}

async function loadFCMSettings(){
  await _loadFCMConfig();
  const vEl=document.getElementById('fcmVapidKey');
  const sEl=document.getElementById('fcmServiceAccount');
  if(vEl&&_fcmVapidKey)vEl.value=_fcmVapidKey;
  if(sEl&&_fcmSA)sEl.value=JSON.stringify(_fcmSA);
}

async function enableEmpNotifications(){
  const banner=document.getElementById('empNotifBanner');
  if(!('Notification' in window)){if(banner)banner.style.display='none';return;}
  if(!_fcmVapidKey){await _loadFCMConfig();}
  if(!_fcmVapidKey){toast('⚠️ الإشعارات غير مفعلة من الإدارة بعد');return;}
  if(!_fcmReady){await _initFCM();}
  const uid=_empCurrentUser&&(_empCurrentUser.id||_empCurrentUser.username)||'emp';
  await _registerFCMToken(uid,'emp');
  if(Notification.permission==='granted'){
    if(banner)banner.style.display='none';
    toast('✅ تم تفعيل الإشعارات');
  }else if(Notification.permission==='denied'){
    if(banner)banner.style.display='none';
    toast('❌ الإشعارات محجوبة — فعّلها من إعدادات المتصفح');
  }
}

function _checkEmpNotifBanner(){
  const banner=document.getElementById('empNotifBanner');
  if(!banner)return;
  if(!('Notification' in window)||Notification.permission==='granted'){banner.style.display='none';return;}
  banner.style.display='block';
}

async function enableMyNotifications(){
  if(!('Notification' in window)){toast('⚠️ المتصفح لا يدعم الإشعارات');return;}
  if(!_fcmVapidKey){toast('⚠️ أضف VAPID Key أولاً من الإعدادات');return;}
  if(!_fcmReady){await _initFCM();}
  await _registerFCMToken(_currentAdminUser||(_empCurrentUser&&(_empCurrentUser.id||_empCurrentUser.username))||'user','admin');
  if(Notification.permission==='granted')toast('✅ تم تفعيل الإشعارات على هذا الجهاز');
  else if(Notification.permission==='denied')toast('❌ الإشعارات محجوبة — افتح إعدادات المتصفح وفعّلها يدوياً');
}

async function testFCMNotification(){
  if(!_fcmSA){toast('⚠️ أضف Service Account JSON أولاً');return;}
  await sendPushNotification('تجربة 🔔','إشعارات الكسواني تعمل ✅',{tag:'test'});
  toast('📤 تم إرسال إشعار تجريبي');
}

function jordanDateStr(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Amman'});}
function jordanDisplayDate(opts={}){return new Date().toLocaleDateString('ar-JO',{timeZone:'Asia/Amman',...opts});}

// ===== CONFIG =====
const ADMIN_USER='alkiswani', ADMIN_PASS='rosemary2026', WA='962775665598';

// ===== STATE =====
let products=[];
let customers=[];
let wishlist=JSON.parse(localStorage.getItem('ak_wish')||'[]');
let cart=JSON.parse(localStorage.getItem('ak_cart')||'[]');
let currentUser=JSON.parse(localStorage.getItem('ak_currentUser')||'null');
let pointsSettings={enabled:false,perDinar:10,onRegister:50,perDiscount:100,minRedeem:200};
let pendingProduct=null;
let writingChoice='no';

// ===== ADMIN SESSION =====
let _currentAdminUser=null; // null=not logged in | 'MAIN'=owner | string=sub-user
let _currentAdminPerms=null; // null=full | array=limited
let _adminUsersList=[];

// ===== FIREBASE FUNCTIONS =====
async function loadProducts(){
  const snap=await db.collection('products').get();
  products=snap.docs.map(d=>({...d.data(), _docId:d.id}));
  renderStore();
  renderMostOrdered();
  updateHeroStats();
}

async function updateHeroStats(){
  try{
    const pc=document.getElementById('heroProductsCount');
    if(pc) pc.textContent='+'+products.length;
    const cc=document.getElementById('heroCustomersCount');
    if(cc){
      // Cache customer count for 15 min — avoids loading all orders on every visit
      let customerCount;
      try{
        const raw=sessionStorage.getItem('_heroStatsCust');
        if(raw){const p=JSON.parse(raw);if(Date.now()-p.ts<15*60*1000)customerCount=p.v;}
      }catch(e){}
      if(customerCount===undefined){
        const ordersSnap=await db.collection('orders').get();
        customerCount=new Set(ordersSnap.docs.map(d=>d.data().phone).filter(Boolean)).size;
        try{sessionStorage.setItem('_heroStatsCust',JSON.stringify({v:customerCount,ts:Date.now()}));}catch(e){}
      }
      cc.textContent='+'+customerCount;
    }
    let totalStars=0,totalReviews=0;
    products.forEach(function(p){(p.reviews||[]).forEach(function(r){totalStars+=r.stars||0;totalReviews++;});});
    const avg=totalReviews>0?(totalStars/totalReviews).toFixed(1):'4.9';
    const rc=document.getElementById('heroRatingCount');
    if(rc) rc.textContent=avg+'★';
  }catch(e){
    const pc=document.getElementById('heroProductsCount');
    const cc=document.getElementById('heroCustomersCount');
    const rc=document.getElementById('heroRatingCount');
    if(pc) pc.textContent='+'+products.length;
    if(cc) cc.textContent='+0';
    if(rc) rc.textContent='4.9★';
  }
}

function renderMostOrdered(){
  const featured=products.filter(p=>p.badge&&p.badge.includes('الأكثر')||p.badge&&p.badge.includes('مميز'));
  const toShow=featured.length?featured:products.slice(0,5);
  if(!toShow.length) return;
  const sec=document.getElementById('mostOrdered');
  const grid=document.getElementById('mostOrderedGrid');
  sec.style.display='block';
  grid.innerHTML=toShow.map(p=>`
    <div onclick="openProductPage('${p._docId||p.id}')" style="background:#fff;border-radius:16px;overflow:hidden;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.06);border:1px solid #e5e7eb;transition:transform 0.2s;">
      <div style="height:150px;background:#f3f4f6;overflow:hidden;position:relative;">
        ${p.images?.[0]||p.img
          ?`<img src="${p.images?.[0]||p.img}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" decoding="async">`
          :`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;">${p.emoji}</div>`}
        <div style="position:absolute;top:8px;right:8px;background:#1a3a2a;color:#fff;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:700;">⭐ الأكثر</div>
      </div>
      <div style="padding:10px;">
        <div style="font-size:0.82rem;color:#6b7280;margin-bottom:2px;">${p.cat}</div>
        <div style="font-size:0.88rem;font-weight:700;color:#111827;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
        <div style="font-size:0.9rem;color:#d4a843;font-weight:700;">${parseFloat(p.price)||0} د.أ</div>
      </div>
    </div>
  `).join('');
}

async function loadCustomers(){
  const snap=await db.collection('customers').get();
  customers=snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function loadPointsSettings(){
  const snap=await db.collection('settings').doc('points').get();
  if(snap.exists) pointsSettings={...pointsSettings,...snap.data()};
}

async function saveProductToFirebase(product){
  const {id,...data}=product;
  await db.collection('products').doc(String(id)).set(data,{merge:true});
}

async function deleteProductFromFirebase(id){
  await db.collection('products').doc(String(id)).delete();
}

async function saveCustomerToFirebase(customer){
  const {id,...data}=customer;
  await db.collection('customers').doc(String(id)).set(data,{merge:true});
}

async function updateCustomerInFirebase(customer){
  const {id,...data}=customer;
  await db.collection('customers').doc(String(id)).update(data);
}

async function savePointsToFirebase(settings){
  await db.collection('settings').doc('points').set(settings,{merge:true});
}

// ضغط الصورة قبل الرفع
function compressImage(file, maxWidth, quality){
  return new Promise(function(resolve){
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        const canvas=document.createElement('canvas');
        let w=img.width, h=img.height;
        // تصغير لو أكبر من maxWidth
        if(w>maxWidth){h=Math.round(h*maxWidth/w);w=maxWidth;}
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0,w,h);
        canvas.toBlob(function(blob){resolve(blob);},'image/jpeg',quality);
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImageToFirebase(base64OrFile, id){
  return new Promise(async function(resolve, reject){
    let blob;
    if(typeof base64OrFile === 'string'){
      // base64 — حوّله لـ blob
      const byteStr=atob(base64OrFile.split(',')[1]);
      const mime=base64OrFile.split(',')[0].split(':')[1].split(';')[0];
      const arr=new Uint8Array(byteStr.length);
      for(let i=0;i<byteStr.length;i++) arr[i]=byteStr.charCodeAt(i);
      blob=new Blob([arr],{type:mime});
    } else {
      // File — اضغطه أولاً (max 1200px, جودة 80%)
      try{ blob=await compressImage(base64OrFile,1200,0.80); }
      catch(e){ blob=base64OrFile; }
    }
    const ref=storage.ref('products/'+id+'_'+Date.now()+'.jpg');
    const task=ref.put(blob);
    task.on('state_changed',
      null,
      function(err){console.error('Upload error:',err);reject(err);},
      function(){task.snapshot.ref.getDownloadURL().then(function(url){resolve(url);});}
    );
  });
}

// ===== SAVE CART LOCALLY =====
const saveCart=()=>localStorage.setItem('ak_cart',JSON.stringify(cart));
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));

// ===== PRE-DECLARE GLOBALS (populated after function definitions) =====
// These will be set at bottom of script

// ===== UTILS =====
let _searchTimer=null;
function debounceSearch(val){clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>searchProducts(val),300);}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function getCatEmoji(c){return{'أشجار الزينة':'🌳','الخشبيات':'🪵','براويز التخرج':'🎓','مباخر':'🕯️','طقوم الضيافة':'☕','مناظر تعليق':'🖼️'}[c]||'📦';}
function getPriceNum(p){
  // Handle product object or price value directly
  const val = typeof p==='object' ? p.price : p;
  // Extract number from any format: 15, "15", "15 د.أ", "15 دينار أردني"
  const n = parseFloat(String(val).replace(/[^\d.]/g,''));
  return isNaN(n) ? 0 : n;
}
function getPriceDisplay(p){
  // Always show as clean number + دينار أردني
  return getPriceNum(p) + ' دينار أردني';
}
function getPriceHTML(p){
  const priceNum=getPriceNum(p);
  const priceText=priceNum+' دينار أردني';
  if(p.oldPrice){
    const oldNum=parseFloat(p.oldPrice)||0;
    const disc=oldNum>0?Math.round((1-priceNum/oldNum)*100):0;
    return `<div class="card-price"><span class="card-price-old">${oldNum} دينار أردني</span><span class="card-discount-badge">-${disc}%</span>${priceText}</div>`;
  }
  return `<div class="card-price">${priceText}</div>`;
}

function getStars(p){
  const reviews=p.reviews||[];
  if(!reviews.length)return '';
  const avg=reviews.reduce((s,r)=>s+r.stars,0)/reviews.length;
  const stars='⭐'.repeat(Math.round(avg));
  return `<div class="card-rating"><span class="stars">${stars}</span><span class="rating-count">(${reviews.length})</span><span onclick="openRatingModal('${p.id}')" style="font-size:0.72rem;color:var(--green-light);cursor:pointer;margin-right:6px;">+ أضف تقييم</span></div>`;
}
function getCardHTML(p){
  const pid=p._docId||String(p.id);
  const inWish=wishlist.some(x=>x._docId===pid||String(x.id)===pid);
  return `
    <div class="store-card" data-pid="${pid}" onclick="openProductPage(this.dataset.pid)" style="cursor:pointer;">
      <div class="store-card-img">
        ${p.images&&p.images.length?`<img src="${p.images[0]}" alt="${p.name}" loading="lazy" decoding="async">`:p.img?`<img src="${p.img}" alt="${p.name}" loading="lazy" decoding="async">`:`<span>${p.emoji}</span>`}
        <div class="card-badge-wrap">
          ${p.outOfStock?`<div class="card-badge" style="background:#6b7280;">نفذ المخزون</div>`:p.badge?`<div class="card-badge">${p.badge}</div>`:''}
          ${p.writing?`<div class="writing-badge">✍️ كتابة</div>`:''}
          ${p.video?`<div class="card-badge" style="background:#dc2626;">🎬</div>`:''}
        </div>
        <button class="btn-wishlist" data-pid="${pid}" onclick="event.stopPropagation();toggleWishlist(this.dataset.pid)" style="position:absolute;top:8px;left:8px;background:rgba(255,255,255,0.9);border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:1rem;">${inWish?'❤️':'🤍'}</button>
      </div>
      <div class="store-card-body">
        <div class="card-cat">${p.cat}</div>
        <div class="card-name">${p.name}</div>
        ${getStars(p)}
        <div class="card-desc">${p.desc||''}</div>
        <div class="card-footer">
          <div style="display:flex;flex-direction:column;gap:2px;">
            ${getPriceHTML(p)}
            ${p.colors&&p.colors.length?`<div style="font-size:0.68rem;color:#9ca3af;">🎨 ${p.colors.length} ألوان</div>`:''}
          </div>
          ${p.outOfStock
            ? `<div style="background:#f3f4f6;color:#9ca3af;padding:7px 12px;border-radius:8px;font-size:0.72rem;font-weight:700;">نفذ المخزون</div>`
            : `<button class="btn-add-cart" data-pid="${pid}" onclick="event.stopPropagation();handleAddToCart(this.dataset.pid)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:4px;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                أضف
              </button>`}
        </div>
      </div>
    </div>`;
}

// ===== STORE RENDER =====
function renderStore(filter='الكل'){
  const grid=document.getElementById('storeGrid');
  const list=filter==='الكل'?products:products.filter(p=>p.cat===filter);
  if(!list.length){grid.innerHTML=`<div class="no-products"><span class="icon">🌿</span>${products.length?'ما في منتجات في هاد القسم':'المنتجات ستظهر هنا قريباً'}</div>`;return;}
  grid.innerHTML=list.map(p=>getCardHTML(p)).join('');
  setTimeout(initLazyImages,100);
}
function searchProducts(query){
  const q=query.trim().toLowerCase();
  if(!q){renderStore();return;}
  const grid=document.getElementById('storeGrid');
  const results=products.filter(p=>
    p.name.toLowerCase().includes(q)||
    p.desc.toLowerCase().includes(q)||
    p.cat.toLowerCase().includes(q)
  );
  if(!results.length){
    grid.innerHTML=`<div class="no-products"><span class="icon">🔍</span>ما في نتائج لـ "${query}"</div>`;
    return;
  }
  grid.innerHTML=results.map(p=>getCardHTML(p)).join('');
}
function filterAll(){
  var btns=document.querySelectorAll('.filter-btn');
  btns.forEach(function(b){b.classList.remove('active');});
  if(btns[0]) btns[0].classList.add('active');
  document.getElementById('searchInput').value='';
  renderStore('الكل');
  document.getElementById('products').scrollIntoView({behavior:'smooth'});
}
function filterCat(btn){
  var cat=btn.getAttribute('data-cat');
  var filterBtn=document.querySelector('.filter-btn[data-cat="'+cat+'"]');
  filterProds(cat,filterBtn||btn);
}
function filterProds(cat,btn){
  document.getElementById('searchInput').value='';
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn&&btn.classList) btn.classList.add('active');
  renderStore(cat);
  // Scroll to products
  document.getElementById('products').scrollIntoView({behavior:'smooth'});
}

// ===== WRITING MODAL =====
function handleAddToCart(id){
  const p=products.find(x=>x._docId===String(id)||String(x.id)===String(id));
  if(!p) return;
  // If product has colors or writing — open product page to let user choose
  if(p.writing||p.colors?.length){
    openProductPage(id);
  } else {
    addToCartDirect(p,'');
    toast('✅ تمت الإضافة للسلة!');
  }
}
function selectWritingOpt(choice){
  writingChoice=choice;
  document.getElementById('optNoWrite').classList.toggle('selected',choice==='no');
  document.getElementById('optYesWrite').classList.toggle('selected',choice==='yes');
  document.getElementById('writingInputArea').classList.toggle('show',choice==='yes');
  if(choice==='yes')document.getElementById('writingText').focus();
}
function closeWritingModal(){document.getElementById('writingOverlay').classList.remove('open');pendingProduct=null;}
function confirmWritingAndAdd(){
  if(!pendingProduct)return;
  const txt=writingChoice==='yes'?document.getElementById('writingText').value.trim():'';
  if(writingChoice==='yes'&&!txt){toast('✍️ يرجى كتابة النص المطلوب');return;}
  addToCartDirect(pendingProduct,txt);
  closeWritingModal();
}
function addToCartDirect(p,writingText){
  const existing=cart.find(x=>x.id===p.id&&x.writingText===writingText);
  if(existing){existing.qty++;}
  else{cart.push({...p,qty:1,writingText:writingText||''});}
  save('ak_cart',cart);
  updateCartCount();
  const btn=document.getElementById('btn-'+p.id);
  if(btn){btn.textContent='✅ تمت الإضافة';btn.classList.add('added');setTimeout(()=>{btn.textContent='🛒 أضف للسلة';btn.classList.remove('added');},1500);}
  toast(`✅ تمت إضافة "${p.name}" للسلة`);
}

// ===== CART =====
function updateCartCount(){
  const t=cart.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cartCount').textContent=t;
  document.getElementById('cartCount').style.display=t>0?'flex':'none';
}
function openCart(){renderCartDrawer();document.getElementById('cartOverlay').classList.add('open');document.getElementById('cartDrawer').classList.add('open');}
function closeCart(){document.getElementById('cartOverlay').classList.remove('open');document.getElementById('cartDrawer').classList.remove('open');}
function renderCartDrawer(){
  const items=document.getElementById('cartItems');
  const footer=document.getElementById('cartFooter');
  if(!cart.length){
    items.innerHTML=`<div class="cart-empty"><div style="font-size:4rem;margin-bottom:16px;">🛒</div><div style="font-size:1.1rem;font-weight:700;color:var(--text-dark);margin-bottom:8px;">سلتك فاضية</div><div style="font-size:0.88rem;color:#aaa;">أضف منتجات من المتجر</div></div>`;
    footer.style.display='none';
    return;
  }
  items.innerHTML=cart.map(item=>`
    <div class="cart-item">
      <div class="cart-item-img">${item.img?`<img src="${item.img}" alt="">`:`<span>${item.emoji}</span>`}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${getPriceNum(item)} دينار أردني</div>
        ${item.writingText?`<div class="cart-writing-note">✍️ ${item.writingText}</div>`:''}
        ${item.color?`<div style="font-size:0.75rem;color:var(--green-dark);background:rgba(45,90,61,0.08);padding:3px 8px;border-radius:6px;margin-bottom:6px;display:inline-block;">🎨 ${item.color}</div>`:''}
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <div class="cart-item-qty">
            <button class="qty-btn" data-id="${item.id}" data-wt="${(item.writingText||'').replace(/"/g,'')}" onclick="changeQty(this.dataset.id,this.dataset.wt,-1)">−</button>
            <span class="qty-num">${item.qty}</span>
            <button class="qty-btn" data-id="${item.id}" data-wt="${(item.writingText||'').replace(/"/g,'')}" onclick="changeQty(this.dataset.id,this.dataset.wt,1)">+</button>
          </div>
          <button onclick="editCartItem('${item.id}','${(item.writingText||'').replace(/'/g,'')}')" style="padding:5px 12px;border-radius:8px;border:1.5px solid var(--green-light);background:#fff;color:var(--green-dark);font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">✏️ تعديل</button>
        </div>
      </div>
      <button class="cart-item-remove" data-id="${item.id}" data-wt="${(item.writingText||'').replace(/"/g,'')}" onclick="removeCart(this.dataset.id,this.dataset.wt)">🗑️</button>
    </div>
  `).join('');
  footer.style.display='block';
  const subtotal=cart.map(i=>getPriceNum(i)*i.qty).reduce((a,b)=>a+b,0);
  const delivery=2;
  const total=subtotal+delivery;
  document.getElementById('cartTotal').innerHTML=`
    <div class="cart-summary-row"><span>المجموع الفرعي (${cart.reduce((a,i)=>a+i.qty,0)} منتج)</span><span>${subtotal.toFixed(2)} د.أ</span></div>
    <div class="cart-summary-row"><span>🚚 أجور التوصيل</span><span>${delivery} د.أ</span></div>
    <div class="cart-summary-row total-row"><span>الإجمالي</span><span>${total.toFixed(2)} دينار أردني</span></div>
  `;
  const pi=document.getElementById('cartPointsInfo');
  if(currentUser&&pointsSettings.enabled){
    const pts=Math.floor(subtotal*pointsSettings.perDinar);
    document.getElementById('cartPointsText').textContent=`ستكسب ${pts} نقطة 🌟`;
    pi.classList.add('show');
  }
}
function changeQty(id,wt,d){
  const item=cart.find(x=>String(x.id)===String(id)&&(x.writingText||'')===(wt||''));
  if(!item)return;
  item.qty+=parseInt(d);
  if(item.qty<=0)cart=cart.filter(x=>x!==item);
  save('ak_cart',cart);updateCartCount();renderCartDrawer();
}
function removeCart(id,wt){
  cart=cart.filter(x=>!(String(x.id)===String(id)&&(x.writingText||'')===(wt||'')));
  save('ak_cart',cart);updateCartCount();renderCartDrawer();
}
function clearCart(){cart=[];save('ak_cart',cart);updateCartCount();}

// ===== CHECKOUT =====
function openCheckout(){
  closeCart();
  appliedDiscount=null;
  document.getElementById('discountCode').value='';
  document.getElementById('discountResult').style.display='none';
  // Set min delivery date to tomorrow
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const minDate=tomorrow.toISOString().split('T')[0];
  const dateEl=document.getElementById('custDeliveryDate');
  if(dateEl){dateEl.min=minDate;dateEl.value=minDate;}
  const summary=document.getElementById('orderSummary');
  const subtotal=cart.map(i=>getPriceNum(i)*i.qty).reduce((a,b)=>a+b,0);
  const delivery=2;
  const total=subtotal+delivery;
  summary.innerHTML=cart.map(i=>`
    <div class="order-item"><span>${i.name} × ${i.qty}</span><span>${getPriceNum(i)*i.qty} دينار أردني</span></div>
    ${i.writingText?`<div class="order-item writing"><span>✍️ كتابة: ${i.writingText}</span></div>`:''}
  `).join('')+`
    <div class="order-item"><span>🚚 أجور التوصيل</span><span>${delivery} دينار أردني</span></div>
    <div class="order-item"><span>الإجمالي قبل الخصم</span><span>${total.toFixed(2)} دينار أردني</span></div>
  `;
  if(currentUser){
    document.getElementById('custName').value=currentUser.name||'';
    document.getElementById('custPhone').value=currentUser.phone||'';
  }
  document.getElementById('checkoutBody').style.display='block';
  document.getElementById('successScreen').classList.remove('show');
  document.getElementById('checkoutOverlay').classList.add('open');
}
function closeCheckout(){document.getElementById('checkoutOverlay').classList.remove('open');}
let appliedDiscount=null;

function applyDiscount(){
  const code=document.getElementById('discountCode').value.trim().toUpperCase();
  const res=document.getElementById('discountResult');
  if(!code){res.className='discount-result err';res.style.display='block';res.textContent='❌ أدخل الكود أولاً';return;}

  db.collection('discounts').where('code','==',code).get().then(snap=>{
    if(snap.empty){res.className='discount-result err';res.style.display='block';res.textContent='❌ الكود غير صحيح';appliedDiscount=null;return;}
    const dc=snap.docs[0].data();
    // Check expiry
    if(dc.expiry&&new Date(dc.expiry)<new Date()){res.className='discount-result err';res.style.display='block';res.textContent='❌ هذا الكود منتهي الصلاحية';appliedDiscount=null;return;}
    // Check limit
    if(dc.limit>0&&(dc.usedCount||0)>=dc.limit){res.className='discount-result err';res.style.display='block';res.textContent='❌ هذا الكود وصل للحد الأقصى';appliedDiscount=null;return;}
    // Check per-person usage (by phone)
    const phone=document.getElementById('custPhone')?.value?.trim()||currentUser?.phone||'';
    if(phone&&dc.usedBy&&dc.usedBy.includes(phone)){
      res.className='discount-result err';res.style.display='block';
      res.textContent='❌ لقد استخدمت هذا الكود من قبل';
      appliedDiscount=null;return;
    }
    // Check product restriction
    if(dc.scope==='specific'&&dc.products_allowed?.length){
      const cartIds=cart.map(i=>String(i.id));
      const hasMatch=dc.products_allowed.some(pid=>cartIds.includes(pid));
      if(!hasMatch){
        res.className='discount-result err';res.style.display='block';
        res.textContent='❌ هذا الكود لا ينطبق على المنتجات في سلتك';
        appliedDiscount=null;return;
      }
    }
    // Valid!
    appliedDiscount={...dc,docId:snap.docs[0].id};
    const subtotal=cart.map(i=>getPriceNum(i)*i.qty).reduce((a,b)=>a+b,0);
    const discVal=dc.type==='percent'?subtotal*(dc.value/100):dc.value;
    const after=Math.max(0,subtotal-discVal)+2;
    res.className='discount-result ok';res.style.display='block';
    res.textContent=`✅ كود "${code}" صالح! خصم ${dc.type==='percent'?dc.value+'%':dc.value+' دينار أردني'} — الإجمالي بعد الخصم: ${after.toFixed(2)} دينار أردني`;
  }).catch(()=>{res.className='discount-result err';res.style.display='block';res.textContent='❌ خطأ في التحقق';});
}

// ===== DISCOUNT MANAGEMENT =====
function toggleDcProducts(val){
  document.getElementById('dcProductsSelect').style.display=val==='specific'?'block':'none';
  if(val==='specific'){
    document.getElementById('dcProductsList').innerHTML=products.map(p=>`
      <label style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:6px;cursor:pointer;font-size:0.85rem;">
        <input type="checkbox" class="dc-prod-check" value="${p._docId||p.id}" style="width:16px;height:16px;">
        ${p.name}
      </label>
    `).join('');
  }
}
function getDcSelectedProducts(){
  return Array.from(document.querySelectorAll('.dc-prod-check:checked')).map(c=>c.value);
}
async function addDiscountCode(){
  const code=document.getElementById('dcCode').value.trim().toUpperCase();
  const type=document.getElementById('dcType').value;
  const value=parseFloat(document.getElementById('dcValue').value);
  const limit=parseInt(document.getElementById('dcLimit').value)||0;
  const expiry=document.getElementById('dcExpiry').value;
  const isWelcome=document.getElementById('dcIsWelcome').checked;
  const scope=document.getElementById('dcScope').value;
  const products_allowed=scope==='specific'?getDcSelectedProducts():[];
  const editingCode=document.getElementById('dcEditingCode').value;
  if(!code||!value){toast('❌ أدخل الكود والقيمة');return;}
  const dc={code,type,value,limit,expiry:expiry||'',createdAt:jordanDisplayDate(),isWelcome,scope,products_allowed};
  if(editingCode){
    const existing=await db.collection('discounts').doc(editingCode).get();
    dc.usedCount=existing.data()?.usedCount||0;
    if(editingCode!==code) await db.collection('discounts').doc(editingCode).delete();
  } else { dc.usedCount=0; }
  await db.collection('discounts').doc(code).set(dc);
  if(isWelcome&&document.getElementById('welcomeCode')) document.getElementById('welcomeCode').textContent=code;
  toast(editingCode?'✅ تم تعديل الكود!':'✅ تم إضافة الكود!');
  cancelDcEdit();
  renderDiscounts();
}
function cancelDcEdit(){
  ['dcCode','dcValue','dcLimit','dcExpiry'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('dcIsWelcome').checked=false;
  document.getElementById('dcScope').value='all';
  document.getElementById('dcProductsSelect').style.display='none';
  document.getElementById('dcEditingCode').value='';
  document.getElementById('dcFormTitle').textContent='➕ إضافة كود خصم جديد';
  document.getElementById('dcSaveBtn').textContent='✅ إضافة الكود';
  document.getElementById('dcCancelBtn').style.display='none';
}
async function editDiscount(code){
  const snap=await db.collection('discounts').doc(code).get();
  if(!snap.exists)return;
  const dc=snap.data();
  document.getElementById('dcCode').value=dc.code;
  document.getElementById('dcType').value=dc.type;
  document.getElementById('dcValue').value=dc.value;
  document.getElementById('dcLimit').value=dc.limit||0;
  document.getElementById('dcExpiry').value=dc.expiry||'';
  document.getElementById('dcIsWelcome').checked=dc.isWelcome||false;
  document.getElementById('dcScope').value=dc.scope||'all';
  toggleDcProducts(dc.scope||'all');
  if(dc.scope==='specific'&&dc.products_allowed?.length){
    setTimeout(()=>{dc.products_allowed.forEach(pid=>{const cb=document.querySelector(`.dc-prod-check[value="${pid}"]`);if(cb)cb.checked=true;});},150);
  }
  document.getElementById('dcEditingCode').value=code;
  document.getElementById('dcFormTitle').textContent='✏️ تعديل: '+code;
  document.getElementById('dcSaveBtn').textContent='💾 حفظ التعديل';
  document.getElementById('dcCancelBtn').style.display='block';
  document.querySelector('#tab-discounts .form-card').scrollIntoView({behavior:'smooth'});
}

async function renderDiscounts(){
  const list=document.getElementById('discountsList');
  const snap=await db.collection('discounts').get();
  if(snap.empty){list.innerHTML='<div class="empty-msg">لا يوجد كودات بعد</div>';return;}
  list.innerHTML=snap.docs.map(d=>{
    const dc=d.data();
    return `<div class="prod-row">
      <div class="prod-info" style="flex:1;">
        <div class="prod-name" style="font-family:monospace;letter-spacing:2px;">${dc.code} ${dc.isWelcome?'🎉':''}</div>
        <div class="prod-meta">
          <span>${dc.type==='percent'?'خصم '+dc.value+'%':'خصم '+dc.value+' دينار أردني'}</span>
          <span>استُخدم: ${dc.usedCount||0}${dc.limit>0?' / '+dc.limit:' (غير محدود)'}</span>
          ${dc.scope==='specific'?`<span style="color:var(--green-dark);">🎯 منتجات محددة</span>`:'<span>كل المنتجات</span>'}
          ${dc.expiry?`<span>ينتهي: ${dc.expiry}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn-del" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;" onclick="editDiscount('${dc.code}')">✏️</button>
        <button class="btn-del" onclick="deleteDiscount('${dc.code}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteDiscount(code){
  if(!confirm('حذف هذا الكود؟'))return;
  await db.collection('discounts').doc(code).delete();
  toast('🗑️ تم حذف الكود');
  renderDiscounts();
}
async function confirmOrder(){
  const name=document.getElementById('custName').value.trim();
  const phone=document.getElementById('custPhone').value.trim();
  const area=document.getElementById('custArea').value;
  const address=document.getElementById('custAddress').value.trim();
  const deliveryDate=document.getElementById('custDeliveryDate')?.value||'';
  if(!name||!phone||!area||!address){toast('❌ يرجى تعبئة جميع الحقول');return;}
  if(!deliveryDate){toast('📅 يرجى تحديد تاريخ التوصيل');return;}
  toast('⏳ جاري تأكيد الطلب...');
  const subtotal=cart.map(i=>getPriceNum(i)*i.qty).reduce((a,b)=>a+b,0);
  const delivery=2;
  // Apply discount
  let discountVal=0;
  let discountText='';
  if(appliedDiscount){
    discountVal=appliedDiscount.type==='percent'?subtotal*(appliedDiscount.value/100):appliedDiscount.value;
    discountText=appliedDiscount.type==='percent'?appliedDiscount.value+'%':appliedDiscount.value+' دينار أردني';
    // Update usage count and track by phone
    const usedBy=appliedDiscount.usedBy||[];
    if(phone&&!usedBy.includes(phone)) usedBy.push(phone);
    await db.collection('discounts').doc(appliedDiscount.docId).update({
      usedCount:(appliedDiscount.usedCount||0)+1,
      usedBy:usedBy
    });
  }
  const total=Math.max(0,subtotal-discountVal)+delivery;
  let earnedPts=0;
  if(currentUser&&pointsSettings.enabled){
    earnedPts=Math.floor(subtotal*pointsSettings.perDinar);
    const cu=customers.find(c=>c.phone===currentUser.phone);
    if(cu){
      cu.points=(cu.points||0)+earnedPts;
      cu.orders=cu.orders||[];
      cu.orders.push({id:'#'+Date.now().toString().slice(-6),items:cart.map(i=>i.name+' ×'+i.qty),total:total.toFixed(2)+' دينار أردني',date:jordanDisplayDate()});
      await updateCustomerInFirebase(cu);
      currentUser.points=cu.points;
      save('ak_currentUser',currentUser);
      updateNavUser();
    }
  }
  const orderNum=Date.now().toString().slice(-6);
  const order={
    id:Date.now(),orderNum:'#'+orderNum,name,phone,area,address,
    notes:document.getElementById('custNotes').value||'',
    deliveryDate:deliveryDate||'',
    items:cart.map(i=>({name:i.name,qty:i.qty,price:getPriceNum(i),writing:i.writingText||''})),
    subtotal:subtotal.toFixed(2)+' دينار أردني',
    delivery:delivery+' دينار أردني',
    discount:discountVal>0?discountText:'لا يوجد',
    total:total.toFixed(2)+' دينار أردني',
    date:jordanDisplayDate(),
    status:'جديد'
  };
  await db.collection('orders').doc(String(order.id)).set(order);
  document.getElementById('checkoutBody').style.display='none';
  const sp=document.getElementById('successScreen');
  sp.classList.add('show');
  sp.querySelector('p').innerHTML=`رقم طلبك: <strong style="color:#1a3a2a;font-size:1.2rem;">${order.orderNum}</strong><br>📅 موعد التوصيل: <strong>${order.deliveryDate}</strong><br><br>سنتواصل معك قريباً على رقم هاتفك لتأكيد التوصيل. 🌿`;
  if(earnedPts>0){document.getElementById('earnedPoints').textContent=earnedPts;document.getElementById('successPoints').style.display='block';}
  appliedDiscount=null;
  clearCart();
  toast('🎉 تم استلام طلبك!');
  // Process referral if exists
  processReferralOnOrder(phone,name);
}
function checkoutWA(){
  if(!cart.length){toast('السلة فاضية!');return;}
  const subtotal=cart.map(i=>getPriceNum(i)*i.qty).reduce((a,b)=>a+b,0);
  const total=subtotal+2;
  let msg='🌿 *طلب جديد - الكسواني روزميري*\n\n';
  cart.forEach(i=>{msg+=`• ${i.name} × ${i.qty} — ${i.priceDisplay||i.price+' د.أ'}\n`;if(i.writingText)msg+=`  ✍️ كتابة: ${i.writingText}\n`;});
  msg+=`\n🚚 أجور التوصيل: 2 دينار أردني\n💰 الإجمالي: ${total.toFixed(2)} د.أ\n\nأرجو التواصل لتأكيد الطلب والتوصيل 🙏`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
  closeCart();
}

// ===== CUSTOMER AUTH =====
function openAuth(){document.getElementById('authOverlay').classList.add('open');}
function closeAuth(){document.getElementById('authOverlay').classList.remove('open');}
function switchAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',['login','register'][i]===tab));
  document.getElementById('authLoginForm').classList.toggle('active',tab==='login');
  document.getElementById('authRegisterForm').classList.toggle('active',tab==='register');
}
async function doCustomerLogin(){
  const phone=document.getElementById('loginPhone').value.trim();
  const pass=document.getElementById('loginPassword').value;
  await loadCustomers();
  const cu=customers.find(c=>c.phone===phone&&c.password===pass);
  if(cu){
    currentUser={...cu};
    save('ak_currentUser',currentUser);
    closeAuth();updateNavUser();
    // Load cart and wishlist from Firebase
    await loadUserData(cu.phone);
    toast(`أهلاً ${cu.name}! 🌿`);
  } else {
    document.getElementById('loginErr').style.display='block';
    setTimeout(()=>document.getElementById('loginErr').style.display='none',3000);
  }
}
async function doCustomerRegister(){
  const name=document.getElementById('regName').value.trim();
  const phone=document.getElementById('regPhone').value.trim();
  const pass=document.getElementById('regPassword').value;
  const err=document.getElementById('registerErr');
  if(!name||!phone||!pass){err.textContent='❌ يرجى تعبئة جميع الحقول';err.style.display='block';return;}
  await loadCustomers();
  if(customers.find(c=>c.phone===phone)){err.textContent='❌ هذا الرقم مسجل مسبقاً';err.style.display='block';return;}
  const bonus=pointsSettings.enabled?pointsSettings.onRegister:0;
  const newCust={id:Date.now(),name,phone,password:pass,points:bonus,orders:[],joinDate:jordanDisplayDate()};
  await saveCustomerToFirebase(newCust);
  customers.push(newCust);
  currentUser={...newCust};
  save('ak_currentUser',currentUser);
  closeAuth();updateNavUser();
  toast(`أهلاً ${name}! تم إنشاء حسابك${bonus>0?' وحصلت على '+bonus+' نقطة ترحيبية 🎉':''}!`);
}

async function loadUserData(phone){
  try{
    const snap=await db.collection('userData').doc(phone).get();
    if(snap.exists){
      const data=snap.data();
      if(data.cart) { cart=data.cart; save('ak_cart',cart); updateCartCount(); }
      if(data.wishlist) { wishlist=data.wishlist; localStorage.setItem('ak_wish',JSON.stringify(wishlist)); updateWishBadge(); }
    }
  }catch(e){ console.log('loadUserData error',e); }
}

async function saveUserData(){
  if(!currentUser) return;
  try{
    await db.collection('userData').doc(currentUser.phone).set({
      cart, wishlist, updatedAt: Date.now()
    });
  }catch(e){ console.log('saveUserData error',e); }
}

function logoutCustomer(){
  // Save before logout
  saveUserData();
  // Clear local data
  cart=[];wishlist=[];
  localStorage.removeItem('ak_cart');
  localStorage.setItem('ak_wish','[]');
  currentUser=null;
  localStorage.removeItem('ak_currentUser');
  updateCartCount();updateWishBadge();
  updateNavUser();closeProfile();
  renderStore();
  toast('تم تسجيل الخروج');
}
function updateNavUser(){
  const chip=document.getElementById('navUserChip');
  const btn=document.getElementById('navLoginBtn');
  const bottomIcon=document.getElementById('bottomAuthIcon');
  const bottomText=document.getElementById('bottomAuthText');
  if(currentUser){
    chip.style.display='flex';btn.style.display='none';
    document.getElementById('navUserName').textContent=currentUser.name.split(' ')[0];
    document.getElementById('navPoints').textContent=(currentUser.points||0)+' نقطة';
    if(bottomIcon) bottomIcon.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    if(bottomText) bottomText.textContent=currentUser.name.split(' ')[0];
    // Bottom auth tab opens profile
    document.querySelector('.bottom-tab:last-child').onclick=openProfile;
  } else {
    chip.style.display='none';btn.style.display='block';
    if(bottomIcon) bottomIcon.textContent='👤';
    if(bottomText) bottomText.textContent='حسابي';
    document.querySelector('.bottom-tab:last-child').onclick=openAuth;
  }
}
async function openProfile(){
  if(!currentUser)return;
  document.getElementById('profileName').textContent=currentUser.name;
  document.getElementById('profilePhone').textContent=currentUser.phone;
  document.getElementById('profilePoints').textContent=currentUser.points||0;
  const sub=document.getElementById('profilePointsSub');
  if(pointsSettings.enabled&&(currentUser.points||0)>=pointsSettings.minRedeem){
    sub.textContent=`يمكنك استبدال نقاطك بخصم ${((currentUser.points||0)/pointsSettings.perDiscount).toFixed(2)} د.أ 🎁`;
  }
  // Referral link
  const refCode='REF'+currentUser.phone.replace(/[^0-9]/g,'').slice(-6);
  const refLink=`${location.origin}${location.pathname}?ref=${refCode}`;
  document.getElementById('referralLink').textContent=refLink;
  // Count referrals
  const refSnap=await db.collection('referrals').where('refCode','==',refCode).get();
  const count=refSnap.size;
  document.getElementById('referralCount').textContent=count>0?`🎯 دعوت ${count} شخص حتى الآن!`:'لم تدعُ أحداً بعد — شارك رابطك الآن!';
  // Badge system
  const userOrdersSnap = await db.collection('orders').where('phone','==',currentUser.phone).get();
  const orderCount = userOrdersSnap.size;
  const badgeEl = document.getElementById('profileBadge');
  // Load badge settings from firebase
  const badgeDoc = await db.collection('settings').doc('badges').get();
  if(badgeDoc.exists) badgeSettings = {...badgeSettings, ...badgeDoc.data()};
  let badge = getUserBadge(orderCount);
  if(badge){
    badgeEl.textContent = badge.label;
    badgeEl.style.background = badge.bg;
    badgeEl.style.color = badge.color;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }
  
  document.getElementById('profileOverlay').classList.add('open');
  // Load orders from Firebase directly
  const oh=document.getElementById('orderHistory');
  oh.innerHTML='<div style="text-align:center;color:#aaa;padding:16px;">⏳ جاري التحميل...</div>';
  try{
    const snap=await db.collection('orders').get();
    const allOrders=snap.docs.map(d=>d.data());
    const myOrders=allOrders.filter(o=>o.phone===currentUser.phone||o.name===currentUser.name);
    myOrders.sort((a,b)=>b.id-a.id);
    oh.innerHTML=myOrders.length?myOrders.map(o=>`
      <div class="order-history-item">
        <div class="ohi-head">
          <span class="ohi-id">${o.orderNum||'طلب #'+String(o.id).slice(-6)} · ${o.date}</span>
          <span class="ohi-status" style="background:${o.status==='تم التسليم'?'#dcfce7':'#fef9c3'};color:${o.status==='تم التسليم'?'#166534':'#854d0e'};padding:2px 8px;border-radius:8px;font-size:0.72rem;">${o.status||'جديد'}</span>
        </div>
        <div class="ohi-items">${(o.items||[]).map(i=>i.name+' ×'+i.qty).join(' · ')}</div>
        <div class="ohi-total">${o.total}</div>
      </div>
    `).join(''):`<div class="no-orders">ما في طلبات بعد 📦</div>`;
  }catch(e){
    oh.innerHTML='<div class="no-orders">ما في طلبات بعد 📦</div>';
  }
}
function closeProfile(){document.getElementById('profileOverlay').classList.remove('open');}

// ===== ADMIN =====
const _ADMIN_SESSION_KEY='ak_admin_session';
const _ADMIN_SESSION_DAYS=30;

function _saveAdminSession(user, perms){
  localStorage.setItem(_ADMIN_SESSION_KEY, JSON.stringify({user, perms, ts:Date.now()}));
}
function _clearAdminSession(){localStorage.removeItem(_ADMIN_SESSION_KEY);}
function _loadAdminSession(){
  try{
    const s=JSON.parse(localStorage.getItem(_ADMIN_SESSION_KEY)||'null');
    if(!s) return null;
    if(Date.now()-s.ts > _ADMIN_SESSION_DAYS*86400000){_clearAdminSession();return null;}
    return s;
  }catch(e){return null;}
}

function openAdminLogin(){
  const saved=_loadAdminSession();
  if(saved){
    _currentAdminUser=saved.user;_currentAdminPerms=saved.perms;
    openAdmin();return;
  }
  document.getElementById('adminLoginOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('aUser').focus(),300);
}
function closeAdminLogin(){document.getElementById('adminLoginOverlay').classList.remove('open');}
async function doAdminLogin(){
  const u=document.getElementById('aUser').value.trim();
  const p=document.getElementById('aPass').value;
  const remember=document.getElementById('aRemember').checked;
  // Main owner login
  if(u===ADMIN_USER&&p===ADMIN_PASS){
    _currentAdminUser='MAIN';_currentAdminPerms=null;
    if(remember) _saveAdminSession('MAIN',null);
    closeAdminLogin();openAdmin();return;
  }
  // Sub-user login from Firestore
  try{
    const snap=await db.collection('admin_users').where('username','==',u).limit(1).get();
    if(!snap.empty){
      const docData=snap.docs[0].data();
      if(docData.password===p){
        _currentAdminUser=u;_currentAdminPerms=docData.permissions||[];
        if(remember) _saveAdminSession(u, docData.permissions||[]);
        closeAdminLogin();openAdmin();return;
      }
    }
  }catch(e){}
  document.getElementById('aErr').style.display='block';
  setTimeout(()=>document.getElementById('aErr').style.display='none',3000);
}
async function _migrateDeliveryRepsLegacy(){
  try{
    const legacy=JSON.parse(localStorage.getItem('delivery_reps')||'[]');
    if(!legacy.length)return;
    const snap=await db.collection('operator_config').doc('delivery_reps').get();
    if(!snap.exists||!(snap.data().reps||[]).length){
      await db.collection('operator_config').doc('delivery_reps').set({reps:legacy});
      _deliveryRepsCache=legacy;
    }
    localStorage.removeItem('delivery_reps');
  }catch(e){}
}

function openAdmin(){
  document.getElementById('adminPanel').classList.add('open');
  document.body.style.overflow='hidden';
  const lbl=document.getElementById('adminLoggedUser');
  if(lbl)lbl.textContent=_currentAdminUser==='MAIN'?'':'— '+_currentAdminUser;
  applyAdminPerms();
  renderAdmin();startOrderListener();
  _migrateDeliveryRepsLegacy();
  _initFCM().then(()=>_registerFCMToken(_currentAdminUser,'admin'));
}
function closeAdmin(){
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow='';
  stopOrderListener();renderStore();
  // session intentionally kept — only logoutAdmin() clears it
}
function logoutAdmin(){
  _clearAdminSession();
  _currentAdminUser=null;_currentAdminPerms=null;
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow='';
  stopOrderListener();renderStore();
}

function applyAdminPerms(){
  const isMain=_currentAdminUser==='MAIN';
  const perms=_currentAdminPerms;
  const allTabs=['products','orders','customers','points','discounts','photos','stats','badges','eid','categories','aboutedit','operator','adminusers','dxf','emporders'];
  allTabs.forEach(tab=>{
    const btn=document.getElementById('admin-tab-btn-'+tab);
    if(!btn)return;
    if(tab==='emporders'){btn.style.display='none';return;} // merged into حساب المشغل
    if(isMain){btn.style.display='';}
    else if(tab==='adminusers'||tab==='dxf'){btn.style.display='none';}
    else if(perms&&perms.includes(tab)){btn.style.display='';}
    else{btn.style.display='none';}
  });
  const firstTab=allTabs.find(tab=>{
    if(tab==='emporders')return false;
    if(tab==='adminusers'||tab==='dxf')return isMain;
    return isMain||(perms&&perms.includes(tab));
  });
  if(firstTab){
    const btn=document.getElementById('admin-tab-btn-'+firstTab);
    if(btn)btn.click();
  }
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('adminLoginOverlay').classList.contains('open'))doAdminLogin();});

function switchAdminTab(tab){
  if(tab!=='operator'){
    if(_empOrdersUnsub){_empOrdersUnsub();_empOrdersUnsub=null;}
    if(_opOrdersUnsub){_opOrdersUnsub();_opOrdersUnsub=null;}
  }
  document.querySelectorAll('.admin-tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(t=>t.classList.remove('active'));
  const activeBtn=document.getElementById('admin-tab-btn-'+tab);
  if(activeBtn)activeBtn.classList.add('active');
  document.getElementById('tab-'+tab).classList.add('active');
  if(tab==='customers')renderCustomers();
  if(tab==='orders')renderOrders();
  if(tab==='stats'){loadStats();loadVisitorStats();}
  if(tab==='badges')loadBadgeSettings();
  if(tab==='points')loadPointsSettingsUI();
  if(tab==='discounts')renderDiscounts();
  if(tab==='photos')renderPhotosAdmin();
  if(tab==='eid')loadEidAdminUI();
  if(tab==='categories'){ renderCategoriesAdmin(); }
  if(tab==='aboutedit'){ loadAboutSettingsForm(); }
  if(tab==='operator'){
    if(_opOrdersUnsub){_opOrdersUnsub();_opOrdersUnsub=null;}
    switchOpTab('oporders');
  }
  if(tab==='adminusers')loadAdminUsers();
  if(tab==='dxf')dxfTabActivated();
  // emporders/empwages are inside operator tab
}

// ===== EMPLOYEE WAGES =====
let _ewStore=null;
let _ewWorker=null;
let _ewStores=[];
let _ewRate=0;
let _ewMonth='';

function _ewShow(n){['ewScreen1','ewScreen2','ewScreen3'].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.style.display=i+1===n?'block':'none';});}

async function loadEmpWages(){
  _ewShow(1);
  const grid=document.getElementById('ewStoreGrid');
  if(!grid)return;
  grid.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;grid-column:1/-1;padding:10px;">⏳ جاري التحميل...</div>';
  try{
    const storesSnap=await db.collection('operator_stores').orderBy('name').get();
    _ewStores=storesSnap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>!s.archived);

    const mashghalCard=`<div onclick="ewOpenMashghal()" style="background:#f0fdf4;border:2px solid #16a34a;border-radius:16px;padding:16px 12px;cursor:pointer;text-align:center;box-shadow:0 2px 8px rgba(22,163,74,0.10);grid-column:1/-1;">
      <div style="font-size:2rem;margin-bottom:6px;">🏭</div>
      <div style="font-weight:900;color:#166534;font-size:1rem;margin-bottom:4px;">المشغل</div>
      <div style="font-size:0.72rem;color:#16a34a;">موظفو الدوام · حساب بالساعة</div>
    </div>`;
    if(!_ewStores.length){grid.innerHTML=mashghalCard;return;}

    grid.innerHTML=mashghalCard+_ewStores.map(store=>{
      return `<div onclick="ewOpenStore('${store.id}')" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:16px;padding:16px 12px;cursor:pointer;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04);">
        <div style="font-size:2rem;margin-bottom:6px;">🏪</div>
        <div style="font-weight:800;color:#111;font-size:0.9rem;margin-bottom:8px;">${store.name}</div>
        <div style="font-size:0.72rem;color:#9ca3af;">اضغط لعرض الحساب</div>
      </div>`;
    }).join('');
  }catch(e){grid.innerHTML='<div style="color:#dc2626;font-size:0.82rem;grid-column:1/-1;padding:10px;">❌ '+e.message+'</div>';}
}


async function ewOpenMashghal(){
  _ewStore={id:'__mashghal__',name:'المشغل',pageId:'__mashghal__'};
  _ewShow(2);
  document.getElementById('ewScreen2Title').innerHTML='🏭 المشغل';
  document.getElementById('ewBackStoreLabel').textContent='المشغل';
  const list=document.getElementById('ewEmpList');
  list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">⏳</div>';
  try{
    const [workersSnap,paymentsSnap,ratesSnap]=await Promise.all([
      db.collection('employee_workers').get(),
      db.collection('emp_wage_payments').where('storeId','==','__mashghal__').get(),
      db.collection('emp_wage_rates').get()
    ]);
    const workers=workersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const payments=paymentsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const ratesData={};
    ratesSnap.docs.forEach(d=>{ratesData[d.id]=d.data();});
    if(!workers.length){list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد موظفين — أضف موظفين من تبويب الموظفين</div>';return;}
    list.innerHTML=workers.map(w=>{
      const hourlyRate=parseFloat(ratesData[w.id]?.hourlyRate||0);
      const paid=payments.filter(p=>p.workerId===w.id).reduce((s,p)=>s+parseFloat(p.amount||0),0);
      const name=w.name||w.username||w.id;
      return `<div onclick="ewOpenEmployee('${w.id}','${name.replace(/'/g,'&#39;')}')" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:14px 16px;cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:800;color:#111;font-size:0.9rem;">👤 ${name}</div>
            <div style="font-size:0.72rem;color:#9ca3af;margin-top:3px;">${hourlyRate?hourlyRate.toFixed(2)+' د.أ/ساعة':'لم يُحدد أجر/ساعة'} · مدفوع ${paid.toFixed(2)} د.أ</div>
          </div>
          <span style="color:#9ca3af;font-size:1rem;">←</span>
        </div>
      </div>`;
    }).join('');
  }catch(e){list.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';}
}

async function ewOpenStore(storeId){
  _ewStore=_ewStores.find(s=>s.id===storeId)||null;
  if(!_ewStore)return;
  _ewShow(2);
  document.getElementById('ewScreen2Title').innerHTML=`🏪 ${_ewStore.name}`;
  document.getElementById('ewBackStoreLabel').textContent=_ewStore.name;
  const list=document.getElementById('ewEmpList');
  list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">⏳</div>';
  try{
    const [workersSnap,ordersSnap,paymentsSnap,ratesSnap]=await Promise.all([
      db.collection('employee_workers').get(),
      db.collection('employee_orders').where('pageId','==',_ewStore.pageId||'').get(),
      db.collection('emp_wage_payments').where('storeId','==',storeId).get(),
      db.collection('emp_wage_rates').get()
    ]);
    const workers=workersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const orders=ordersSnap.docs.map(d=>d.data()).filter(o=>o.status==='delivered');
    const payments=paymentsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const ratesMap={};
    ratesSnap.docs.forEach(d=>{ratesMap[d.id]=d.data().rates||{};});
    const workerIds=[...new Set(orders.map(o=>o.workerId).filter(Boolean))];
    if(!workerIds.length){list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد موظفين لهذا المتجر</div>';return;}
    list.innerHTML=workerIds.map(wid=>{
      const w=workers.find(x=>x.id===wid)||{id:wid,name:wid};
      const rate=parseFloat(ratesMap[wid]?.[storeId]||0);
      const count=orders.filter(o=>o.workerId===wid).length;
      const earned=count*rate;
      const paid=payments.filter(p=>p.workerId===wid).reduce((s,p)=>s+parseFloat(p.amount||0),0);
      const bal=earned-paid;
      const balColor=bal>0.01?'#ef4444':bal<-0.01?'#f59e0b':'#22c55e';
      const balLabel=bal>0.01?`متبقي ${bal.toFixed(2)} د.أ`:bal<-0.01?`زائد ${Math.abs(bal).toFixed(2)} د.أ`:'الحساب صفر ✅';
      const name=w.name||w.username||wid;
      return `<div onclick="ewOpenEmployee('${wid}','${name.replace(/'/g,'&#39;')}')" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:14px 16px;cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:800;color:#111;font-size:0.9rem;">👤 ${name}</div>
            <div style="font-size:0.72rem;color:#9ca3af;margin-top:3px;">${count} طلب × ${rate.toFixed(2)} د.أ = ${earned.toFixed(2)} · مدفوع ${paid.toFixed(2)}</div>
          </div>
          <div style="font-weight:800;color:${balColor};font-size:0.85rem;">${balLabel}</div>
        </div>
      </div>`;
    }).join('');
  }catch(e){list.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';}
}

async function ewOpenEmployee(workerId,workerName){
  if(!_ewStore)return;
  _ewWorker={id:workerId,name:workerName};
  _ewShow(3);
  const isMashghal=_ewStore.id==='__mashghal__';
  document.getElementById('ewScreen3Title').textContent=`👤 ${workerName}`;
  const orderSec=document.getElementById('ewOrderRateSection');
  if(orderSec)orderSec.style.display=isMashghal?'none':'';
  // افتراضياً عرض كامل تراكمي (بدون تحديد شهر)
  const picker=document.getElementById('ewMonthPicker');
  if(picker)picker.value=_ewMonth||'';
  await _ewRefreshEmployee();
}

async function _ewRefreshEmployee(){
  if(!_ewWorker||!_ewStore)return;
  const isMashghal=_ewStore.id==='__mashghal__';
  // بدون اختيار شهر = عرض كامل تراكمي (كل الدوام والدفعات) — لأن فترة الحساب تنتهي بإغلاق الكشف مش نهاية الشهر
  const hasMonth=!!_ewMonth;
  let dateFrom='0000-00-00',dateTo='9999-99-99';
  if(hasMonth){
    const [yr,mo]=_ewMonth.split('-');
    const lastDay=new Date(+yr,+mo,0).getDate();
    dateFrom=`${_ewMonth}-01`;dateTo=`${_ewMonth}-${String(lastDay).padStart(2,'0')}`;
  }
  try{
    const [ordersSnap,paymentsSnap,rateDoc,attSnap]=await Promise.all([
      isMashghal
        ? Promise.resolve({docs:[]})
        : db.collection('employee_orders').where('workerId','==',_ewWorker.id).where('pageId','==',_ewStore.pageId||'').get(),
      db.collection('emp_wage_payments').where('workerId','==',_ewWorker.id).where('storeId','==',_ewStore.id).get(),
      db.collection('emp_wage_rates').doc(_ewWorker.id).get(),
      db.collection('attendance').where('employeeId','==',_ewWorker.id).get()
    ]);

    const rates=(rateDoc.exists?rateDoc.data().rates:{})||{};
    _ewRate=isMashghal?0:parseFloat(rates[_ewStore.id]||0);
    const rateInput=document.getElementById('ewRateInput');
    if(rateInput)rateInput.value=_ewRate.toFixed(2);
    const hourlyRate=parseFloat(rateDoc.exists?rateDoc.data().hourlyRate||0:0);
    const hrInput=document.getElementById('ewHourlyRateInput');
    if(hrInput)hrInput.value=hourlyRate?hourlyRate.toFixed(2):'';

    // Attendance entries — filter by month in JS (avoids composite index)
    const attDocs=attSnap.docs.map(d=>d.data()).filter(r=>r.date>=dateFrom&&r.date<=dateTo).sort((a,b)=>a.date.localeCompare(b.date));
    let totalAttSecs=0;
    attDocs.forEach(r=>{totalAttSecs+=r.secondsWorked!=null?r.secondsWorked:(r.hoursWorked?Math.round(r.hoursWorked*3600):0);});
    const attEarned=hourlyRate?Math.round(_secsToDecimalHrs(totalAttSecs)*hourlyRate*100)/100:0;

    // Order entries
    const deliveredOrders=ordersSnap.docs.filter(d=>d.data().status==='delivered');
    const orderCount=deliveredOrders.length;
    const orderEarned=orderCount*_ewRate;

    const totalEarned=attEarned+orderEarned;
    // الدفعات مفلترة حسب الشهر المختار (مثل الدوام) — عشان كل شهر يكون حسابه مستقل
    const paymentsArr=paymentsSnap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>{const dt=p.date||'';return dt>=dateFrom&&dt<=dateTo;});
    const paid=paymentsArr.reduce((s,p)=>s+parseFloat(p.amount||0),0);
    const bal=totalEarned-paid;
    const balColor=bal>0.01?'#ef4444':bal<-0.01?'#f59e0b':'#22c55e';

    // Summary
    document.getElementById('ewEmpSummary').innerHTML=`
      <div style="background:#eff6ff;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:1.15rem;font-weight:900;color:#1d4ed8;">${totalEarned.toFixed(2)}</div>
        <div style="font-size:0.68rem;color:#6b7280;">مُستحق</div>
        <div style="font-size:0.62rem;color:#93c5fd;">${attEarned>0?`${attEarned.toFixed(2)} دوام`:''}${orderEarned>0?(attEarned>0?' + ':'')+orderEarned.toFixed(2)+' طلب':''}</div>
      </div>
      <div style="background:#f0fdf4;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:1.15rem;font-weight:900;color:#16a34a;">${paid.toFixed(2)}</div>
        <div style="font-size:0.68rem;color:#6b7280;">مدفوع</div>
      </div>
      <div style="background:#fef2f2;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:1.15rem;font-weight:900;color:${balColor};">${Math.abs(bal).toFixed(2)}</div>
        <div style="font-size:0.68rem;color:#6b7280;">${bal>0.01?'متبقي':bal<-0.01?'زائد':'صفر ✅'}</div>
      </div>`;

    // Build unified كشف الحساب
    const entries=[];
    // attendance days
    attDocs.forEach(r=>{
      const secs=r.secondsWorked!=null?r.secondsWorked:(r.hoursWorked?Math.round(r.hoursWorked*3600):0);
      const dayEarned=hourlyRate?Math.round(_secsToDecimalHrs(secs)*hourlyRate*100)/100:0;
      const inT=r.checkIn?new Date(r.checkIn).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'';
      const outT=r.checkOut?new Date(r.checkOut).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—';
      entries.push({type:'att',date:r.date,secs,dayEarned,inT,outT});
    });
    // payments
    paymentsArr.forEach(p=>{entries.push({type:'pay',date:p.date||'',amount:parseFloat(p.amount||0),notes:p.notes||'',id:p.id,addedBy:p.addedBy||''});});
    // sort newest first
    entries.sort((a,b)=>b.date.localeCompare(a.date));

    const kashf=document.getElementById('ewKashf');
    if(!kashf)return;
    if(!entries.length){
      kashf.innerHTML='<div style="padding:16px;text-align:center;color:#9ca3af;font-size:0.82rem;">لا يوجد سجلات</div>';
      return;
    }
    // header
    let html=`<div style="display:grid;grid-template-columns:80px 1fr auto;gap:0;background:#f9fafb;padding:7px 12px;border-bottom:1px solid #e5e7eb;">
      <span style="font-size:0.68rem;color:#9ca3af;font-weight:700;">التاريخ</span>
      <span style="font-size:0.68rem;color:#9ca3af;font-weight:700;">التفاصيل</span>
      <span style="font-size:0.68rem;color:#9ca3af;font-weight:700;text-align:left;">المبلغ</span>
    </div>`;
    entries.forEach((e,i)=>{
      const border=i<entries.length-1?'border-bottom:1px solid #f3f4f6;':'';
      if(e.type==='att'){
        const hasOut=e.outT&&e.outT!=='—';
        html+=`<div style="display:grid;grid-template-columns:80px 1fr auto;gap:0;padding:10px 12px;align-items:center;${border}">
          <span style="font-size:0.78rem;color:#374151;font-weight:700;">${e.date.slice(5)}</span>
          <div style="font-size:0.78rem;color:#374151;">
            <span style="color:#166534;">⏱ ${_fmtDuration(e.secs)}</span>
            <span style="color:#9ca3af;font-size:0.7rem;margin-right:6px;">${e.inT}${hasOut?' ← '+e.outT:' (جاري)'}</span>
          </div>
          <span style="font-size:0.82rem;font-weight:900;color:#166534;text-align:left;">${e.dayEarned>0?'+'+e.dayEarned.toFixed(2):'—'}</span>
        </div>`;
      } else {
        html+=`<div style="display:grid;grid-template-columns:80px 1fr auto;gap:0;padding:10px 12px;align-items:center;background:#fafffe;${border}">
          <span style="font-size:0.78rem;color:#374151;font-weight:700;">${e.date.slice(5)||'—'}</span>
          <div style="font-size:0.78rem;color:#374151;">
            💵 دفعة${e.notes?' · '+e.notes:''}
            <span style="font-size:0.68rem;color:#9ca3af;display:block;">${e.addedBy}</span>
          </div>
          <div style="text-align:left;">
            <span style="font-size:0.82rem;font-weight:900;color:#dc2626;">-${e.amount.toFixed(2)}</span>
            <button onclick="ewDeletePayment('${e.id}')" style="display:block;margin-top:3px;background:#fee2e2;border:none;border-radius:6px;color:#dc2626;padding:2px 7px;cursor:pointer;font-size:0.72rem;">🗑</button>
          </div>
        </div>`;
      }
    });
    kashf.innerHTML=html;
  }catch(e){toast('❌ '+e.message);}
}

async function ewSaveRate(){
  if(!_ewWorker||!_ewStore)return;
  const rate=parseFloat(document.getElementById('ewRateInput').value)||0;
  try{
    const rateDoc=await db.collection('emp_wage_rates').doc(_ewWorker.id).get();
    const existing=(rateDoc.exists?rateDoc.data().rates:{})||{};
    existing[_ewStore.id]=rate;
    await db.collection('emp_wage_rates').doc(_ewWorker.id).set({
      workerId:_ewWorker.id,workerName:_ewWorker.name,rates:existing,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    _ewRate=rate;
    toast('✅ تم حفظ الراتب');
    await _ewRefreshEmployee();
  }catch(e){toast('❌ '+e.message);}
}

async function ewSaveHourlyRate(){
  if(!_ewWorker)return;
  const rate=parseFloat(document.getElementById('ewHourlyRateInput').value)||0;
  try{
    await db.collection('emp_wage_rates').doc(_ewWorker.id).set({hourlyRate:rate,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    toast('✅ تم حفظ أجر الساعة');
  }catch(e){toast('❌ '+e.message);}
}

async function ewRecordPayment(){
  if(!_ewWorker||!_ewStore)return;
  const amt=parseFloat(document.getElementById('ewPayAmt').value)||0;
  if(!amt){toast('⚠️ أدخل المبلغ');return;}
  const notes=(document.getElementById('ewPayNotes').value||'').trim();
  try{
    await db.collection('emp_wage_payments').add({
      workerId:_ewWorker.id,workerName:_ewWorker.name,
      storeId:_ewStore.id,storeName:_ewStore.name,
      amount:amt,notes,
      date:jordanDateStr(),addedBy:_currentAdminUser||'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم تسجيل الدفعة');
    document.getElementById('ewPayAmt').value='';
    document.getElementById('ewPayNotes').value='';
    await _ewRefreshEmployee();
  }catch(e){toast('❌ '+e.message);}
}

async function ewDeletePayment(docId){
  if(!confirm('حذف هذه الدفعة؟'))return;
  try{
    await db.collection('emp_wage_payments').doc(docId).delete();
    toast('🗑 تم حذف الدفعة');
    await _ewRefreshEmployee();
  }catch(e){toast('❌ '+e.message);}
}

function ewBack(){_ewStore=null;_ewWorker=null;_ewShow(1);loadEmpWages();}
function ewBackToStore(){_ewWorker=null;if(_ewStore){_ewShow(2);if(_ewStore.id==='__mashghal__')ewOpenMashghal();else ewOpenStore(_ewStore.id);}}

// stubs kept for compatibility
function openEmpWageDetail(){}
function saveEmpWageRates(){}
function recordEmpWagePayment(){}
function closeEmpWageDetail(){}
function settleEmpPage(){}
function recordEmpWageAdjustment(){}

// ===== FRAME GALLERY =====
let _frameSelectMode=false;
let _frameSelected=new Set();
let _frameOrdersCache=[];

function _hasRealImage(o){
  const urls=Array.isArray(o.imageDataUrls)?o.imageDataUrls:[];
  if(urls.length) return urls.some(u=>u&&typeof u==='string'&&u.length>100);
  return !!(o.imageDataUrl&&typeof o.imageDataUrl==='string'&&o.imageDataUrl.length>100);
}
function _getFrameOrders(){
  return (_opOrdersAllData||[]).filter(o=>
    (o.isFrameOrder===true||(o.products||[]).some(p=>(p.name||'').includes('برواز')))
    &&_hasRealImage(o)
    &&o.photoTaken!==true
    &&!['cancelled','returned','refused'].includes(o.status)
  );
}
function _updateFrameGalleryCount(){
  const el=document.getElementById('frameGalleryCount');
  if(el) el.textContent=_getFrameOrders().length;
}
function _renderFrameGallery(){
  const grid=document.getElementById('frameGalleryGrid');
  const sub=document.getElementById('frameGallerySubtitle');
  if(!grid)return;
  const frames=(_frameOrdersCache.length?_frameOrdersCache:_getFrameOrders()).sort((a,b)=>{
    const t=o=>(o.createdAt?.toMillis?.())||(o.createdAt?.seconds||0)*1000||0;
    return t(b)-t(a);
  });
  if(sub) sub.textContent=frames.length+' طلب بانتظار الصورة';
  // sync selected set — remove any ids no longer in frames
  const frameIds=new Set(frames.map(o=>o.id));
  _frameSelected.forEach(id=>{if(!frameIds.has(id))_frameSelected.delete(id);});
  _updateFrameSelectBar();
  if(!frames.length){
    grid.innerHTML='<div style="text-align:center;color:rgba(255,255,255,0.45);padding:60px 0;font-size:0.9rem;">✅ لا توجد صور منتظرة</div>';
    return;
  }
  grid.innerHTML=frames.map(o=>{
    const imgs=(o.imageDataUrls&&o.imageDataUrls.filter(u=>u&&u.length>50).length)
      ?o.imageDataUrls.filter(u=>u&&u.length>50)
      :(o.imageDataUrl?[o.imageDataUrl]:[]);
    const prods=(o.products||[]).map(p=>p.name+(p.qty>1?` ×${p.qty}`:'')).join('، ')||'—';
    const dt=o.createdAt?(new Date(o.createdAt)).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    const isSel=_frameSelected.has(o.id);
    const borderCol=isSel?'#7c3aed':'rgba(124,58,237,0.3)';
    const bgCol=isSel?'#1e1040':'#0f0f1a';
    const imgHtml=imgs.map((src,i)=>`
      <div style="position:relative;margin-bottom:${i<imgs.length-1?'6px':'0'};">
        <img src="${src}" onclick="${_frameSelectMode?`_toggleFrameSelect('${o.id}')`:`this.style.maxHeight=this.style.maxHeight==='none'?'220px':'none'`}" onerror="this.style.background='#2d1b4e';this.style.minHeight='80px';this.alt='⚠️ لم تُحمَّل الصورة';" style="width:100%;border-radius:10px;object-fit:cover;max-height:220px;cursor:${_frameSelectMode?'pointer':'zoom-in'};" loading="lazy">
        ${i===0?`<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.72);color:#fff;font-family:'Tajawal',sans-serif;font-size:0.75rem;font-weight:800;padding:3px 9px;border-radius:8px;backdrop-filter:blur(4px);">${prods}</div>`:''}
        ${i===0&&isSel?`<div style="position:absolute;inset:0;border-radius:10px;background:rgba(124,58,237,0.25);display:flex;align-items:center;justify-content:center;"><div style="background:#7c3aed;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">✓</div></div>`:''}
      </div>`).join('');
    const actionBtn=_frameSelectMode
      ?`<button onclick="_toggleFrameSelect('${o.id}')" style="width:100%;padding:10px;background:${isSel?'#7c3aed':'rgba(255,255,255,0.1)'};color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:800;cursor:pointer;">${isSel?'✓ محدد':'☐ تحديد'}</button>`
      :`<button onclick="markFramePhotoTaken('${o.id}')" style="width:100%;padding:11px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:800;cursor:pointer;">✅ أخذت الصورة</button>`;
    return `<div id="fgc-${o.id}" style="background:${bgCol};border:2px solid ${borderCol};border-radius:14px;overflow:hidden;transition:border-color 0.2s,background 0.2s;">
      <div style="padding:12px 14px 8px;">${imgHtml}</div>
      <div style="padding:6px 14px 14px;">
        <div style="color:#fff;font-weight:800;font-size:0.92rem;margin-bottom:2px;">${o.customerName||'—'}</div>
        ${o.customerPhone?`<div style="color:rgba(255,255,255,0.45);font-size:0.75rem;margin-bottom:2px;">📞 ${o.customerPhone}</div>`:''}
        ${dt?`<div style="color:rgba(255,255,255,0.3);font-size:0.72rem;margin-bottom:10px;">${dt}</div>`:'<div style="margin-bottom:10px;"></div>'}
        ${actionBtn}
      </div>
    </div>`;
  }).join('');
}
function _updateFrameSelectBar(){
  const bar=document.getElementById('frameSelectBar');
  const cnt=document.getElementById('frameSelectedCount');
  if(!bar)return;
  if(_frameSelectMode){
    bar.style.display='flex';
    if(cnt) cnt.textContent=_frameSelected.size+' محدد';
  } else {
    bar.style.display='none';
  }
}
function toggleFrameSelectMode(){
  _frameSelectMode=!_frameSelectMode;
  _frameSelected.clear();
  const btn=document.getElementById('frameSelectBtn');
  if(btn) btn.style.background=_frameSelectMode?'#7c3aed':'rgba(255,255,255,0.12)';
  _renderFrameGallery();
}
function _toggleFrameSelect(id){
  if(_frameSelected.has(id)) _frameSelected.delete(id);
  else _frameSelected.add(id);
  _updateFrameSelectBar();
  // re-render just this card's style without full redraw
  const frames=_getFrameOrders();
  const o=frames.find(x=>x.id===id);
  if(!o) return;
  _renderFrameGallery();
}
function frameSelectAll(){
  _getFrameOrders().forEach(o=>_frameSelected.add(o.id));
  _renderFrameGallery();
}
function _downloadOrderImages(o){
  const imgs=Array.isArray(o.imageDataUrls)?o.imageDataUrls.filter(u=>u&&u.length>100):(o.imageDataUrl?[o.imageDataUrl]:[]);
  const name=(o.customerName||'برواز').replace(/\s+/g,'_');
  const prod=((o.products||[])[0]?.name||'').replace(/\s+/g,'_');
  imgs.forEach((src,i)=>{
    const a=document.createElement('a');
    a.href=src;
    a.download=`${name}_${prod}${imgs.length>1?'_'+(i+1):''}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}
async function markSelectedFramesTaken(){
  const ids=[..._frameSelected];
  if(!ids.length)return;
  try{
    ids.forEach(id=>{
      const o=_frameOrdersCache.find(x=>x.id===id);
      if(o) _downloadOrderImages(o);
    });
    await Promise.all(ids.map(id=>db.collection('employee_orders').doc(id).update({photoTaken:true})));
    ids.forEach(id=>{
      const idx=(_opOrdersAllData||[]).findIndex(o=>o.id===id);
      if(idx!==-1) _opOrdersAllData[idx].photoTaken=true;
    });
    _frameOrdersCache=_frameOrdersCache.filter(o=>!ids.includes(o.id));
    _frameSelected.clear();
    _frameSelectMode=false;
    const btn=document.getElementById('frameSelectBtn');
    if(btn) btn.style.background='rgba(255,255,255,0.12)';
    _updateFrameGalleryCount();
    _renderFrameGallery();
  }catch(e){alert('حدث خطأ: '+e.message);}
}
async function openFrameGallery(){
  const m=document.getElementById('frameGalleryModal');
  if(m){m.style.display='block';document.body.style.overflow='hidden';}
  _frameSelectMode=false;
  _frameSelected.clear();
  const btn=document.getElementById('frameSelectBtn');
  if(btn) btn.style.background='rgba(255,255,255,0.12)';
  // show loading
  const grid=document.getElementById('frameGalleryGrid');
  const sub=document.getElementById('frameGallerySubtitle');
  if(grid) grid.innerHTML='<div style="text-align:center;color:rgba(255,255,255,0.45);padding:60px 0;font-size:0.9rem;">⏳ جاري التحميل...</div>';
  try{
    // Direct Firestore query to get fresh image data
    const snap=await db.collection('employee_orders')
      .where('isFrameOrder','==',true)
      .get();
    const fromFirestore=snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(o=>_hasRealImage(o)&&o.photoTaken!==true&&!['cancelled','returned','refused'].includes(o.status));
    // also include برواز by product name from memory (orders that predate the flag)
    const firestoreIds=new Set(fromFirestore.map(o=>o.id));
    const fromMemory=(_opOrdersAllData||[]).filter(o=>
      !firestoreIds.has(o.id)
      &&(o.products||[]).some(p=>(p.name||'').includes('برواز'))
      &&_hasRealImage(o)
      &&o.photoTaken!==true
      &&!['cancelled','returned','refused'].includes(o.status)
    );
    _frameOrdersCache=[...fromFirestore,...fromMemory];
    if(sub) sub.textContent=_frameOrdersCache.length+' طلب بانتظار الصورة';
    _renderFrameGallery();
  }catch(e){
    if(grid) grid.innerHTML='<div style="color:#f87171;font-size:0.85rem;padding:20px;text-align:center;">❌ '+e.message+'</div>';
  }
}
function closeFrameGallery(){
  const m=document.getElementById('frameGalleryModal');
  if(m) m.style.display='none';
  document.body.style.overflow='';
  _frameSelectMode=false;
  _frameSelected.clear();
}
async function markFramePhotoTaken(orderId){
  try{
    const o=_frameOrdersCache.find(x=>x.id===orderId);
    if(o) _downloadOrderImages(o);
    await db.collection('employee_orders').doc(orderId).update({photoTaken:true});
    const idx=(_opOrdersAllData||[]).findIndex(o=>o.id===orderId);
    if(idx!==-1) _opOrdersAllData[idx].photoTaken=true;
    _frameOrdersCache=_frameOrdersCache.filter(o=>o.id!==orderId);
    _updateFrameGalleryCount();
    _renderFrameGallery();
  }catch(e){alert('حدث خطأ: '+e.message);}
}

// ===== CUSTOMER GALLERY =====
let _galCurrentPhone=null,_galCurrentData=null;
let _slideshowPhotos=[],_slideshowIdx=0,_slideshowTimer=null;

function _genGalleryToken(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:16},()=>c[Math.floor(Math.random()*c.length)]).join('');
}
async function openGalleryMgmt(){
  // Ensure Firebase Auth token for Storage writes
  try{
    if(!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
  }catch(e){}
  document.getElementById('galleryMgmtModal').style.display='block';
  document.body.style.overflow='hidden';
  document.getElementById('galPhoneInput').value='';
  document.getElementById('galCustomerArea').innerHTML='';
  _galCurrentPhone=null;_galCurrentData=null;
}
function closeGalleryMgmt(){
  document.getElementById('galleryMgmtModal').style.display='none';
  document.body.style.overflow='';
}
async function searchGalleryCustomer(){
  const phone=document.getElementById('galPhoneInput').value.trim();
  if(!phone||phone.length<7){alert('أدخل رقم هاتف صحيح');return;}
  const area=document.getElementById('galCustomerArea');
  area.innerHTML='<div style="text-align:center;color:rgba(255,255,255,0.4);padding:30px;">⏳ بحث...</div>';
  try{
    await _ensureNet();
    const snap=await db.collection('customer_galleries').doc(phone).get({source:'server'});
    if(snap.exists){
      _galCurrentPhone=phone;
      _galCurrentData={id:snap.id,...snap.data()};
      _renderGalleryCustomer();
    } else {
      area.innerHTML=`<div style="background:#161616;border:1.5px dashed #333;border-radius:14px;padding:20px;text-align:center;">
        <div style="color:rgba(255,255,255,0.5);font-size:0.88rem;margin-bottom:14px;">لا يوجد معرض لهذا الرقم</div>
        <input id="galNewName" type="text" placeholder="اسم الزبون (اختياري)" style="width:100%;padding:10px;background:#1f1f1f;border:1.5px solid #333;border-radius:9px;color:#fff;font-family:'Tajawal',sans-serif;font-size:0.9rem;outline:none;box-sizing:border-box;margin-bottom:10px;">
        <button onclick="createGalleryCustomer('${phone}')" style="width:100%;padding:12px;background:#c9a84c;color:#000;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:800;cursor:pointer;">✨ إنشاء معرض جديد</button>
      </div>`;
    }
  }catch(e){area.innerHTML='<div style="color:#f87171;padding:20px;text-align:center;">❌ '+e.message+'</div>';}
}
async function createGalleryCustomer(phone){
  const name=document.getElementById('galNewName')?.value.trim()||'';
  const token=_genGalleryToken();
  const data={phone,name,token,createdAt:new Date().toISOString(),photos:[]};
  await _ensureNet();
  await db.collection('customer_galleries').doc(phone).set(data);
  _galCurrentPhone=phone;
  _galCurrentData=data;
  _renderGalleryCustomer();
}
function _renderGalleryCustomer(){
  const d=_galCurrentData;
  if(!d)return;
  const galleryUrl=location.origin+'/?g='+d.token;
  const qrUrl='https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(galleryUrl)+'&size=220x220&bgcolor=0a0a0a&color=ffffff&margin=10';
  const photos=d.photos||[];
  const area=document.getElementById('galCustomerArea');
  area.innerHTML=`
    <!-- Customer card -->
    <div style="background:#161616;border:1.5px solid #c9a84c44;border-radius:16px;padding:18px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="color:#fff;font-weight:900;font-size:1rem;">${d.name||d.phone}</div>
          <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;">${d.phone}</div>
          <div style="color:rgba(255,255,255,0.35);font-size:0.7rem;margin-top:2px;">${photos.length} صورة</div>
        </div>
        <div style="text-align:center;">
          <img src="${qrUrl}" style="width:90px;height:90px;border-radius:8px;" loading="lazy">
          <div style="color:#c9a84c;font-size:0.65rem;margin-top:4px;">QR Code</div>
        </div>
      </div>
      <!-- Actions -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <button onclick="_printGalleryQR('${d.token}','${d.name||d.phone}','${galleryUrl}')" style="flex:1;padding:10px;background:#c9a84c;color:#000;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:800;cursor:pointer;">🖨️ طباعة QR</button>
        <button onclick="navigator.clipboard.writeText('${galleryUrl}').then(()=>toast('✅ تم نسخ الرابط'))" style="flex:1;padding:10px;background:#333;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">🔗 نسخ الرابط</button>
        <button onclick="window.open('https://wa.me/${d.phone.replace(/^0/,'962')}?text='+encodeURIComponent('مرحباً، معرض صورك: ${galleryUrl}'),'_blank')" style="flex:1;padding:10px;background:#25d366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">💬 واتساب</button>
      </div>
      <!-- Upload -->
      <input type="file" id="galUploadInput" accept="image/*,video/*" multiple style="display:none;" onchange="uploadGalleryPhotos(this)">
      <button onclick="document.getElementById('galUploadInput').click()" style="width:100%;padding:12px;background:#1f1f1f;color:#c9a84c;border:1.5px dashed #c9a84c44;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;margin-bottom:14px;">📤 رفع صور وفيديوهات</button>
      <!-- Upload progress -->
      <div id="galUploadProgress" style="display:none;"></div>
    </div>
    <!-- Photo grid -->
    <div id="galPhotoGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      ${photos.length?photos.map((p,i)=>p.type==='video'?`
        <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#000;">
          <video src="${p.url}" style="width:100%;height:100%;object-fit:cover;cursor:pointer;" onclick="_previewGalleryPhoto('${p.url}','video')" muted preload="metadata"></video>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;"><div style="background:rgba(0,0,0,0.5);border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:0.9rem;">▶</div></div>
          <button onclick="deleteGalleryPhoto('${_galCurrentPhone}','${p.url}','${p.storagePath||''}',${i})" style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;">✕</button>
        </div>`:`
        <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;">
          <img src="${p.url}" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in;" onclick="_previewGalleryPhoto('${p.url}','image')">
          <button onclick="deleteGalleryPhoto('${_galCurrentPhone}','${p.url}','${p.storagePath||''}',${i})" style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>
        </div>`).join('')
      :'<div style="grid-column:span 3;text-align:center;color:rgba(255,255,255,0.3);padding:30px;font-size:0.85rem;">لا توجد صور أو فيديوهات بعد</div>'}
    </div>`;
}
async function uploadGalleryPhotos(input){
  if(!_galCurrentPhone)return;
  const files=[...input.files];
  if(!files.length)return;
  input.value='';
  const prog=document.getElementById('galUploadProgress');
  // Ensure auth before every upload attempt
  try{
    if(!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
  }catch(authErr){
    if(prog){prog.style.display='block';prog.innerHTML='<div style="color:#f87171;font-size:0.82rem;text-align:center;padding:8px;">❌ فشل تسجيل الدخول: '+authErr.message+'<br><small>تأكد من تفعيل Anonymous Auth في Firebase</small></div>';}
    return;
  }
  if(prog){prog.style.display='block';prog.innerHTML='<div style="color:#c9a84c;font-size:0.82rem;text-align:center;padding:8px;">⏳ جاري الرفع (0/'+files.length+')...</div>';}
  let done=0,lastErr=null;
  const newItems=[];
  for(const file of files){
    try{
      const isVideo=file.type.startsWith('video/');
      const ext=isVideo?(file.name.split('.').pop()||'mp4'):'jpg';
      const path=`galleries/${_galCurrentPhone}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const ref=storage.ref(path);
      if(isVideo){
        await ref.put(file);
      } else {
        const base64=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
        const compressed=await _compressImage(base64,1200,0.80);
        const blob=await fetch(compressed).then(r=>r.blob());
        await ref.put(blob);
      }
      const url=await ref.getDownloadURL();
      newItems.push({url,storagePath:path,type:isVideo?'video':'image',createdAt:new Date().toISOString()});
      done++;
      if(prog) prog.innerHTML='<div style="color:#c9a84c;font-size:0.82rem;text-align:center;padding:8px;">⏳ جاري الرفع ('+done+'/'+files.length+')...</div>';
    }catch(e){
      console.error('Upload error',e);
      lastErr=e;
      if(prog){prog.style.display='block';prog.innerHTML='<div style="color:#f87171;font-size:0.82rem;text-align:center;padding:8px;">❌ خطأ: '+(e.code||e.name||'unknown')+' — '+e.message+'</div>';}
      break;
    }
  }
  if(!newItems.length){
    if(!lastErr&&prog){prog.style.display='block';prog.innerHTML='<div style="color:#f87171;font-size:0.82rem;text-align:center;padding:8px;">❌ فشل رفع الملفات — تأكد من الاتصال</div>';}
    return;
  }
  const updatedPhotos=[...(_galCurrentData.photos||[]),...newItems];
  await db.collection('customer_galleries').doc(_galCurrentPhone).update({photos:updatedPhotos,photoCount:updatedPhotos.length});
  _galCurrentData.photos=updatedPhotos;
  _galCurrentData.photoCount=updatedPhotos.length;
  if(prog)prog.style.display='none';
  _renderGalleryCustomer();
}
async function deleteGalleryPhoto(phone,url,storagePath,idx){
  if(!confirm('حذف هذه الصورة نهائياً؟'))return;
  try{
    if(storagePath){try{await storage.ref(storagePath).delete();}catch(e){}}
    const photos=[...(_galCurrentData.photos||[])];
    photos.splice(idx,1);
    await db.collection('customer_galleries').doc(phone).update({photos,photoCount:photos.length});
    _galCurrentData.photos=photos;
    _galCurrentData.photoCount=photos.length;
    _renderGalleryCustomer();
  }catch(e){alert('خطأ: '+e.message);}
}
function _printGalleryQR(token,name,url){
  const qrUrl='https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(url)+'&size=400x400&bgcolor=ffffff&color=000000&margin=15';
  const w=window.open('','_blank','width=450,height=550');
  w.document.write(`<html><head><title>QR - ${name}</title><style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:Tajawal,Arial;background:#fff;direction:rtl;}img{width:300px;height:300px;}h2{margin:14px 0 4px;font-size:1.2rem;}p{color:#666;font-size:0.85rem;margin:4px 0 18px;}</style></head><body><h2>${name}</h2><p>امسح الكود لمشاهدة معرض صورك</p><img src="${qrUrl}"><p style="font-size:0.7rem;color:#999;margin-top:14px;">${url}</p><script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}
function _previewGalleryPhoto(url,type='image'){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:13000;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;';
  const close=()=>document.body.removeChild(ov);
  ov.innerHTML=type==='video'
    ?`<div style="position:relative;max-width:95vw;max-height:92vh;"><video src="${url}" controls autoplay style="max-width:95vw;max-height:92vh;border-radius:10px;"></video><button onclick="(${close.toString()})()" style="position:absolute;top:-12px;right:-12px;background:#333;color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1rem;">✕</button></div>`
    :`<img src="${url}" onclick="(${close.toString()})()" style="max-width:95vw;max-height:92vh;border-radius:10px;object-fit:contain;cursor:zoom-out;">`;
  if(type!=='video') ov.onclick=close;
  document.body.appendChild(ov);
}

// ===== PUBLIC SLIDESHOW =====
async function _initPublicSlideshow(token){
  const loading=document.getElementById('pslLoading');
  const errEl=document.getElementById('pslError');
  const ps=document.getElementById('publicSlideshow');
  if(!ps)return;
  ps.style.display='block';
  if(loading)loading.style.display='flex';
  if(errEl)errEl.style.display='none';
  try{
    const snap=await db.collection('customer_galleries').where('token','==',token).limit(1).get();
    if(snap.empty){
      if(loading)loading.style.display='none';
      if(errEl)errEl.style.display='flex';
      return;
    }
    const data=snap.docs[0].data();
    const photos=(data.photos||[]).filter(p=>p.url);
    if(!photos.length){
      if(loading)loading.style.display='none';
      if(errEl){errEl.style.display='flex';errEl.querySelector('div div:last-child').textContent='لا توجد صور في هذا المعرض';}
      return;
    }
    _slideshowPhotos=photos;
    _slideshowIdx=0;
    document.getElementById('pslCustomerName').textContent=data.name||data.phone||'';
    _slideshowRender();
    if(loading)loading.style.display='none';
    // touch swipe support
    let tx=0;
    ps.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;},{passive:true});
    ps.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>50){if(dx<0)_slideshowNext();else _slideshowPrev();}},{passive:true});
    _slideshowAutoPlay();
  }catch(e){
    if(loading)loading.style.display='none';
    if(errEl)errEl.style.display='flex';
  }
}
function _slideshowRender(){
  const ph=_slideshowPhotos;
  if(!ph.length)return;
  const wrap=document.getElementById('pslMediaWrap');
  const dots=document.getElementById('pslDots');
  const cnt=document.getElementById('pslPhotoCount');
  const cur=ph[_slideshowIdx];
  if(wrap){
    if(cur.type==='video'){
      wrap.innerHTML=`<video src="${cur.url}" controls autoplay style="max-width:100%;max-height:100vh;object-fit:contain;" onended="_slideshowNext()"></video>`;
      // pause auto-timer while video plays
      if(_slideshowTimer){clearInterval(_slideshowTimer);_slideshowTimer=null;}
    } else {
      wrap.innerHTML=`<img src="${cur.url}" style="max-width:100%;max-height:100vh;object-fit:contain;" draggable="false">`;
      _slideshowAutoPlay();
    }
  }
  if(cnt)cnt.textContent=(_slideshowIdx+1)+' / '+ph.length+(cur.type==='video'?' 🎬':'');
  if(dots)dots.innerHTML=ph.map((x,i)=>`<div onclick="_slideshowGoTo(${i})" style="width:${i===_slideshowIdx?'20px':'7px'};height:7px;border-radius:4px;background:${i===_slideshowIdx?'#c9a84c':'rgba(255,255,255,0.35)'};cursor:pointer;transition:all 0.3s;">${x.type==='video'?'':''}</div>`).join('');
}
function _slideshowNext(){_slideshowIdx=(_slideshowIdx+1)%_slideshowPhotos.length;_slideshowRender();}
function _slideshowPrev(){_slideshowIdx=(_slideshowIdx-1+_slideshowPhotos.length)%_slideshowPhotos.length;_slideshowRender();}
function _slideshowGoTo(i){_slideshowIdx=i;_slideshowRender();}
function _slideshowAutoPlay(){
  if(_slideshowTimer)clearInterval(_slideshowTimer);
  _slideshowTimer=setInterval(()=>{
    const cur=_slideshowPhotos[_slideshowIdx];
    if(cur&&cur.type!=='video') _slideshowNext();
  },4000);
}

// ===== DAILY EXPENSES =====
async function loadExpenses(){
  const list=document.getElementById('expensesList');
  const summary=document.getElementById('expSummary');
  if(!list)return;
  list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">⏳ جاري التحميل...</div>';

  // Set default month filter to current month if empty
  const mf=document.getElementById('expMonthFilter');
  if(mf&&!mf.value){
    const n=new Date();
    mf.value=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0');
  }
  const monthVal=mf?mf.value:'';

  try{
    let q=db.collection('operator_expenses').orderBy('createdAt','desc');
    const snap=await q.get();
    let docs=snap.docs.map(d=>({id:d.id,...d.data()}));

    // Filter client-side by month
    if(monthVal){
      docs=docs.filter(d=>(d.date||'').startsWith(monthVal));
    }

    if(!docs.length){
      list.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">لا توجد مصاريف لهذا الشهر</div>';
      if(summary)summary.textContent='';
      return;
    }

    const total=docs.reduce((s,d)=>s+parseFloat(d.amount||0),0);
    if(summary)summary.textContent=`الإجمالي: ${total.toFixed(2)} د.أ (${docs.length} مصروف)`;

    // Group by category for mini summary
    const cats={};
    docs.forEach(d=>{const c=d.category||'أخرى';cats[c]=(cats[c]||0)+parseFloat(d.amount||0);});
    const catBar=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>
      `<span style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:2px 8px;font-size:0.72rem;color:#9a3412;">${c} ${v.toFixed(2)}</span>`
    ).join('');

    list.innerHTML=`
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${catBar}</div>
      ${docs.map(d=>`
        <div style="background:#fff;border:1.5px solid #fed7aa;border-radius:10px;padding:10px 13px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:#9a3412;font-size:0.9rem;">${parseFloat(d.amount||0).toFixed(2)} د.أ
              <span style="background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:1px 7px;font-size:0.72rem;margin-right:6px;">${d.category||'أخرى'}</span>
            </div>
            <div style="font-size:0.72rem;color:#9ca3af;margin-top:2px;">${d.date||''} ${d.notes?'· '+d.notes:''} ${d.addedBy?'· '+d.addedBy:''}</div>
          </div>
          <button onclick="deleteExpense('${d.id}')" style="background:none;border:none;cursor:pointer;font-size:1rem;color:#d1d5db;padding:4px 6px;" title="حذف">🗑️</button>
        </div>`).join('')}`;
  }catch(e){
    list.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';
  }
}

async function addExpenseFromSession(){
  const amt=parseFloat(document.getElementById('inline_exp_amt')?.value)||0;
  if(!amt){toast('⚠️ أدخل المبلغ');return;}
  const category=(document.getElementById('inline_exp_cat')?.value||'أخرى').trim()||'أخرى';
  const notes=(document.getElementById('inline_exp_notes')?.value||'').trim();
  const date=jordanDateStr();
  try{
    await db.collection('operator_expenses').add({
      amount:amt, category, notes, date,
      sessionId:_opCurrentSession?.id||null,
      addedBy:_currentAdminUser||'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم تسجيل المصروف');
    // refresh expenses list
    if(_opCurrentSession){
      const from=_opCurrentSession.openedDate;
      const to=_opCurrentSession.closedDate||jordanDateStr();
      try{
        const eSnap=await db.collection('operator_expenses').where('date','>=',from).where('date','<=',to).get();
        _opDayExpenses=eSnap.docs.map(d=>({id:d.id,...d.data()}));
      }catch(e){_opDayExpenses=[];}
    }
    renderOperatorDailyView();
  }catch(e){toast('❌ '+e.message);}
}

async function addExpense(){
  const amt=parseFloat(document.getElementById('expAmt')?.value)||0;
  if(!amt){toast('⚠️ أدخل المبلغ');return;}
  const category=(document.getElementById('expCategory')?.value||'أخرى').trim()||'أخرى';
  const notes=(document.getElementById('expNotes')?.value||'').trim();
  const dateEl=document.getElementById('expDate');
  const date=dateEl?.value||jordanDateStr();
  try{
    await db.collection('operator_expenses').add({
      amount:amt,
      category,
      notes,
      date,
      addedBy:_currentAdminUser||'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم تسجيل المصروف');
    document.getElementById('expAmt').value='';
    document.getElementById('expNotes').value='';
    document.getElementById('expCategory').value='';
    loadExpenses();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteExpense(id){
  if(!confirm('حذف هذا المصروف؟'))return;
  try{
    await db.collection('operator_expenses').doc(id).delete();
    toast('🗑️ تم الحذف');
    loadExpenses();
  }catch(e){toast('❌ '+e.message);}
}

// ===== ADMIN USERS MANAGEMENT =====
const PERM_LABELS={operator:'💼 حساب المشغل',products:'📦 المنتجات',orders:'🧾 الطلبات',customers:'👥 الزبائن',stats:'📊 الإحصائيات',discounts:'🎁 كودات الخصم',photos:'📸 صور الزبائن',points:'🌟 النقاط',badges:'🏅 الشارات',categories:'📂 الأقسام',aboutedit:'🌿 من نحن',eid:'🌙 العيد'};

async function loadAdminUsers(){
  try{
    const snap=await db.collection('admin_users').orderBy('createdAt','desc').get();
    _adminUsersList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){
    const snap=await db.collection('admin_users').get();
    _adminUsersList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }
  renderAdminUsers();
}

function renderAdminUsers(){
  const wrap=document.getElementById('adminUsersWrap');
  if(!wrap)return;
  if(!_adminUsersList.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;padding:24px;background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;">لا يوجد مستخدمون مضافون بعد</div>';
    return;
  }
  wrap.innerHTML=_adminUsersList.map(u=>`
    <div style="background:#fff;border-radius:12px;padding:16px 18px;margin-bottom:10px;border:1.5px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.95rem;color:#111827;margin-bottom:6px;">👤 ${u.username}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${(u.permissions||[]).map(p=>`<span style="background:rgba(26,58,42,0.08);color:var(--green-dark);border-radius:6px;padding:3px 8px;font-size:0.75rem;font-weight:600;">${PERM_LABELS[p]||p}</span>`).join('')}
        </div>
      </div>
      <button onclick="deleteAdminUser('${u.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:8px;padding:7px 13px;font-family:'Tajawal',sans-serif;font-size:0.82rem;cursor:pointer;flex-shrink:0;">🗑 حذف</button>
    </div>
  `).join('');
}

async function addAdminUser(){
  const u=document.getElementById('newAdminUsername').value.trim();
  const p=document.getElementById('newAdminPassword').value.trim();
  const perms=Array.from(document.querySelectorAll('.perm-check:checked')).map(c=>c.value);
  if(!u){toast('⚠️ أدخل اسم المستخدم');return;}
  if(!p){toast('⚠️ أدخل كلمة المرور');return;}
  if(!perms.length){toast('⚠️ اختر صلاحية واحدة على الأقل');return;}
  if(u===ADMIN_USER){toast('⚠️ هذا الاسم محجوز');return;}
  // check duplicate
  const dup=_adminUsersList.find(x=>x.username===u);
  if(dup){toast('⚠️ اسم المستخدم موجود مسبقاً');return;}
  try{
    await db.collection('admin_users').add({username:u,password:p,permissions:perms,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    document.getElementById('newAdminUsername').value='';
    document.getElementById('newAdminPassword').value='';
    document.querySelectorAll('.perm-check').forEach(c=>c.checked=false);
    toast('✅ تم إضافة المستخدم');
    loadAdminUsers();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

async function deleteAdminUser(id){
  if(!confirm('حذف هذا المستخدم نهائياً؟'))return;
  try{
    await db.collection('admin_users').doc(id).delete();
    toast('🗑 تم حذف المستخدم');
    loadAdminUsers();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

// ===== EMPLOYEE WORKERS =====
const _EMP_SESSION_KEY='ak_emp_session';
const _EMP_SESSION_DAYS=7;
let _empCurrentUser=null; // {id, username, defaultPage}
let _empCurrentImages=[];

function _saveEmpSession(u){localStorage.setItem(_EMP_SESSION_KEY,JSON.stringify({...u,ts:Date.now()}));}
function _clearEmpSession(){localStorage.removeItem(_EMP_SESSION_KEY);}
function _loadEmpSession(){
  try{
    const s=JSON.parse(localStorage.getItem(_EMP_SESSION_KEY)||'null');
    if(!s)return null;
    if(Date.now()-s.ts>_EMP_SESSION_DAYS*86400000){_clearEmpSession();return null;}
    return s;
  }catch(e){return null;}
}

function openEmpLogin(){
  const saved=_loadEmpSession();
  if(saved){_empCurrentUser=saved;openEmpPanel();return;}
  document.getElementById('empLoginOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('empUser').focus(),300);
}
function closeEmpLogin(){
  document.getElementById('empLoginOverlay').classList.remove('open');
  document.getElementById('empLoginErr').textContent='';
  document.getElementById('empUser').value='';
  document.getElementById('empPass').value='';
}
let _empPagesCache=[];
let _empSharedProducts=null;
let _empOrderCart=[];
let _empOrderUrgent=false;
let _empReadyToDeliver=false;
function toggleEmpReady(){
  _empReadyToDeliver=!_empReadyToDeliver;
  const btn=document.getElementById('empReadyBtn');
  if(!btn)return;
  if(_empReadyToDeliver){
    btn.style.background='linear-gradient(135deg,#1a3a2a,#2d5a3d)';
    btn.style.color='#fff';
    btn.style.border='1.5px solid #1a3a2a';
    btn.textContent='📦 جاهز للتوصيل · مفعّل';
    btn.style.boxShadow='0 0 0 4px rgba(26,58,42,0.15)';
  }else{
    btn.style.background='#fff';
    btn.style.color='#374151';
    btn.style.border='1.5px dashed #d1d5db';
    btn.textContent='📦 جاهز للتوصيل';
    btn.style.boxShadow='none';
  }
}
function _resetEmpReadyBtn(){_empReadyToDeliver=false;const b=document.getElementById('empReadyBtn');if(b){b.style.background='#fff';b.style.color='#374151';b.style.border='1.5px dashed #d1d5db';b.textContent='📦 جاهز للتوصيل';b.style.boxShadow='none';}}
function toggleEmpUrgent(){
  _empOrderUrgent=!_empOrderUrgent;
  const btn=document.getElementById('empUrgentBtn');
  if(!btn)return;
  if(_empOrderUrgent){
    btn.style.background='linear-gradient(135deg,#dc2626,#ef4444)';
    btn.style.color='#fff';
    btn.style.border='1.5px solid #dc2626';
    btn.textContent='🔥 مستعجل · مفعّل';
    btn.style.boxShadow='0 0 0 4px rgba(220,38,38,0.15)';
  }else{
    btn.style.background='#fff';
    btn.style.color='#374151';
    btn.style.border='1.5px dashed #d1d5db';
    btn.textContent='🔥 طلب مستعجل';
    btn.style.boxShadow='none';
  }
}
function resetEmpUrgentBtn(){_empOrderUrgent=false;const b=document.getElementById('empUrgentBtn');if(b){b.style.background='#fff';b.style.color='#374151';b.style.border='1.5px dashed #d1d5db';b.textContent='🔥 طلب مستعجل';b.style.boxShadow='none';}}
let _empDeliveryFee=2;
let _empOrdersUnsub=null;
let _opOrdersUnsub=null;
let _opStmtUnsub=null;
let _opStmtPollId=null;
let _empTodayUnsub=null;
let _empEditOrderId=null;
let _empEditCart=[];
let _empEditDeliveryFee=0;
let _empOrdersAllData=[];
let _empOrdersFilter='all';
let _opOrdersAllData=[];
let _opOrdersFilter='all';
let _opSelectMode=false;
let _opSelectedIds=new Set();
// تحديد متعدد لقسم قيد التوصيل — المناديب (تسليم جماعي)
let _delivSelectMode=false;
let _delivSelectedIds=new Set();
let _areaFeesCache=null;
let _empAdvFilter=null,_opAdvFilter=null;
let _tvModeActive=false,_tvModeInterval=null;
let _empCancelTargetId=null,_empHoldTargetId=null;

// ===== STATUS SYSTEM =====
const EMP_STATUSES={
  pending:   {label:'جديد',         color:'#f59e0b',bg:'#fffbeb',border:'#fde68a'},
  preparing: {label:'قيد التجهيز', color:'#f97316',bg:'#fff7ed',border:'#fed7aa'},
  prepared:  {label:'تم التجهيز',  color:'#3b82f6',bg:'#eff6ff',border:'#bfdbfe'},
  delivering:{label:'قيد التوصيل',color:'#8b5cf6',bg:'#f5f3ff',border:'#ddd6fe'},
  waiting_rep:{label:'انتظار مندوب',color:'#d97706',bg:'#fef3c7',border:'#fde68a'},
  delivered: {label:'تم التوصيل', color:'#22c55e',bg:'#f0fdf4',border:'#86efac'},
  queued:    {label:'قائمة توصيل', color:'#0ea5e9',bg:'#f0f9ff',border:'#bae6fd'},
  onhold:    {label:'عالق',         color:'#d97706',bg:'#fef3c7',border:'#fde68a'},
  postponed: {label:'مؤجل',        color:'#f59e0b',bg:'#fffbeb',border:'#fde68a'},
  cancelled: {label:'ملغي',        color:'#ef4444',bg:'#fef2f2',border:'#fecaca'},
  returned:  {label:'مرتجع',       color:'#6b7280',bg:'#f9fafb',border:'#e5e7eb'},
  refused:   {label:'رفض الاستلام',color:'#dc2626',bg:'#fef2f2',border:'#fecaca'},
};
const EMP_STATUS_NEXT={pending:'preparing',preparing:'prepared',prepared:'delivering',delivering:'delivered'};
function _empSt(s){return EMP_STATUSES[s]||{label:s,color:'#6b7280',bg:'#f9fafb',border:'#e5e7eb'};}

async function openEmpPanel(){
  document.getElementById('empPanel').style.display='block';
  document.body.style.overflow='hidden';
  _checkEmpNotifBanner();
  _initFCM().then(()=>{if(Notification.permission==='granted')_registerFCMToken(_empCurrentUser&&(_empCurrentUser.id||_empCurrentUser.username),'emp');});
  const lbl=document.getElementById('empNameLabel');
  if(lbl)lbl.textContent=_empCurrentUser.displayName||_empCurrentUser.username;
  const isDelivery=_empCurrentUser.permissions?.isDelivery||false;
  const isQRViewer=_empCurrentUser.permissions?.isQRViewer||false;
  const hdr=document.querySelector('#empPanel .admin-tab-content, #empPanel > div:first-child div:nth-child(2)');
  const titleEl=document.querySelector('#empPanel [style*="c9a84c"]');
  if(titleEl)titleEl.textContent=isQRViewer?'📷 ماسح الطلبات':isDelivery?'🚀 تسليم مبيعات':'📋 تسجيل الطلبات';
  document.getElementById('empNormalOrderSection').style.display=(!isDelivery&&!isQRViewer)?'block':'none';
  document.getElementById('empDeliverySection').style.display=isDelivery?'block':'none';
  document.getElementById('empQRViewerSection').style.display=isQRViewer?'block':'none';
  if(isQRViewer){
    // QR viewer: nothing to init, just show the scan button
  }else if(isDelivery){
    initEmpDeliveryPanel();
  }else{
    _empOrderCart=[];
    _empDeliveryFee=2;
    await _loadEmpPagesIntoPanel();
    await onEmpPageChange();
    renderEmpOrderCart();
    loadEmpTodayOrders();
    loadEmpPoints();
    // Populate area fees datalist
    _loadAreaFees().then(fees=>{
      const dl=document.getElementById('areaFeesList');
      if(dl)dl.innerHTML=(fees||[]).map(f=>`<option value="${f.area}">`).join('');
    });
  }
}

async function _loadEmpPagesIntoPanel(){
  try{
    const snap=await db.collection('employee_pages').orderBy('name').get();
    _empPagesCache=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){
    try{const snap=await db.collection('employee_pages').get();_empPagesCache=snap.docs.map(d=>({id:d.id,...d.data()}));}catch(e2){_empPagesCache=[];}
  }
  const sel=document.getElementById('emp_page');
  if(!sel)return;
  sel.innerHTML='<option value="">— اختار الصفحة —</option>'+
    _empPagesCache.filter(p=>!p.hiddenFromEmployee).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  // pre-select default page
  if(_empCurrentUser.defaultPage){
    const match=_empPagesCache.find(p=>p.id===_empCurrentUser.defaultPage||p.name===_empCurrentUser.defaultPage);
    if(match){sel.value=match.id;onEmpPageChange();}
  }
}

let _selectedEmpProductId=null;

async function onEmpPageChange(){
  if(!_empSharedProducts){
    const grid=document.getElementById('emp_product_grid');
    if(grid) grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#9ca3af;font-size:0.8rem;padding:16px;">⏳ جاري التحميل...</div>';
    try{
      let snap;
      try{snap=await db.collection('operator_products').orderBy('name').get();}
      catch(e){snap=await db.collection('operator_products').get();}
      _empSharedProducts=snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.isRawMaterial);
    }catch(e){_empSharedProducts=[];}
  }
  renderEmpProductPicker();
}

let _empProductSearchQuery='';
let _empProductCategoryFilter='';

function filterEmpProductGrid(q){
  _empProductSearchQuery=(q||'').trim();
  renderEmpProductPicker();
}
function clearEmpProductSearch(){
  _empProductSearchQuery='';
  const inp=document.getElementById('emp_product_search');
  if(inp){inp.value='';inp.focus();}
  renderEmpProductPicker();
}
function filterEmpProductCategory(cat){
  _empProductCategoryFilter=cat;
  renderEmpProductPicker();
}

function _renderEmpCategoryChips(){
  const wrap=document.getElementById('emp_category_chips');
  if(!wrap)return;
  const cats=[...new Set((_empSharedProducts||[]).map(p=>p.category||'').filter(Boolean))].sort();
  if(!cats.length){wrap.innerHTML='';return;}
  wrap.innerHTML=['الكل',...cats].map(c=>{
    const isActive=c==='الكل'?!_empProductCategoryFilter:_empProductCategoryFilter===c;
    return `<button onclick="filterEmpProductCategory('${c==='الكل'?'':c}')" style="padding:5px 13px;border-radius:20px;border:1.5px solid ${isActive?'#1a3a2a':'#e5e7eb'};background:${isActive?'#1a3a2a':'#fff'};color:${isActive?'#fff':'#374151'};font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:${isActive?'700':'400'};cursor:pointer;white-space:nowrap;">${c}</button>`;
  }).join('');
}

function renderEmpProductPicker(){
  const grid=document.getElementById('emp_product_grid');
  if(!grid)return;
  let prods=_empSharedProducts||[];
  if(!prods.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#9ca3af;font-size:0.8rem;padding:16px;">لا يوجد منتجات — أضفها من حساب المشغل</div>';
    _renderEmpCategoryChips();
    return;
  }
  _renderEmpCategoryChips();
  if(_empProductCategoryFilter){
    prods=prods.filter(p=>(p.category||'')=== _empProductCategoryFilter);
  }
  if(_empProductSearchQuery){
    const q=_empProductSearchQuery.toLowerCase();
    prods=prods.filter(p=>(p.name||'').toLowerCase().includes(q));
  }
  if(!prods.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#9ca3af;font-size:0.8rem;padding:16px;">لا يوجد نتائج</div>';
    return;
  }
  grid.innerHTML=prods.map(p=>{
    const img=p.imageDataUrl||(p.images&&p.images[0])||p.img||'';
    const isSelected=_selectedEmpProductId===p.id;
    return `<div onclick="selectEmpProduct('${p.id}')" id="emp_prod_card_${p.id}" style="cursor:pointer;border-radius:10px;padding:8px;border:2px solid ${isSelected?'#1a3a2a':'#e5e7eb'};background:${isSelected?'#f0fdf4':'#fff'};display:flex;flex-direction:column;align-items:center;gap:5px;transition:border-color 0.15s;">
      ${img?`<img src="${img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;">`:`<div style="width:64px;height:64px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">📦</div>`}
      <div style="font-size:0.76rem;font-weight:700;color:#1a3a2a;text-align:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${p.name}</div>
      <div style="font-size:0.72rem;color:#166534;font-weight:600;">${(p.sellPrice||0).toFixed(2)} د.أ</div>
      ${isSelected?'<div style="font-size:0.7rem;color:#1a3a2a;font-weight:800;">✓ مختار</div>':''}
    </div>`;
  }).join('');
}

let _selectedEmpColor=null;

function selectEmpProduct(id){
  _selectedEmpProductId=id;
  _selectedEmpColor=null;
  renderEmpProductPicker();
  const prod=(_empSharedProducts||[]).find(p=>p.id===id);
  const bar=document.getElementById('emp_product_selected_bar');
  const noBar=document.getElementById('emp_no_product_bar');
  if(!prod){if(bar)bar.style.display='none';if(noBar)noBar.style.display='flex';return;}
  if(bar) bar.style.display='flex';
  if(noBar) noBar.style.display='none';
  const nameEl=document.getElementById('emp_selected_prod_name');
  const priceEl=document.getElementById('emp_selected_prod_price');
  const imgWrap=document.getElementById('emp_selected_prod_img_wrap');
  if(nameEl) nameEl.textContent=prod.name||'';
  if(priceEl) priceEl.textContent=(prod.sellPrice||0).toFixed(2)+' د.أ / وحدة';
  const img=prod.imageDataUrl||(prod.images&&prod.images[0])||prod.img||'';
  if(imgWrap) imgWrap.innerHTML=img?`<img src="${img}" style="width:42px;height:42px;object-fit:cover;border-radius:7px;border:1px solid #86efac;">`:'';
}

function selectEmpColor(color,btn){
  _selectedEmpColor=color;
  document.querySelectorAll('#emp_color_btns button').forEach(b=>{
    b.style.background='#fff';b.style.color='#374151';b.style.borderColor='#cbd5e1';
  });
  if(btn){btn.style.background='#1a3a2a';btn.style.color='#fff';btn.style.borderColor='#1a3a2a';}
}

function addToEmpCart(){
  if(!_selectedEmpProductId){toast('⚠️ اختار المنتج أولاً');return;}
  const prod=(_empSharedProducts||[]).find(p=>p.id===_selectedEmpProductId);
  if(!prod){toast('⚠️ المنتج غير موجود');return;}
  const qtyEl=document.getElementById('emp_cart_qty');
  const qty=Math.max(1,parseInt(qtyEl?.value||1));
  _empOrderCart.push({id:prod.id,name:prod.name||'',price:parseFloat(prod.sellPrice||0),qty,color:'',writing:''});
  _selectedEmpProductId=null;
  _selectedEmpColor=null;
  const bar=document.getElementById('emp_product_selected_bar');
  const noBar=document.getElementById('emp_no_product_bar');
  if(bar) bar.style.display='none';
  if(noBar) noBar.style.display='flex';
  if(qtyEl) qtyEl.value='1';
  renderEmpProductPicker();
  renderEmpOrderCart();
}

function removeFromEmpCart(idx){_empOrderCart.splice(idx,1);renderEmpOrderCart();}

function changeEmpQty(idx,delta){
  _empOrderCart[idx].qty=Math.max(1,(_empOrderCart[idx].qty||1)+delta);
  renderEmpOrderCart();
}

function updateCartItemColor(idx,color){
  if(!_empOrderCart[idx])return;
  _empOrderCart[idx].color=_empOrderCart[idx].color===color?'':color;
  renderEmpOrderCart();
}

function updateCartItemWriting(idx,value){
  if(!_empOrderCart[idx])return;
  _empOrderCart[idx].writing=value;
}

function updateCartItemPrice(idx,price,label){
  if(!_empOrderCart[idx])return;
  _empOrderCart[idx].price=parseFloat(price)||0;
  if(label!==undefined) _empOrderCart[idx].priceLabel=label;
  renderEmpOrderCart();
}

// يحدّد اسم خيار السعر المختار للمنتج (لتسجيله بالطلب)
function _resolveItemPriceLabel(item){
  if(item.priceLabel) return item.priceLabel;
  const prod=(_empSharedProducts||[]).find(p=>p.id===item.id)||(_opProductsList||[]).find(p=>p.id===item.id);
  if(!prod) return '';
  const choices=_productPriceChoices(prod);
  if(!choices.length) return '';
  const match=choices.find(c=>Math.abs((c.price||0)-(item.price||0))<0.001);
  return match?match.label:'';
}

// قائمة الأسعار القابلة للاختيار = السعر الأساسي + الخيارات المضافة (بدون تكرار)
// baseOverride: سعر أساسي بديل (مثلاً سعر المتجر بشاشة البيع)
function _productPriceChoices(prod,baseOverride){
  const opts=Array.isArray(prod?.priceOptions)?prod.priceOptions:[];
  if(!opts.length) return [];
  const base=parseFloat(baseOverride!=null?baseOverride:(prod?.sellPrice||0))||0;
  const list=[];
  if(base>0&&!opts.some(o=>Math.abs((o.price||0)-base)<0.001)) list.push({label:'أساسي',price:base});
  opts.forEach(o=>list.push({label:o.label,price:parseFloat(o.price)||0}));
  return list;
}

function calcEmpOrderTotal(){return _empOrderCart.reduce((s,i)=>s+(i.price*i.qty),0);}

// ===== SMART PASTE (AI) + CUSTOMER MEMORY =====
const _EMP_AREAS=['عمان','اربد','الزرقاء','البلقاء','مادبا','الكرك','الطفيلة','معان','العقبة','جرش','عجلون','المفرق','الاغوار','الشونة','الازرق','رصيفة'];

// كشف المحافظة تلقائياً من نص العنوان
function _empDetectArea(txt){
  if(!txt) return '';
  const t=txt.replace(/[أإآ]/g,'ا');
  for(const a of _EMP_AREAS){
    const norm=a.replace(/[أإآ]/g,'ا');
    if(t.includes(norm)) return a;
  }
  // مرادفات شائعة
  const syn={'الرصيفة':'رصيفة','عمّان':'عمان','إربد':'اربد','الزرقا':'الزرقاء'};
  for(const k in syn){if(t.includes(k.replace(/[أإآ]/g,'ا'))) return syn[k];}
  return '';
}
function _empSetAreaIfEmpty(area){
  const sel=document.getElementById('emp_area');
  if(!sel) return;
  if(area && _EMP_AREAS.includes(area)){sel.value=area;onEmpAreaChange();}
  else if(!sel.value){const det=_empDetectArea(document.getElementById('emp_address')?.value||'');if(det){sel.value=det;onEmpAreaChange();}}
}

async function runSmartPaste(){
  const ta=document.getElementById('emp_smart_paste');
  const txt=(ta?.value||'').trim();
  if(!txt){toast('⚠️ الصق رسالة الزبون أولاً');return;}
  const btn=document.getElementById('emp_smart_btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري التحليل...';}
  try{
    if(!_akFunctions){throw new Error('خدمة التحليل غير متاحة');}
    const names=(_empSharedProducts||[]).map(p=>p.name).filter(Boolean);
    const call=_akFunctions.httpsCallable('parseOrder');
    const r=await call({text:txt,products:names,areas:_EMP_AREAS});
    const d=r.data||{};
    let filled=[];
    if(d.name){const el=document.getElementById('emp_customer_name');if(el){el.value=d.name;filled.push('الاسم');}}
    if(d.phone){const el=document.getElementById('emp_phone');if(el){el.value=d.phone;filled.push('الرقم');onEmpPhoneInput(d.phone);}}
    if(d.address){const el=document.getElementById('emp_address');if(el){el.value=d.address;filled.push('العنوان');}}
    _empSetAreaIfEmpty(d.area);
    if(d.area||document.getElementById('emp_area')?.value) filled.push('المحافظة');
    if(d.notes){const el=document.getElementById('emp_notes');if(el){el.value=d.notes;filled.push('الملاحظات');}}
    // طابق المنتج وأضفه للسلة
    if(d.product){
      const prod=(_empSharedProducts||[]).find(p=>p.name===d.product)||
                 (_empSharedProducts||[]).find(p=>(p.name||'').includes(d.product)||d.product.includes(p.name||''));
      if(prod){
        const qty=Math.max(1,parseInt(d.qty)||1);
        if(!_empOrderCart.some(i=>i.id===prod.id)){
          _empOrderCart.push({id:prod.id,name:prod.name||'',price:parseFloat(prod.sellPrice||0),qty,color:'',writing:''});
          renderEmpOrderCart();
          filled.push('المنتج');
        }
      }
    }
    toast(filled.length?('✅ تم تعبئة: '+filled.join('، ')):'⚠️ ما قدرت أستخرج معلومات واضحة');
    if(ta) ta.value='';
  }catch(e){
    toast('❌ '+(e.message||'فشل التحليل'));
  }finally{
    if(btn){btn.disabled=false;btn.textContent='✨ تحليل وتعبئة';}
  }
}

// اقتراح الزباين (autocomplete) + ملف الزبون
let _empPhoneTimer=null;
function onEmpPhoneInput(val){
  const phone=(val||'').replace(/\s+/g,'');
  clearTimeout(_empPhoneTimer);
  const box=document.getElementById('emp_phone_suggest');
  if(phone.length>=10){_empShowCRM(phone);}else{const b=document.getElementById('emp_crm_banner');if(b)b.style.display='none';}
  if(phone.length<4){if(box)box.style.display='none';return;}
  _empPhoneTimer=setTimeout(async()=>{
    try{
      const snap=await db.collection('customers')
        .where(firebase.firestore.FieldPath.documentId(),'>=',phone)
        .where(firebase.firestore.FieldPath.documentId(),'<=',phone+'')
        .limit(6).get();
      if(snap.empty){if(box)box.style.display='none';return;}
      const items=snap.docs.map(d=>({id:d.id,...d.data()}));
      box.innerHTML=items.map(c=>`<div onclick='applyEmpCustomer(${JSON.stringify({phone:c.id,name:c.name||'',address:c.address||'',area:c.area||''}).replace(/'/g,"&#39;")})' style="padding:9px 11px;border-bottom:1px solid #f3f4f6;cursor:pointer;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='#fff'">
        <div style="font-weight:700;font-size:0.85rem;color:#1a3a2a;">${c.name||'زبون'} <span style="direction:ltr;color:#6b7280;font-weight:600;">${c.id}</span></div>
        ${c.address?`<div style="font-size:0.72rem;color:#9ca3af;">📍 ${c.address}</div>`:''}
      </div>`).join('');
      box.style.display='block';
    }catch(e){if(box)box.style.display='none';}
  },280);
}

function applyEmpCustomer(c){
  if(c.name){const el=document.getElementById('emp_customer_name');if(el)el.value=c.name;}
  if(c.phone){const el=document.getElementById('emp_phone');if(el)el.value=c.phone;}
  if(c.address){const el=document.getElementById('emp_address');if(el)el.value=c.address;}
  _empSetAreaIfEmpty(c.area);
  const box=document.getElementById('emp_phone_suggest');if(box)box.style.display='none';
  if(c.phone)_empShowCRM(c.phone);
}

async function _empShowCRM(phone){
  const banner=document.getElementById('emp_crm_banner');
  if(!banner) return;
  try{
    const snap=await db.collection('employee_orders').where('customerPhone','==',phone).get();
    if(snap.empty){banner.style.display='none';return;}
    const orders=snap.docs.map(d=>d.data());
    const total=orders.length;
    const delivered=orders.filter(o=>o.status==='delivered').length;
    const bad=orders.filter(o=>o.status==='returned'||o.status==='cancelled').length;
    let last='';
    const sorted=orders.slice().sort((a,b)=>{const ta=a.createdAt?.toMillis?.()||0,tb=b.createdAt?.toMillis?.()||0;return tb-ta;});
    const lo=sorted[0];
    if(lo){last=(lo.products&&lo.products[0]?.name)||lo.productName||'';}
    // تقييم
    let badge,bg,bord;
    if(bad>=2&&bad>=delivered){badge='🔴 زبون يرفض كثيراً ('+bad+' مرتجع/ملغي)';bg='#fef2f2';bord='#fecaca';}
    else if(delivered>=3){badge='🟢 زبون ممتاز — '+delivered+' طلب مستلَم';bg='#f0fdf4';bord='#bbf7d0';}
    else{badge='🔵 زبون مسجّل — '+total+' طلب سابق';bg='#eff6ff';bord='#bfdbfe';}
    banner.innerHTML=`<div style="background:${bg};border:1.5px solid ${bord};border-radius:9px;padding:9px 11px;font-size:0.78rem;color:#374151;">
      <div style="font-weight:700;margin-bottom:2px;">${badge}</div>
      <div style="font-size:0.72rem;color:#6b7280;">📦 الكل: ${total} · ✅ مستلَم: ${delivered}${bad?` · ↩️ راجع/ملغي: ${bad}`:''}${last?` · 🏷 آخر منتج: ${last}`:''}</div>
    </div>`;
    banner.style.display='block';
  }catch(e){banner.style.display='none';}
}

// حفظ/تحديث بيانات الزبون بعد تسجيل الطلب
async function _empUpsertCustomer(phone,name,address,area,productName){
  if(!phone) return;
  try{
    await db.collection('customers').doc(phone).set({
      ...(name?{name}:{}),
      ...(address?{address}:{}),
      ...(area?{area}:{}),
      ...(productName?{lastProduct:productName}:{}),
      orderCount:firebase.firestore.FieldValue.increment(1),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
  }catch(e){}
}

function renderEmpOrderCart(){
  const wrap=document.getElementById('empCartItems');
  if(!wrap)return;
  if(!_empOrderCart.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;border:1.5px dashed #e5e7eb;border-radius:9px;">أضف منتجاً للطلب</div>';
    const t=document.getElementById('emp_total');
    if(t)t.value='0.00';
    updateEmpNet();
    return;
  }
  wrap.innerHTML=_empOrderCart.map((item,i)=>{
    const prod=(_empSharedProducts||[]).find(p=>p.id===item.id)||{};
    const colors=Array.isArray(prod.colors)?prod.colors:[];
    const priceOpts=_productPriceChoices(prod);
    const req=!!prod.requiresWriting;
    const showExtras=colors.length||req||priceOpts.length;
    const priceOptsHtml=priceOpts.length?`<div style="margin-top:8px;"><div style="font-size:0.74rem;font-weight:700;color:#854d0e;margin-bottom:5px;">💵 السعر</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${priceOpts.map(o=>{const active=Math.abs((item.price||0)-(o.price||0))<0.001;const sl=(o.label||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");return `<button onclick="updateCartItemPrice(${i},${(o.price||0)},'${sl}')" style="padding:4px 12px;border:1.5px solid ${active?'#854d0e':'#fde047'};border-radius:20px;background:${active?'#854d0e':'#fef9c3'};color:${active?'#fff':'#854d0e'};font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;">${o.label} — ${(o.price||0).toFixed(2)}</button>`;}).join('')}</div></div>`:'';
    const colorHtml=colors.length?`<div style="margin-top:8px;"><div style="font-size:0.74rem;font-weight:700;color:#374151;margin-bottom:5px;">🎨 اللون</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${colors.map(c=>`<button onclick="updateCartItemColor(${i},'${c.replace(/'/g,"\\'")}')" style="padding:4px 12px;border:1.5px solid ${item.color===c?'#1a3a2a':'#cbd5e1'};border-radius:20px;background:${item.color===c?'#1a3a2a':'#fff'};color:${item.color===c?'#fff':'#374151'};font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">${c}</button>`).join('')}</div></div>`:'';
    const writingHtml=`<div style="margin-top:8px;"><div style="font-size:0.74rem;font-weight:700;color:${req?'#92400e':'#374151'};margin-bottom:4px;">✍️ الكتابة${req?' <span style="color:#dc2626;font-weight:800;">* إجباري</span>':' <span style="font-weight:400;color:#9ca3af;">(اختياري)</span>'}</div><input type="text" id="cart_writing_${i}" value="${(item.writing||'').replace(/"/g,'&quot;')}" placeholder="${req?'اكتب النص هنا... (إجباري)':'اسم الشخص، تاريخ...'}" oninput="updateCartItemWriting(${i},this.value)" style="width:100%;padding:7px 10px;border:1.5px solid ${req&&!item.writing?'#f59e0b':'#e5e7eb'};border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.82rem;outline:none;box-sizing:border-box;background:${req?'#fffbeb':'#fff'};"></div>`;
    return `<div style="padding:9px 10px;background:#f8fafc;border-radius:9px;margin-bottom:6px;border:1px solid #e5e7eb;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.84rem;color:#1a3a2a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</div>
          <div style="font-size:0.75rem;color:#6b7280;">${item.price.toFixed(2)} د.أ / وحدة</div>
        </div>
        <div style="display:flex;align-items:center;gap:3px;flex-shrink:0;">
          <button onclick="changeEmpQty(${i},-1)" style="width:26px;height:26px;border:1.5px solid #e5e7eb;border-radius:7px;background:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;">−</button>
          <span style="min-width:24px;text-align:center;font-weight:700;font-size:0.88rem;">${item.qty}</span>
          <button onclick="changeEmpQty(${i},1)" style="width:26px;height:26px;border:1.5px solid #e5e7eb;border-radius:7px;background:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;">+</button>
        </div>
        <div style="font-weight:800;color:#166534;font-size:0.85rem;min-width:48px;text-align:left;">${(item.price*item.qty).toFixed(2)}</div>
        <button onclick="removeFromEmpCart(${i})" style="width:22px;height:22px;background:#fee2e2;color:#dc2626;border:none;border-radius:5px;cursor:pointer;font-size:0.75rem;flex-shrink:0;">✕</button>
      </div>
      ${showExtras?priceOptsHtml+colorHtml+writingHtml:''}
    </div>`;
  }).join('');
  const t=document.getElementById('emp_total');
  if(t)t.value=calcEmpOrderTotal().toFixed(2);
  updateEmpNet();
}

function setEmpDeliveryFee(val,btn){
  const customEl=document.getElementById('emp_delivery_custom');
  document.querySelectorAll('#empDeliveryBtns button').forEach(b=>{
    b.style.background='#fff';b.style.color='#374151';b.style.borderColor='#e5e7eb';
  });
  if(btn){btn.style.background='#1a3a2a';btn.style.color='#fff';btn.style.borderColor='#1a3a2a';}
  if(val===-1){
    if(customEl){customEl.style.display='block';customEl.focus();}
    _empDeliveryFee=parseFloat(customEl?.value||0)||0;
  }else{
    if(customEl)customEl.style.display='none';
    _empDeliveryFee=val;
  }
  updateEmpNet();
}

function updateEmpNet(){
  const customEl=document.getElementById('emp_delivery_custom');
  if(customEl&&customEl.style.display!=='none'){
    _empDeliveryFee=parseFloat(customEl.value)||0;
  }
  const dlv=_empDeliveryFee;
  const userTotal=parseFloat(document.getElementById('emp_total')?.value)||0;
  const net=userTotal+dlv;
  const netEl=document.getElementById('empNetLabel');
  const dlvRow=document.getElementById('empDeliveryRow');
  const dlvLbl=document.getElementById('empDeliveryLabel');
  if(dlvRow)dlvRow.style.display=dlv>0?'flex':'none';
  if(dlvLbl)dlvLbl.textContent=dlv.toFixed(2)+' د.أ';
  if(netEl)netEl.textContent=net.toFixed(2)+' د.أ';
}
function closeEmpPanel(){
  document.getElementById('empPanel').style.display='none';
  document.body.style.overflow='';
  if(_empTodayUnsub){_empTodayUnsub();_empTodayUnsub=null;}
  if(_empDlvTodayUnsub){_empDlvTodayUnsub();_empDlvTodayUnsub=null;}
}
function logoutEmp(){
  _clearEmpSession();
  _empCurrentUser=null;
  closeEmpPanel();
}

async function doEmpLogin(){
  const username=document.getElementById('empUser').value.trim();
  const password=document.getElementById('empPass').value;
  const errEl=document.getElementById('empLoginErr');
  if(!username||!password){errEl.textContent='أدخل اسم المستخدم وكلمة المرور';return;}
  errEl.textContent='⏳ جاري التحقق...';
  try{
    const snap=await db.collection('employee_workers').where('username','==',username).limit(1).get();
    if(snap.empty){errEl.textContent='❌ اسم المستخدم غير موجود';return;}
    const doc=snap.docs[0];
    const data=doc.data();
    if(data.password!==password){errEl.textContent='❌ كلمة المرور غلط';return;}
    _empCurrentUser={id:doc.id,username:data.username,displayName:data.name||data.username,defaultPage:data.defaultPage||'',permissions:data.permissions||{}};
    _saveEmpSession(_empCurrentUser);
    closeEmpLogin();
    openEmpPanel();
  }catch(e){errEl.textContent='❌ خطأ: '+e.message;}
}

async function onEmpImageChange(input){
  const files=[...input.files];
  if(!files.length)return;
  const MAX=6;
  const remaining=MAX-_empCurrentImages.length;
  if(remaining<=0){toast('⚠️ الحد الأقصى ٦ صور');input.value='';return;}
  const toProcess=files.slice(0,remaining);
  if(files.length>remaining)toast(`⚠️ تم إضافة ${remaining} صورة فقط (الحد الأقصى ${MAX})`);
  for(const file of toProcess){
    await new Promise(res=>{
      const reader=new FileReader();
      reader.onload=async e=>{
        const compressed=await _compressImage(e.target.result);
        _empCurrentImages.push(compressed);
        res();
      };
      reader.readAsDataURL(file);
    });
  }
  input.value='';
  renderEmpImagePreview();
}
function renderEmpImagePreview(){
  const wrap=document.getElementById('emp_img_preview');
  if(!wrap)return;
  if(!_empCurrentImages.length){wrap.innerHTML='';return;}
  wrap.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px;">
    ${_empCurrentImages.map((src,i)=>`<div style="position:relative;">
      <img src="${src}" onclick="openEmpOrderImage('${src}')" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1.5px solid #e5e7eb;cursor:zoom-in;">
      <button onclick="clearEmpImage(${i})" style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:0.65rem;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>
    </div>`).join('')}
  </div>
  <div style="font-size:0.68rem;color:#9ca3af;text-align:center;margin-top:4px;">${_empCurrentImages.length}/6 صور</div>`;
}
function clearEmpImage(idx){
  if(idx===undefined)_empCurrentImages=[];
  else _empCurrentImages.splice(idx,1);
  renderEmpImagePreview();
  const c=document.getElementById('emp_img_camera');
  const f=document.getElementById('emp_img_file');
  if(c)c.value='';if(f)f.value='';
}

async function submitEmpOrder(){
  if(!_empCurrentUser){toast('⚠️ يجب تسجيل الدخول أولاً');return;}
  const pageSel=document.getElementById('emp_page');
  const pageId=pageSel.value;
  const pageName=pageSel.selectedOptions[0]?.text||'';
  const phone=document.getElementById('emp_phone').value.trim();
  const customerName=(document.getElementById('emp_customer_name')?.value||'').trim();
  const address=document.getElementById('emp_address').value.trim();
  const notes=document.getElementById('emp_notes').value.trim();
  const orderNumInput=document.getElementById('emp_order_num').value.trim();
  const areaInput=(document.getElementById('emp_area')?.value||'').trim();
  if(!pageId){toast('⚠️ اختار الصفحة');return;}
  if(!_empOrderCart.length){toast('⚠️ أضف منتجاً للطلب أولاً');return;}
  const missingWriting=_empOrderCart.find(item=>{
    const prod=(_empSharedProducts||[]).find(p=>p.id===item.id);
    return prod?.requiresWriting&&!(item.writing||'').trim();
  });
  if(missingWriting){toast(`⚠️ "${missingWriting.name}" يتطلب كتابة إجبارية`);return;}
  if(!phone){toast('⚠️ أدخل رقم الزبون');return;}
  if(!address){toast('⚠️ أدخل العنوان');return;}
  if(!areaInput){toast('⚠️ اختار المحافظة');return;}
  const prodsTotal=parseFloat(document.getElementById('emp_total')?.value)||0;
  const deliveryFee=_empDeliveryFee||0;
  const totalPrice=prodsTotal+deliveryFee;
  const netPrice=prodsTotal+deliveryFee;
  const btn=document.querySelector('#empPanel button[onclick="submitEmpOrder()"]');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الحفظ...';}
  try{
    // ضغط الصور لتفادي تجاوز حد حجم وثيقة Firestore (1MB)
    _empCurrentImages=await _compressImagesForDoc(_empCurrentImages);
    await db.collection('employee_orders').add({
      workerId:_empCurrentUser.id,
      workerName:_empCurrentUser.displayName||_empCurrentUser.username,
      pageId,pageName,
      products:_empOrderCart.map(i=>{const pl=_resolveItemPriceLabel(i);return {id:i.id,name:i.name,price:i.price,qty:i.qty,...(i.color?{color:i.color}:{}),...(i.writing?{writing:i.writing}:{}),...(pl?{priceLabel:pl}:{})};}),
      customerPhone:phone,
      ...(customerName?{customerName}:{}),
      address,notes,
      ...(areaInput?{area:areaInput}:{}),
      ...(orderNumInput?{orderNum:orderNumInput}:{}),
      ...(_empCurrentImages.length?{imageDataUrls:_empCurrentImages,imageDataUrl:_empCurrentImages[0]}:{}),
      ...(_empCurrentImages.length&&_empOrderCart.some(i=>(i.name||'').includes('برواز'))?{isFrameOrder:true}:{}),
      status:_empReadyToDeliver?'prepared':'pending',
      ...(_empOrderUrgent?{urgent:true}:{}),
      totalPrice,deliveryFee,netPrice,
      date:jordanDateStr(),
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),
      editHistory:[]
    });
    _empUpsertCustomer(phone,customerName,address,areaInput,_empOrderCart[0]?.name||'');
    toast(_empOrderUrgent?'🔥 تم تسجيل الطلب المستعجل':'✅ تم تسجيل الطلب بنجاح');
    _empOrderCart=[];_empDeliveryFee=2;_empCurrentImages=[];
    resetEmpUrgentBtn();_resetEmpReadyBtn();
    renderEmpOrderCart();
    document.getElementById('emp_phone').value='';
    const nameEl=document.getElementById('emp_customer_name');if(nameEl)nameEl.value='';
    const crmB=document.getElementById('emp_crm_banner');if(crmB)crmB.style.display='none';
    const pasteEl=document.getElementById('emp_smart_paste');if(pasteEl)pasteEl.value='';
    document.getElementById('emp_address').value='';
    document.getElementById('emp_notes').value='';
    document.getElementById('emp_order_num').value='';
    const areaEl=document.getElementById('emp_area');if(areaEl)areaEl.value='';
    const areaHint=document.getElementById('emp_area_fee_hint');if(areaHint)areaHint.style.display='none';
    _selectedEmpProductId=null;
    _empProductSearchQuery='';
    const searchInp=document.getElementById('emp_product_search');
    if(searchInp) searchInp.value='';
    const bar=document.getElementById('emp_product_selected_bar');
    const noBar=document.getElementById('emp_no_product_bar');
    if(bar) bar.style.display='none';
    if(noBar) noBar.style.display='flex';
    renderEmpProductPicker();
    clearEmpImage();
    loadEmpTodayOrders();
  }catch(e){toast('❌ خطأ: '+e.message);}
  if(btn){btn.disabled=false;btn.textContent='✅ تسجيل الطلب';}
}

function loadEmpTodayOrders(){
  const wrap=document.getElementById('empOrdersList');
  if(!wrap||!_empCurrentUser)return;
  if(_empTodayUnsub){_empTodayUnsub();_empTodayUnsub=null;}
  wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;">⏳</div>';
  _empTodayUnsub=db.collection('employee_orders')
    .where('workerId','==',_empCurrentUser.id)
    .limit(150)
    .onSnapshot(snap=>{
      const orders=snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      if(!orders.length){wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:20px;">لا يوجد طلبات بعد</div>';return;}
      wrap.innerHTML=orders.map(o=>{
        const st=_empSt(o.status);
        const prods=o.products||[{name:o.productName||'?',price:o.price||0,qty:1}];
        const prodsTotal=prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0);
        const dlv=o.deliveryFee||0;
        const excess=Math.max(0,dlv-2);
        const adjProds=prodsTotal-excess;
        const final=o.netPrice!=null?o.netPrice:adjProds+dlv;
        const orderLabel=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
        const canEdit=!['delivered','cancelled','returned','refused'].includes(o.status);
        const canCancel=!['cancelled','returned','refused','delivered'].includes(o.status);
        return `<div style="background:#fff;border:1.5px solid ${st.border};border-radius:14px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          <!-- Header bar -->
          <div style="background:${st.bg};padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${st.border};">
            <span style="font-size:0.78rem;font-weight:700;color:${st.color};">${st.label}</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <span style="font-size:0.68rem;color:#9ca3af;">${o.date||''}</span>
              <span style="font-size:0.72rem;color:#9ca3af;">${orderLabel}</span>
            </div>
          </div>
          ${o.needsReview?`<div style="background:#fff7ed;padding:6px 12px;font-size:0.75rem;color:#c2410c;font-weight:700;border-bottom:1px solid #fed7aa;">✏️ تعديل من الموظف – يحتاج مراجعة</div>`:''}
          <!-- Body -->
          <div style="padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-weight:800;color:#1a3a2a;font-size:0.9rem;">📄 ${o.pageName}</div>
                <div style="font-size:0.76rem;color:#6b7280;margin-top:2px;">📞 ${o.customerPhone}</div>
              </div>
              <div style="text-align:left;">
                <div style="font-weight:900;color:#166534;font-size:1rem;">${final.toFixed(2)} <span style="font-size:0.7rem;">د.أ</span></div>
                ${dlv>0?`<div style="font-size:0.68rem;color:#9ca3af;">منتجات ${adjProds.toFixed(2)} + توصيل ${dlv.toFixed(2)}</div>`:''}
              </div>
            </div>
            <!-- Products -->
            <div style="background:#f9fafb;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
              ${prods.map(p=>`<div style="display:flex;justify-content:space-between;font-size:0.8rem;padding:2px 0;">
                <span style="color:#374151;">• ${p.name} <span style="color:#9ca3af;">× ${p.qty||1}</span></span>
                <span style="font-weight:700;color:#1a3a2a;">${(p.price*(p.qty||1)).toFixed(2)} د.أ</span>
              </div>`).join('')}
            </div>
            <!-- Address + notes -->
            <div style="font-size:0.76rem;color:#6b7280;margin-bottom:8px;">📍 ${o.address}${o.notes?` <span style="color:#9ca3af;">· ${o.notes}</span>`:''}</div>
            <!-- Photo -->
            ${o.imageDataUrl?`<img src="${o.imageDataUrl}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:8px;" onclick="this.style.maxHeight=this.style.maxHeight==='none'?'160px':'none'>"` :''}
            <!-- Edit history -->
            ${o.editHistory?.length?`<div style="font-size:0.7rem;color:#f97316;margin-bottom:6px;">✏️ تم التعديل ${o.editHistory.length} مرة</div>`:''}
            <!-- Action buttons -->
            ${['pending','preparing'].includes(o.status)?`<div style="margin-bottom:8px;"><button onclick="updateEmpOrderStatus('${o.id}','prepared')" style="width:100%;padding:10px;background:#3b82f6;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:800;cursor:pointer;">✅ تم التجهيز</button></div>`:''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${canEdit?`<button onclick="openEmpOrderEdit('${o.id}')" style="flex:1;padding:7px 10px;background:#fefce8;color:#854d0e;border:1.5px solid #fde68a;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;">✏️ تعديل</button>`:''}
              ${canCancel?`<button onclick="cancelEmpOrder('${o.id}')" style="padding:7px 14px;background:#fee2e2;color:#dc2626;border:1.5px solid #fecaca;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;">🚫 ملغي</button>`:''}
            </div>
          </div>
        </div>`;
      }).join('');
    },e=>{wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ خطأ في التحميل</div>';});
}

async function cancelEmpOrder(id){
  if(!confirm('إلغاء هذا الطلب؟'))return;
  try{
    const docRef=db.collection('employee_orders').doc(id);
    const snap=await docRef.get();
    const prev=snap.data();
    const by=_empCurrentUser?.displayName||_empCurrentUser?.username||'موظف';
    const editEntry={by,at:jordanDisplayDate(),note:`${_empSt(prev.status).label} ← ${_empSt('cancelled').label}`};
    await docRef.update({
      status:'cancelled',
      editHistory:[...(prev.editHistory||[]),editEntry],
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('🚫 تم إلغاء الطلب');
  }catch(e){toast('❌ '+e.message);}
}

// ===== DELIVERY EMPLOYEE PANEL =====
let _empDlvStoresList=[];
let _empDlvProductsList=[];
let _empDlvCart=[];
let _empDlvCurrentImage=null;
let _empDlvTodayUnsub=null;
let _todaySalesUnsub=null;

async function initEmpDeliveryPanel(){
  const dateEl=document.getElementById('empDlv_date');
  if(dateEl&&!dateEl.value) dateEl.value=jordanDateStr();
  if(!_empDlvStoresList.length){
    try{const s=await db.collection('operator_stores').orderBy('name').get();_empDlvStoresList=s.docs.map(d=>({id:d.id,...d.data()}));}
    catch(e){try{const s=await db.collection('operator_stores').get();_empDlvStoresList=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e2){_empDlvStoresList=[];}}
  }
  if(!_empDlvProductsList.length){
    try{const s=await db.collection('operator_products').orderBy('name').get();_empDlvProductsList=s.docs.map(d=>({id:d.id,...d.data()}));}
    catch(e){try{const s=await db.collection('operator_products').get();_empDlvProductsList=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e2){_empDlvProductsList=[];}}
  }
  const storeSel=document.getElementById('empDlv_store');
  if(storeSel) storeSel.innerHTML='<option value="">— اختار المتجر —</option>'+
    _empDlvStoresList.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
  _fillEmpDlvProdOptions('');
  renderEmpDlvCart();
  loadEmpDlvTodayList();
}

function _fillEmpDlvProdOptions(storeId){
  const prodSel=document.getElementById('empDlv_prod');
  if(!prodSel)return;
  prodSel.innerHTML='<option value="">— المنتج —</option>'+
    _empDlvProductsList.map(p=>{
      const price=storeId&&p.storePrices?.[storeId]?p.storePrices[storeId]:(p.defaultSellPrice||0);
      return `<option value="${p.id}" data-name="${p.name}" data-price="${price}" data-raw="${p.rawMaterialCost||0}" data-tree="${p.treeCost||0}" data-machine="${p.machineWorkerWage||0}" data-assembly="${p.assemblyWorkerWage||0}">${p.name} — ${parseFloat(price).toFixed(2)} د.أ</option>`;
    }).join('');
  const info=document.getElementById('empDlv_price_info');
  if(info)info.textContent='';
}

function onEmpDlvStoreChange(){
  const sel=document.getElementById('empDlv_store');
  _fillEmpDlvProdOptions(sel?.value||'');
  renderEmpDlvCart();
}

function addEmpDlvItem(){
  const storeSel=document.getElementById('empDlv_store');
  const prodSel=document.getElementById('empDlv_prod');
  const qtyEl=document.getElementById('empDlv_qty');
  if(!storeSel?.value){toast('⚠️ اختار المتجر أولاً');return;}
  const opt=prodSel?.selectedOptions[0];
  if(!opt||!opt.value){toast('⚠️ اختار منتجاً');return;}
  const qty=parseInt(qtyEl?.value)||1;
  const price=parseFloat(opt.dataset.price||0);
  const existing=_empDlvCart.find(i=>i.productId===opt.value);
  if(existing){existing.qty+=qty;}
  else{_empDlvCart.push({productId:opt.value,productName:opt.dataset.name,qty,sellPrice:price,rawMaterialCost:parseFloat(opt.dataset.raw||0),treeCost:parseFloat(opt.dataset.tree||0),machineWorkerWage:parseFloat(opt.dataset.machine||0),assemblyWorkerWage:parseFloat(opt.dataset.assembly||0)});}
  if(qtyEl)qtyEl.value=1;
  if(prodSel)prodSel.value='';
  const info=document.getElementById('empDlv_price_info');
  if(info)info.textContent='';
  renderEmpDlvCart();
}

function removeEmpDlvItem(i){_empDlvCart.splice(i,1);renderEmpDlvCart();}
function changeEmpDlvQty(i,d){_empDlvCart[i].qty=Math.max(1,(_empDlvCart[i].qty||1)+d);renderEmpDlvCart();}

function renderEmpDlvCart(){
  const list=document.getElementById('empDlv_cart_list');
  const totalWrap=document.getElementById('empDlv_cart_total');
  const totalVal=document.getElementById('empDlv_total_val');
  if(!list)return;
  if(!_empDlvCart.length){
    list.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:12px;">أضف منتجاً ➕</div>';
    if(totalWrap)totalWrap.style.display='none';return;
  }
  const total=_empDlvCart.reduce((s,i)=>(i.sellPrice||0)*(i.qty||1)+s,0);
  list.innerHTML=_empDlvCart.map((item,idx)=>`
    <div style="display:flex;align-items:center;gap:6px;padding:8px 4px;border-bottom:1px dashed #e5e7eb;">
      <div style="flex:1;font-weight:700;color:#1a3a2a;font-size:0.82rem;">${item.productName}</div>
      <div style="display:flex;align-items:center;border:1.5px solid #e5e7eb;border-radius:7px;overflow:hidden;flex-shrink:0;">
        <button onclick="changeEmpDlvQty(${idx},-1)" style="padding:4px 10px;border:none;background:#f3f4f6;cursor:pointer;font-size:0.9rem;font-weight:700;">−</button>
        <span style="padding:4px 8px;font-weight:800;font-size:0.85rem;min-width:24px;text-align:center;">${item.qty}</span>
        <button onclick="changeEmpDlvQty(${idx},1)" style="padding:4px 10px;border:none;background:#f3f4f6;cursor:pointer;font-size:0.9rem;font-weight:700;">+</button>
      </div>
      <span style="font-weight:700;color:#166534;font-size:0.82rem;min-width:50px;text-align:left;">${((item.sellPrice||0)*(item.qty||1)).toFixed(2)} د.أ</span>
      <button onclick="removeEmpDlvItem(${idx})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 8px;font-size:0.75rem;cursor:pointer;">✕</button>
    </div>`).join('');
  if(totalWrap)totalWrap.style.display='flex';
  if(totalVal)totalVal.textContent=total.toFixed(2)+' د.أ';
}

async function onEmpDlvImageChange(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    _empDlvCurrentImage=await _compressImage(e.target.result);
    renderEmpDlvImagePreview();
  };
  reader.readAsDataURL(file);
}

function renderEmpDlvImagePreview(){
  const wrap=document.getElementById('empDlv_img_preview');if(!wrap)return;
  if(!_empDlvCurrentImage){wrap.innerHTML='';return;}
  wrap.innerHTML=`<div style="position:relative;display:inline-block;width:100%;">
    <img src="${_empDlvCurrentImage}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;border:1.5px solid #e5e7eb;">
    <button onclick="clearEmpDlvImage()" style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8rem;">✕</button>
  </div>`;
}

function clearEmpDlvImage(){
  _empDlvCurrentImage=null;renderEmpDlvImagePreview();
  const c=document.getElementById('empDlv_img_camera');const f=document.getElementById('empDlv_img_file');
  if(c)c.value='';if(f)f.value='';
}

async function submitEmpDelivery(){
  const storeSel=document.getElementById('empDlv_store');
  if(!storeSel?.value){toast('⚠️ اختار المتجر');return;}
  if(!_empDlvCart.length){toast('⚠️ أضف منتجاً على الأقل');return;}
  const storeId=storeSel.value;
  const storeName=storeSel.selectedOptions[0]?.text||'';
  const date=document.getElementById('empDlv_date')?.value||jordanDateStr();
  const notes=document.getElementById('empDlv_notes')?.value.trim()||'';
  const btn=document.querySelector('#empDeliverySection button[onclick="submitEmpDelivery()"]');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الحفظ...';}
  try{
    const batch=db.batch();
    _empDlvCart.forEach(item=>{
      const ref=db.collection('operator_sales').doc();
      batch.set(ref,{
        storeId,storeName,
        productId:item.productId,productName:item.productName,
        qty:item.qty,sellPrice:item.sellPrice,
        rawMaterialCost:item.rawMaterialCost||0,
        treeCost:item.treeCost||0,
        machineWorkerWage:item.machineWorkerWage||0,
        assemblyWorkerWage:item.assemblyWorkerWage||0,
        notes,date,
        imageDataUrl:_empDlvCurrentImage||null,
        addedBy:_empCurrentUser.displayName||_empCurrentUser.username,
        delivered:false,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    toast('✅ تم التسليم للمبيعات');
    _empDlvCart=[];_empDlvCurrentImage=null;
    if(storeSel)storeSel.value='';
    const notesEl=document.getElementById('empDlv_notes');if(notesEl)notesEl.value='';
    renderEmpDlvCart();renderEmpDlvImagePreview();
    clearEmpDlvImage();
    loadEmpDlvTodayList();
  }catch(e){toast('❌ '+e.message);}
  if(btn){btn.disabled=false;btn.textContent='✅ تسليم للمبيعات';}
}

function loadEmpDlvTodayList(){
  const wrap=document.getElementById('empDlvTodayList');
  if(!wrap||!_empCurrentUser)return;
  const today=jordanDateStr();
  if(_empDlvTodayUnsub){_empDlvTodayUnsub();_empDlvTodayUnsub=null;}
  _empDlvTodayUnsub=db.collection('operator_sales').where('date','==',today).where('addedBy','==',_empCurrentUser.displayName||_empCurrentUser.username)
    .onSnapshot(snap=>{
      const sales=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      if(!sales.length){wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:20px;">لا يوجد تسليمات اليوم</div>';return;}
      const grouped={};
      sales.forEach(s=>{const k=s.storeId+'_'+s.date;if(!grouped[k])grouped[k]={storeName:s.storeName,date:s.date,items:[],imageDataUrl:s.imageDataUrl};grouped[k].items.push(s);});
      wrap.innerHTML=Object.values(grouped).map(g=>{
        const total=g.items.reduce((s,i)=>(i.sellPrice||0)*(i.qty||1)+s,0);
        return `<div style="background:#fff;border:1.5px solid #fcd34d;border-radius:12px;padding:12px 14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-weight:700;color:#1a3a2a;font-size:0.88rem;">🏪 ${g.storeName}</div>
            <span style="font-weight:900;color:#92400e;">${total.toFixed(2)} د.أ</span>
          </div>
          <div style="font-size:0.75rem;color:#6b7280;margin-bottom:4px;">${g.items.map(i=>`${i.productName} × ${i.qty}`).join(' · ')}</div>
          ${g.imageDataUrl?`<img src="${g.imageDataUrl}" style="width:100%;max-height:80px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;margin-top:6px;">`:'' }
        </div>`;
      }).join('');
    },()=>{});
}

// ===== EMPLOYEE WORKERS ADMIN =====
async function loadEmpWorkers(){
  const wrap=document.getElementById('empWorkersList');
  if(!wrap)return;
  wrap.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">⏳</div>';
  try{
    const snap=await db.collection('employee_workers').orderBy('username').get();
    const workers=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!workers.length){wrap.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد موظفين بعد</div>';return;}
    wrap.innerHTML=workers.map(w=>{
      const perms=w.permissions||{};
      const tags=[];
      if(perms.canAddOrders!==false)tags.push('📝 إضافة');
      if(perms.canEditOrders!==false)tags.push('✏️ تعديل');
      if(perms.isOperator)tags.push('🔧 مشغل');
      if(perms.isDelivery)tags.push('🚀 تسليم');
      if(perms.isQRViewer)tags.push('📷 QR فقط');
      if(perms.canViewAll)tags.push('👁 عرض الكل');
      if(perms.canPrint!==false)tags.push('🖨 طباعة');
      return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">
          <div>
            <div style="font-weight:700;color:#1a3a2a;font-size:0.9rem;">👤 ${w.name||w.username}</div>
            <div style="font-size:0.75rem;color:#6b7280;">@${w.username} &nbsp;·&nbsp; 🔑 ${w.password} ${w.defaultPage?'&nbsp;·&nbsp; 📄 '+w.defaultPage:''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button onclick="editEmpWorker('${w.id}')" style="background:#fefce8;color:#854d0e;border:1.5px solid #fde68a;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:0.8rem;">✏️</button>
            <button onclick="deleteEmpWorker('${w.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:0.8rem;">🗑</button>
          </div>
        </div>
        ${tags.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;">${tags.map(t=>`<span style="font-size:0.68rem;padding:3px 8px;background:#f0fdf4;color:#166534;border-radius:20px;border:1px solid #bbf7d0;">${t}</span>`).join('')}</div>`:''}
      </div>`;
    }).join('');
  }catch(e){wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';}
}

async function addEmpWorker(){
  const name=document.getElementById('newWorkerName').value.trim();
  const username=document.getElementById('newWorkerUsername').value.trim();
  const password=document.getElementById('newWorkerPassword').value.trim();
  const pageSel=document.getElementById('newWorkerPage');
  const defaultPage=pageSel?.value||'';
  if(!name||!username||!password){toast('⚠️ أدخل الاسم الكامل واسم المستخدم وكلمة المرور');return;}
  const permissions={
    canAddOrders:document.getElementById('perm_addOrders')?.checked!==false,
    canEditOrders:document.getElementById('perm_editOrders')?.checked!==false,
    isOperator:document.getElementById('perm_operator')?.checked||false,
    canViewAll:document.getElementById('perm_viewAll')?.checked||false,
    canPrint:document.getElementById('perm_print')?.checked!==false,
    isDelivery:document.getElementById('perm_isDelivery')?.checked||false,
    isQRViewer:document.getElementById('perm_isQRViewer')?.checked||false,
  };
  try{
    const exists=await db.collection('employee_workers').where('username','==',username).limit(1).get();
    if(!exists.empty){toast('⚠️ اسم المستخدم موجود مسبقاً');return;}
    await db.collection('employee_workers').add({name,username,password,defaultPage,permissions,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    document.getElementById('newWorkerName').value='';
    document.getElementById('newWorkerUsername').value='';
    document.getElementById('newWorkerPassword').value='';
    if(pageSel)pageSel.value='';
    toast('✅ تم إضافة الموظف');
    loadEmpWorkers();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteEmpWorker(id){
  if(!confirm('حذف هذا الموظف نهائياً؟'))return;
  try{await db.collection('employee_workers').doc(id).delete();toast('🗑 تم الحذف');loadEmpWorkers();}
  catch(e){toast('❌ '+e.message);}
}

// ===== PAGES & SHARED PRODUCTS =====
async function _loadEmpPagesForAdmin(){
  try{const snap=await db.collection('employee_pages').orderBy('name').get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
  catch(e){try{const snap=await db.collection('employee_pages').get();return snap.docs.map(d=>({id:d.id,...d.data()}));}catch(e2){return [];}}
}

async function _refreshWorkerPageDropdown(){
  const pages=await _loadEmpPagesForAdmin();
  const sel=document.getElementById('newWorkerPage');
  if(!sel)return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— الصفحة الافتراضية (اختياري) —</option>'+pages.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(cur)sel.value=cur;
}

async function loadEmpPagesAdmin(){
  const wrap=document.getElementById('empPagesAdminWrap');
  if(!wrap)return;
  const pages=await _loadEmpPagesForAdmin();
  await _refreshWorkerPageDropdown();
  if(!pages.length){wrap.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:8px;">لا يوجد صفحات بعد</div>';return;}
  wrap.innerHTML=pages.map(pg=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:${pg.hiddenFromEmployee?'#f9fafb':'#f8fafc'};border-radius:9px;margin-bottom:6px;border:1px solid #e5e7eb;opacity:${pg.hiddenFromEmployee?'0.7':'1'};">
      <span style="font-weight:600;color:${pg.hiddenFromEmployee?'#9ca3af':'#1a3a2a'};font-size:0.88rem;">📄 ${pg.name}${pg.hiddenFromEmployee?' <span style="font-size:0.68rem;color:#9ca3af;font-weight:400;">(مخفية عن الموظف)</span>':''}</span>
      <div style="display:flex;gap:5px;">
        <button onclick="toggleEmpPageVisibility('${pg.id}',${!!pg.hiddenFromEmployee})" style="background:${pg.hiddenFromEmployee?'#dcfce7':'#f0f9ff'};color:${pg.hiddenFromEmployee?'#166534':'#0369a1'};border:1px solid ${pg.hiddenFromEmployee?'#86efac':'#bae6fd'};border-radius:7px;padding:5px 10px;cursor:pointer;font-size:0.78rem;" title="${pg.hiddenFromEmployee?'إظهار للموظف':'إخفاء عن الموظف'}">${pg.hiddenFromEmployee?'👁️ إظهار':'🙈 إخفاء'}</button>
        <button onclick="editEmpPage('${pg.id}','${pg.name.replace(/'/g,"\\'")}')" style="background:#fefce8;color:#854d0e;border:1.5px solid #fde68a;border-radius:7px;padding:5px 10px;cursor:pointer;font-size:0.78rem;">✏️</button>
        <button onclick="deleteEmpPage('${pg.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:7px;padding:5px 10px;cursor:pointer;font-size:0.78rem;">🗑</button>
      </div>
    </div>`).join('');
  loadEmpProductsAdmin();
}

async function addEmpPage(){
  const name=document.getElementById('newEmpPageName').value.trim();
  if(!name){toast('⚠️ أدخل اسم الصفحة');return;}
  try{
    const exists=await db.collection('employee_pages').where('name','==',name).limit(1).get();
    if(!exists.empty){toast('⚠️ الصفحة موجودة مسبقاً');return;}
    await db.collection('employee_pages').add({name,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    document.getElementById('newEmpPageName').value='';
    toast('✅ تم إضافة الصفحة');
    loadEmpPagesAdmin();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteEmpPage(id){
  if(!confirm('حذف هذه الصفحة؟'))return;
  try{await db.collection('employee_pages').doc(id).delete();toast('🗑 تم الحذف');loadEmpPagesAdmin();}
  catch(e){toast('❌ '+e.message);}
}

async function toggleEmpPageVisibility(id, currentlyHidden){
  try{
    if(currentlyHidden){
      await db.collection('employee_pages').doc(id).update({hiddenFromEmployee:firebase.firestore.FieldValue.delete()});
      toast('👁️ الصفحة ظاهرة للموظف الآن');
    } else {
      await db.collection('employee_pages').doc(id).update({hiddenFromEmployee:true});
      toast('🙈 الصفحة مخفية عن الموظف');
    }
    loadEmpPagesAdmin();
  }catch(e){toast('❌ '+e.message);}
}

async function loadEmpProductsAdmin(){
  const wrap=document.getElementById('empProductsAdminWrap');
  if(!wrap)return;
  wrap.innerHTML='<div style="color:#9ca3af;font-size:0.78rem;padding:6px;">⏳...</div>';
  try{
    let snap;
    try{snap=await db.collection('operator_products').orderBy('name').get();}
    catch(e){snap=await db.collection('operator_products').get();}
    const prods=snap.docs.map(d=>({id:d.id,...d.data()}));
    _empSharedProducts=prods;
    if(!prods.length){wrap.innerHTML='<div style="color:#9ca3af;font-size:0.78rem;padding:8px;">لا يوجد منتجات — أضفها من حساب المشغل ← المنتجات</div>';return;}
    wrap.innerHTML=prods.map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:8px;margin-bottom:6px;border:1px solid #e5e7eb;">
        <span style="font-weight:600;color:#1a3a2a;font-size:0.88rem;">📦 ${p.name}</span>
        <span style="font-weight:800;color:#92400e;font-size:0.88rem;">${parseFloat(p.rawMaterialCost||0).toFixed(2)} د.أ تكلفة</span>
      </div>`).join('');
  }catch(e){wrap.innerHTML='<div style="color:#dc2626;font-size:0.78rem;">❌ '+e.message+'</div>';}
}

async function addEmpProduct(){
  const name=document.getElementById('newEmpProdName').value.trim();
  const price=parseFloat(document.getElementById('newEmpProdPrice').value)||0;
  if(!name){toast('⚠️ أدخل اسم المنتج');return;}
  try{
    await db.collection('employee_products').add({productName:name,price,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    document.getElementById('newEmpProdName').value='';
    document.getElementById('newEmpProdPrice').value='';
    _empSharedProducts=null;
    toast('✅ تم إضافة المنتج');
    loadEmpProductsAdmin();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteEmpProduct(id){
  if(!confirm('حذف هذا المنتج؟'))return;
  try{await db.collection('employee_products').doc(id).delete();_empSharedProducts=null;toast('🗑 تم الحذف');loadEmpProductsAdmin();}
  catch(e){toast('❌ '+e.message);}
}

// ===== EDIT WORKERS / PAGES / PRODUCTS =====
async function editEmpWorker(id){
  const snap=await db.collection('employee_workers').doc(id).get();
  if(!snap.exists)return;
  const w=snap.data();
  const name=prompt('الاسم الكامل:',w.name||'');
  if(name===null)return;
  const password=prompt('كلمة المرور:',w.password||'');
  if(password===null)return;
  if(!name.trim()||!password.trim()){toast('⚠️ الاسم وكلمة المرور مطلوبان');return;}
  try{
    await db.collection('employee_workers').doc(id).update({name:name.trim(),password:password.trim()});
    toast('✅ تم التعديل');loadEmpWorkers();
  }catch(e){toast('❌ '+e.message);}
}

async function editEmpPage(id,currentName){
  const name=prompt('اسم الصفحة:',currentName);
  if(name===null||!name.trim())return;
  try{
    await db.collection('employee_pages').doc(id).update({name:name.trim()});
    toast('✅ تم التعديل');loadEmpPagesAdmin();
  }catch(e){toast('❌ '+e.message);}
}

async function editEmpProduct(id,currentName,currentPrice){
  const name=prompt('اسم المنتج:',currentName);
  if(name===null||!name.trim())return;
  const priceStr=prompt('السعر (د.أ):',currentPrice);
  if(priceStr===null)return;
  const price=parseFloat(priceStr)||0;
  try{
    await db.collection('employee_products').doc(id).update({productName:name.trim(),price});
    _empSharedProducts=null;
    toast('✅ تم التعديل');loadEmpProductsAdmin();
  }catch(e){toast('❌ '+e.message);}
}

// ===== ORDER EDIT MODAL =====
let _empEditImages=[];
function openOpOrderDetail(orderId){
  const o=_opOrdersAllData.find(x=>x.id===orderId)||_empOrdersAllData&&_empOrdersAllData.find(x=>x.id===orderId);
  if(!o){db.collection('employee_orders').doc(orderId).get().then(s=>{if(s.exists)_showOpOrderDetail({id:s.id,...s.data()});});return;}
  _showOpOrderDetail(o);
}

function _showOpOrderDetail(o){
  const st=_empSt(o.status);
  const prods=o.products||[{name:o.productName||'?',price:o.price||0,qty:1}];
  const total=o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0);
  const dlv=o.deliveryFee||0;
  const net=o.netPrice!=null?o.netPrice:total+dlv;
  const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-5).toUpperCase();
  const isClosed=['cancelled','returned','refused','delivered'].includes(o.status);
  const nextSt=EMP_STATUS_NEXT[o.status];
  const isOperator=!!_currentAdminUser;
  const imgs=o.imageDataUrls&&o.imageDataUrls.length?o.imageDataUrls:(o.imageDataUrl?[o.imageDataUrl]:[]);

  let el=document.getElementById('opOrderDetailSheet');
  if(!el){
    el=document.createElement('div');
    el.id='opOrderDetailSheet';
    el.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
    el.innerHTML='<div onclick="closeOpOrderDetail()" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);"></div><div id="opOrderDetailBody" style="position:relative;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;background:#fafafa;border-radius:20px 20px 0 0;padding:0 0 28px;font-family:\'Tajawal\',sans-serif;animation:luxSheetUp .35s cubic-bezier(.2,.8,.2,1);"></div>';
    document.body.appendChild(el);
  }

  // Determine primary action for detail panel
  const _dBtn=(label,fn,style='primary')=>{
    const s=style==='primary'?'background:#111;color:#fff;border:none;'
             :style==='green'?'background:#16a34a;color:#fff;border:none;'
             :style==='danger'?'background:#fff;color:#dc2626;border:1px solid #fecaca;'
             :'background:#fafafa;color:#555;border:1px solid #ebebeb;';
    return `<button onclick="${fn}" style="flex:1;padding:12px 8px;${s}border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:800;cursor:pointer;min-width:80px;">${label}</button>`;
  };
  const _dIconBtn=(label,fn)=>`<button onclick="${fn}" style="padding:12px 14px;background:#fafafa;color:#555;border:1px solid #ebebeb;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.9rem;cursor:pointer;">${label}</button>`;

  const body=document.getElementById('opOrderDetailBody');
  body.innerHTML=`
    <div style="background:#111;padding:16px 18px 14px;border-radius:20px 20px 0 0;display:flex;align-items:center;justify-content:space-between;animation:luxSheetUp .3s cubic-bezier(.2,.8,.2,1);">
      <button onclick="closeOpOrderDetail()" style="background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.7);width:34px;height:34px;border-radius:50%;font-size:1rem;cursor:pointer;transition:all .2s;">✕</button>
      <div style="text-align:center;">
        <div style="color:#fff;font-weight:900;font-size:1rem;letter-spacing:-0.3px;">${label}</div>
        <div style="color:rgba(255,255,255,0.45);font-size:0.68rem;margin-top:2px;letter-spacing:0.5px;">${o.pageName||''}</div>
      </div>
      <span style="background:rgba(255,255,255,0.1);color:#fff;border-radius:20px;padding:4px 12px;font-size:0.72rem;font-weight:800;border:1px solid rgba(255,255,255,0.15);">${st.label}</span>
    </div>
    ${o.urgent?`<div style="background:#dc2626;color:#fff;padding:9px 16px;font-weight:800;text-align:center;font-size:0.88rem;letter-spacing:0.5px;">🔥 طلب مستعجل</div>`:''}
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:#fafafa;">
      <div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:10px;letter-spacing:1px;">معلومات الزبون</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.82rem;">
          <div><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">الاسم</div><div style="font-weight:700;color:#111;">${o.customerName||'—'}</div></div>
          <div><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">الهاتف</div><div style="font-weight:700;color:#111;direction:ltr;">${o.customerPhone||'—'}</div></div>
          <div style="grid-column:1/-1;"><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">العنوان</div><div style="font-weight:700;color:#111;">${o.address||'—'}${o.area?' · '+o.area:''}</div></div>
          ${o.notes?`<div style="grid-column:1/-1;"><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">ملاحظات</div><div style="font-weight:600;color:#555;">${o.notes}</div></div>`:''}
        </div>
      </div>
      <div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:10px;letter-spacing:1px;">المنتجات</div>
        ${prods.map(p=>`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f5f5f5;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:0.88rem;color:#111;">${p.name}</div>
            ${p.priceLabel?`<div style="font-size:0.72rem;color:#854d0e;background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:2px 8px;margin-top:3px;display:inline-block;font-weight:700;">🏷 ${p.priceLabel}</div>`:''}
            ${p.color?`<div style="font-size:0.72rem;color:#555;margin-top:2px;">اللون: ${p.color}</div>`:''}
            ${p.writing?`<div style="font-size:0.72rem;color:#555;background:#fafafa;border-right:2.5px solid #111;border-radius:6px;padding:3px 8px;margin-top:4px;display:inline-block;">✎ ${p.writing}</div>`:''}
          </div>
          <div style="text-align:left;flex-shrink:0;">
            <div style="font-size:0.72rem;color:#999;">${p.qty||1} × ${p.price.toFixed(2)}</div>
            <div style="font-weight:900;color:#111;font-size:0.9rem;">${(p.price*(p.qty||1)).toFixed(2)} <span style="font-size:0.6rem;color:#999;font-weight:500;">د.أ</span></div>
          </div>
        </div>`).join('')}
        <div style="margin-top:10px;padding-top:10px;border-top:1.5px solid #111;display:flex;justify-content:space-between;align-items:center;">
          ${dlv>0?`<div style="font-size:0.74rem;color:#999;">منتجات: ${total.toFixed(2)} + توصيل: ${dlv.toFixed(2)}</div>`:'<div></div>'}
          <div style="font-weight:900;font-size:1.1rem;color:#111;letter-spacing:-0.3px;">${net.toFixed(2)} <span style="font-size:0.6rem;color:#999;font-weight:500;">د.أ</span></div>
        </div>
      </div>
      ${!['delivered','cancelled','returned','refused'].includes(o.status)?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:8px;letter-spacing:1px;">المندوب</div>
        ${o.deliveryRepName
          ?`<div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-weight:800;color:#111;font-size:0.88rem;">${o.deliveryRepName}</span>${o.deliveryRepPhone?`<a href="tel:${o.deliveryRepPhone}" style="font-weight:700;color:#555;direction:ltr;text-decoration:none;font-size:0.82rem;">${o.deliveryRepPhone}</a>`:''}</div>`
          :`<div style="font-size:0.82rem;color:#bbb;">لم يُعيَّن مندوب بعد</div>`}
      </div>`:''}
      ${o.cancelReason?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #fecaca;border-right:3px solid #dc2626;"><div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:4px;letter-spacing:1px;">سبب الإلغاء</div><div style="font-size:0.85rem;font-weight:700;color:#dc2626;">${o.cancelReason}</div></div>`:''}
      ${o.holdReason?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;border-right:3px solid #111;"><div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:4px;letter-spacing:1px;">سبب التعليق</div><div style="font-size:0.85rem;font-weight:700;color:#555;">${o.holdReason}</div></div>`:''}
      ${o.internalNote?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;border-right:3px solid #111;"><div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:4px;letter-spacing:1px;">ملاحظة داخلية</div><div style="font-size:0.85rem;color:#555;">${o.internalNote}</div></div>`:''}
      ${o.workerName?`<div style="font-size:0.78rem;color:#999;padding:2px 2px;">الموظف: <b style="color:#555;">${o.workerName}</b></div>`:''}
      ${o.editHistory&&o.editHistory.length?`<div style="font-size:0.71rem;color:#bbb;padding:0 2px;line-height:1.7;">${o.editHistory.map(e=>`<span>${e.note} <span style="color:#ddd;">(${e.by})</span></span>`).join(' ← ')}</div>`:''}
      ${imgs.length?`<div style="display:grid;grid-template-columns:repeat(${Math.min(imgs.length,3)},1fr);gap:6px;">${imgs.map(src=>`<img src="${src}" onclick="openEmpOrderImage('${src}')" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;cursor:zoom-in;">`).join('')}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
        ${isOperator&&nextSt&&!isClosed&&nextSt!=='delivering'?_dBtn(`${EMP_STATUSES[nextSt].label} ←`,`closeOpOrderDetail();updateEmpOrderStatus('${o.id}','${nextSt}')`,'primary'):''}
        ${isOperator&&nextSt==='delivering'&&!isClosed?_dBtn('اختر مندوب ←',`closeOpOrderDetail();_openRepPickerFromDetail('${o.id}')`,'green'):''}
        ${o.status==='waiting_rep'?_dBtn('تعيين مندوب ←',`closeOpOrderDetail();_openRepPickerFromDetail('${o.id}')`,'green'):''}
        ${_dIconBtn('✏️',`closeOpOrderDetail();openEmpOrderEdit('${o.id}')`)}
        ${_dIconBtn('🖨',`printEmpOrder('${o.id}',false)`)}
        ${_dIconBtn('🏷️',`printOrderQR('${o.id}')`)}
        ${isOperator?_dIconBtn('📱',`closeOpOrderDetail();openDeliveryModal&&openDeliveryModal('${o.id}')`):''}
      </div>
      ${!isClosed?`<div style="display:flex;gap:8px;">
        ${o.status!=='waiting_rep'&&o.status!=='delivering'&&o.status!=='queued'?_dBtn('إرسال لمندوب ←',`closeOpOrderDetail();_openRepPickerFromDetail('${o.id}')`,'green'):''}
        ${_dBtn('🚫 إلغاء',`_cancelOpOrderFromDetail('${o.id}')`,'danger')}
      </div>`
      :o.status==='delivered'?`<div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${_dBtn(o.deliveryRepName?'🔄 تغيير مندوب':'تعيين مندوب',`closeOpOrderDetail();_openRepPickerFromDetail('${o.id}')`,'primary')}
        ${_dBtn('↩️ إرجاع الطلب',`_returnOpOrderFromDetail('${o.id}')`,'plain')}
        ${_dBtn('🚫 إلغاء',`_cancelOpOrderFromDetail('${o.id}')`,'danger')}
      </div>`
      :`<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div style="font-size:0.72rem;color:#999;font-weight:700;width:100%;padding-bottom:4px;">إعادة تفعيل:</div>
        ${_dBtn('جديد',`closeOpOrderDetail();updateEmpOrderStatus('${o.id}','pending')`)}
        ${_dBtn('قيد التجهيز',`closeOpOrderDetail();updateEmpOrderStatus('${o.id}','preparing')`)}
        ${_dBtn('إرسال لمندوب',`closeOpOrderDetail();_openRepPickerFromDetail('${o.id}')`,'green')}
      </div>`}
    </div>`;

  el.style.display='flex';
  document.body.style.overflow='hidden';
}

function closeOpOrderDetail(){
  const el=document.getElementById('opOrderDetailSheet');
  if(el)el.style.display='none';
  document.body.style.overflow='';
}

async function _cancelOpOrderFromDetail(id){
  const reason=prompt('سبب الإلغاء:');
  if(reason===null)return;
  closeOpOrderDetail();
  try{
    const docRef=db.collection('employee_orders').doc(id);
    const snap=await docRef.get();
    const data=snap.data();
    const by=_currentAdminUser||_empCurrentUser?.displayName||'admin';
    const editEntry={by,at:jordanDisplayDate(),note:`${_empSt(data.status).label} ← ${_empSt('cancelled').label}`};
    await docRef.update({status:'cancelled',cancelReason:reason||'',editHistory:[...(data.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    toast('🚫 تم إلغاء الطلب');
    // no accounting effect for simple cancel
  }catch(e){toast('❌ '+e.message);}
}

async function _returnOpOrderFromDetail(id){
  if(!confirm('↩️ إلغاء مع إرجاع الطلب\n\nسيتم إلغاء الطلب وإرجاع تكلفة الإنتاج للمتجر في الكشف الحالي.\nهل أنت متأكد؟'))return;
  closeOpOrderDetail();
  closeOpCardMenu();
  try{
    const docRef=db.collection('employee_orders').doc(id);
    const snap=await docRef.get();
    if(!snap.exists){toast('❌ الطلب غير موجود');return;}
    const data=snap.data();
    if(data.status!=='delivered'){toast('⚠️ الطلب غير مُسلَّم');return;}
    const by=_currentAdminUser||_empCurrentUser?.displayName||'admin';
    const editEntry={by,at:jordanDisplayDate(),note:`${_empSt('delivered').label} ← ${_empSt('returned').label} (إرجاع)`};
    await docRef.update({
      status:'returned',
      editHistory:[...(data.editHistory||[]),editEntry],
      needsReview:firebase.firestore.FieldValue.delete(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('↩️ تم الإرجاع — سيُضاف قيد للمتجر في الكشف الحالي');
    await _handleDeliveredCancel(id,data,'returned');
    if(typeof _renderOpOrdersView==='function')_renderOpOrdersView();
  }catch(e){toast('❌ '+e.message);}
}

async function _openRepPickerFromDetail(orderId){
  _qrAssignOrderId=orderId;
  const modal=document.getElementById('qrRepAssignModal');
  if(!modal)return;
  modal.style.display='flex';
  document.getElementById('qrAssignOrderInfo').textContent='';
  document.getElementById('qrAssignStatusBadge').innerHTML='';
  document.getElementById('qrAssignActionBtns').innerHTML='';
  await _showRepPickerInModal(orderId);
}

function openEmpOrderEdit(orderId){
  _empEditOrderId=orderId;
  _empEditCart=[];
  _empEditDeliveryFee=0;
  _empEditImages=[];
  const modal=document.getElementById('empOrderEditModal');
  modal.style.display='flex';
  db.collection('employee_orders').doc(orderId).get().then(snap=>{
    if(!snap.exists){toast('❌ الطلب غير موجود');closeEmpOrderEdit();return;}
    const o=snap.data();
    _empEditCart=(o.products||[{name:o.productName||'?',price:o.price||0,qty:1}]).map(p=>({...p}));
    _empEditDeliveryFee=o.deliveryFee??2;
    // Show/hide delivery fee section based on admin status
    const editDlvSec=document.getElementById('empEditDeliverySection');
    if(editDlvSec)editDlvSec.style.display=_currentAdminUser?'block':'none';
    _empEditImages=o.imageDataUrls?[...o.imageDataUrls]:(o.imageDataUrl?[o.imageDataUrl]:[]);
    document.getElementById('empEdit_phone').value=o.customerPhone||'';
    document.getElementById('empEdit_address').value=o.address||'';
    document.getElementById('empEdit_notes').value=o.notes||'';
    const areaEl=document.getElementById('empEdit_area');if(areaEl)areaEl.value=o.area||'';
    const pageEl=document.getElementById('empEdit_page');
    if(pageEl){
      db.collection('employee_pages').orderBy('name').get().then(ps=>{
        const pages=ps.docs.map(d=>({id:d.id,...d.data()}));
        pageEl.innerHTML='<option value="">— اختار الصفحة —</option>'+pages.map(p=>`<option value="${p.id}" data-name="${p.name}"${(o.pageId===p.id||o.pageName===p.name)?' selected':''}>${p.name}</option>`).join('');
        if(!pageEl.value&&o.pageName){const opt=document.createElement('option');opt.value='';opt.textContent=o.pageName;opt.selected=true;pageEl.prepend(opt);}
      }).catch(()=>{});
    }
    // Populate add-product dropdown with operator products (not website products)
    const addProdSel=document.getElementById('empEditAddProd');
    if(addProdSel){
      const _populateEditProdSel=()=>{
        const storeId=o.storeId||'';
        addProdSel.innerHTML='<option value="">اختر منتج...</option>'+(_empSharedProducts||[]).map(p=>{
          const price=storeId&&p.storePrices&&p.storePrices[storeId]?p.storePrices[storeId]:(p.sellPrice||p.price||p.defaultSellPrice||0);
          return `<option value="${p.id}" data-price="${price}">${p.name}</option>`;
        }).join('');
      };
      if(_empSharedProducts){
        _populateEditProdSel();
      } else {
        addProdSel.innerHTML='<option value="">جاري التحميل...</option>';
        db.collection('operator_products').get()
          .then(s=>{_empSharedProducts=s.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.isRawMaterial);_populateEditProdSel();})
          .catch(()=>{addProdSel.innerHTML='<option value="">اختر منتج...</option>';});
      }
    }
    const urgEl=document.getElementById('empEdit_urgent');
    if(urgEl) urgEl.checked=!!o.urgent;
    const totalEl=document.getElementById('empEditTotalInput');
    if(totalEl)totalEl.value=(o.totalPrice!=null?o.totalPrice-(_empEditDeliveryFee||0):_empEditCart.reduce((s,p)=>s+(parseFloat(p.price||0)*(p.qty||1)),0)).toFixed(2);
    const dlv=_empEditDeliveryFee;
    const btns=document.querySelectorAll('#empEditDeliveryBtns button');
    btns.forEach(b=>{b.style.background='#fff';b.style.color='#374151';b.style.borderColor='#e5e7eb';});
    const customEl=document.getElementById('empEdit_delivery_custom');
    if(dlv===0){btns[0].style.background='#1a3a2a';btns[0].style.color='#fff';btns[0].style.borderColor='#1a3a2a';customEl.style.display='none';}
    else if(dlv===2){btns[1].style.background='#1a3a2a';btns[1].style.color='#fff';btns[1].style.borderColor='#1a3a2a';customEl.style.display='none';}
    else if(dlv===3){btns[2].style.background='#1a3a2a';btns[2].style.color='#fff';btns[2].style.borderColor='#1a3a2a';customEl.style.display='none';}
    else if(dlv>0){btns[3].style.background='#1a3a2a';btns[3].style.color='#fff';btns[3].style.borderColor='#1a3a2a';customEl.style.display='block';customEl.value=dlv;}
    _renderEmpEditImgPreview();
    renderEmpEditCart();
  }).catch(e=>{toast('❌ '+e.message);closeEmpOrderEdit();});
}
function _renderEmpEditImgPreview(){
  const wrap=document.getElementById('empEdit_img_preview');
  if(!wrap)return;
  if(!_empEditImages.length){wrap.innerHTML='';return;}
  wrap.innerHTML=_empEditImages.map((src,i)=>`<div style="position:relative;display:inline-block;margin:4px;">
    <img src="${src}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1.5px solid #86efac;">
    <button onclick="_removeEmpEditImg(${i})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;background:#ef4444;color:#fff;border:none;border-radius:50%;cursor:pointer;font-size:0.7rem;line-height:1;">✕</button>
  </div>`).join('');
}
function _removeEmpEditImg(i){_empEditImages.splice(i,1);_renderEmpEditImgPreview();}
async function onEmpEditImageChange(input){
  const files=Array.from(input.files||[]);
  for(const f of files){
    await new Promise(res=>{
      const r=new FileReader();
      r.onload=async e=>{
        const compressed=await _compressImage(e.target.result);
        _empEditImages.push(compressed);
        _renderEmpEditImgPreview();
        res();
      };
      r.readAsDataURL(f);
    });
  }
  input.value='';
}

function closeEmpOrderEdit(){
  document.getElementById('empOrderEditModal').style.display='none';
  _empEditOrderId=null;_empEditCart=[];_empEditDeliveryFee=0;_empEditImages=[];
}

function renderEmpEditCart(){
  const wrap=document.getElementById('empEditCartWrap');
  if(!wrap)return;
  if(!_empEditCart.length){wrap.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:8px;text-align:center;">لا يوجد منتجات</div>';updateEmpEditNet();return;}
  wrap.innerHTML=`<div style="font-size:0.8rem;font-weight:700;color:#1a3a2a;margin-bottom:6px;">📦 المنتجات</div>`+
    _empEditCart.map((item,i)=>`
      <div style="padding:8px 10px;background:#f8fafc;border-radius:8px;margin-bottom:6px;border:1px solid #e5e7eb;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${item.color!==undefined||item.writing!==undefined?'7px':'0'};">
          <div style="flex:1;font-size:0.85rem;font-weight:600;color:#1a3a2a;">${item.name}</div>
          <div style="font-size:0.78rem;color:#6b7280;">${parseFloat(item.price||0).toFixed(2)} د.أ</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="changeEmpEditQty(${i},-1)" style="width:26px;height:26px;border-radius:6px;border:1.5px solid #e5e7eb;background:#fff;cursor:pointer;font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;">−</button>
            <span style="min-width:22px;text-align:center;font-weight:700;font-size:0.88rem;">${item.qty||1}</span>
            <button onclick="changeEmpEditQty(${i},1)" style="width:26px;height:26px;border-radius:6px;border:1.5px solid #1a3a2a;background:#1a3a2a;color:#fff;cursor:pointer;font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;">+</button>
          </div>
          <button onclick="removeEmpEditItem(${i})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:0.75rem;flex-shrink:0;">✕</button>
        </div>
        ${(()=>{const pr=(_opProductsList||[]).find(p=>p.id===item.id)||(_empSharedProducts||[]).find(p=>p.id===item.id)||{};const po=_productPriceChoices(pr);return po.length?`<div style="margin-bottom:7px;"><div style="font-size:0.72rem;font-weight:700;color:#854d0e;margin-bottom:4px;">💵 السعر</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${po.map(o=>{const active=Math.abs((item.price||0)-(o.price||0))<0.001;const sl=(o.label||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");return `<button onclick="updateEmpEditPrice(${i},${(o.price||0)},'${sl}')" style="padding:4px 11px;border:1.5px solid ${active?'#854d0e':'#fde047'};border-radius:18px;background:${active?'#854d0e':'#fef9c3'};color:${active?'#fff':'#854d0e'};font-family:'Tajawal',sans-serif;font-size:0.76rem;font-weight:700;cursor:pointer;">${o.label} — ${(o.price||0).toFixed(2)}</button>`;}).join('')}</div></div>`:'';})()}
        <div style="display:flex;gap:6px;">
          <input value="${(item.color||'').replace(/"/g,'&quot;')}" placeholder="🎨 اللون" oninput="_empEditCart[${i}].color=this.value" style="flex:1;padding:6px 9px;border:1.5px solid #e5e7eb;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.8rem;outline:none;" onfocus="this.style.borderColor='#0369a1'" onblur="this.style.borderColor='#e5e7eb'">
          <input value="${(item.writing||'').replace(/"/g,'&quot;')}" placeholder="✍️ الكتابة" oninput="_empEditCart[${i}].writing=this.value" style="flex:1;padding:6px 9px;border:1.5px solid #e5e7eb;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.8rem;outline:none;" onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#e5e7eb'">
        </div>
      </div>`).join('');
  updateEmpEditNet();
}

function updateEmpEditPrice(i,price,label){
  if(!_empEditCart[i])return;
  const newPrice=parseFloat(price)||0;
  const oldPrice=parseFloat(_empEditCart[i].price||0);
  const qty=_empEditCart[i].qty||1;
  const totalEl=document.getElementById('empEditTotalInput');
  if(totalEl){
    const diff=(newPrice-oldPrice)*qty;
    totalEl.value=Math.max(0,parseFloat(totalEl.value||0)+diff).toFixed(2);
  }
  _empEditCart[i].price=newPrice;
  if(label!==undefined) _empEditCart[i].priceLabel=label;
  renderEmpEditCart();
}

function changeEmpEditQty(i,delta){
  if(!_empEditCart[i])return;
  const oldQty=_empEditCart[i].qty||1;
  const newQty=Math.max(1,oldQty+delta);
  _empEditCart[i].qty=newQty;
  const totalEl=document.getElementById('empEditTotalInput');
  if(totalEl){
    const diff=(newQty-oldQty)*parseFloat(_empEditCart[i].price||0);
    totalEl.value=Math.max(0,parseFloat(totalEl.value||0)+diff).toFixed(2);
  }
  renderEmpEditCart();
}

function removeEmpEditItem(i){
  const removed=_empEditCart[i];
  if(removed){
    const totalEl=document.getElementById('empEditTotalInput');
    if(totalEl){
      const subtracted=parseFloat(removed.price||0)*(removed.qty||1);
      totalEl.value=Math.max(0,parseFloat(totalEl.value||0)-subtracted).toFixed(2);
    }
  }
  _empEditCart.splice(i,1);
  renderEmpEditCart();
}

function onEmpEditProdChange(){
  const sel=document.getElementById('empEditAddProd');
  const priceEl=document.getElementById('empEditAddPrice');
  if(sel.value&&priceEl){
    const opt=sel.options[sel.selectedIndex];
    priceEl.value=opt.dataset.price||'';
  }
}

function addItemToEmpEdit(){
  const sel=document.getElementById('empEditAddProd');
  const priceEl=document.getElementById('empEditAddPrice');
  const qtyEl=document.getElementById('empEditAddQty');
  const price=parseFloat(priceEl.value);
  if(!sel.value&&isNaN(price)){toast('⚠️ اختر منتجاً أو أدخل سعراً');return;}
  const opt=sel.value?sel.options[sel.selectedIndex]:null;
  const name=opt?opt.text.trim():'منتج مخصص';
  const qty=Math.max(1,parseInt(qtyEl.value)||1);
  const finalPrice=isNaN(price)?0:price;
  _empEditCart.push({id:sel.value||'',name,price:finalPrice,qty});
  // Add product price × qty to the total field
  const totalEl=document.getElementById('empEditTotalInput');
  if(totalEl) totalEl.value=(parseFloat(totalEl.value||0)+finalPrice*qty).toFixed(2);
  sel.value='';priceEl.value='';qtyEl.value='1';
  renderEmpEditCart();
}

function setEmpEditDelivery(val,btn){
  const customEl=document.getElementById('empEdit_delivery_custom');
  document.querySelectorAll('#empEditDeliveryBtns button').forEach(b=>{b.style.background='#fff';b.style.color='#374151';b.style.borderColor='#e5e7eb';});
  if(btn){btn.style.background='#1a3a2a';btn.style.color='#fff';btn.style.borderColor='#1a3a2a';}
  if(val===-1){customEl.style.display='block';customEl.focus();_empEditDeliveryFee=parseFloat(customEl.value)||0;}
  else{customEl.style.display='none';_empEditDeliveryFee=val;}
  updateEmpEditNet();
}

function updateEmpEditNet(){
  const customEl=document.getElementById('empEdit_delivery_custom');
  if(customEl&&customEl.style.display!=='none')_empEditDeliveryFee=parseFloat(customEl.value)||0;
  const dlv=_empEditDeliveryFee;
  const userTotal=parseFloat(document.getElementById('empEditTotalInput')?.value)||0;
  const net=userTotal+dlv;
  const netEl=document.getElementById('empEditNetLabel');
  const dlvRow=document.getElementById('empEditDeliveryRow');
  const dlvLbl=document.getElementById('empEditDeliveryLabel');
  if(netEl)netEl.textContent=net.toFixed(2)+' د.أ';
  if(dlvRow)dlvRow.style.display=dlv>0?'flex':'none';
  if(dlvLbl)dlvLbl.textContent=dlv.toFixed(2)+' د.أ';
}

async function saveEmpOrderEdit(){
  if(!_empEditOrderId){toast('⚠️ خطأ: لا يوجد طلب');return;}
  if(!_empEditCart.length){toast('⚠️ يجب أن يكون هناك منتج واحد على الأقل');return;}
  const phone=document.getElementById('empEdit_phone').value.trim();
  const address=document.getElementById('empEdit_address').value.trim();
  const area=(document.getElementById('empEdit_area')?.value||'').trim();
  if(!phone){toast('⚠️ أدخل رقم الزبون');return;}
  if(!area){toast('⚠️ اختار المحافظة');return;}
  if(!address){toast('⚠️ أدخل العنوان');return;}
  const notes=document.getElementById('empEdit_notes').value.trim();
  const prodsTotal=parseFloat(document.getElementById('empEditTotalInput')?.value)||0;
  const deliveryFee=_empEditDeliveryFee;
  const netPrice=prodsTotal+deliveryFee;
  const btn=document.querySelector('#empOrderEditModal button[onclick="saveEmpOrderEdit()"]');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الحفظ...';}
  try{
    // ضغط الصور (خاصة القديمة غير المضغوطة) لتفادي تجاوز حد حجم وثيقة Firestore (1MB)
    _empEditImages=await _compressImagesForDoc(_empEditImages);
    const docRef=db.collection('employee_orders').doc(_empEditOrderId);
    const prev=(await docRef.get()).data();
    const by=_empCurrentUser?.displayName||_empCurrentUser?.username||_currentAdminUser||'admin';
    const editEntry={by,at:jordanDisplayDate(),note:'تعديل تفاصيل الطلب'};
    const pageEl=document.getElementById('empEdit_page');
    const selectedPageOpt=pageEl&&pageEl.options[pageEl.selectedIndex];
    const newPageId=pageEl?pageEl.value:'';
    const newPageName=selectedPageOpt?(selectedPageOpt.dataset.name||selectedPageOpt.textContent):'';
    const urgent=document.getElementById('empEdit_urgent')?.checked||false;
    const updateData={
      products:_empEditCart.map(i=>{const pl=_resolveItemPriceLabel(i);return {id:i.id||'',name:i.name,price:parseFloat(i.price||0),qty:i.qty||1,...(i.color?{color:i.color}:{}),...(i.writing?{writing:i.writing}:{}),...(pl?{priceLabel:pl}:{})};}),
      customerPhone:phone,address,notes,area,
      urgent,
      ...(newPageName?{pageName:newPageName}:{}),
      ...(newPageId?{pageId:newPageId}:{}),
      totalPrice:prodsTotal+deliveryFee,deliveryFee,netPrice,
      needsReview:true,
      editHistory:[...(prev.editHistory||[]),editEntry],
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    if(_empEditImages.length){updateData.imageDataUrls=_empEditImages;updateData.imageDataUrl=_empEditImages[0];}
    await docRef.update(updateData);
    toast('✅ تم حفظ التعديلات');
    closeEmpOrderEdit();
  }catch(e){toast('❌ '+e.message);}
  if(btn){btn.disabled=false;btn.textContent='💾 حفظ التعديلات';}
}

// ===== ORDER TRACKING & OPERATOR =====
function _buildCustomerHistoryMap(allData){
  const map=new Map();
  (allData||[]).forEach(o=>{
    const phone=(o.customerPhone||'').trim();
    if(!phone)return;
    map.set(phone,(map.get(phone)||0)+1);
  });
  return map;
}

function _repeatBadge(phone,customerHist,size){
  if(!customerHist)return '';
  const n=customerHist.get((phone||'').trim())||0;
  if(n<=1)return '';
  const safe=(phone||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  if(size==='sm')return `<span onclick="event.stopPropagation();viewCustomerHistory('${safe}')" style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:5px;padding:1px 6px;font-size:0.65rem;font-weight:700;margin-bottom:4px;cursor:pointer;">🔁 زبون سابق · ${n}</span>`;
  return `<span onclick="event.stopPropagation();viewCustomerHistory('${safe}')" style="display:inline-flex;align-items:center;gap:3px;background:#fef3c7;color:#92400e;border:1.5px solid #fde68a;border-radius:7px;padding:2px 8px;font-size:0.7rem;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;margin:4px 0;">🔁 زبون سابق · ${n} طلبات</span>`;
}

function _renderAdminOrderCard(o,isOperator,customerHist){
  const st=_empSt(o.status);
  const prods=o.products||[{name:o.productName||'?',price:o.price||0,qty:1}];
  const total=o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0);
  const dlv=o.deliveryFee||0;
  const net=o.netPrice!=null?o.netPrice:total+dlv;
  const nextSt=EMP_STATUS_NEXT[o.status];
  const isClosed=['cancelled','returned','refused','delivered'].includes(o.status);
  const isHold=o.status==='onhold';
  const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-5).toUpperCase();
  const phone=(o.customerPhone||'').trim();

  // Product image: look up from shared products list
  const firstProdImg=(()=>{
    const pid=prods[0]?.id;
    const pd=pid?(_empSharedProducts||[]).find(p=>p.id===pid):null;
    return pd?(pd.imageDataUrl||(pd.images&&pd.images[0])||pd.img||''):'';
  })();

  // Main next-action button (one primary action per card)
  let nextBtn='';
  if(isHold){
    nextBtn=`<button class="lux-next plain" onclick="event.stopPropagation();updateEmpOrderStatus('${o.id}','pending')">▶ استئناف</button>`;
  }else if(o.status==='waiting_rep'){
    nextBtn=`<button class="lux-next go" onclick="event.stopPropagation();_openRepPickerFromDetail('${o.id}')">تعيين مندوب <span class="arr">←</span></button>`;
  }else if(nextSt==='delivering'){
    nextBtn=`<button class="lux-next go" onclick="event.stopPropagation();_openRepPickerFromDetail('${o.id}')">اختر مندوب <span class="arr">←</span></button>`;
  }else if(nextSt){
    nextBtn=`<button class="lux-next primary" onclick="event.stopPropagation();updateEmpOrderStatus('${o.id}','${nextSt}')">${EMP_STATUSES[nextSt].label} <span class="arr">←</span></button>`;
  }
  // ⚡ quick-skip to rep for early stages (operator only)
  const quickBtn=(isOperator&&!isHold&&(o.status==='pending'||o.status==='preparing'))
    ?`<button class="lux-more" title="إرسال مباشر للمندوب" onclick="event.stopPropagation();_openRepPickerFromDetail('${o.id}')">⚡</button>`:'';

  // Worker view: status select instead of single button
  const workerSelect=!isOperator
    ?`<select onchange="updateEmpOrderStatus('${o.id}',this.value)" onclick="event.stopPropagation();" style="padding:6px 9px;border:1px solid #ebebeb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.75rem;font-weight:700;outline:none;background:#fafafa;color:#222;margin:6px 8px 6px 0;">
      ${Object.entries(EMP_STATUSES).map(([k,v])=>`<option value="${k}"${o.status===k?' selected':''}>${v.label}</option>`).join('')}
    </select>`:'';

  // Journey progress steps: pending→preparing→prepared→delivering→delivered
  const _stageIdx={pending:0,preparing:1,prepared:2,waiting_rep:2,queued:3,delivering:3,delivered:4}[o.status];
  const steps=_stageIdx!==undefined
    ?`<span class="lux-steps">${[0,1,2,3].map(i=>`<span class="lux-step ${i<_stageIdx?'done':i===_stageIdx?'now':''}"></span>`).join('')}</span>`:'';
  const dotLive=!isClosed&&!isHold&&o.status!=='waiting_rep';

  const imgPanel=firstProdImg
    ?`<div style="flex-shrink:0;width:78px;align-self:stretch;overflow:hidden;border-left:1px solid #f3f4f6;position:relative;">
        <img src="${firstProdImg}" onclick="event.stopPropagation();openEmpOrderImage('${firstProdImg}')" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;min-height:80px;">
        ${prods.length>1?`<div style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.55);color:#fff;border-radius:5px;font-size:0.65rem;padding:1px 5px;font-family:'Tajawal',sans-serif;">+${prods.length-1}</div>`:''}
      </div>`
    :'';

  const _selectChecked=_opSelectMode&&isOperator&&_opSelectedIds.has(o.id);
  return `<div id="opcard_${o.id}" data-order-id="${o.id}" class="lux-card" style="${o.urgent?'border-color:#fca5a5;':''}${_selectChecked?'outline:2.5px solid #111;':''}">${_opSelectMode&&isOperator?`<div onclick="opToggleSelect('${o.id}')" style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fafafa;border-bottom:1px solid #ebebeb;cursor:pointer;"><input id="opchk_${o.id}" type="checkbox" ${_selectChecked?'checked':''} onclick="event.stopPropagation();opToggleSelect('${o.id}')" style="width:18px;height:18px;cursor:pointer;accent-color:#111;"><span style="font-size:0.82rem;font-weight:800;color:#111;">${label}</span><span style="font-size:0.75rem;color:#999;">${(o.pageName||o.storeName||'')}</span></div>`:''}
    ${o.urgent?`<div style="background:#dc2626;color:#fff;padding:4px 14px;font-size:0.7rem;font-weight:800;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;animation:urgentPulse 1.4s infinite;">🔥 طلب مستعجل</div>`:''}
    <div onclick="${_opSelectMode&&isOperator?`opToggleSelect('${o.id}')`:`openOpOrderDetail('${o.id}')`}" style="display:flex;cursor:pointer;direction:ltr;min-height:80px;">
      ${imgPanel}
      <div style="flex:1;min-width:0;padding:13px 15px 11px;direction:rtl;">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px;">
          <span style="font-weight:800;color:#111;font-size:0.92rem;white-space:nowrap;">${o.workerName||o.pageName||'—'}</span>
          <span style="font-size:0.65rem;font-weight:600;color:#999;letter-spacing:0.6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}${o.pageName?' · '+o.pageName:''}</span>
          <span style="font-weight:900;color:#111;font-size:1.02rem;flex-shrink:0;white-space:nowrap;letter-spacing:-0.3px;font-variant-numeric:tabular-nums;">${net.toFixed(2)} <span style="font-size:0.6rem;font-weight:500;color:#999;">د.أ</span></span>
        </div>
        <div style="font-size:0.74rem;color:#555;line-height:1.85;">
          ${phone||'—'}${o.area?` <span style="color:#d8d8d8;">·</span> ${o.area}`:''}
          ${_repeatBadge(phone,customerHist,'sm')}
          ${o.needsReview?`<span style="background:#fafafa;border:1px solid #ebebeb;color:#854d0e;border-radius:6px;padding:1px 7px;font-size:0.68rem;font-weight:700;">✏️ معدَّل</span>`:''}
          <br>${prods.map(p=>`<b style="color:#111;">${p.name}</b>${p.color?` · <span style="color:#0369a1;">${p.color}</span>`:''}${p.writing?` · <span style="color:#7c3aed;">✍️${p.writing}</span>`:''} ×${p.qty||1}`).join(' <span style="color:#d8d8d8;">·</span> ')}
        </div>
        ${o.address?`<div style="font-size:0.71rem;color:#999;margin-top:2px;">📍 ${o.address}${o.notes?' · '+o.notes:''}</div>`:''}
        ${o.deliveryRepName?`<div style="font-size:0.72rem;color:#555;margin-top:2px;">المندوب: <b style="color:#111;">${o.deliveryRepName}</b></div>`:''}
        ${o.holdReason?`<div class="lux-note" style="border-right-color:#d97706;">⏸ ${o.holdReason}</div>`:''}
        ${o.cancelReason?`<div class="lux-note" style="border-right-color:#dc2626;">🚫 ${o.cancelReason}</div>`:''}
        ${isOperator&&o.internalNote?`<div class="lux-note">🔒 ${o.internalNote}</div>`:''}
      </div>
    </div>
    <div class="lux-foot">
      <div class="lux-stage">
        <span class="lux-dot ${dotLive?'live':''}" style="background:${dotLive?'#16a34a':'#bbb'};"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${st.label}</span>
        ${steps}
      </div>
      ${workerSelect}
      ${quickBtn}
      <button class="lux-more" onclick="event.stopPropagation();openOpCardMenu('${o.id}',${isOperator})">⋯</button>
      ${nextBtn}
    </div>
  </div>`;
}

// Action sheet with secondary order actions (⋯)
function openOpCardMenu(id,isOperator){
  const o=(_opOrdersAllData||[]).find(x=>x.id===id)||(_empOrdersAllData||[]).find(x=>x.id===id);
  if(!o)return;
  const isClosed=['cancelled','returned','refused','delivered'].includes(o.status);
  const isHold=o.status==='onhold';
  const imgs=o.imageDataUrls&&o.imageDataUrls.length?o.imageDataUrls:(o.imageDataUrl?[o.imageDataUrl]:[]);
  const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-5).toUpperCase();
  const noteEsc=(o.internalNote||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const items=[
    `<button class="lux-menu-item" onclick="closeOpCardMenu();openEmpOrderEdit('${o.id}')">✏️ تعديل الطلب</button>`,
    `<button class="lux-menu-item" onclick="closeOpCardMenu();printEmpOrder('${o.id}',false)">🖨 طباعة</button>`,
    imgs.length?`<button class="lux-menu-item" onclick="closeOpCardMenu();printEmpOrder('${o.id}',true)">🖨📷 طباعة مع الصور</button>`:'',
    `<button class="lux-menu-item" onclick="closeOpCardMenu();printOrderQR('${o.id}')">🏷️ ليبل QR</button>`,
    o.status==='prepared'?`<button class="lux-menu-item" onclick="closeOpCardMenu();openDeliveryModal('${o.id}')">📱 إرسال واتساب</button>`:'',
    isOperator?`<button class="lux-menu-item" onclick="closeOpCardMenu();copyOrderTrackingLink('${o.id}')">🔗 رابط التتبع</button>`:'',
    isOperator?`<button class="lux-menu-item" onclick="closeOpCardMenu();openInternalNote('${o.id}','${noteEsc}')">🔒 ${o.internalNote?'تعديل الملاحظة الداخلية':'ملاحظة داخلية'}</button>`:'',
    (!isClosed&&!isHold&&isOperator)?`<button class="lux-menu-item" onclick="closeOpCardMenu();openEmpHoldModal('${o.id}')">⏸ تعليق الطلب</button>`:'',
    (!isClosed&&isOperator)?`<button class="lux-menu-item danger" onclick="closeOpCardMenu();openEmpCancelModal('${o.id}')">🚫 إلغاء الطلب</button>`:'',
    (o.status==='delivered'&&isOperator)?`<button class="lux-menu-item" onclick="closeOpCardMenu();_returnOpOrderFromDetail('${o.id}')">↩️ إلغاء مع إرجاع الطلب</button>`:'',
    (o.status==='delivered'&&isOperator)?`<button class="lux-menu-item danger" onclick="closeOpCardMenu();_cancelOpOrderFromDetail('${o.id}')">🚫 إلغاء بدون إرجاع</button>`:'',
    `<button class="lux-menu-item danger" onclick="closeOpCardMenu();deleteEmpOrder('${o.id}')">🗑 حذف نهائي</button>`
  ].filter(Boolean).join('');
  let modal=document.getElementById('opCardMenuModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='opCardMenuModal';
    document.body.appendChild(modal);
  }
  modal.className='lux-menu-overlay';
  modal.style.display='flex';
  modal.onclick=e=>{if(e.target===modal)closeOpCardMenu();};
  modal.innerHTML=`<div class="lux-menu-sheet">
    <div style="width:40px;height:4px;background:#e4e4e7;border-radius:3px;margin:2px auto 12px;"></div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;padding:0 12px 10px;border-bottom:1px solid #f3f4f6;margin-bottom:6px;">
      <span style="font-weight:800;font-size:0.95rem;color:#111;">${o.workerName||o.pageName||''} <span style="font-size:0.68rem;color:#999;font-weight:600;">${label}</span></span>
      <span style="font-weight:900;font-size:0.95rem;color:#111;">${(o.netPrice!=null?o.netPrice:(o.totalPrice||0)).toFixed(2)} <span style="font-size:0.6rem;color:#999;font-weight:500;">د.أ</span></span>
    </div>
    ${items}
  </div>`;
}
function closeOpCardMenu(){
  const m=document.getElementById('opCardMenuModal');
  if(m)m.style.display='none';
}
window.openOpCardMenu=openOpCardMenu;
window.closeOpCardMenu=closeOpCardMenu;

function _renderKanban(orders, isOperator, filterStatus, customerHist){
  const STATUS_ORDER=['pending','preparing','prepared','waiting_rep','queued','delivering','delivered','onhold','cancelled','returned','refused'];
  const groups={};
  STATUS_ORDER.forEach(s=>groups[s]=[]);
  orders.forEach(o=>{ if(groups[o.status])groups[o.status].push(o); else groups['pending'].push(o); });
  // Urgent orders pinned to top of each group
  Object.keys(groups).forEach(s=>groups[s].sort((a,b)=>(b.urgent?1:0)-(a.urgent?1:0)));
  if(filterStatus&&filterStatus!=='all'){
    const grp=groups[filterStatus]||[];
    return grp.length
      ?grp.map(o=>_renderAdminOrderCard(o,isOperator,customerHist)).join('')
      :'<div style="color:#9ca3af;font-size:0.82rem;padding:18px;text-align:center;">لا يوجد طلبات</div>';
  }
  return STATUS_ORDER.map(status=>{
    const grp=groups[status];
    if(!grp.length)return '';
    const st=_empSt(status);
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px;padding:0 2px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${st.color};flex-shrink:0;"></div>
        <span style="font-weight:800;color:${st.color};font-size:0.82rem;">${st.label}</span>
        <span style="background:${st.color};color:#fff;border-radius:20px;padding:1px 8px;font-size:0.7rem;font-weight:700;">${grp.length}</span>
        <div style="flex:1;height:1px;background:${st.border};"></div>
      </div>
      ${grp.map(o=>_renderAdminOrderCard(o,isOperator,customerHist)).join('')}
    </div>`;
  }).join('');
}

function _renderKanbanBoard(orders, isOperator, customerHist){
  return _renderKanban(orders,isOperator,'all',customerHist);
}

function _renderKanbanCard(o,isOperator,customerHist){
  const total=o.totalPrice||0;
  const dlv=o.deliveryFee||0;
  const net=o.netPrice!=null?o.netPrice:total;
  const phone=(o.customerPhone||'').trim();
  const nextSt=EMP_STATUS_NEXT[o.status];
  const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-5).toUpperCase();
  return `<div onclick="openOpOrderDetail('${o.id}')" style="background:#fff;border:1px solid #e5e7eb;border-radius:9px;padding:9px 10px;margin-bottom:7px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:5px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;color:#1a3a2a;font-size:0.78rem;line-height:1.3;">${label}</div>
        <div style="font-size:0.72rem;color:#374151;margin-top:1px;">${o.pageName||''}</div>
      </div>
      <div style="font-weight:900;color:#166534;font-size:0.8rem;flex-shrink:0;white-space:nowrap;">${net.toFixed(2)}</div>
    </div>
    <div style="font-size:0.68rem;color:#6b7280;margin-bottom:3px;">📞 ${phone}</div>
    ${_repeatBadge(phone,customerHist,'sm')}
    <div style="font-size:0.7rem;color:#4b5563;margin-bottom:6px;line-height:1.35;">📍 ${o.area||o.address||'—'}</div>
    ${nextSt?`<button onclick="event.stopPropagation();updateEmpOrderStatus('${o.id}','${nextSt}')" style="width:100%;padding:5px;background:${EMP_STATUSES[nextSt].color};color:#fff;border:none;border-radius:6px;font-family:'Tajawal',sans-serif;font-size:0.7rem;font-weight:700;cursor:pointer;">← ${EMP_STATUSES[nextSt].label}</button>`:''}
  </div>`;
}

function _updateEmpChipCounts(data, prefix){
  const counts={all:data.length,edited:0,urgent:0};
  Object.keys(EMP_STATUSES).forEach(s=>counts[s]=0);
  data.forEach(o=>{
    if(counts[o.status]!==undefined)counts[o.status]++;
    if(o.needsReview)counts.edited++;
    if(o.urgent&&!['delivered','cancelled','returned','refused'].includes(o.status))counts.urgent++;
  });
  // delivering chip shows queued+delivering combined count
  counts.delivering=(counts.delivering||0)+(counts.queued||0);
  Object.keys(counts).forEach(s=>{const el=document.getElementById(prefix+s);if(el)el.textContent=counts[s];});
}

const _seenEmpOrderIds=new Set();
const _seenOpOrderIds=new Set();

function _playNewOrderSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [[880,0],[1100,0.18],[880,0.36]].forEach(([freq,t])=>{
      const osc=ctx.createOscillator(),g=ctx.createGain();
      osc.connect(g);g.connect(ctx.destination);
      osc.frequency.value=freq;osc.type='sine';
      g.gain.setValueAtTime(0.35,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.25);
      osc.start(ctx.currentTime+t);osc.stop(ctx.currentTime+t+0.25);
    });
  }catch(e){}
  if(navigator.vibrate)navigator.vibrate([200,80,200]);
}

function _ordersLoadingSkeleton(){
  const c=`<div style="background:#f9fafb;border:1px solid #f3f4f6;border-radius:10px;padding:12px;margin-bottom:8px;animation:_skelPulse 1.2s ease-in-out infinite;"><div style="height:13px;background:#e5e7eb;border-radius:4px;width:55%;margin-bottom:8px;"></div><div style="height:10px;background:#e5e7eb;border-radius:4px;width:38%;"></div></div>`;
  return `<style>@keyframes _skelPulse{0%,100%{opacity:1}50%{opacity:.35}}</style>${c.repeat(6)}`;
}
function _ordersDateCutoff(){
  const d=new Date();d.setDate(d.getDate()-30);
  return firebase.firestore.Timestamp.fromDate(d);
}
function loadEmpOrders(){
  const wrap=document.getElementById('empOrdersAdminWrap');
  if(!wrap)return;
  if(_empOrdersUnsub&&_empOrdersAllData.length){_renderEmpOrdersView();return;}
  if(_empOrdersUnsub){_empOrdersUnsub();_empOrdersUnsub=null;}
  wrap.innerHTML=_ordersLoadingSkeleton();
  if(!_empSharedProducts){
    db.collection('operator_products').get()
      .then(s=>{_empSharedProducts=s.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.isRawMaterial);})
      .catch(()=>{});
  }
  _empOrdersUnsub=db.collection('employee_orders')
    .where('createdAt','>=',_ordersDateCutoff())
    .orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      const newData=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(_seenEmpOrderIds.size){
        const fresh=newData.filter(o=>!_seenEmpOrderIds.has(o.id));
        if(fresh.length)_playNewOrderSound();
      }
      newData.forEach(o=>_seenEmpOrderIds.add(o.id));
      _empOrdersAllData=newData;
      _renderEmpOrdersView();
    },e=>{wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';});
}

function _renderEmpOrdersView(){
  const wrap=document.getElementById('empOrdersAdminWrap');
  if(!wrap)return;
  _updateEmpChipCounts(_empOrdersAllData,'eoc-');
  const customerHist=_buildCustomerHistoryMap(_empOrdersAllData);
  if(_empKanbanBoardView){
    let orders=_empOrdersAllData;
    if(_empOrdersSearch) orders=orders.filter(o=>_matchesSearch(o,_empOrdersSearch));
    if(_empAdvFilter) orders=_applyAdvFilter(orders,_empAdvFilter);
    if(!orders.length){wrap.innerHTML=`<div style="color:#9ca3af;font-size:0.82rem;padding:16px;text-align:center;">${_empOrdersSearch||_empAdvFilter?'لا توجد نتائج':'لا يوجد طلبات'}</div>`;return;}
    wrap.innerHTML=_renderKanbanBoard(orders,false,customerHist);
    return;
  }
  let orders;
  if(_empOrdersFilter==='all') orders=_empOrdersAllData;
  else if(_empOrdersFilter==='edited') orders=_empOrdersAllData.filter(o=>o.needsReview);
  // delivering chip shows queued+delivering together as normal cards
  else if(_empOrdersFilter==='delivering'||_empOrdersFilter==='waiting_rep') orders=_empOrdersAllData.filter(o=>o.status==='queued'||o.status==='delivering'||o.status==='waiting_rep');
  else orders=_empOrdersAllData.filter(o=>o.status===_empOrdersFilter);
  if(_empOrdersSearch) orders=orders.filter(o=>_matchesSearch(o,_empOrdersSearch));
  if(_empAdvFilter) orders=_applyAdvFilter(orders,_empAdvFilter);
  if(!orders.length){wrap.innerHTML=`<div style="color:#9ca3af;font-size:0.82rem;padding:16px;text-align:center;">${_empOrdersSearch||_empAdvFilter?'لا توجد نتائج':'لا يوجد طلبات'}</div>`;return;}
  wrap.innerHTML=_empGroupByArea
    ?_renderGroupedByArea(orders,false,customerHist)
    :_renderKanban(orders,false,_empOrdersFilter==='edited'?'all':_empOrdersFilter,customerHist);
}

function setEmpOrderFilter(filter,btn){
  _empOrdersFilter=filter;
  document.querySelectorAll('#empOrdersChips .order-stab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  _renderEmpOrdersView();
}

function loadOperatorOrders(){
  const wrap=document.getElementById('opOrdersWrap');
  if(!wrap)return;
  if(_opOrdersUnsub&&_opOrdersAllData.length){_renderOpOrdersView();return;}
  if(_opOrdersUnsub){_opOrdersUnsub();_opOrdersUnsub=null;}
  wrap.innerHTML=_ordersLoadingSkeleton();
  if(!_empSharedProducts){
    db.collection('operator_products').get()
      .then(s=>{_empSharedProducts=s.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.isRawMaterial);})
      .catch(()=>{});
  }
  _opOrdersUnsub=db.collection('employee_orders')
    .where('createdAt','>=',_ordersDateCutoff())
    .orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      const newData=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(_seenOpOrderIds.size){
        const fresh=newData.filter(o=>!_seenOpOrderIds.has(o.id));
        if(fresh.length){
          _playNewOrderSound();
          const fo=fresh[0];
          const title=fo.urgent?'🔥 طلب مستعجل جديد!':'طلب جديد 🛒';
          sendPushNotification(title,(fo.pageName||'')+(fo.customerPhone?' — '+fo.customerPhone:''),{tag:fo.urgent?'urgent-order':'new-order',orderId:fo.id||''});
        }
      }
      newData.forEach(o=>_seenOpOrderIds.add(o.id));
      _opOrdersAllData=newData;
      _updateFrameGalleryCount();
      _renderOpOrdersView();
      if(_tvModeActive)_renderTVMode();
    },e=>{wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:10px;">❌ '+e.message+'</div>';});
}

function _renderOpOrdersView(){
  const wrap=document.getElementById('opOrdersWrap');
  if(!wrap)return;
  _updateEmpChipCounts(_opOrdersAllData,'ooc-');
  const customerHist=_buildCustomerHistoryMap(_opOrdersAllData);
  if(_opKanbanBoardView){
    let orders=_opOrdersAllData;
    if(_opOrdersSearch) orders=orders.filter(o=>_matchesSearch(o,_opOrdersSearch));
    if(_opAdvFilter) orders=_applyAdvFilter(orders,_opAdvFilter);
    if(!orders.length){wrap.innerHTML=`<div style="color:#9ca3af;font-size:0.82rem;padding:16px;text-align:center;">${_opOrdersSearch||_opAdvFilter?'لا توجد نتائج':'لا يوجد طلبات'}</div>`;return;}
    wrap.innerHTML=_renderKanbanBoard(orders,true,customerHist);
    return;
  }
  // Special combined view for delivering/queued/waiting_rep tabs
  if(_opOrdersFilter==='delivering'||_opOrdersFilter==='queued'||_opOrdersFilter==='waiting_rep'){
    const combined=_opOrdersAllData.filter(o=>o.status==='queued'||o.status==='delivering'||o.status==='waiting_rep');
    wrap.innerHTML=_renderDeliveryQueue(combined);
    const repWrap=document.getElementById('opCancelReport');
    if(repWrap)repWrap.style.display='none';
    return;
  }
  let orders;
  if(_opOrdersFilter==='all') orders=_opOrdersAllData;
  else if(_opOrdersFilter==='edited') orders=_opOrdersAllData.filter(o=>o.needsReview);
  else if(_opOrdersFilter==='urgent') orders=_opOrdersAllData.filter(o=>o.urgent&&!['delivered','cancelled','returned','refused'].includes(o.status));
  else orders=_opOrdersAllData.filter(o=>o.status===_opOrdersFilter);
  if(_opOrdersSearch) orders=orders.filter(o=>_matchesSearch(o,_opOrdersSearch));
  if(_opAdvFilter) orders=_applyAdvFilter(orders,_opAdvFilter);
  if(!orders.length){wrap.innerHTML=`<div style="color:#9ca3af;font-size:0.82rem;padding:16px;text-align:center;">${_opOrdersSearch||_opAdvFilter?'لا توجد نتائج':'لا يوجد طلبات'}</div>`;return;}
  wrap.innerHTML=_opGroupByArea
    ?_renderGroupedByArea(orders,true,customerHist)
    :_renderKanban(orders,true,(_opOrdersFilter==='edited'||_opOrdersFilter==='urgent')?'all':_opOrdersFilter,customerHist);
  // Show reports after render
  if(_opOrdersFilter==='cancelled'){
    setTimeout(renderCancelReport,10);
  } else if(_opOrdersFilter==='all'){
    const repWrap=document.getElementById('opCancelReport');
    if(repWrap){
      const cancelHtml=(() => {
        const cancelled=_opOrdersAllData.filter(o=>o.status==='cancelled'&&o.cancelReason);
        if(!cancelled.length)return '';
        const counts={};
        cancelled.forEach(o=>{const r=o.cancelReason||'غير محدد';counts[r]=(counts[r]||0)+1;});
        const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
        const total=cancelled.length;
        return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:14px;margin-top:8px;">
          <div style="font-weight:800;color:#374151;font-size:0.9rem;margin-bottom:10px;">📊 تحليل أسباب الإلغاء (${total} طلب)</div>
          ${sorted.map(([reason,count])=>{const pct=Math.round((count/total)*100);return `<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;"><span style="font-size:0.82rem;color:#374151;">${reason}</span><span style="font-size:0.78rem;font-weight:700;color:#ef4444;">${count} (${pct}%)</span></div><div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden;"><div style="height:100%;background:#ef4444;border-radius:4px;width:${pct}%;"></div></div></div>`;}).join('')}
        </div>`;
      })();
      repWrap.innerHTML=cancelHtml+renderRepReport();
      repWrap.style.display=repWrap.innerHTML?'block':'none';
    }
  } else {
    const repWrap=document.getElementById('opCancelReport');
    if(repWrap)repWrap.style.display='none';
  }
}

function toggleOpSelectMode(){
  _opSelectMode=!_opSelectMode;
  if(!_opSelectMode){_opSelectedIds.clear();}
  const btn=document.getElementById('opSelectModeBtn');
  const bar=document.getElementById('opBulkBar');
  if(btn){btn.style.background=_opSelectMode?'#111':'#fff';btn.style.color=_opSelectMode?'#fff':'#555';btn.style.borderColor=_opSelectMode?'#111':'#ebebeb';btn.textContent=_opSelectMode?'✕ إلغاء التحديد':'☑ تحديد للطباعة';}
  if(bar){bar.style.display=_opSelectMode?'flex':'none';}
  _renderOpOrdersView();
}
function opToggleSelect(id){
  if(_opSelectedIds.has(id))_opSelectedIds.delete(id);else _opSelectedIds.add(id);
  _updateBulkBar();
  // toggle checkbox UI without full re-render
  const cb=document.getElementById('opchk_'+id);
  if(cb){cb.checked=_opSelectedIds.has(id);}
  const card=document.getElementById('opcard_'+id);
  if(card){card.style.outline=_opSelectedIds.has(id)?'2.5px solid #1a3a2a':'';}
}
function opSelectAll(){
  const wrap=document.getElementById('opOrdersWrap');
  if(!wrap)return;
  wrap.querySelectorAll('[data-order-id]').forEach(el=>{_opSelectedIds.add(el.dataset.orderId);});
  _updateBulkBar();
  wrap.querySelectorAll('[data-order-id]').forEach(el=>{
    const cb=el.querySelector('input[type=checkbox]');
    if(cb)cb.checked=true;
    el.style.outline='2.5px solid #1a3a2a';
  });
}
function opClearSelect(){
  _opSelectedIds.clear();
  _updateBulkBar();
  document.querySelectorAll('[data-order-id]').forEach(el=>{
    const cb=el.querySelector('input[type=checkbox]');
    if(cb)cb.checked=false;
    el.style.outline='';
  });
}
function _updateBulkBar(){
  const c=document.getElementById('opBulkCount');
  if(c)c.textContent=_opSelectedIds.size;
}
async function _moveToPreparing(orders){
  const toMove=orders.filter(o=>o.status==='pending');
  if(!toMove.length) return;
  const batch=db.batch();
  toMove.forEach(o=>{
    batch.update(db.collection('employee_orders').doc(o.id),{
      status:'preparing',
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
  toast(`⚙️ تم نقل ${toMove.length} طلب لـ"قيد التجهيز"`);
}

async function printSelectedOrders(){
  if(!_opSelectedIds.size){toast('⚠️ لم تحدد أي طلب');return;}
  const ids=[..._opSelectedIds];
  const orders=ids.map(id=>_opOrdersAllData.find(o=>o.id===id)).filter(Boolean);
  if(!orders.length){toast('⚠️ لم يتم العثور على الطلبات');return;}
  orders.sort((a,b)=>{const pa=(a.products?.[0]?.name||a.productName||'').trim();const pb=(b.products?.[0]?.name||b.productName||'').trim();return pa.localeCompare(pb,'ar');});
  await _moveToPreparing(orders);
  const pw=window.open('','_blank','width=700,height=900');
  const rows=orders.map(o=>{
    const prods=(o.products||[{name:o.productName||'?',qty:1,price:o.price||0}]);
    const prodRows=prods.map(p=>`<tr><td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;">${p.name}</td><td style="padding:5px 8px;text-align:center;border-bottom:1px solid #f0f0f0;">${p.qty||1}</td><td style="padding:5px 8px;text-align:left;border-bottom:1px solid #f0f0f0;">${((p.price||0)*(p.qty||1)).toFixed(2)}</td></tr>`).join('');
    const net=(o.netPrice!=null?o.netPrice:(o.totalPrice||0));
    return `<div style="border:1.5px solid #ddd;border-radius:10px;padding:14px;margin-bottom:14px;page-break-inside:avoid;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:800;font-size:1rem;color:#1a3a2a;">#${o.orderNum||o.id.slice(-6).toUpperCase()}</div>
        <div style="font-size:0.8rem;color:#6b7280;">${o.pageName||o.storeName||''}</div>
      </div>
      <div style="font-size:0.85rem;margin-bottom:4px;">📞 ${o.customerPhone||'—'}</div>
      ${o.address?`<div style="font-size:0.82rem;color:#374151;margin-bottom:4px;">📍 ${o.address}</div>`:''}
      ${o.notes?`<div style="font-size:0.8rem;color:#854d0e;margin-bottom:6px;">📝 ${o.notes}</div>`:''}
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:6px;">
        <thead><tr style="background:#f9fafb;"><th style="padding:5px 8px;text-align:right;">المنتج</th><th style="padding:5px 8px;text-align:center;">كمية</th><th style="padding:5px 8px;text-align:left;">السعر</th></tr></thead>
        <tbody>${prodRows}</tbody>
        <tfoot><tr><td colspan="2" style="padding:6px 8px;font-weight:800;text-align:right;">المجموع</td><td style="padding:6px 8px;font-weight:900;text-align:left;color:#166534;">${net.toFixed(2)} د.أ</td></tr></tfoot>
      </table>
    </div>`;
  }).join('');
  pw.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>طباعة ${orders.length} طلب</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
  <style>body{font-family:'Tajawal',Arial,sans-serif;padding:16px;max-width:680px;margin:0 auto;direction:rtl;}
  .no-print{text-align:center;margin-bottom:16px;}@media print{.no-print{display:none;}}</style></head>
  <body>
  <div class="no-print"><button onclick="window.print()" style="padding:10px 28px;background:#1a3a2a;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">🖨️ طباعة ${orders.length} طلب</button></div>
  ${rows}</body></html>`);
  pw.document.close();
}

async function printSelectedLabels(){
  if(!_opSelectedIds.size){toast('⚠️ لم تحدد أي طلب');return;}
  const ids=[..._opSelectedIds];
  const orders=ids.map(id=>_opOrdersAllData.find(o=>o.id===id)).filter(Boolean);
  if(!orders.length){toast('⚠️ لم يتم العثور على الطلبات');return;}
  orders.sort((a,b)=>{const pa=(a.products?.[0]?.name||a.productName||'').trim();const pb=(b.products?.[0]?.name||b.productName||'').trim();return pa.localeCompare(pb,'ar');});
  await _moveToPreparing(orders);
  const pw=window.open('','_blank','width=900,height=800');
  const labels=orders.map(o=>{
    const url=window.location.origin+window.location.pathname+'?order='+o.id;
    const phone=(o.customerPhone||'').replace(/\s+/g,'');
    const addr=(o.address||'').trim();
    const page=(o.pageName||'').trim();
    const prods=(o.products&&o.products.length?o.products:[{name:o.productName||'',qty:1}]);
    const prodLines=prods.map(p=>{const qty=p.qty||p.quantity||1;return p.name+(qty>1?' × '+qty:'');}).filter(Boolean).join('، ');
    const divId='qrl_'+o.id;
    return {url,phone,addr,page,prodLines,divId,id:o.id};
  });
  const labelsHtml=labels.map((l,i)=>`
    <div class="label-wrap${i<labels.length-1?' pg-break':''}">
      <div class="label-header">${l.page||''}</div>
      <div class="label-body">
        <div class="qr-col" id="${l.divId}"></div>
        <div class="vline"></div>
        <div class="info-col">
          ${l.phone?`<div class="info-phone">${l.phone}</div>`:''}
          ${l.prodLines?`<div class="info-row">📦 ${l.prodLines}</div>`:''}
          ${l.addr?`<div class="info-row addr">📍 ${l.addr}</div>`:''}
        </div>
      </div>
    </div>`).join('');
  const qrScripts=labels.map(l=>`new QRCode(document.getElementById('${l.divId}'),{text:'${l.url}',width:160,height:160,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});`).join('');
  pw.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
<title>ليبلات ${orders.length} طلب</title>
<style>
@page{size:auto;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#fff;font-family:Arial,sans-serif;}
.label-wrap{width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.pg-break{break-after:page;page-break-after:always;}
.label-header{background:#1a1a2e;color:#fff;text-align:center;font-size:13pt;font-weight:900;padding:3mm 2mm;flex-shrink:0;}
.label-body{flex:1;display:flex;flex-direction:row;align-items:stretch;overflow:hidden;min-height:0;}
.qr-col{flex-shrink:0;width:42%;display:flex;align-items:center;justify-content:center;padding:3mm;background:#f5f5f5;}
.qr-col img,.qr-col canvas{max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;}
.vline{width:1px;background:#ccc;flex-shrink:0;}
.info-col{flex:1;display:flex;flex-direction:column;justify-content:center;gap:2.5mm;padding:3mm 4mm;overflow:hidden;}
.info-phone{font-size:13pt;font-weight:900;direction:ltr;color:#111;word-break:break-all;line-height:1.2;}
.info-row{font-size:9pt;font-weight:700;color:#1a3a2a;word-break:break-word;line-height:1.35;}
.info-row.addr{color:#444;font-weight:600;font-size:8.5pt;}
.no-print{text-align:center;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;}
@media screen{.label-wrap{height:auto;min-height:50vw;max-height:none;margin-bottom:6mm;border:1px dashed #ccc;}}
@media print{.no-print{display:none!important;}}
</style></head><body>
<div class="no-print"><button onclick="window.print()" style="padding:10px 28px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">🏷️ طباعة ${orders.length} ليبل</button></div>
${labelsHtml}
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
<script>${qrScripts}<\/script>
</body></html>`);
  pw.document.close();
}

function setOpOrderFilter(filter,btn){
  _opOrdersFilter=filter;
  document.querySelectorAll('#opOrdersChips .order-stab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  _renderOpOrdersView();
}

async function deleteEmpOrder(id){
  if(!confirm('حذف هذا الطلب نهائياً؟'))return;
  try{
    const snap=await db.collection('employee_orders').doc(id).get();
    const data=snap.exists?snap.data():null;
    await db.collection('employee_orders').doc(id).delete();
    if(data?.status==='delivered'){
      unsyncOrderFromAccounting(id);
      addPageRefundEntry(id,data,'deleted');
    }
    toast('🗑 تم حذف الطلب');
  }catch(e){toast('❌ '+e.message);}
}

async function updateEmpOrderStatus(id,newStatus){
  try{
    const docRef=db.collection('employee_orders').doc(id);
    const snap=await docRef.get();
    const data=snap.data();
    const prevStatus=data.status;
    if(prevStatus===newStatus)return;
    // Block delivered if no rep assigned
    if(newStatus==='delivered'&&!data.deliveryRepName){
      toast('⚠️ يجب تعيين مندوب توصيل أولاً قبل تسليم الطلب');
      return;
    }
    const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:`${_empSt(prevStatus).label} ← ${_empSt(newStatus).label}`};
    const editHistory=[...(data.editHistory||[]),editEntry];
    const extraFields={};
    if(newStatus==='delivered') extraFields.deliveredDate=jordanDateStr();
    if(!['delivered','onhold'].includes(newStatus)&&prevStatus==='delivered')
      extraFields.deliveredDate=firebase.firestore.FieldValue.delete();
    if(['cancelled','returned','refused'].includes(newStatus)&&prevStatus!=='delivered')
      extraFields.deliveredDate=firebase.firestore.FieldValue.delete();
    // Clear rep assignment when moving back to waiting_rep
    const _deleteFields=[];
    if(newStatus==='waiting_rep'){
      extraFields.deliveryRepName=firebase.firestore.FieldValue.delete();
      extraFields.deliveryRepPhone=firebase.firestore.FieldValue.delete();
      extraFields.assignedAt=firebase.firestore.FieldValue.delete();
      _deleteFields.push('deliveryRepName','deliveryRepPhone','assignedAt');
    }
    await docRef.update({status:newStatus,editHistory,...extraFields,needsReview:firebase.firestore.FieldValue.delete(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    toast('✅ تم تحديث الحالة');
    // Update local cache immediately (don't wait for snapshot)
    const _patchLocal=(arr)=>{
      if(!arr)return;
      const idx=arr.findIndex(o=>o.id===id);
      if(idx<0)return;
      const updated={...arr[idx],status:newStatus,...extraFields};
      _deleteFields.forEach(k=>delete updated[k]);
      arr[idx]=updated;
    };
    _patchLocal(typeof _opOrdersAllData!=='undefined'?_opOrdersAllData:null);
    _patchLocal(typeof _empOrdersAllData!=='undefined'?_empOrdersAllData:null);
    sendPushNotification('تحديث طلب 📋','طلب '+(data.orderNum||('#'+id.slice(-6)))+' ← '+_empSt(newStatus).label,{tag:'status-update',orderId:id});
    if(newStatus==='delivered') syncOrderToAccounting(id,data,null,false,_opCurrentSession?.id||null);
    // Only 'returned' and 'refused' trigger accounting refund — 'cancelled' is a no-op
    if(['returned','refused'].includes(newStatus)&&prevStatus==='delivered'){
      _handleDeliveredCancel(id,data,newStatus);
    }
    if(!['cancelled','returned','refused','delivered'].includes(newStatus)){
      removePageRefundEntry(id);
    }
    // Re-render orders list so UI reflects the change immediately
    if(typeof _renderOpOrdersView==='function') _renderOpOrdersView();
    if(typeof _renderEmpOrdersView==='function') _renderEmpOrdersView();
  }catch(e){toast('❌ '+e.message);}
}

async function syncOrderToAccounting(orderId,orderData,dateOverride,silent,sessionId){
  // Find store linked to this page
  if(!_opStoresList.length) await loadOpStores();
  const store=_opStoresList.find(s=>s.pageId===orderData.pageId);
  if(!store) return; // no linked store — skip silently

  // Prevent duplicate sync
  try{
    const dup=await db.collection('operator_sales').where('fromOrderId','==',orderId).limit(1).get();
    if(!dup.empty) return;
  }catch(e){}

  // Ensure products list is loaded for cost lookup
  if(!_opProductsList.length) await loadOpProducts();

  const products=orderData.products||[];
  if(!products.length) return;

  try{
    const batch=db.batch();
    products.forEach(product=>{
      // بحث بالـ ID أولاً، فإذا ما لاقى يبحث بالاسم (للطلبات القديمة)
      const opProd=_opProductsList.find(p=>p.id===product.id)||_opProductsList.find(p=>p.name===product.name);
      const storePrice=opProd?.storePrices?.[store.id]||0;
      const totalCost=opProd?((opProd.rawMaterialCost||0)+(opProd.treeCost||0)+(opProd.machineWorkerWage||0)+(opProd.assemblyWorkerWage||0)):0;
      // المستحق = السعر الرسمي (سعر المتجر أو التكلفة). soldPrice = السعر الفعلي يلي انباع فيه للزبون
      const sellPrice=storePrice||totalCost||0;
      const customerUnit=parseFloat(product.price)||0;
      const soldPrice=(customerUnit>0&&customerUnit<sellPrice)?customerUnit:sellPrice;
      const ref=db.collection('operator_sales').doc();
      batch.set(ref,{
        storeId:store.id,
        storeName:store.name,
        productId:product.id||'',
        productName:product.name||'',
        qty:product.qty||1,
        sellPrice,
        soldPrice,
        rawMaterialCost:opProd?(opProd.rawMaterialCost||0):0,
        treeCost:opProd?(opProd.treeCost||0):0,
        machineWorkerWage:opProd?(opProd.machineWorkerWage||0):0,
        assemblyWorkerWage:opProd?(opProd.assemblyWorkerWage||0):0,
        notes:orderData.notes||'',
        date:dateOverride||jordanDateStr(),
        delivered:true,
        fromOrderId:orderId,
        sessionId:sessionId||null,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    if(!silent) toast(`✅ تم تسجيل الطلب في حساب "${store.name}"`);
  }catch(e){console.error('syncOrderToAccounting error:',e);}
}

async function unsyncOrderFromAccounting(orderId){
  try{
    const snap=await db.collection('operator_sales').where('fromOrderId','==',orderId).get();
    if(snap.empty) return;
    const batch=db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    toast('🗑 تم حذف السجلات من كشف الحساب');
  }catch(e){console.error('unsyncOrderFromAccounting error:',e);}
}

// Smart cancel handler: if delivery was in current session → remove from sales (reversal).
// If delivery was in a different/closed session → keep old record, add refund to current period.
async function _handleDeliveredCancel(orderId, orderData, reason){
  try{
    const snap=await db.collection('operator_sales').where('fromOrderId','==',orderId).get();
    if(snap.empty){
      // No sale record found — just add refund entry to track the loss
      await addPageRefundEntry(orderId,orderData,reason);
      return;
    }
    const saleSessionId=snap.docs[0].data().sessionId||null;
    const currentSessionId=_opCurrentSession?.id||null;
    if(saleSessionId&&currentSessionId&&saleSessionId===currentSessionId){
      // Same session: reverse the delivery — delete the sales records, no refund entry needed
      const batch=db.batch();
      snap.docs.forEach(d=>batch.delete(d.ref));
      await batch.commit();
      toast('↩️ تم إلغاء التسجيل من الكشف الحالي');
    }else{
      // Different/old session: keep old record intact, add refund entry for today (current period)
      await addPageRefundEntry(orderId,orderData,reason);
    }
  }catch(e){console.error('_handleDeliveredCancel error:',e);}
}

async function addPageRefundEntry(orderId, orderData, reason){
  try{
    if(!_opProductsList.length) await loadOpProducts();
    if(!_opStoresList.length) await loadOpStores();
    const products=orderData.products||[];
    if(!products.length) return;
    // find linked store
    const store=_opStoresList.find(s=>s.pageId===orderData.pageId)||null;
    let totalCost=0;
    const items=products.map(p=>{
      const op=_opProductsList.find(x=>x.id===p.id)||_opProductsList.find(x=>x.name===p.name);
      const unitCost=op?((op.rawMaterialCost||0)+(op.treeCost||0)+(op.machineWorkerWage||0)+(op.assemblyWorkerWage||0)):0;
      const qty=p.qty||1;
      totalCost+=unitCost*qty;
      return {name:p.name||'',qty,unitCost};
    });
    if(totalCost<=0) return;
    await db.collection('page_refunds').add({
      pageId:orderData.pageId||'',
      pageName:orderData.pageName||'بدون صفحة',
      storeId:store?store.id:'',
      storeName:store?store.name:'',
      orderId,
      orderNum:orderData.orderNum||orderData.id||'',
      customerName:orderData.workerName||orderData.customerName||'',
      customerPhone:orderData.customerPhone||'',
      items,
      totalCost,
      date:jordanDateStr(),
      sessionId:_opCurrentSession?.id||null,
      reason,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
  }catch(e){console.error('addPageRefundEntry error:',e);}
}

async function removePageRefundEntry(orderId){
  try{
    const snap=await db.collection('page_refunds').where('orderId','==',orderId).get();
    if(snap.empty) return;
    const batch=db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    toast('↩️ تم حذف رصيد المرتجع');
  }catch(e){console.error('removePageRefundEntry error:',e);}
}

async function deletePageRefund(refundId){
  if(!confirm('حذف هذا الرصيد؟')) return;
  try{
    await db.collection('page_refunds').doc(refundId).delete();
    _acctCurrentRefunds=(_acctCurrentRefunds||[]).filter(r=>r.id!==refundId);
    renderAcctDetail();
    toast('🗑 تم الحذف');
  }catch(e){toast('❌ '+e.message);}
}

function openEmpOrderImage(src){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  ov.innerHTML=`<img src="${src}" style="max-width:95vw;max-height:90vh;border-radius:10px;object-fit:contain;">`;
  ov.onclick=()=>document.body.removeChild(ov);
  document.body.appendChild(ov);
}

function printOrderQR(orderId) {
  db.collection('employee_orders').doc(orderId).get().then(snap=>{
    const o=snap.exists?{id:snap.id,...snap.data()}:{id:orderId,customerPhone:'',address:''};
    if(o.status==='pending'){updateEmpOrderStatus(orderId,'preparing');o.status='preparing';}
    const url=window.location.origin+window.location.pathname+'?order='+orderId;
    const phone=(o.customerPhone||'').replace(/\s+/g,'');
    const addr=(o.address||'').trim();
    const page=(o.pageName||'').trim();
    const prods=o.products&&o.products.length?o.products:[{name:o.productName||''}];
    const prodLines=prods.map(p=>{const qty=p.qty||p.quantity||1;return p.name+(qty>1?' × '+qty:'');}).filter(Boolean).join('، ');
    const pw=window.open('','_blank','width=420,height=320');
    pw.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
<title>QR #${orderId.slice(-6).toUpperCase()}</title>
<style>
@page{size:80mm 55mm;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:80mm;height:55mm;background:#fff;overflow:hidden;font-family:Arial,sans-serif;}
.label{width:80mm;height:55mm;display:flex;flex-direction:row;align-items:stretch;}
.qr-side{flex-shrink:0;width:55mm;display:flex;align-items:center;justify-content:center;padding:2mm;}
.divider{width:0.4mm;background:#222;flex-shrink:0;margin:2mm 0;}
.info{flex:1;padding:2.5mm 3mm;display:flex;flex-direction:column;justify-content:center;gap:2.5mm;overflow:hidden;}
.row{display:flex;align-items:flex-start;gap:1.5mm;line-height:1.3;}
.icon{font-size:8pt;flex-shrink:0;margin-top:0.5pt;}
.txt{word-break:break-word;font-weight:700;font-size:8pt;}
.txt.phone{font-size:9pt;direction:ltr;}
.txt.page{color:#6b21a8;}
.txt.prod{color:#1a3a2a;}
.sep{border-top:0.4mm dashed #bbb;margin:1mm 0;}
.no-print{position:fixed;bottom:6px;left:50%;transform:translateX(-50%);}
@media print{.no-print{display:none!important;}}
</style></head><body>
<div class="label">
  <div class="qr-side" id="qrl"></div>
  <div class="divider"></div>
  <div class="info">
    ${page?`<div class="row"><span class="icon">🏪</span><span class="txt page">${page}</span></div>`:''}
    ${prodLines?`<div class="row"><span class="icon">📦</span><span class="txt prod">${prodLines}</span></div>`:''}
    ${(page||prodLines)?`<div class="sep"></div>`:''}
    ${phone?`<div class="row"><span class="icon">📞</span><span class="txt phone">${phone}</span></div>`:''}
    ${addr?`<div class="row"><span class="icon">📍</span><span class="txt">${addr}</span></div>`:''}
  </div>
</div>
<button class="no-print" onclick="window.print()" style="padding:7px 20px;background:#1a3a2a;color:#fff;border:none;border-radius:8px;font-family:sans-serif;font-size:0.82rem;cursor:pointer;">🖨 طباعة</button>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
<script>new QRCode(document.getElementById('qrl'),{text:'${url}',width:194,height:194,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});<\/script>
</body></html>`);
    pw.document.close();
  }).catch(()=>{
    toast('❌ تعذّر جلب بيانات الطلب');
  });
}

function printEmpOrder(orderId,withPhoto){
  db.collection('employee_orders').doc(orderId).get().then(snap=>{
    if(!snap.exists){toast('❌ الطلب غير موجود');return;}
    const o={id:snap.id,...snap.data()};
    if(o.status==='pending'){
      updateEmpOrderStatus(orderId,'preparing');
      o.status='preparing';
    }
    const st=_empSt(o.status);
    const prods=o.products||[{name:o.productName||'?',price:o.price||0,qty:1}];
    const total=o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0);
    const dlv=o.deliveryFee||0;
    const net=o.netPrice!=null?o.netPrice:total+dlv;
    const pw=window.open('','_blank','width=620,height=750');
    pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${o.id.slice(-6).toUpperCase()}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>
body{font-family:'Tajawal',Arial,sans-serif;padding:24px;max-width:520px;margin:0 auto;color:#111;direction:rtl;}
.hd{text-align:center;border-bottom:2px solid #1a3a2a;padding-bottom:14px;margin-bottom:16px;}
.hd-title{font-size:1.5rem;font-weight:800;color:#1a3a2a;}
.hd-sub{font-size:0.8rem;color:#6b7280;margin-top:4px;}
.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:0.88rem;}
.lbl{color:#6b7280;font-weight:600;}
.val{font-weight:700;}
.pt{font-weight:800;font-size:0.9rem;margin:14px 0 8px;color:#1a3a2a;}
.pr{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dotted #e5e7eb;font-size:0.85rem;}
.tot{display:flex;justify-content:space-between;padding:12px 0;font-size:1rem;font-weight:800;border-top:2px solid #1a3a2a;margin-top:6px;color:#1a3a2a;}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:0.8rem;font-weight:700;}
.foot{text-align:center;margin-top:20px;font-size:0.72rem;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;}
@media print{.no-print{display:none;}}
</style></head><body>
${o.urgent?`<div style="background:linear-gradient(90deg,#dc2626,#ef4444);color:#fff;padding:8px 16px;font-weight:800;text-align:center;font-size:1rem;border-radius:8px;margin-bottom:14px;letter-spacing:1px;">🔥 طلب مستعجل 🔥</div>`:''}
<div class="hd"><div class="hd-title">الكسواني روزميري</div><div class="hd-sub">فاتورة طلب &nbsp;·&nbsp; ${jordanDisplayDate()}</div></div>
<div class="row"><span class="lbl">رقم الطلب</span><span class="val">${o.orderNum||('#'+o.id.slice(-6).toUpperCase())}</span></div>
<div class="row"><span class="lbl">الصفحة</span><span class="val">${o.pageName}</span></div>
<div class="row"><span class="lbl">رقم الزبون</span><span class="val" dir="ltr">${o.customerPhone}</span></div>
<div class="row"><span class="lbl">العنوان</span><span class="val">${o.address}</span></div>
${o.notes?`<div class="row"><span class="lbl">ملاحظات</span><span class="val">${o.notes}</span></div>`:''}
<div class="row"><span class="lbl">الحالة</span><span class="badge" style="background:${st.bg};color:${st.color};">${st.label}</span></div>
<div class="pt">📦 المنتجات</div>
${prods.map(p=>`<div class="pr" style="flex-direction:column;align-items:flex-start;gap:3px;"><div style="display:flex;justify-content:space-between;width:100%;"><span>${p.name}${p.color?` <span style="font-size:0.78rem;color:#6b7280;">(${p.color})</span>`:''}</span><span>${p.qty||1} × ${p.price.toFixed(2)} = <strong>${(p.price*(p.qty||1)).toFixed(2)} د.أ</strong></span></div>${p.writing?`<div style="font-size:0.8rem;color:#1a3a2a;background:#f0fdf4;padding:3px 8px;border-radius:6px;border-right:3px solid #16a34a;">✍️ الكتابة: ${p.writing}</div>`:''}</div>`).join('')}
${dlv>0?`<div class="tot" style="border-top:1.5px solid #e5e7eb;color:#111;font-weight:700;font-size:0.88rem;"><span>إجمالي المنتجات</span><span>${total.toFixed(2)} د.أ</span></div>
<div class="row"><span class="lbl">🚗 أجور التوصيل</span><span class="val" style="color:#f97316;">+ ${dlv.toFixed(2)} د.أ</span></div>
<div class="tot"><span>الحساب النهائي</span><span style="color:#16a34a;">${net.toFixed(2)} د.أ</span></div>`:`<div class="tot"><span>الحساب النهائي</span><span>${total.toFixed(2)} د.أ</span></div>`}
${withPhoto?(()=>{const imgs=o.imageDataUrls&&o.imageDataUrls.length?o.imageDataUrls:(o.imageDataUrl?[o.imageDataUrl]:[]);return imgs.length?`<div style="margin-top:16px;display:grid;grid-template-columns:repeat(${Math.min(imgs.length,3)},1fr);gap:6px;">${imgs.map(src=>`<img src="${src}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;">`).join('')}</div>`:''})():''}
${o.editHistory&&o.editHistory.length?`<div style="margin-top:10px;font-size:0.72rem;color:#f97316;">✏️ ${o.editHistory.map(e=>e.note+' ('+e.by+')').join(' | ')}</div>`:''}
<div style="display:flex;align-items:center;justify-content:space-between;margin-top:18px;padding-top:14px;border-top:1px dashed #e5e7eb;">
  <div style="font-size:0.72rem;color:#9ca3af;">امسح الكود لتحديث الطلب</div>
  <div id="qr-print" style="width:90px;height:90px;"></div>
</div>
<div class="foot">
<button class="no-print" onclick="window.print()" style="padding:10px 28px;background:#1a3a2a;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:0.9rem;cursor:pointer;margin-bottom:12px;">🖨 طباعة</button>
<div>الكسواني روزميري © ${new Date().getFullYear()}</div></div>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
<script>window.addEventListener('load',function(){try{new QRCode(document.getElementById('qr-print'),{text:'${orderId}',width:90,height:90,colorDark:'#000',colorLight:'#fff'});}catch(e){}});<\/script>
</body></html>`);
    pw.document.close();
  }).catch(e=>toast('❌ '+e.message));
}

// ===== EMPLOYEE POINTS SYSTEM =====
let _empPointsSettings={pointValue:1};
async function _loadEmpPointsSettings(){
  try{const s=await db.collection('settings').doc('emp_points').get();if(s.exists)_empPointsSettings=s.data();}catch(e){}
}
async function loadEmpPoints(){
  if(!_empCurrentUser)return;
  try{
    await _loadEmpPointsSettings();
    const pv=_empPointsSettings.pointValue||1;
    const [ordersSnap,approvedSnap,pendingSnap]=await Promise.all([
      db.collection('employee_orders').where('workerId','==',_empCurrentUser.id).get(),
      db.collection('points_requests').where('workerId','==',_empCurrentUser.id).where('status','==','approved').get(),
      db.collection('points_requests').where('workerId','==',_empCurrentUser.id).orderBy('requestedAt','desc').limit(5).get()
    ]);
    const earned=ordersSnap.size;
    const paid=approvedSnap.docs.reduce((s,d)=>s+(d.data().pointsRequested||0),0);
    const available=Math.max(0,earned-paid);
    const el1=document.getElementById('empPointsTotal');const el2=document.getElementById('empPointsAvailable');const el3=document.getElementById('empPointsAmount');
    if(el1)el1.textContent=earned;
    if(el2)el2.textContent=available;
    if(el3)el3.textContent=(available*pv).toFixed(2);
    const reqWrap=document.getElementById('empPointsRequestsList');
    if(reqWrap){
      if(pendingSnap.empty){reqWrap.innerHTML='';return;}
      reqWrap.innerHTML='<div style="font-size:0.78rem;font-weight:700;color:#374151;margin-bottom:6px;">آخر الطلبات:</div>'+
        pendingSnap.docs.map(d=>{const r=d.data();
          const st=r.status==='approved'?{l:'✅ مُوافق عليه',c:'#166534',bg:'#f0fdf4'}:r.status==='rejected'?{l:'❌ مرفوض',c:'#dc2626',bg:'#fef2f2'}:{l:'⏳ قيد المراجعة',c:'#d97706',bg:'#fffbeb'};
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${st.bg};border-radius:8px;margin-bottom:4px;">
            <div><div style="font-size:0.82rem;font-weight:700;color:${st.c};">${st.l}</div>
            <div style="font-size:0.72rem;color:#6b7280;">${r.pointsRequested} نقطة = ${(r.amountRequested||0).toFixed(2)} د.أ</div></div>
            <div style="font-size:0.7rem;color:#9ca3af;">${r.requestedAt?.toDate?.()?.toLocaleDateString('ar-JO')||''}</div></div>`;
        }).join('');
    }
  }catch(e){console.error('loadEmpPoints',e);}
}
async function requestEmpPayout(){
  if(!_empCurrentUser)return;
  const available=parseInt(document.getElementById('empPointsAvailable')?.textContent||0);
  if(!available||available<=0){toast('⚠️ لا يوجد نقاط متاحة للصرف');return;}
  await _loadEmpPointsSettings();
  const pv=_empPointsSettings.pointValue||1;
  const amount=(available*pv).toFixed(2);
  if(!confirm(`طلب صرف ${available} نقطة = ${amount} د.أ؟`))return;
  try{
    const pending=await db.collection('points_requests').where('workerId','==',_empCurrentUser.id).where('status','==','pending').get();
    if(!pending.empty){toast('⚠️ يوجد طلب صرف قيد المراجعة بالفعل');return;}
    await db.collection('points_requests').add({
      workerId:_empCurrentUser.id,
      workerName:_empCurrentUser.displayName||_empCurrentUser.username||'',
      pointsRequested:available,amountRequested:parseFloat(amount),
      status:'pending',requestedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم إرسال طلب الصرف');
    loadEmpPoints();
  }catch(e){toast('❌ '+e.message);}
}
async function saveEmpPointValue(){
  const val=parseFloat(document.getElementById('empPointValueInput')?.value||0);
  if(isNaN(val)||val<0){toast('⚠️ أدخل قيمة صحيحة');return;}
  try{
    await db.collection('settings').doc('emp_points').set({pointValue:val},{merge:true});
    _empPointsSettings.pointValue=val;
    toast('✅ تم حفظ قيمة النقطة: '+val+' د.أ/نقطة');
    loadAdminEmpPoints();
  }catch(e){toast('❌ '+e.message);}
}
async function loadAdminEmpPoints(){
  await _loadEmpPointsSettings();
  const pvInput=document.getElementById('empPointValueInput');
  if(pvInput)pvInput.value=_empPointsSettings.pointValue||1;
  const pv=_empPointsSettings.pointValue||1;
  const reqWrap=document.getElementById('adminPointsRequestsList');
  if(reqWrap){
    try{
      const snap=await db.collection('points_requests').where('status','==','pending').get();
      if(snap.empty){reqWrap.innerHTML='<div style="color:#9ca3af;font-size:0.82rem;padding:8px;text-align:center;">لا يوجد طلبات معلقة</div>';}
      else{reqWrap.innerHTML=snap.docs.map(d=>{const r=d.data();return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fffbeb;border-radius:9px;margin-bottom:8px;border:1px solid #fde68a;">
          <div><div style="font-weight:700;font-size:0.88rem;color:#92400e;">${r.workerName||'موظف'}</div>
          <div style="font-size:0.78rem;color:#6b7280;">${r.pointsRequested} نقطة = ${(r.amountRequested||0).toFixed(2)} د.أ</div></div>
          <div style="display:flex;gap:6px;">
            <button onclick="reviewPointsRequest('${d.id}','approved')" style="padding:6px 12px;background:#166534;color:#fff;border:none;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer;">✅ موافقة</button>
            <button onclick="reviewPointsRequest('${d.id}','rejected')" style="padding:6px 12px;background:#dc2626;color:#fff;border:none;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer;">❌ رفض</button>
          </div></div>`;}).join('');}
    }catch(e){reqWrap.innerHTML=`<div style="color:#dc2626;font-size:0.82rem;">خطأ: ${e.message}</div>`;}
  }
  const lbWrap=document.getElementById('adminEmpPointsList');
  if(lbWrap){
    try{
      const workersSnap=await db.collection('employee_workers').get();
      const workers=workersSnap.docs.map(d=>({id:d.id,...d.data()}));
      const results=await Promise.all(workers.map(async w=>{
        const [oSnap,pSnap]=await Promise.all([
          db.collection('employee_orders').where('workerId','==',w.id).get(),
          db.collection('points_requests').where('workerId','==',w.id).where('status','==','approved').get()
        ]);
        const earned=oSnap.size;
        const paid=pSnap.docs.reduce((s,d)=>s+(d.data().pointsRequested||0),0);
        return{...w,earned,paid,available:Math.max(0,earned-paid)};
      }));
      results.sort((a,b)=>b.earned-a.earned);
      lbWrap.innerHTML=results.length?results.map((w,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f9fafb;border-radius:9px;margin-bottom:6px;border:1px solid #e5e7eb;">
          <div style="font-size:1.1rem;min-width:24px;text-align:center;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)}</div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:0.88rem;color:#1a3a2a;">${w.name||w.username||'موظف'}</div>
            <div style="font-size:0.75rem;color:#6b7280;">${w.earned} نقطة مكتسبة · ${w.available} متاحة · ${w.paid} مُصرفة</div>
          </div>
          <div style="text-align:left;"><div style="font-weight:800;font-size:0.9rem;color:#166534;">${(w.available*pv).toFixed(2)} د.أ</div></div>
          ${w.available>0?`<button onclick="claimWorkerPoints('${w.id}','${(w.name||w.username||'موظف').replace(/'/g,"\\'")}',${w.available},${(w.available*pv).toFixed(2)})" title="استلام النقاط" style="width:32px;height:32px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;">🎯</button>`:'<div style="width:32px;"></div>'}
        </div>`).join(''):'<div style="color:#9ca3af;font-size:0.82rem;text-align:center;padding:12px;">لا يوجد موظفون</div>';
    }catch(e){lbWrap.innerHTML=`<div style="color:#dc2626;font-size:0.82rem;">خطأ: ${e.message}</div>`;}
  }
}
async function claimWorkerPoints(workerId,workerName,available,amount){
  if(!confirm(`تأكيد استلام ${available} نقطة (${amount} د.أ) لـ ${workerName}؟\nسيتم تصفير النقاط المتاحة.`))return;
  try{
    await db.collection('points_requests').add({
      workerId,workerName,
      pointsRequested:available,amountRequested:parseFloat(amount),
      status:'approved',
      claimedDirectly:true,
      requestedAt:firebase.firestore.FieldValue.serverTimestamp(),
      reviewedAt:firebase.firestore.FieldValue.serverTimestamp(),
      reviewedBy:_currentAdminUser||'admin'
    });
    toast(`✅ تم تسجيل استلام نقاط ${workerName}`);
    loadAdminEmpPoints();
  }catch(e){toast('❌ '+e.message);}
}

async function reviewPointsRequest(reqId,action){
  try{
    await db.collection('points_requests').doc(reqId).update({
      status:action,reviewedAt:firebase.firestore.FieldValue.serverTimestamp(),
      reviewedBy:_currentAdminUser||'admin'
    });
    toast(action==='approved'?'✅ تمت الموافقة على الطلب':'❌ تم رفض الطلب');
    loadAdminEmpPoints();
  }catch(e){toast('❌ '+e.message);}
}
window.requestEmpPayout=requestEmpPayout;
window.saveEmpPointValue=saveEmpPointValue;
window.reviewPointsRequest=reviewPointsRequest;
window.claimWorkerPoints=claimWorkerPoints;

function switchEmpSubTab(tab){
  ['tracking','operator','daysheet','workers','emppoints','settings'].forEach(t=>{
    const el=document.getElementById('emp-subtab-'+t);
    const btn=document.getElementById('emp-subtab-btn-'+t);
    if(el)el.style.display=(t===tab?'':'none');
    if(btn){btn.style.background=(t===tab?'var(--green-dark)':'#fff');btn.style.color=(t===tab?'#fff':'#374151');btn.style.fontWeight=(t===tab?'700':'400');}
  });
  if(tab==='tracking'){_empOrdersFilter='all';document.querySelectorAll('#empOrdersChips .order-stab').forEach((b,i)=>{b.classList.toggle('active',i===0);});loadEmpOrders();}
  if(tab==='operator'){_opOrdersFilter='all';document.querySelectorAll('#opOrdersChips .order-stab').forEach((b,i)=>{b.classList.toggle('active',i===0);});loadOperatorOrders();}
  if(tab==='daysheet'){const d=document.getElementById('daysheet_date');if(d&&!d.value)d.value=jordanDateStr();loadDaySheet();}
  if(tab==='workers')loadEmpWorkers();
  if(tab==='emppoints')loadAdminEmpPoints();
  if(tab==='settings'){loadEmpPagesAdmin();_initAreaFeesUI();loadFCMSettings();}
}

// ===== DAILY PAGE ACCOUNT SHEET (كشف الحساب اليومي) =====
async function loadDaySheet(){
  const storesWrap=document.getElementById('daysheet_stores_wrap');
  if(!storesWrap)return;
  const date=document.getElementById('daysheet_date')?.value||jordanDateStr();
  const listView=document.getElementById('daysheet-store-list');
  const detailView=document.getElementById('daysheet-detail-view');
  if(listView)listView.style.display='block';
  if(detailView)detailView.style.display='none';
  storesWrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:30px;">⏳ تحميل...</div>';
  try{
    if(!_opProductsList.length) await loadOpProducts();
    if(!_opStoresList.length) await loadOpStores();
    const [byDeliveredSnap,refundsSnap,expSnap]=await Promise.all([
      db.collection('employee_orders').where('deliveredDate','==',date).get(),
      db.collection('page_refunds').where('date','==',date).get(),
      db.collection('operator_expenses').where('date','==',date).get()
    ]);
    const orders=byDeliveredSnap.docs.map(d=>({id:d.id,...d.data()}));
    const refunds=refundsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const dayExpenses=expSnap.docs.map(d=>d.data());
    window._dsAllOrders=orders;
    window._dsAllRefunds=refunds;
    window._dsDayExpenses=dayExpenses;
    window._dsDate=date;
    if(!orders.length&&!refunds.length){
      storesWrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:40px;">لا يوجد طلبات في هذا اليوم</div>';
      return;
    }
    const DONE=['delivered'];
    function _storeForPage(pageId){return _opStoresList.find(s=>s.pageId===pageId)||null;}
    function _prodCost(name){
      const op=_opProductsList.find(p=>p.name===name);
      return op?((op.rawMaterialCost||0)+(op.treeCost||0)+(op.machineWorkerWage||0)+(op.assemblyWorkerWage||0)):0;
    }
    const noStoreKey='__no_store__';
    const storeMap={};
    orders.filter(o=>DONE.includes(o.status)).forEach(o=>{
      const store=_storeForPage(o.pageId);
      const key=store?store.id:noStoreKey;
      if(!storeMap[key])storeMap[key]={id:key,name:store?store.name:'بدون متجر',deliveredCount:0,totalSale:0,refundTotal:0};
      const dlv=o.deliveryFee||0;
      const prodsTotal=(o.totalPrice||0)-(o.deliveryFee||0);
      const excessDlv=Math.max(0,dlv-2);
      storeMap[key].deliveredCount++;
      storeMap[key].totalSale+=prodsTotal-excessDlv;
    });
    refunds.forEach(r=>{
      const key=r.storeId||noStoreKey;
      if(!storeMap[key])storeMap[key]={id:key,name:r.storeName||'بدون متجر',deliveredCount:0,totalSale:0,refundTotal:0};
      storeMap[key].refundTotal+=(r.totalCost||0);
    });
    let grandSale=0,grandCount=0;
    const cards=Object.values(storeMap).map(st=>{
      grandSale+=st.totalSale;grandCount+=st.deliveredCount;
      const safeId=st.id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const safeName=st.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div onclick="openDaysheetStoreDetail('${safeId}','${safeName}')" style="background:#fff;border:1.5px solid #d1fae5;border-radius:13px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,0.05);" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='0 1px 4px rgba(0,0,0,0.05)'">
        <div>
          <div style="font-weight:800;color:#1a3a2a;font-size:0.92rem;margin-bottom:3px;">🏪 ${st.name}</div>
          <div style="font-size:0.75rem;color:#6b7280;">✅ ${st.deliveredCount} طلب مسلّم${st.refundTotal>0?` · ↩️ ${st.refundTotal.toFixed(2)} د.أ رصيد`:''}</div>
        </div>
        <div style="text-align:left;">
          <div style="font-weight:900;color:#166534;font-size:1rem;">${st.totalSale.toFixed(2)}</div>
          <div style="font-size:0.65rem;color:#6b7280;">صافي البيع · د.أ</div>
        </div>
      </div>`;
    }).join('');
    const dayExpTotal=dayExpenses.reduce((s,e)=>s+parseFloat(e.amount||0),0);
    const expRows=dayExpenses.length?dayExpenses.map(e=>`<span style="background:rgba(255,255,255,0.1);border-radius:5px;padding:2px 7px;font-size:0.68rem;color:rgba(255,255,255,0.75);">${e.category||'أخرى'} ${parseFloat(e.amount||0).toFixed(2)}${e.notes?' ('+e.notes+')':''}</span>`).join(' '):'';
    const netAfterExp=grandSale-dayExpTotal;
    const totalCard=`<div style="background:linear-gradient(135deg,#1a3a2a,#2d6a4f);border-radius:13px;padding:13px 16px;margin-top:4px;">
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.6);margin-bottom:8px;">📊 إجمالي اليوم — ${date}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${dayExpTotal>0?'8':'0'}px;">
        <div style="color:rgba(255,255,255,0.7);font-size:0.8rem;">✅ ${grandCount} طلب مسلّم · صافي البيع</div>
        <div style="font-weight:900;color:#a7f3d0;font-size:1.1rem;">${grandSale.toFixed(2)} د.أ</div>
      </div>
      ${dayExpTotal>0?`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="color:rgba(255,255,255,0.6);font-size:0.78rem;">🧾 مصاريف اليوم</div>
        <div style="font-weight:700;color:#fca5a5;font-size:0.95rem;">− ${dayExpTotal.toFixed(2)} د.أ</div>
      </div>
      ${expRows?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">${expRows}</div>`:''}
      <div style="border-top:1px solid rgba(255,255,255,0.2);padding-top:8px;display:flex;justify-content:space-between;align-items:center;">
        <div style="color:rgba(255,255,255,0.85);font-size:0.82rem;font-weight:700;">💰 صافي الربح بعد المصاريف</div>
        <div style="font-weight:900;color:${netAfterExp>=0?'#86efac':'#fca5a5'};font-size:1.15rem;">${netAfterExp.toFixed(2)} د.أ</div>
      </div>`:''}
    </div>`;
    storesWrap.innerHTML=cards+totalCard;
  }catch(e){
    storesWrap.innerHTML='<div style="text-align:center;color:#dc2626;font-size:0.85rem;padding:30px;">❌ خطأ في التحميل</div>';
  }
}

function openDaysheetStoreDetail(storeId,storeName){
  const listView=document.getElementById('daysheet-store-list');
  const detailView=document.getElementById('daysheet-detail-view');
  const titleEl=document.getElementById('daysheet_detail_title');
  const wrap=document.getElementById('daysheet_wrap');
  if(!wrap||!detailView||!listView)return;
  if(listView)listView.style.display='none';
  detailView.style.display='block';
  if(titleEl)titleEl.textContent='🏪 '+storeName;
  const allOrders=window._dsAllOrders||[];
  const allRefunds=window._dsAllRefunds||[];
  const noStoreKey='__no_store__';
  function _storeForPage(pageId){return _opStoresList.find(s=>s.pageId===pageId)||null;}
  const storeOrders=allOrders.filter(o=>{
    const st=_storeForPage(o.pageId);
    if(storeId===noStoreKey) return !st;
    return st&&st.id===storeId;
  });
  const storeRefunds=allRefunds.filter(r=>(r.storeId||noStoreKey)===storeId);
  window._dsOrdersCache=storeOrders;
  wrap.innerHTML=_renderDaySheet(storeOrders,storeRefunds,window._dsDate||jordanDateStr(),window._dsDayExpenses||[]);
}

function backToDaysheetList(){
  const listView=document.getElementById('daysheet-store-list');
  const detailView=document.getElementById('daysheet-detail-view');
  if(detailView)detailView.style.display='none';
  if(listView)listView.style.display='block';
}

function _renderDaySheet(orders,refunds,date,dayExpenses){
  if(!Array.isArray(refunds)){date=refunds;refunds=[];dayExpenses=[];}
  if(!Array.isArray(dayExpenses))dayExpenses=[];
  const dayExpTotal=dayExpenses.reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const DONE=['delivered'];
  const FAILED=['cancelled','returned','refused'];

  function _prodCost(name){
    const op=_opProductsList.find(p=>p.name===name);
    return op?((op.rawMaterialCost||0)+(op.treeCost||0)+(op.machineWorkerWage||0)+(op.assemblyWorkerWage||0)):0;
  }
  function _storeForPage(pageId){
    return _opStoresList.find(s=>s.pageId===pageId)||null;
  }

  // Group delivered orders by store
  const stores={};
  const noStoreKey='__no_store__';
  orders.filter(o=>DONE.includes(o.status)).forEach(o=>{
    const store=_storeForPage(o.pageId);
    const key=store?store.id:noStoreKey;
    if(!stores[key])stores[key]={id:key,name:store?store.name:'بدون متجر',delivered:[],refunds:[]};
    stores[key].delivered.push(o);
  });
  // Attach refunds to stores
  refunds.forEach(r=>{
    const key=r.storeId||noStoreKey;
    if(!stores[key])stores[key]={id:key,name:r.storeName||'بدون متجر',delivered:[],refunds:[]};
    stores[key].refunds.push(r);
  });

  // Count totals for header
  const totalDelivered=orders.filter(o=>DONE.includes(o.status)).length;
  const totalFailed=orders.filter(o=>FAILED.includes(o.status)).length;
  const totalActive=orders.length-totalDelivered-totalFailed;

  let grandSale=0,grandCost=0,grandCount=0;

  const storeCards=Object.values(stores).map(st=>{
    let storeSale=0,storeCost=0;

    const orderRows=st.delivered.map(o=>{
      const dlv=o.deliveryFee||0;
      const prodsTotal=(o.totalPrice||0)-(o.deliveryFee||0);
      const excessDlv=Math.max(0,dlv-2);
      const effectiveSale=prodsTotal-excessDlv;
      storeSale+=effectiveSale;
      let orderCost=0;
      (o.products||[]).forEach(p=>{orderCost+=_prodCost(p.name)*(p.qty||1);});
      storeCost+=orderCost;
      const prodsStr=(o.products||[]).map(p=>`${p.name}${(p.qty||1)>1?' ×'+p.qty:''}`).join(' · ');
      const dlvNote=dlv>2?`<span style="color:#f59e0b;font-size:0.68rem;"> (توصيل ${dlv} — خصم ${excessDlv.toFixed(2)} د.أ)</span>`:'';
      const locationStr=[o.area,o.address].filter(Boolean).join(' — ');
      return `<div style="padding:8px 12px;border-bottom:1px dashed #e5f0e8;font-size:0.8rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <div style="font-weight:700;color:#1a3a2a;">${o.name||'—'}${dlvNote}</div>
            ${locationStr?`<div style="color:#6b7280;font-size:0.72rem;margin-top:1px;">📍 ${locationStr}</div>`:''}
            <div style="color:#374151;margin-top:2px;">${prodsStr}</div>
            ${o.notes?`<div style="color:#9ca3af;font-size:0.7rem;margin-top:1px;">📝 ${o.notes}</div>`:''}
          </div>
          <div style="text-align:left;flex-shrink:0;">
            <div style="font-weight:800;color:#166534;">${effectiveSale.toFixed(2)} د.أ</div>
            ${orderCost>0?`<div style="font-size:0.68rem;color:#dc2626;">تكلفة: ${orderCost.toFixed(2)}</div>`:''}
          </div>
        </div>
      </div>`;
    }).join('');

    const storeProfit=storeSale-storeCost;
    const refundTotal=(st.refunds||[]).reduce((s,r)=>s+(r.totalCost||0),0);
    grandSale+=storeSale; grandCost+=storeCost; grandCount+=st.delivered.length;

    return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
      <div style="background:linear-gradient(135deg,#1a3a2a,#2d6a4f);padding:12px 14px;">
        <div style="font-weight:800;color:#fff;font-size:0.95rem;margin-bottom:8px;">🏪 ${st.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:7px;text-align:center;">
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.6);margin-bottom:2px;">صافي البيع</div>
            <div style="font-weight:800;color:#a7f3d0;font-size:0.92rem;">${storeSale.toFixed(2)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:7px;text-align:center;">
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.6);margin-bottom:2px;">تكلفة المنتجات</div>
            <div style="font-weight:800;color:#fca5a5;font-size:0.92rem;">${storeCost.toFixed(2)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:7px;text-align:center;">
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.6);margin-bottom:2px;">صافي الربح</div>
            <div style="font-weight:800;color:${storeProfit>=0?'#86efac':'#fca5a5'};font-size:0.92rem;">${storeProfit.toFixed(2)}</div>
          </div>
        </div>
        ${refundTotal>0?`<div style="margin-top:7px;background:rgba(253,242,248,0.12);border-radius:8px;padding:5px 10px;font-size:0.72rem;color:#fce7f3;">↩️ رصيد له من المشغل (للمعلومية): ${refundTotal.toFixed(2)} د.أ</div>`:''}
      </div>
      <div style="padding:5px 12px 3px;font-size:0.7rem;color:#6b7280;font-weight:600;">✅ ${st.delivered.length} طلب مسلّم</div>
      ${orderRows||'<div style="text-align:center;color:#9ca3af;font-size:0.78rem;padding:10px;">لا يوجد طلبات مسلّمة</div>'}
    </div>`;
  }).join('');

  const grandProfit=grandSale-grandCost;
  const grandProfitAfterExp=grandProfit-dayExpTotal;
  const expRowsDetail=dayExpenses.length?dayExpenses.map(e=>`<span style="background:rgba(255,255,255,0.1);border-radius:5px;padding:2px 7px;font-size:0.67rem;color:rgba(255,255,255,0.7);">${e.category||'أخرى'} ${parseFloat(e.amount||0).toFixed(2)}${e.notes?' ('+e.notes+')':''}</span>`).join(' '):'';
  const totalCard=`<div style="background:linear-gradient(135deg,#0f2419,#1a3a2a);border-radius:14px;padding:16px 18px;margin-top:6px;">
    <div style="font-size:0.75rem;color:rgba(255,255,255,0.6);margin-bottom:10px;">📊 إجمالي اليوم — ${date}</div>
    <div style="display:grid;grid-template-columns:${dayExpTotal>0?'1fr 1fr 1fr 1fr':'1fr 1fr 1fr'};gap:8px;margin-bottom:10px;">
      <div style="background:rgba(255,255,255,0.08);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);margin-bottom:3px;">صافي البيع</div>
        <div style="font-size:1.2rem;font-weight:900;color:#a7f3d0;">${grandSale.toFixed(2)}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.4);">د.أ</div>
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);margin-bottom:3px;">تكلفة المنتجات</div>
        <div style="font-size:1.2rem;font-weight:900;color:#fca5a5;">${grandCost.toFixed(2)}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.4);">د.أ</div>
      </div>
      ${dayExpTotal>0?`<div style="background:rgba(255,200,0,0.1);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);margin-bottom:3px;">🧾 مصاريف</div>
        <div style="font-size:1.2rem;font-weight:900;color:#fde68a;">${dayExpTotal.toFixed(2)}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.4);">د.أ</div>
      </div>`:''}
      <div style="background:rgba(255,255,255,0.1);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);margin-bottom:3px;">${dayExpTotal>0?'ربح بعد المصاريف':'صافي الربح'}</div>
        <div style="font-size:1.2rem;font-weight:900;color:${grandProfitAfterExp>=0?'#86efac':'#fca5a5'};">${grandProfitAfterExp.toFixed(2)}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.4);">د.أ</div>
      </div>
    </div>
    ${expRowsDetail?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">${expRowsDetail}</div>`:''}
    <div style="border-top:1px solid rgba(255,255,255,0.15);padding-top:10px;display:flex;justify-content:space-around;color:rgba(255,255,255,0.5);font-size:0.7rem;">
      <span>✅ مسلّم ${totalDelivered}</span>
      ${totalActive>0?`<span>🔄 تنفيذ ${totalActive}</span>`:''}
      ${totalFailed>0?`<span>❌ ملغي ${totalFailed}</span>`:''}
      <span>📦 إجمالي ${orders.length}</span>
    </div>
  </div>`;

  return (storeCards||'<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:20px;">لا يوجد طلبات مسلّمة لهذا اليوم</div>')+totalCard;
}

function printDaySheet(){
  const date=document.getElementById('daysheet_date')?.value||jordanDateStr();
  const wrap=document.getElementById('daysheet_wrap');
  if(!wrap||wrap.querySelector('[style*="تحميل"]')||wrap.querySelector('[style*="لا يوجد طلبات في هذا اليوم"]')){toast('⚠️ لا يوجد بيانات للطباعة');return;}
  const orders_cache=window._dsOrdersCache;
  if(!orders_cache){toast('⚠️ حمّل الكشف أولاً');return;}
  _printDaySheetWindow(orders_cache,date);
}

function _printDaySheetWindow(orders,date){
  const DONE=['delivered'];
  const FAILED=['cancelled','returned','refused'];
  const pages={};
  orders.forEach(o=>{
    const key=o.pageName||'بدون صفحة';
    if(!pages[key])pages[key]={name:key,delivered:[],active:[],failed:[]};
    if(DONE.includes(o.status)) pages[key].delivered.push(o);
    else if(FAILED.includes(o.status)) pages[key].failed.push(o);
    else pages[key].active.push(o);
  });

  let grandTotal=0;let grandCount=0;let grandDelivery=0;

  const rows=Object.values(pages).map(pg=>{
    const dlvOrders=pg.delivered;
    const prodsTotal=dlvOrders.reduce((s,o)=>s+(o.totalPrice||0),0);
    const dlvFees=dlvOrders.reduce((s,o)=>s+(o.deliveryFee||0),0);
    grandTotal+=prodsTotal;grandCount+=dlvOrders.length;grandDelivery+=dlvFees;

    const prodMap={};
    dlvOrders.forEach(o=>{(o.products||[]).forEach(p=>{
      if(!prodMap[p.name])prodMap[p.name]={name:p.name,qty:0,revenue:0};
      prodMap[p.name].qty+=(p.qty||1);
      prodMap[p.name].revenue+=(p.price||0)*(p.qty||1);
    });});

    const prodLines=Object.values(prodMap).map(p=>`<tr><td style="padding:4px 8px;">${p.name}</td><td style="padding:4px 8px;text-align:center;">${p.qty}</td><td style="padding:4px 8px;text-align:center;">${p.revenue.toFixed(2)}</td></tr>`).join('');
    return `<div class="page-block">
      <div class="pg-header">
        <span>${pg.name}</span>
        <span class="pg-total">${prodsTotal.toFixed(2)} د.أ${dlvFees>0?' (+توصيل '+dlvFees.toFixed(2)+')':''}</span>
      </div>
      <div class="pg-stats">
        <span class="chip delivered">✅ مسلّم: ${dlvOrders.length}</span>
        ${pg.active.length?`<span class="chip active">🔄 قيد التنفيذ: ${pg.active.length}</span>`:''}
        ${pg.failed.length?`<span class="chip failed">❌ ملغي/مرتجع: ${pg.failed.length}</span>`:''}
      </div>
      ${prodLines?`<table class="prod-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>المبلغ (د.أ)</th></tr></thead><tbody>${prodLines}</tbody></table>`:'<p style="color:#9ca3af;font-size:0.8rem;padding:6px 0;">لا يوجد طلبات مسلّمة</p>'}
    </div>`;
  }).join('');

  const html=`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>كشف يومي — ${date}</title>
<style>
*{font-family:'Tajawal',sans-serif;box-sizing:border-box;}
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
body{margin:0;padding:20px;color:#1a1a1a;font-size:0.88rem;background:#fff;}
h1{text-align:center;font-size:1.1rem;color:#1a3a2a;margin:0 0 4px;}
.subtitle{text-align:center;color:#6b7280;font-size:0.78rem;margin-bottom:16px;}
.page-block{border:1.5px solid #d1fae5;border-radius:10px;margin-bottom:12px;overflow:hidden;}
.pg-header{background:#1a3a2a;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;font-weight:700;font-size:0.92rem;}
.pg-total{color:#a7f3d0;}
.pg-stats{padding:8px 14px;display:flex;gap:8px;flex-wrap:wrap;background:#f0fdf4;}
.chip{padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;}
.chip.delivered{background:#dcfce7;color:#166534;}
.chip.active{background:#fef9c3;color:#854d0e;}
.chip.failed{background:#fee2e2;color:#dc2626;}
.prod-table{width:100%;border-collapse:collapse;font-size:0.8rem;}
.prod-table th{background:#f9fafb;padding:6px 8px;text-align:right;font-weight:700;color:#374151;border-bottom:1.5px solid #e5e7eb;}
.prod-table td{border-bottom:1px solid #f3f4f6;}
.summary{background:#1a3a2a;color:#fff;border-radius:10px;padding:14px 18px;margin-top:6px;display:flex;justify-content:space-between;}
.sum-lbl{font-size:0.72rem;color:rgba(255,255,255,0.5);margin-bottom:3px;}
.sum-val{font-size:1.1rem;font-weight:900;}
@media print{body{padding:10px;}button{display:none;}}
</style></head><body>
<h1>🌿 الكسواني روزميري</h1>
<p class="subtitle">كشف الحساب اليومي — ${date}</p>
${rows}
<div class="summary">
  <div><div class="sum-lbl">طلبات مسلّمة</div><div class="sum-val" style="color:#a7f3d0;">${grandCount} طلب</div></div>
  <div><div class="sum-lbl">صافي المنتجات</div><div class="sum-val" style="color:#a7f3d0;">${grandTotal.toFixed(2)} د.أ</div></div>
  ${grandDelivery>0?`<div><div class="sum-lbl">أجور توصيل</div><div class="sum-val">${grandDelivery.toFixed(2)} د.أ</div></div>`:''}
  <div><div class="sum-lbl">إجمالي الطلبات</div><div class="sum-val">${orders.length}</div></div>
</div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;
  const w=window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
}

// ===== SIZES =====
function showAddSizeUI(){document.getElementById('addSizeUI').style.display='block';document.getElementById('newSizeName').focus();}

function confirmAddSize(){
  const name=document.getElementById('newSizeName').value.trim();
  const price=parseFloat(document.getElementById('newSizePrice').value);
  if(!name){toast('⚠️ أدخل اسم الحجم');return;}
  if(isNaN(price)||price<0){toast('⚠️ أدخل سعراً صحيحاً');return;}
  if(currentSizes.find(s=>s.name===name)){toast('⚠️ هذا الحجم موجود مسبقاً');return;}
  currentSizes.push({name,price});
  document.getElementById('pSizes').value=JSON.stringify(currentSizes);
  document.getElementById('newSizeName').value='';
  document.getElementById('newSizePrice').value='';
  document.getElementById('addSizeUI').style.display='none';
  renderSizeTags();
}

function removeSizeItem(name){
  currentSizes=currentSizes.filter(s=>s.name!==name);
  document.getElementById('pSizes').value=JSON.stringify(currentSizes);
  renderSizeTags();
}

function renderSizeTags(){
  const c=document.getElementById('sizesContainer');
  if(!c)return;
  if(!currentSizes.length){c.innerHTML='';return;}
  c.innerHTML=currentSizes.map(s=>`
    <div style="display:flex;align-items:center;justify-content:space-between;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:10px 14px;">
      <div style="font-weight:700;color:#1d4ed8;font-size:0.9rem;">📐 ${s.name}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-weight:800;color:#1e40af;font-size:1rem;">${parseFloat(s.price).toFixed(2)} د.أ</span>
        <button type="button" onclick="removeSizeItem('${s.name}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:0.8rem;">✕</button>
      </div>
    </div>`).join('');
}

let currentOrderStatus='جديد';

function switchOrderTab(status, btn){
  currentOrderStatus=status;
  document.querySelectorAll('.order-stab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const wrap=document.getElementById('transferBtnWrap');
  if(wrap) wrap.style.display=status==='جديد'?'flex':'none';
  renderOrdersByStatus();
}

async function renderOrders(){
  const list=document.getElementById('ordersList');
  list.innerHTML='<div class="empty-msg">⏳ جاري التحميل...</div>';
  const snap=await db.collection('orders').get();
  const allOrders=snap.docs.map(d=>d.data()).sort((a,b)=>b.id-a.id);
  // Update counts
  const counts={'جديد':0,'قيد التجهيز':0,'بالطريق':0,'تم التسليم':0,'ملغي':0};
  allOrders.forEach(o=>{ const s=o.status||'جديد'; if(counts[s]!==undefined) counts[s]++; });
  document.getElementById('cnt-new').textContent=counts['جديد'];
  document.getElementById('cnt-prep').textContent=counts['قيد التجهيز'];
  document.getElementById('cnt-way').textContent=counts['بالطريق'];
  document.getElementById('cnt-done').textContent=counts['تم التسليم'];
  document.getElementById('cnt-cancel').textContent=counts['ملغي'];
  window._allOrders=allOrders;
  renderOrdersByStatus();
}

function renderOrdersByStatus(){
  const list=document.getElementById('ordersList');
  const all=window._allOrders||[];
  const filtered=all.filter(o=>(o.status||'جديد')===currentOrderStatus);
  if(!filtered.length){list.innerHTML=`<div class="empty-msg">ما في طلبات بهذه الحالة</div>`;return;}
  const statusColors={'جديد':'#dcfce7','قيد التجهيز':'#fef9c3','بالطريق':'#dbeafe','تم التسليم':'#f0fdf4','ملغي':'#fee2e2'};
  const statusText={'جديد':'#166534','قيد التجهيز':'#854d0e','بالطريق':'#1e40af','تم التسليم':'#166534','ملغي':'#991b1b'};
  list.innerHTML=filtered.map(o=>`
    <div class="prod-row" style="flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center;flex-wrap:wrap;gap:6px;">
        <div style="font-weight:700;color:var(--green-dark);font-size:0.9rem;">طلب ${o.orderNum||'#'+String(o.id).slice(-6)} · ${o.date}</div>
        <span style="background:${statusColors[o.status||'جديد']};color:${statusText[o.status||'جديد']};padding:3px 10px;border-radius:8px;font-size:0.75rem;font-weight:600;">${o.status||'جديد'}</span>
      </div>
      <div style="font-size:0.85rem;color:var(--text-mid);">👤 ${o.name} · <a href="https://wa.me/962${(o.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'')}" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none;">📱 ${o.phone}</a> · 📍 ${o.area||''}</div>
      <div style="font-size:0.82rem;color:var(--text-dark);">${(o.items||[]).map(i=>`${i.name} ×${i.qty}${i.writing?' ✍️ '+i.writing:''}`).join(' · ')}</div>
      <div style="font-weight:700;color:var(--brown);font-size:0.9rem;">💰 الإجمالي: ${o.total}</div>
      ${o.notes?`<div style="font-size:0.78rem;color:#92400e;background:#fef3c7;padding:6px 10px;border-radius:6px;">📝 ${o.notes}</div>`:''}
      ${o.cancelReason?`<div style="font-size:0.78rem;color:#991b1b;background:#fee2e2;padding:6px 10px;border-radius:6px;">🚫 سبب الإلغاء: ${o.cancelReason}</div>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        ${currentOrderStatus!=='جديد'&&currentOrderStatus!=='ملغي'?`<button onclick="updateOrderStatus('${o.id}','جديد');renderOrders()" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">📋 جديد</button>`:''}
        ${currentOrderStatus!=='قيد التجهيز'&&currentOrderStatus!=='ملغي'?`<button onclick="updateOrderStatus('${o.id}','قيد التجهيز');renderOrders()" style="padding:6px 12px;border-radius:8px;border:1px solid #fbbf24;background:#fef9c3;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;color:#92400e;">⚙️ تجهيز</button>`:''}
        ${currentOrderStatus!=='بالطريق'&&currentOrderStatus!=='ملغي'?`<button onclick="updateOrderStatus('${o.id}','بالطريق');renderOrders()" style="padding:6px 12px;border-radius:8px;border:1px solid #93c5fd;background:#dbeafe;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;color:#1e40af;">🚚 بالطريق</button>`:''}
        ${currentOrderStatus!=='تم التسليم'&&currentOrderStatus!=='ملغي'?`<button onclick="updateOrderStatus('${o.id}','تم التسليم');renderOrders()" style="padding:6px 12px;border-radius:8px;border:1px solid #86efac;background:#dcfce7;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;color:#166534;">✅ تسليم</button>`:''}
        ${currentOrderStatus!=='ملغي'?`<button onclick="openCancelDialog('${o.id}')" style="padding:6px 12px;border-radius:8px;border:1px solid #fca5a5;background:#fee2e2;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;color:#dc2626;">🚫 إلغاء</button>`:''}
        ${currentOrderStatus==='ملغي'?`<button onclick="updateOrderStatus('${o.id}','جديد');renderOrders()" style="padding:6px 12px;border-radius:8px;border:1px solid #e0e0e0;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">↩️ استعادة</button>`:''}
        <button onclick="deleteOrder('${o.id}')" style="padding:6px 12px;border-radius:8px;border:1px solid #d1d5db;background:#f9fafb;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;color:#6b7280;">🗑️ حذف</button>
      </div>
    </div>
  `).join('');
}

function searchAdminProducts(q){
  const list=document.getElementById('adminList');
  const filtered=q.trim()?products.filter(p=>p.name.includes(q)||p.cat.includes(q)):products;
  if(!filtered.length){list.innerHTML='<div class="empty-msg">ما في نتائج</div>';return;}
  list.innerHTML=filtered.map(p=>`
    <div class="prod-row">
      <div class="prod-thumb">${p.images?.[0]||p.img?`<img src="${p.images?.[0]||p.img}">`:`<span>${p.emoji}</span>`}</div>
      <div class="prod-info">
        <div class="prod-name">${p.name}</div>
        <div class="prod-meta"><span>📂 ${p.cat}</span>${p.writing?`<span class="writing-tag">✍️ قابل للكتابة</span>`:''}</div>
      </div>
      <div class="prod-price">${p.price}</div>
      <button class="btn-del" data-pid="${p._docId||p.id}" data-oos="${p.outOfStock?'1':'0'}" onclick="toggleOutOfStock(this)"
        style="${p.outOfStock?'background:#fef2f2;color:#dc2626;border-color:#fca5a5;':'background:#f0fdf4;color:#16a34a;border-color:#86efac;'}">
        ${p.outOfStock?'❌ نفذ':'✅ متوفر'}
      </button>
      <button class="btn-del" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;" onclick="editProduct('${p._docId||p.id}')">✏️</button>
      <button class="btn-del" onclick="delProduct('${p._docId||p.id}')">🗑️</button>
    </div>
  `).join('');
}
async function renderAdmin(){
  await loadCustomers();
  const cats=[...new Set(products.map(p=>p.cat))];
  document.getElementById('aTotalP').textContent=products.length;
  document.getElementById('aTotalC').textContent=cats.length;
  document.getElementById('aTotalCust').textContent=customers.length;
  document.getElementById('pCount').textContent=products.length;
  const list=document.getElementById('adminList');
  if(!products.length){list.innerHTML=`<div class="empty-msg">ما في منتجات بعد</div>`;return;}
  list.innerHTML=products.map(p=>`
    <div class="prod-row">
      <div class="prod-thumb">${p.images?.[0]||p.img?`<img src="${p.images?.[0]||p.img}">`:`<span>${p.emoji}</span>`}</div>
      <div class="prod-info">
        <div class="prod-name">${p.name}</div>
        <div class="prod-meta"><span>📂 ${p.cat}</span>${p.writing?`<span class="writing-tag">✍️ قابل للكتابة</span>`:''}</div>
      </div>
      <div class="prod-price">${p.price}</div>
      <button class="btn-del" data-pid="${p._docId||p.id}" data-oos="${p.outOfStock?'1':'0'}" onclick="toggleOutOfStock(this)"
        style="${p.outOfStock?'background:#fef2f2;color:#dc2626;border-color:#fca5a5;':'background:#f0fdf4;color:#16a34a;border-color:#86efac;'}">
        ${p.outOfStock?'❌ نفذ':'✅ متوفر'}
      </button>
      <button class="btn-del" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;" onclick="editProduct('${p._docId||p.id}')">✏️</button>
      <button class="btn-del" onclick="delProduct('${p._docId||p.id}')">🗑️</button>
    </div>
  `).join('');
}

async function renderCustomers(){
  await loadCustomers();
  const list=document.getElementById('customersList');
  document.getElementById('custCount').textContent=customers.length;
  if(!customers.length){list.innerHTML=`<div class="empty-msg">ما في زبائن مسجلين بعد</div>`;return;}
  list.innerHTML=customers.map(c=>`
    <div class="cust-row">
      <div class="cust-avatar">👤</div>
      <div class="cust-info">
        <div class="cust-name">${c.name}</div>
        <div class="cust-phone">${c.phone} · انضم ${c.joinDate||''} · ${(c.orders||[]).length} طلب</div>
      </div>
      <div class="cust-points">🌟 ${c.points||0} نقطة</div>
    </div>
  `).join('');
}

function loadPointsSettingsUI(){
  document.getElementById('pointsEnabled').checked=pointsSettings.enabled;
  document.getElementById('pointsPerDinar').value=pointsSettings.perDinar;
  document.getElementById('pointsOnRegister').value=pointsSettings.onRegister;
  document.getElementById('pointsPerDiscount').value=pointsSettings.perDiscount;
  document.getElementById('minPointsRedeem').value=pointsSettings.minRedeem;
}
async function savePointsSettings(){
  pointsSettings={
    enabled:document.getElementById('pointsEnabled').checked,
    perDinar:parseInt(document.getElementById('pointsPerDinar').value)||10,
    onRegister:parseInt(document.getElementById('pointsOnRegister').value)||50,
    perDiscount:parseInt(document.getElementById('pointsPerDiscount').value)||100,
    minRedeem:parseInt(document.getElementById('minPointsRedeem').value)||200,
  };
  await savePointsToFirebase(pointsSettings);
  toast('✅ تم حفظ إعدادات النقاط!');
}

function prevImgs(input){
  const files=Array.from(input.files);
  const container=document.getElementById('imgsPrevContainer');
  document.getElementById('upPh').textContent=`✅ ${files.length} صورة محددة`;
  container.innerHTML='';
  files.forEach((f,i)=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=document.createElement('img');
      img.src=e.target.result;
      img.style.cssText='width:70px;height:70px;object-fit:cover;border-radius:8px;border:2px solid #e0e0e0;';
      container.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}


let currentColors=[];
let colorImages={};
let newColorImgFile=null;

function showAddColorUI(){
  document.getElementById('addColorUI').style.display='block';
  document.getElementById('newColorName').value='';
  document.getElementById('newColorImg').value='';
  document.getElementById('newColorImgPreview').style.display='none';
  newColorImgFile=null;
  document.getElementById('newColorImgLabel').childNodes[0].textContent='📷 اختر صورة اللون (اختياري)';
}

function previewNewColorImg(input){
  const file=input.files[0];
  if(!file) return;
  newColorImgFile=file;
  const reader=new FileReader();
  reader.onload=e=>{
    const prev=document.getElementById('newColorImgPreview');
    prev.src=e.target.result;
    prev.style.display='block';
    const lbl=document.getElementById('newColorImgLabel');
    lbl.firstChild.textContent='✅ صورة محددة ';
  };
  reader.readAsDataURL(file);
}

async function confirmAddColor(){
  const name=document.getElementById('newColorName').value.trim();
  if(!name){toast('اكتب اسم اللون');return;}
  if(currentColors.includes(name)){toast('هذا اللون موجود');return;}
  
  if(newColorImgFile){
    toast('جاري رفع الصورة...');
    try{
      const ref=storage.ref('color-images/'+Date.now()+'_'+newColorImgFile.name);
      await ref.put(newColorImgFile);
      const url=await ref.getDownloadURL();
      colorImages[name]=url;
    }catch(e){toast('خطأ في رفع الصورة');}
  }
  
  currentColors.push(name);
  document.getElementById('pColors').value=JSON.stringify(currentColors);
  renderColorTags();
  document.getElementById('addColorUI').style.display='none';
  newColorImgFile=null;
  toast('تم إضافة اللون ✅');
}

function renderColorTags(){
  const c=document.getElementById('colorsTagsContainer');
  c.innerHTML=currentColors.map(color=>{
    const imgHtml=colorImages[color]
      ?'<img src="'+colorImages[color]+'" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:2px solid var(--green-dark);">'
      :'<div style="width:48px;height:48px;border-radius:8px;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎨</div>';
    const btnTxt=colorImages[color]?'📷 تغيير الصورة':'📷 إضافة صورة';
    const safeColor=color.replace(/'/g,"\'");
    return '<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;">'
      +imgHtml
      +'<div style="flex:1;"><div style="font-weight:700;font-size:0.9rem;">'+color+'</div>'
      +'<label style="font-size:0.75rem;color:var(--green-dark);cursor:pointer;">'+btnTxt
      +'<input type="file" accept="image/*" onchange="changeColorImg(\'' +safeColor+ '\',this)" style="display:none;"></label></div>'
      +'<span onclick="removeColorTag(\'' +safeColor+ '\')" style="cursor:pointer;color:#e53e3e;font-size:1.2rem;">🗑️</span></div>';
  }).join('');
}

async function changeColorImg(color, input){
  const file=input.files[0];
  if(!file) return;
  toast('جاري رفع الصورة...');
  try{
    const ref=storage.ref('color-images/'+Date.now()+'_'+file.name);
    await ref.put(file);
    const url=await ref.getDownloadURL();
    colorImages[color]=url;
    renderColorTags();
    toast('تم تحديث صورة '+color+' ✅');
  }catch(e){toast('خطأ في رفع الصورة');}
}

// ===== POTS (قوارير) =====
let currentPots=[];
let potImages={};
let currentSizes=[];
let newPotImgFile=null;

function showAddPotUI(){
  document.getElementById('addPotUI').style.display='block';
  document.getElementById('newPotName').value='';
  document.getElementById('newPotImg').value='';
  document.getElementById('newPotImgPreview').style.display='none';
  newPotImgFile=null;
  document.getElementById('newPotImgLabel').firstChild.textContent='📷 اختر صورة القوار (اختياري)';
}

function previewNewPotImg(input){
  const file=input.files[0];
  if(!file) return;
  newPotImgFile=file;
  const reader=new FileReader();
  reader.onload=e=>{
    const prev=document.getElementById('newPotImgPreview');
    prev.src=e.target.result;
    prev.style.display='block';
    document.getElementById('newPotImgLabel').firstChild.textContent='✅ صورة محددة ';
  };
  reader.readAsDataURL(file);
}

async function confirmAddPot(){
  const name=document.getElementById('newPotName').value.trim();
  if(!name){toast('اكتب اسم القوار');return;}
  if(currentPots.includes(name)){toast('هذه القوار موجودة');return;}
  if(newPotImgFile){
    toast('جاري رفع الصورة...');
    try{
      const ref=storage.ref('pot-images/'+Date.now()+'_'+newPotImgFile.name);
      await ref.put(newPotImgFile);
      const url=await ref.getDownloadURL();
      potImages[name]=url;
    }catch(e){toast('خطأ في رفع الصورة');}
  }
  currentPots.push(name);
  document.getElementById('pPots').value=JSON.stringify(currentPots);
  renderPotTags();
  document.getElementById('addPotUI').style.display='none';
  newPotImgFile=null;
  toast('تم إضافة القوار ✅');
}

function renderPotTags(){
  const c=document.getElementById('potsTagsContainer');
  if(!c) return;
  c.innerHTML=currentPots.map(pot=>{
    const imgHtml=potImages[pot]
      ?'<img src="'+potImages[pot]+'" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:2px solid #c9a84c;">'
      :'<div style="width:48px;height:48px;border-radius:8px;background:#fef3c7;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">🪴</div>';
    const btnTxt=potImages[pot]?'📷 تغيير الصورة':'📷 إضافة صورة';
    const safePot=pot.replace(/'/g,"\\'");
    return '<div style="background:#fffbf0;border:1px solid #e8c96d;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;">'
      +imgHtml
      +'<div style="flex:1;"><div style="font-weight:700;font-size:0.9rem;">'+pot+'</div>'
      +'<label style="font-size:0.75rem;color:#c9a84c;cursor:pointer;">'+btnTxt
      +'<input type="file" accept="image/*" onchange="changePotImg(\''+safePot+'\',this)" style="display:none;"></label></div>'
      +'<span onclick="removePotTag(\''+safePot+'\')" style="cursor:pointer;color:#e53e3e;font-size:1.2rem;">🗑️</span></div>';
  }).join('');
}

async function changePotImg(pot, input){
  const file=input.files[0];
  if(!file) return;
  toast('جاري رفع الصورة...');
  try{
    const ref=storage.ref('pot-images/'+Date.now()+'_'+file.name);
    await ref.put(file);
    const url=await ref.getDownloadURL();
    potImages[pot]=url;
    renderPotTags();
    toast('تم تحديث صورة القوار ✅');
  }catch(e){toast('خطأ في رفع الصورة');}
}

function removePotTag(pot){
  currentPots=currentPots.filter(p=>p!==pot);
  delete potImages[pot];
  renderPotTags();
  document.getElementById('pPots').value=JSON.stringify(currentPots);
}

let selectedPot='';

function renderPpPots(pots, potImgs){
  const list=document.getElementById('ppPotsList');
  if(!list) return;
  list.innerHTML=pots.map(pot=>{
    const img=potImgs&&potImgs[pot]?potImgs[pot]:'';
    return `<div onclick="selectPot('${pot.replace(/'/g,"\'")}',this)" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid #e0e0e0;border-radius:12px;cursor:pointer;transition:all 0.2s;background:#fff;">
      ${img
        ?`<img src="${img}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #e0e0e0;">`
        :`<div style="width:52px;height:52px;border-radius:8px;background:#fef3c7;display:flex;align-items:center;justify-content:center;font-size:1.8rem;">🪴</div>`}
      <span style="font-weight:700;font-size:0.95rem;">${pot}</span>
      <span style="margin-right:auto;font-size:1.1rem;opacity:0;" class="pot-check">✅</span>
    </div>`;
  }).join('');
}

function selectPot(pot, el){
  selectedPot=pot;
  document.querySelectorAll('#ppPotsList > div').forEach(d=>{
    d.style.borderColor='#e0e0e0';
    d.style.background='#fff';
    d.querySelector('.pot-check').style.opacity='0';
  });
  el.style.borderColor='#c9a84c';
  el.style.background='#fffbf0';
  el.querySelector('.pot-check').style.opacity='1';
}

function addColorTag(color){
  if(!color||currentColors.includes(color))return;
  currentColors.push(color);
  renderColorTags();
  document.getElementById('pColors').value=JSON.stringify(currentColors);
}

function removeColorTag(color){
  currentColors=currentColors.filter(c=>c!==color);
  delete colorImages[color];
  renderColorTags();
  document.getElementById('pColors').value=JSON.stringify(currentColors);
}

async function addProduct(){
  const name=document.getElementById('pName').value.trim();
  const priceRaw=document.getElementById('pPrice').value.trim();
  const oldPriceRaw=document.getElementById('pOldPrice').value.trim();
  const cat=document.getElementById('pCat').value;
  const desc=document.getElementById('pDesc').value.trim();
  const badge=document.getElementById('pBadge').value.trim();
  const writing=document.getElementById('pWriting').checked;
  const imgFiles=Array.from(document.getElementById('pImg').files);
  const videoFile=document.getElementById('pVideo').files[0];
  const videoUrl=document.getElementById('pVideoUrl')?.value.trim()||'';
  const colorsRaw=document.getElementById('pColors').value;
  const colorsInput=document.getElementById('pColorsInput').value.trim();
  let colors=[];
  if(colorsRaw){
    try{colors=JSON.parse(colorsRaw);}catch(e){colors=currentColors;}
  } else if(colorsInput){
    // Parse comma-separated colors from input
    colors=colorsInput.split(/[,،]/).map(c=>c.trim()).filter(c=>c);
  } else {
    colors=currentColors;
  }
  const editingId=document.getElementById('editingId').value;
  if(!name||!priceRaw||!cat){toast('❌ يرجى تعبئة اسم المنتج والسعر والقسم');return;}
  const price=parseFloat(priceRaw);
  const oldPrice=oldPriceRaw?parseFloat(oldPriceRaw):null;
  if(isNaN(price)){toast('❌ السعر لازم يكون رقم');return;}
  toast('⏳ جاري الحفظ...');
  // Find existing product by _docId or id
  const existing=editingId?products.find(p=>p._docId===editingId||String(p.id)===editingId):null;
  const id=existing?.id||editingId||Date.now();
  // Upload video if new file selected
  let video=existing?.video||'';
  if(videoFile){
    toast('⏳ جاري رفع الفيديو...');
    const videoRef=storage.ref('videos/prod_'+id+'_'+Date.now()+'.mp4');
    const videoTask=await new Promise((res,rej)=>{
      const t=videoRef.put(videoFile);
      t.on('state_changed',null,rej,()=>t.snapshot.ref.getDownloadURL().then(res));
    });
    video=videoTask;
  } else if(videoUrl){
    video=videoUrl;
  }
  let images=existing?.images||[];
  if(imgFiles.length>0){
    images=[];
    toast('⏳ جاري رفع الصور...');
    for(const file of imgFiles){
      const imgUrl=await uploadImageToFirebase(file, 'prod_'+id);
      images.push(imgUrl);
    }
  }
  const docId=existing?._docId||String(id);
  const finalId=editingId?existing?.id||id:id;
  // Get pots
  let pots=currentPots;
  const potsRaw=document.getElementById('pPots')?.value;
  if(potsRaw){try{pots=JSON.parse(potsRaw);}catch(e){pots=currentPots;}}
  // Get sizes
  let sizes=currentSizes;
  const sizesRaw=document.getElementById('pSizes')?.value;
  if(sizesRaw&&sizesRaw!=='[]'){try{sizes=JSON.parse(sizesRaw);}catch(e){sizes=currentSizes;}}
  const showColors=document.getElementById('pShowColors')?.checked!==false;
  const showSizes=document.getElementById('pShowSizes')?.checked!==false;
  const showPots=document.getElementById('pShowPots')?.checked!==false;
  const pHeight=document.getElementById('pHeight')?.value.trim()||'';
  const pWidth=document.getElementById('pWidth')?.value.trim()||'';
  const pMaterial=document.getElementById('pMaterial')?.value.trim()||'';
  const pWoodCost=parseFloat(document.getElementById('pWoodCost')?.value)||0;
  const pWorkerWage=parseFloat(document.getElementById('pWorkerWage')?.value)||0;
  const product={
    id:finalId,name,price,oldPrice:oldPrice||null,
    cat,desc,badge,writing,
    images:images,
    img:images[0]||existing?.img||'',
    video:video||'',
    emoji:getCatEmoji(cat),
    colors:colors,
    colorImages:colorImages,
    pots:pots,
    potImages:potImages,
    sizes:sizes,
    showColors,showSizes,showPots,
    height:pHeight,
    width:pWidth,
    material:pMaterial,
    woodCost:pWoodCost,
    workerWage:pWorkerWage,
    reviews:existing?.reviews||[]
  };
  await db.collection('products').doc(docId).set(product);
  product._docId=docId;
  if(editingId){products=products.map(p=>String(p.id)===String(editingId)||p._docId===docId?{...product,_docId:docId}:p);}
  else{products.push({...product,_docId:docId});}
  await renderAdmin();
  cancelEdit();
  toast(editingId?'✅ تم تعديل المنتج!':'✅ تم إضافة المنتج!');
}


function removeExistingImage(idx){
  const p=products.find(x=>String(x.id)===document.getElementById('editingId').value||x._docId===document.getElementById('editingId').value);
  if(!p) return;
  p.images=p.images||[];
  p.images.splice(idx,1);
  const prevContainer=document.getElementById('imgsPrevContainer');
  const upPh=document.getElementById('upPh');
  prevContainer.innerHTML=p.images.map((img,i)=>`
    <div style="position:relative;display:inline-block;">
      <img src="${img}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:2px solid #e0e0e0;">
      <span onclick="removeExistingImage(${i})" style="position:absolute;top:-6px;right:-6px;background:#e53e3e;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;cursor:pointer;font-weight:700;">✕</span>
    </div>
  `).join('');
  upPh.textContent=p.images.length>0?`✅ ${p.images.length} صورة محفوظة`:'اضغط لرفع صور المنتج';
  toast('تم حذف الصورة');
}

function resetForm(){
  colorImages={};potImages={};
  ['pName','pPrice','pOldPrice','pDesc','pBadge','pColorsInput','pHeight','pWidth','pMaterial','pWoodCost','pWorkerWage'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const pPotsEl=document.getElementById('pPots');if(pPotsEl)pPotsEl.value='';
  const ptc=document.getElementById('potsTagsContainer');if(ptc)ptc.innerHTML='';
  currentPots=[];
  document.getElementById('pVideo').value='';
  if(document.getElementById('pVideoUrl')) document.getElementById('pVideoUrl').value='';
  document.getElementById('vExistingArea').style.display='none';
  document.getElementById('vPrevName').style.display='none';
  document.getElementById('pCat').value='';
  document.getElementById('pWriting').checked=false;
  document.getElementById('pImg').value='';
  document.getElementById('pVideo').value='';
  document.getElementById('pColors').value='';
  document.getElementById('imgsPrevContainer').innerHTML='';
  document.getElementById('colorsTagsContainer').innerHTML='';
  document.getElementById('upPh').textContent='📸\nاضغط لرفع صورة أو أكثر';
  document.getElementById('vPrevName').style.display='none';
  document.getElementById('vUpPh').innerHTML='🎬<br><span style="font-size:0.78rem;color:#aaa;">اضغط لرفع فيديو</span>';
  currentColors=[];
  currentSizes=[];
  const sizesEl=document.getElementById('pSizes');if(sizesEl)sizesEl.value='[]';
  const sizesC=document.getElementById('sizesContainer');if(sizesC)sizesC.innerHTML='';
  const showColors=document.getElementById('pShowColors');if(showColors)showColors.checked=true;
  const showSizes=document.getElementById('pShowSizes');if(showSizes)showSizes.checked=true;
  const showPots=document.getElementById('pShowPots');if(showPots)showPots.checked=true;
}

async function delProduct(id){
  if(!confirm('حذف هذا المنتج؟'))return;
  toast('⏳ جاري الحذف...');
  try{
    const p=products.find(x=>String(x.id)===String(id)||String(x._docId)===String(id));
    if(!p){toast('❌ المنتج غير موجود');return;}
    // Use _docId (Firestore document ID) for deletion
    const docId=p._docId||String(p.id);
    await db.collection('products').doc(docId).delete();
    products=products.filter(x=>x!==p);
    renderStore();
    await renderAdmin();
    toast('🗑️ تم الحذف بنجاح');
  }catch(e){
    console.error(e);
    toast('❌ خطأ: '+e.message);
  }
}

function editProduct(id){
  const p=products.find(x=>String(x.id)===String(id)||x._docId===String(id));
  if(!p){toast('❌ المنتج غير موجود');return;}
  document.getElementById('pName').value=p.name||'';
  document.getElementById('pPrice').value=p.price||'';
  document.getElementById('pOldPrice').value=p.oldPrice||'';
  document.getElementById('pCat').value=p.cat||'';
  document.getElementById('pDesc').value=p.desc||'';
  document.getElementById('pBadge').value=p.badge||'';
  document.getElementById('pWriting').checked=p.writing||false;
  if(document.getElementById('pHeight')) document.getElementById('pHeight').value=p.height||'';
  if(document.getElementById('pWidth')) document.getElementById('pWidth').value=p.width||'';
  if(document.getElementById('pMaterial')) document.getElementById('pMaterial').value=p.material||'';
  if(document.getElementById('pWoodCost')) document.getElementById('pWoodCost').value=p.woodCost||'';
  if(document.getElementById('pWorkerWage')) document.getElementById('pWorkerWage').value=p.workerWage||'';
  colorImages=p.colorImages||{};
  potImages=p.potImages||{};
  // Load pots
  let pPotsEdit=p.pots||[];
  if(typeof pPotsEdit==='string'){try{pPotsEdit=JSON.parse(pPotsEdit);}catch(e){pPotsEdit=[];}}
  currentPots=pPotsEdit;
  const pPotsEl=document.getElementById('pPots');
  if(pPotsEl) pPotsEl.value=JSON.stringify(pPotsEdit);
  renderPotTags();
  // Load sizes
  let pSizesEdit=p.sizes||[];
  if(typeof pSizesEdit==='string'){try{pSizesEdit=JSON.parse(pSizesEdit);}catch(e){pSizesEdit=[];}}
  currentSizes=pSizesEdit;
  const pSizesEl=document.getElementById('pSizes');
  if(pSizesEl)pSizesEl.value=JSON.stringify(currentSizes);
  renderSizeTags();
  // Visibility toggles
  const showColorsEl=document.getElementById('pShowColors');if(showColorsEl)showColorsEl.checked=p.showColors!==false;
  const showSizesEl=document.getElementById('pShowSizes');if(showSizesEl)showSizesEl.checked=p.showSizes!==false;
  const showPotsEl=document.getElementById('pShowPots');if(showPotsEl)showPotsEl.checked=p.showPots!==false;
  // Show existing images
  const prevContainer=document.getElementById('imgsPrevContainer');
  const upPh=document.getElementById('upPh');
  const imgs=p.images&&p.images.length?p.images:p.img?[p.img]:[];
  if(imgs.length){
    prevContainer.innerHTML=imgs.map((img,i)=>`
      <div style="position:relative;display:inline-block;">
        <img src="${img}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:2px solid #e0e0e0;">
        <span onclick="removeExistingImage(${i})" style="position:absolute;top:-6px;right:-6px;background:#e53e3e;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;cursor:pointer;font-weight:700;">✕</span>
      </div>
    `).join('');
    upPh.textContent=`✅ ${imgs.length} صورة محفوظة`;
  }
  // Show existing colors
  let pColors=p.colors||[];
  if(typeof pColors==='string'){try{pColors=JSON.parse(pColors);}catch(e){pColors=pColors?[pColors]:[];}}
  currentColors=pColors;
  document.getElementById('pColors').value=JSON.stringify(pColors);
  document.getElementById('pColorsInput').value='';
  renderColorTags();
  document.getElementById('pVideo').value='';
  if(document.getElementById('pVideoUrl')) document.getElementById('pVideoUrl').value='';
  if(p.video){
    document.getElementById('vExistingArea').style.display='block';
    document.getElementById('vExistingText').textContent=p.video.includes('firebase')||p.video.includes('http')?'فيديو محفوظ ✅':p.video;
  } else {
    document.getElementById('vExistingArea').style.display='none';
  }
  document.getElementById('editingId').value=String(p._docId||p.id);
  document.getElementById('saveProductBtn').textContent='💾 حفظ التعديلات';
  document.getElementById('cancelEditBtn').style.display='block';
  document.querySelector('.form-card h2').textContent='✏️ تعديل المنتج: '+p.name;
  // Scroll to top of admin modal
  document.getElementById('adminPanel').scrollTo({top:0,behavior:'smooth'});
  toast('✏️ عدّل البيانات واضغط حفظ');
}

function cancelEdit(){
  resetForm();
  document.getElementById('editingId').value='';
  document.getElementById('saveProductBtn').textContent='✅ إضافة المنتج';
  document.getElementById('cancelEditBtn').style.display='none';
  document.querySelector('.form-card h2').textContent='➕ إضافة منتج جديد';
}

// ===== EDIT CART ITEM =====
let editingCartItem=null;
let editingCartColor='';

function editCartItem(id,wt){
  const item=cart.find(x=>String(x.id)===String(id)&&(x.writingText||'')===(wt||''));
  if(!item)return;
  editingCartItem=item;
  editingCartColor=item.color||'';
  document.getElementById('editCartProductName').textContent=item.name;
  // Colors
  const p=products.find(x=>x._docId===String(id)||String(x.id)===String(id));
  let pColors=p?.colors||[];
  if(typeof pColors==='string'){try{pColors=JSON.parse(pColors);}catch(e){pColors=[];}}
  const colSec=document.getElementById('editCartColorsSection');
  if(pColors.length){
    colSec.style.display='block';
    document.getElementById('editCartColorsList').innerHTML=pColors.map(c=>`
      <button onclick="selectEditColor('${c}',this)" style="padding:8px 16px;border-radius:20px;border:2px solid ${c===editingCartColor?'var(--green-dark)':'#e0e0e0'};background:${c===editingCartColor?'var(--green-dark)':'#fff'};color:${c===editingCartColor?'#fff':'inherit'};font-family:'Tajawal',sans-serif;font-size:0.88rem;cursor:pointer;">${c}</button>
    `).join('');
  } else { colSec.style.display='none'; }
  // Writing
  const wrSec=document.getElementById('editCartWritingSection');
  if(p?.writing){
    wrSec.style.display='block';
    document.getElementById('editCartWritingInput').value=item.writingText||'';
  } else { wrSec.style.display='none'; }
  document.getElementById('editCartOverlay').classList.add('open');
}
function selectEditColor(color,btn){
  editingCartColor=color;
  document.querySelectorAll('#editCartColorsList button').forEach(b=>{
    b.style.borderColor='#e0e0e0';b.style.background='#fff';b.style.color='inherit';
  });
  btn.style.borderColor='var(--green-dark)';btn.style.background='var(--green-dark)';btn.style.color='#fff';
}
function closeEditCart(){document.getElementById('editCartOverlay').classList.remove('open');}
function saveCartEdit(){
  if(!editingCartItem)return;
  editingCartItem.color=editingCartColor;
  const p=products.find(x=>x._docId===String(editingCartItem.id)||String(x.id)===String(editingCartItem.id));
  if(p?.writing){
    editingCartItem.writingText=document.getElementById('editCartWritingInput').value.trim();
  }
  save('ak_cart',cart);
  closeEditCart();
  renderCartDrawer();
  toast('✅ تم حفظ التعديل!');
}
function notifyAdminWA(order){
  const items=order.items.map(function(i){return '• '+i.name+' ×'+i.qty+' — '+i.price+' د.أ'+(i.writing?' ✍️ '+i.writing:'');}).join('\n');
  const msg='🔔 *طلب جديد - الكسواني روزميري*\n\n'
    +'رقم الطلب: '+order.orderNum+'\n\n'
    +'👤 الاسم: '+order.name+'\n'
    +'📞 الهاتف: '+order.phone+'\n'
    +'📍 المنطقة: '+order.area+'\n'
    +'🏠 العنوان: '+order.address+'\n'
    +'📅 موعد التوصيل: '+(order.deliveryDate||'غير محدد')+'\n\n'
    +'📦 المنتجات:\n'+items+'\n\n'
    +'💰 المجموع: '+order.subtotal+'\n'
    +'🚚 التوصيل: '+order.delivery+'\n'
    +'💵 الإجمالي: '+order.total+'\n\n'
    +'📝 ملاحظات: '+(order.notes||'لا يوجد');
  var url='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);
  var a=document.createElement('a');
  a.href=url;
  a.target='_blank';
  a.rel='noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== RATING =====
let currentRatingProductId=null;
let selectedStars=0;

function openRatingModal(id){
  currentRatingProductId=id;
  selectedStars=0;
  const p=products.find(x=>String(x.id)===String(id));
  if(!p)return;
  document.getElementById('rmProductName').textContent=p.name;
  document.getElementById('reviewText').value='';
  document.querySelectorAll('#starSelect span').forEach(s=>s.classList.remove('active'));
  const reviews=p.reviews||[];
  const rev=document.getElementById('existingReviews');
  rev.innerHTML=reviews.length?reviews.slice(-3).reverse().map(r=>`
    <div class="review-item">
      <div class="review-stars">${'⭐'.repeat(r.stars)}</div>
      ${r.text?`<div class="review-text">${r.text}</div>`:''}
      <div class="review-author">${r.author||'زبون'} · ${r.date||''}</div>
    </div>
  `).join(''):'<div style="text-align:center;color:#aaa;font-size:0.85rem;padding:12px;">لا يوجد تقييمات بعد</div>';
  document.getElementById('ratingOverlay').classList.add('open');
}
function closeRatingModal(){document.getElementById('ratingOverlay').classList.remove('open');}
function selectStar(n){
  selectedStars=n;
  document.querySelectorAll('#starSelect span').forEach((s,i)=>s.classList.toggle('active',i<n));
}
async function submitRating(){
  if(!selectedStars){toast('⭐ يرجى اختيار عدد النجوم');return;}
  const p=products.find(x=>String(x.id)===String(currentRatingProductId));
  if(!p)return;
  const review={stars:selectedStars,text:document.getElementById('reviewText').value.trim(),author:currentUser?currentUser.name:'زبون',date:jordanDisplayDate()};
  p.reviews=p.reviews||[];
  p.reviews.push(review);
  await db.collection('products').doc(String(p.id)).update({reviews:p.reviews});
  closeRatingModal();
  renderStore();
  toast('✅ شكراً على تقييمك!');
}

// ===== ORDER STATUS =====
function openOrderStatus(){document.getElementById('orderStatusOverlay').classList.add('open');document.getElementById('orderStatusResult').style.display='none';document.getElementById('orderStatusError').style.display='none';history.pushState({orderStatus:true},'','#track');}
function closeOrderStatus(){
  document.getElementById('orderStatusOverlay').classList.remove('open');
  if(location.hash==='#track')history.replaceState(null,'',location.pathname);
  if(_trackingListener){_trackingListener();_trackingListener=null;}
}
let _trackingListener=null;

async function trackOrder(){
  const raw=document.getElementById('trackOrderId').value.trim().replace('#','');
  if(!raw){toast('أدخل رقم الطلب');return;}
  toast('⏳ جاري البحث...');
  // Cancel previous listener
  if(_trackingListener){_trackingListener();_trackingListener=null;}
  const snap=await db.collection('orders').get();
  const doc=snap.docs.find(d=>{const o=d.data();return String(o.id).slice(-6)===raw||String(o.id)===raw||(o.orderNum||'').replace('#','')===raw;});
  if(!doc){
    document.getElementById('orderStatusResult').style.display='none';
    document.getElementById('orderStatusError').style.display='block';
    return;
  }
  // Subscribe to real-time updates for this specific order
  _trackingListener=db.collection('orders').doc(doc.id).onSnapshot(snap=>{
    if(!snap.exists) return;
    renderTrackingResult(snap.data());
  });
}

function renderTrackingResult(order){
  document.getElementById('orderStatusError').style.display='none';
  document.getElementById('orderStatusResult').style.display='block';
  document.getElementById('trOrderNum').textContent='طلب '+(order.orderNum||'#'+String(order.id).slice(-6));
  const statusColors={'جديد':'#dcfce7','قيد التجهيز':'#fef9c3','بالطريق':'#dbeafe','تم التسليم':'#d1fae5','ملغي':'#fee2e2'};
  const statusTextC={'جديد':'#166534','قيد التجهيز':'#854d0e','بالطريق':'#1e40af','تم التسليم':'#065f46','ملغي':'#991b1b'};
  const st=order.status||'جديد';
  const badge=document.getElementById('trStatusBadge');
  badge.textContent=st; badge.style.background=statusColors[st]||'#f3f4f6'; badge.style.color=statusTextC[st]||'#374151';
  document.getElementById('orderStatusInfo').innerHTML=`👤 <strong>${order.name}</strong> · 📅 ${order.date}${order.deliveryDate?'<br>📦 موعد التوصيل: <strong>'+order.deliveryDate+'</strong>':''}`;
  document.getElementById('trItems').innerHTML=(order.items||[]).map(i=>`<div style="padding:3px 0;border-bottom:1px solid var(--border);">🌿 ${i.name} × ${i.qty}${i.writing?' <span style="color:#92400e;font-size:0.8rem;">✍️ '+i.writing+'</span>':''}</div>`).join('');
  document.getElementById('trTotal').textContent=order.total||'—';
  document.getElementById('trDate').textContent=order.date||'—';
  // Update cancel reason display
  const cancelDiv=document.getElementById('trCancelReason');
  if(cancelDiv){
    if(st==='ملغي'&&order.cancelReason){cancelDiv.style.display='block';cancelDiv.textContent='🚫 سبب الإلغاء: '+order.cancelReason;}
    else{cancelDiv.style.display='none';}
  }
  const statuses=['جديد','قيد التجهيز','بالطريق','تم التسليم'];
  const cur=statuses.indexOf(st);
  for(let i=1;i<=4;i++){
    const icon=document.getElementById('s'+i);
    const lbl=document.getElementById('sl'+i);
    const line=document.querySelector('#sv'+i+' .sv-line');
    icon.classList.remove('done','active');
    lbl.classList.remove('active','done');
    if(line) line.classList.remove('done');
    if(st==='ملغي'){icon.style.opacity='0.4';lbl.style.opacity='0.4';}
    else{icon.style.opacity='';lbl.style.opacity='';}
    if(st!=='ملغي'){
      if(i-1<cur){icon.classList.add('done');lbl.classList.add('done');if(line)line.classList.add('done');}
      else if(i-1===cur){icon.classList.add('active');lbl.classList.add('active');}
    }
  }
  const cancelBtnWrap=document.getElementById('trCancelBtnWrap');
  if(cancelBtnWrap){
    if(st==='جديد'||st==='قيد التجهيز'){
      cancelBtnWrap.style.display='block';
      cancelBtnWrap.querySelector('button').onclick=()=>openCustomerCancelDialog(String(order.id));
    } else {
      cancelBtnWrap.style.display='none';
    }
  }
}

function openAbout(){document.getElementById('aboutOverlay').classList.add('open');history.pushState({about:true},'','#about');}
function closeAbout(){document.getElementById('aboutOverlay').classList.remove('open');if(location.hash==='#about')history.replaceState(null,'',location.pathname);}

// ===== SOUND NOTIFICATION FOR NEW ORDERS =====
let _orderListener=null;
let _lastOrderCount=-1;

function playOrderSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const notes=[523,659,784,1047];
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value=freq;
      osc.type='sine';
      gain.gain.setValueAtTime(0,ctx.currentTime+i*0.12);
      gain.gain.linearRampToValueAtTime(0.3,ctx.currentTime+i*0.12+0.05);
      gain.gain.linearRampToValueAtTime(0,ctx.currentTime+i*0.12+0.25);
      osc.start(ctx.currentTime+i*0.12);
      osc.stop(ctx.currentTime+i*0.12+0.3);
    });
  }catch(e){}
}

function startOrderListener(){
  if(_orderListener) return;
  _orderListener=db.collection('orders').onSnapshot(snap=>{
    const count=snap.size;
    if(_lastOrderCount===-1){_lastOrderCount=count;return;}
    if(count>_lastOrderCount){
      _lastOrderCount=count;
      playOrderSound();
      // Get the latest order to show details
      const docs=snap.docs.sort((a,b)=>b.data().id-a.data().id);
      const latest=docs[0]?.data();
      if(latest) showNewOrderAlert(latest);
      else toast('🔔 وصل طلب جديد!');
      renderOrders();
    } else {_lastOrderCount=count;}
  });
}

function showNewOrderAlert(order){
  const existing=document.getElementById('newOrderAlert');
  if(existing) existing.remove();
  const phone=(order.phone||'').replace(/[^0-9]/g,'');
  const intlPhone=phone.startsWith('0')?'962'+phone.slice(1):phone;
  const items=(order.items||[]).map(i=>i.name+' ×'+i.qty).join('، ');
  const waMsg=encodeURIComponent(notifyAdminWAMsg(order));
  const div=document.createElement('div');
  div.id='newOrderAlert';
  div.innerHTML=`
    <div style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.18);border:2px solid #25D366;padding:16px 18px;min-width:290px;max-width:340px;animation:fadeUp 0.3s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:700;color:#1a3a2a;font-size:0.95rem;">🔔 طلب جديد!</div>
        <button onclick="document.getElementById('newOrderAlert').remove()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:#aaa;line-height:1;">✕</button>
      </div>
      <div style="font-size:0.82rem;color:#374151;margin-bottom:4px;">👤 <strong>${order.name}</strong> · 📞 ${order.phone}</div>
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:2px;">📍 ${order.area||''} ${order.address?'— '+order.address:''}</div>
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:10px;">🌿 ${items}</div>
      <div style="display:flex;gap:8px;">
        <a href="https://wa.me/${intlPhone}?text=${waMsg}" target="_blank" style="flex:1;background:#25D366;color:#fff;text-align:center;padding:8px;border-radius:8px;font-size:0.82rem;font-weight:700;text-decoration:none;">📱 واتساب</a>
        <button onclick="switchOrderTab('جديد',document.getElementById('stab-new'));renderOrders();document.getElementById('newOrderAlert').remove()" style="flex:1;background:#1a3a2a;color:#fff;border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;">📋 عرض الطلب</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(()=>div.remove(),30000);
}

async function transferNewOrders(){
  const newOrders=(window._allOrders||[]).filter(o=>(o.status||'جديد')==='جديد');
  if(!newOrders.length){toast('⚠️ ما في طلبات جديدة');return;}
  if(!confirm(`سيتم ترحيل ${newOrders.length} طلب لواتساب ونقلهم لـ"قيد التجهيز". تأكيد؟`)){return;}
  const date=jordanDisplayDate({weekday:'long',year:'numeric',month:'long',day:'numeric'});
  let msg=`📋 *ترحيل الطلبات الجديدة*\n🌿 الكسواني روزميري\n📅 ${date}\n\n`;
  newOrders.forEach((o,i)=>{
    const items=(o.items||[]).map(it=>it.name+' ×'+it.qty+(it.writing?' ✍️ '+it.writing:'')).join('، ');
    msg+=`${'━'.repeat(22)}\n`;
    msg+=`📦 طلب ${o.orderNum||'#'+String(o.id).slice(-6)}\n`;
    msg+=`👤 ${o.name} | 📞 ${o.phone}\n`;
    msg+=`📍 ${o.area||''}${o.address?' — '+o.address:''}\n`;
    msg+=`📅 التوصيل: ${o.deliveryDate||'غير محدد'}\n`;
    msg+=`🌿 ${items}\n`;
    msg+=`💰 الإجمالي: ${o.total}\n`;
    if(o.notes) msg+=`📝 ${o.notes}\n`;
  });
  msg+=`${'━'.repeat(22)}\n`;
  msg+=`\n✅ إجمالي الطلبات: ${newOrders.length}`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
  // Move all to قيد التجهيز
  const batch=db.batch();
  newOrders.forEach(o=>{
    batch.update(db.collection('orders').doc(String(o.id)),{status:'قيد التجهيز'});
  });
  await batch.commit();
  toast(`✅ تم ترحيل ${newOrders.length} طلب`);
  renderOrders();
}

function notifyAdminWAMsg(order){
  const items=(order.items||[]).map(i=>'• '+i.name+' ×'+i.qty+(i.writing?' ✍️ '+i.writing:'')).join('\n');
  return '🔔 *طلب جديد - الكسواني روزميري*\n\n'
    +'رقم الطلب: '+(order.orderNum||'#'+String(order.id).slice(-6))+'\n\n'
    +'👤 الاسم: '+order.name+'\n'
    +'📞 الهاتف: '+order.phone+'\n'
    +'📍 المنطقة: '+(order.area||'')+'\n'
    +'🏠 العنوان: '+(order.address||'')+'\n'
    +'📅 موعد التوصيل: '+(order.deliveryDate||'غير محدد')+'\n\n'
    +'📦 المنتجات:\n'+items+'\n\n'
    +'💰 المجموع: '+(order.subtotal||'')+'\n'
    +'🚚 التوصيل: '+(order.delivery||'')+'\n'
    +'💵 الإجمالي: '+(order.total||'')+'\n\n'
    +'📝 ملاحظات: '+(order.notes||'لا يوجد');
}

function stopOrderListener(){
  if(_orderListener){_orderListener();_orderListener=null;_lastOrderCount=-1;}
}

// ===== UPDATE ORDER STATUS (from admin) =====

async function sendDailyReport(){
  try{
    const snap=await db.collection('orders').get();
    const orders=snap.docs.map(d=>d.data());
    const today=jordanDisplayDate();
    const todayOrders=orders.filter(o=>o.date===today);
    const totalToday=todayOrders.reduce((s,o)=>s+parseFloat((o.total||'0').replace(/[^0-9.]/g,'')),0);
    const allTotal=orders.reduce((s,o)=>s+parseFloat((o.total||'0').replace(/[^0-9.]/g,'')),0);
    const newOrders=orders.filter(o=>(o.status||'جديد')==='جديد').length;
    const delivered=orders.filter(o=>o.status==='تم التسليم').length;
    // Top product today
    const todayItems={};
    todayOrders.forEach(o=>(o.items||[]).forEach(i=>{todayItems[i.name]=(todayItems[i.name]||0)+i.qty;}));
    const topToday=Object.entries(todayItems).sort((a,b)=>b[1]-a[1])[0];
    var reportLines=[
      'تقرير اليوم - الكسواني روزميري',
      'التاريخ: '+today,
      '',
      'طلبات اليوم: '+todayOrders.length+' طلب',
      'مبيعات اليوم: '+totalToday.toFixed(2)+' دينار',
      '',
      'طلبات جديدة: '+newOrders,
      'تم تسليمها: '+delivered,
      '',
      topToday?('الاكثر طلبا: '+topToday[0]+' x'+topToday[1]):'',
      'اجمالي المبيعات: '+allTotal.toFixed(2)+' دينار',
      'عدد الطلبات: '+orders.length
    ];
    var msg=reportLines.join('\n');
        var a=document.createElement('a');
    a.href='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);
    a.target='_blank';
    a.rel='noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }catch(e){toast('❌ خطأ في إرسال التقرير');}
}

// ===== OPERATOR LEDGER =====
// ===== OPERATOR ACCOUNTING SYSTEM — NEW =====

// --- Sub-tab switcher ---
function switchOpTab(tab){
  const allTabs=['oporders','products','stores','sales','account','balance','reps','daysheet','workers','empwages','expenses','emppoints','settings'];
  allTabs.forEach(t=>{
    const panelId=t==='oporders'?'emp-subtab-operator':
                  ['daysheet','workers','empwages','expenses','emppoints','settings'].includes(t)?'emp-subtab-'+t:
                  'optab-'+t;
    const el=document.getElementById(panelId);
    const btn=document.getElementById('optab-btn-'+t);
    const isActive=t===tab;
    if(el) el.style.display=isActive?'block':'none';
    if(btn){
      btn.style.background=isActive?'var(--green-dark)':'var(--card-bg)';
      btn.style.color=isActive?'#fff':'var(--text-mid)';
      btn.style.fontWeight=isActive?'700':'400';
    }
  });
  if(tab!=='sales'&&_todaySalesUnsub){_todaySalesUnsub();_todaySalesUnsub=null;}
  if(tab==='products') loadOpProducts();
  if(tab==='stores') loadOpStores();
  if(tab==='sales') initSalesTab();
  if(tab==='account'){loadAcctStoreList();checkOperatorDayStatus();}
  if(tab==='balance') loadBalanceTab();
  if(tab==='oporders'){_opOrdersFilter='all';document.querySelectorAll('#opOrdersChips .order-stab').forEach((b,i)=>{b.classList.toggle('active',i===0);});loadOperatorOrders();}
  if(tab==='daysheet'){const d=document.getElementById('daysheet_date');if(d&&!d.value)d.value=jordanDateStr();loadDaySheet();}
  if(tab==='workers')loadEmpWorkers();
  if(tab==='empwages')loadEmpWages();
  if(tab==='expenses'){const d=document.getElementById('expDate');if(d&&!d.value)d.value=jordanDateStr();loadExpenses();}
  if(tab==='emppoints')loadAdminEmpPoints();
  if(tab==='settings'){loadEmpPagesAdmin();_initAreaFeesUI();loadFCMSettings();}
  if(tab==='reps'){loadPointValueSetting();loadRepAccounting();}
}

// ===== QUICK DELIVER TAB (تسليم سريع) =====
// Per-store carts: {storeId: {storeName, items: []}}
let _dlvCarts={};
let _dlvCurrentStoreId='';

async function initDlvTab(){
  if(!_opStoresList.length) await loadOpStores();
  if(!_opProductsList.length) await loadOpProducts();
  const storeSel=document.getElementById('dlv_store');
  storeSel.innerHTML='<option value="">— اختار المتجر —</option>'+
    _opStoresList.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
  // restore previously selected store if any
  if(_dlvCurrentStoreId) storeSel.value=_dlvCurrentStoreId;
  const dateEl=document.getElementById('dlv_date');
  if(dateEl&&!dateEl.value) dateEl.value=jordanDateStr();
  _fillDlvProdOptions(_dlvCurrentStoreId);
  renderDlvCart();
  renderDlvPending();
}

function _fillDlvProdOptions(storeId){
  const prodSel=document.getElementById('dlv_prod');
  prodSel.innerHTML='<option value="">— المنتج —</option>'+
    _opProductsList.map(p=>{
      const storePrices=p.storePrices||{};
      const price=storeId&&storePrices[storeId]?storePrices[storeId]:(p.defaultSellPrice||0);
      return `<option value="${p.id}" data-name="${p.name}" data-price="${price}" data-raw="${p.rawMaterialCost||0}" data-tree="${p.treeCost||0}" data-machine="${p.machineWorkerWage||0}" data-assembly="${p.assemblyWorkerWage||0}">${p.name} — ${price.toFixed(2)} د.أ</option>`;
    }).join('');
  const info=document.getElementById('dlv_price_info');
  if(info) info.textContent='';
}

function _dlvCurrentCart(){
  if(!_dlvCurrentStoreId) return [];
  if(!_dlvCarts[_dlvCurrentStoreId]) return [];
  return _dlvCarts[_dlvCurrentStoreId].items;
}

function onDlvStoreChange(){
  const sel=document.getElementById('dlv_store');
  _dlvCurrentStoreId=sel.value;
  _fillDlvProdOptions(_dlvCurrentStoreId);
  renderDlvCart();
}

function onDlvProdChange(){
  const opt=document.getElementById('dlv_prod').selectedOptions[0];
  const info=document.getElementById('dlv_price_info');
  if(!opt||!opt.value){info.textContent='';return;}
  info.textContent=`💰 سعر الوحدة: ${parseFloat(opt.dataset.price||0).toFixed(2)} د.أ`;
}

function addDlvItem(){
  const storeEl=document.getElementById('dlv_store');
  const prodSel=document.getElementById('dlv_prod');
  const qtyEl=document.getElementById('dlv_qty');
  if(!storeEl.value){toast('⚠️ اختار المتجر أولاً');return;}
  const opt=prodSel.selectedOptions[0];
  if(!opt||!opt.value){toast('⚠️ اختار منتجاً');return;}
  const qty=parseInt(qtyEl.value)||1;
  const price=parseFloat(opt.dataset.price||0);
  const sid=storeEl.value;
  const sname=storeEl.selectedOptions[0]?.text||'';
  if(!_dlvCarts[sid]) _dlvCarts[sid]={storeName:sname,items:[]};
  const cart=_dlvCarts[sid].items;
  const existing=cart.find(i=>i.productId===opt.value);
  if(existing){existing.qty+=qty;}
  else{
    cart.push({
      productId:opt.value, productName:opt.dataset.name, qty, sellPrice:price,
      rawMaterialCost:parseFloat(opt.dataset.raw||0),
      treeCost:parseFloat(opt.dataset.tree||0),
      machineWorkerWage:parseFloat(opt.dataset.machine||0),
      assemblyWorkerWage:parseFloat(opt.dataset.assembly||0)
    });
  }
  qtyEl.value=1; prodSel.value='';
  document.getElementById('dlv_price_info').textContent='';
  renderDlvCart();
  renderDlvPending();
}

function removeDlvItem(idx){
  const cart=_dlvCurrentCart();
  cart.splice(idx,1);
  renderDlvCart();
  renderDlvPending();
}

function changeDlvQty(idx, delta){
  const cart=_dlvCurrentCart();
  cart[idx].qty=Math.max(1,(cart[idx].qty||1)+delta);
  renderDlvCart();
  renderDlvPending();
}

function renderDlvCart(){
  const list=document.getElementById('dlv_cart_list');
  const totalWrap=document.getElementById('dlv_cart_total');
  const totalVal=document.getElementById('dlv_total_val');
  if(!list)return;
  const cart=_dlvCurrentCart();
  if(!cart.length){
    list.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;">السلة فاضية — اضغط ➕ لإضافة منتج</div>';
    if(totalWrap)totalWrap.style.display='none';
    return;
  }
  const total=cart.reduce((s,i)=>(i.sellPrice||0)*(i.qty||1)+s,0);
  list.innerHTML=cart.map((item,idx)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px dashed var(--border);">
      <div style="flex:1;font-weight:700;color:var(--text-dark);font-size:0.85rem;">${item.productName}</div>
      <div style="display:flex;align-items:center;border:1.5px solid var(--border);border-radius:8px;overflow:hidden;flex-shrink:0;">
        <button onclick="changeDlvQty(${idx},-1)" style="padding:5px 11px;border:none;background:#f3f4f6;color:var(--green-dark);font-size:1rem;font-weight:700;cursor:pointer;line-height:1;">−</button>
        <span style="padding:5px 10px;font-weight:800;font-size:0.9rem;min-width:28px;text-align:center;background:var(--card-bg);">${item.qty}</span>
        <button onclick="changeDlvQty(${idx},1)" style="padding:5px 11px;border:none;background:#f3f4f6;color:var(--green-dark);font-size:1rem;font-weight:700;cursor:pointer;line-height:1;">+</button>
      </div>
      <span style="font-weight:700;color:#166534;font-size:0.85rem;white-space:nowrap;min-width:52px;text-align:left;">${((item.sellPrice||0)*(item.qty||1)).toFixed(2)} د.أ</span>
      <button onclick="removeDlvItem(${idx})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:5px 9px;font-size:0.75rem;cursor:pointer;flex-shrink:0;">✕</button>
    </div>`).join('');
  if(totalWrap){totalWrap.style.display='flex';}
  if(totalVal){totalVal.textContent=total.toFixed(2)+' د.أ';}
}

// ===== PENDING ORDERS (localStorage) =====
const _PENDING_ORDERS_KEY='ak_pending_orders';
let _dlvCurrentImage=null;

function _loadPendingOrders(){
  try{return JSON.parse(localStorage.getItem(_PENDING_ORDERS_KEY)||'[]');}catch(e){return [];}
}
function _savePendingOrdersLS(orders){
  try{localStorage.setItem(_PENDING_ORDERS_KEY,JSON.stringify(orders));}catch(e){toast('⚠️ تجاوز مساحة التخزين');}
}

function _compressImage(dataUrl,maxDim=900,quality=0.6){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width,h=img.height;
      // تصغير أكبر بُعد لـ maxDim (يشمل الصور الطويلة والعريضة)
      if(w>maxDim||h>maxDim){
        if(w>=h){h=Math.round(h*maxDim/w);w=maxDim;}
        else{w=Math.round(w*maxDim/h);h=maxDim;}
      }
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      let q=quality, out=canvas.toDataURL('image/jpeg',q);
      // إنقاص الجودة تدريجياً لو لسا كبيرة (هدف ~480KB لكل صورة)
      while(out.length>650000&&q>0.3){q-=0.1;out=canvas.toDataURL('image/jpeg',q);}
      resolve(out);
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

// يضمن إنه مجموع الصور يبقى تحت حد حجم وثيقة Firestore (~1MB) — يضغط أكثر لو لزم
async function _compressImagesForDoc(arr){
  if(!arr||!arr.length) return arr;
  for(let k=0;k<arr.length;k++){
    if(arr[k]&&arr[k].length>200000) arr[k]=await _compressImage(arr[k]);
  }
  let dim=700;
  while(arr.reduce((s,u)=>s+(u?u.length:0),0)>950000&&dim>=400){
    for(let k=0;k<arr.length;k++){ if(arr[k]) arr[k]=await _compressImage(arr[k],dim,0.55); }
    dim-=150;
  }
  return arr;
}

async function onDlvImageChange(input){
  const file=input.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    _dlvCurrentImage=await _compressImage(e.target.result);
    renderDlvImagePreview();
  };
  reader.readAsDataURL(file);
}

function renderDlvImagePreview(){
  const wrap=document.getElementById('dlv_img_preview');
  if(!wrap)return;
  if(!_dlvCurrentImage){wrap.innerHTML='';return;}
  wrap.innerHTML=`<div style="position:relative;display:inline-block;width:100%;">
    <img src="${_dlvCurrentImage}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;border:1.5px solid var(--border);">
    <button onclick="clearDlvImage()" style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8rem;">✕</button>
  </div>`;
}

function clearDlvImage(){
  _dlvCurrentImage=null;
  renderDlvImagePreview();
  const c=document.getElementById('dlv_img_camera');
  const f=document.getElementById('dlv_img_file');
  if(c)c.value='';if(f)f.value='';
}

function addPendingOrder(){
  const storeEl=document.getElementById('dlv_store');
  if(!storeEl.value){toast('⚠️ اختار المتجر أولاً');return;}
  const cart=_dlvCurrentCart();
  if(!cart.length){toast('⚠️ أضف منتجاً على الأقل');return;}
  const date=document.getElementById('dlv_date').value||jordanDateStr();
  const notes=document.getElementById('dlv_notes').value.trim();
  const order={
    id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),
    storeId:storeEl.value,
    storeName:storeEl.selectedOptions[0]?.text||'',
    items:JSON.parse(JSON.stringify(cart)),
    imageDataUrl:_dlvCurrentImage||null,
    date,notes,
    createdAt:Date.now()
  };
  const orders=_loadPendingOrders();
  orders.push(order);
  _savePendingOrdersLS(orders);
  delete _dlvCarts[_dlvCurrentStoreId];
  _dlvCurrentImage=null;
  document.getElementById('dlv_notes').value='';
  renderDlvImagePreview();
  renderDlvCart();
  renderDlvPending();
  toast('✅ تم إضافة الطلب');
}

function renderDlvPending(){
  const wrap=document.getElementById('dlv_pending_wrap');
  if(!wrap)return;
  const orders=_loadPendingOrders();
  const allWrap=document.getElementById('dlv_deliver_all_wrap');
  if(!orders.length){
    wrap.innerHTML='';
    if(allWrap)allWrap.style.display='none';
    return;
  }
  if(allWrap)allWrap.style.display='';
  wrap.innerHTML=`<div style="font-size:0.88rem;font-weight:700;color:var(--green-dark);margin-bottom:10px;">📋 الطلبات المعلقة (${orders.length})</div>`+
    orders.map(ord=>{
      const total=ord.items.reduce((s,i)=>(i.sellPrice||0)*(i.qty||1)+s,0);
      return `<div style="background:var(--card-bg);border:1.5px solid #fcd34d;border-radius:12px;padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <div style="font-weight:700;color:var(--green-dark);font-size:0.92rem;">🏪 ${ord.storeName}</div>
            <div style="font-size:0.72rem;color:var(--text-mid);">${ord.date}${ord.notes?' · '+ord.notes:''}</div>
          </div>
          <span style="font-weight:900;color:#92400e;font-size:0.95rem;white-space:nowrap;">${total.toFixed(2)} د.أ</span>
        </div>
        ${ord.imageDataUrl?`<img src="${ord.imageDataUrl}" style="width:100%;max-height:110px;object-fit:cover;border-radius:8px;margin-bottom:8px;border:1px solid var(--border);" onclick="openDlvImage('${ord.id}')">`:'' }
        <div style="font-size:0.78rem;color:var(--text-mid);margin-bottom:10px;line-height:1.6;">${ord.items.map(i=>`${i.productName} × ${i.qty}`).join(' &nbsp;·&nbsp; ')}</div>
        <div style="display:flex;gap:8px;">
          <button onclick="deliverOrder('${ord.id}')" style="flex:1;padding:9px;background:#166534;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;">✅ تسليم</button>
          <button onclick="deletePendingOrder('${ord.id}')" style="padding:9px 14px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.85rem;cursor:pointer;">🗑</button>
        </div>
      </div>`;
    }).join('');
}

function openDlvImage(orderId){
  const orders=_loadPendingOrders();
  const ord=orders.find(o=>o.id===orderId);
  if(!ord||!ord.imageDataUrl)return;
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
  ov.innerHTML=`<img src="${ord.imageDataUrl}" style="max-width:95vw;max-height:90vh;border-radius:10px;object-fit:contain;">`;
  ov.onclick=()=>document.body.removeChild(ov);
  document.body.appendChild(ov);
}

async function deliverOrder(orderId){
  const orders=_loadPendingOrders();
  const ord=orders.find(o=>o.id===orderId);
  if(!ord)return;
  const btn=event.target;
  btn.disabled=true;btn.textContent='⏳...';
  try{
    const batch=db.batch();
    ord.items.forEach(item=>{
      const ref=db.collection('operator_sales').doc();
      batch.set(ref,{
        storeId:ord.storeId,storeName:ord.storeName,
        productId:item.productId,productName:item.productName,
        qty:item.qty,sellPrice:item.sellPrice,
        rawMaterialCost:item.rawMaterialCost||0,
        treeCost:item.treeCost||0,
        machineWorkerWage:item.machineWorkerWage||0,
        assemblyWorkerWage:item.assemblyWorkerWage||0,
        notes:ord.notes,date:ord.date,
        delivered:true,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    _savePendingOrdersLS(orders.filter(o=>o.id!==orderId));
    renderDlvPending();
    toast(`✅ تم تسليم طلب ${ord.storeName}`);
  }catch(e){btn.disabled=false;btn.textContent='✅ تسليم';toast('❌ '+e.message);}
}

async function deliverAllOrders(){
  const orders=_loadPendingOrders();
  if(!orders.length){toast('⚠️ ما في طلبات');return;}
  if(!confirm(`تسليم كل ${orders.length} طلبات للكشف؟`))return;
  const btn=event.target;
  btn.disabled=true;btn.textContent='⏳ جاري التسليم...';
  try{
    const batch=db.batch();
    let total=0;
    orders.forEach(ord=>{
      ord.items.forEach(item=>{
        const ref=db.collection('operator_sales').doc();
        batch.set(ref,{
          storeId:ord.storeId,storeName:ord.storeName,
          productId:item.productId,productName:item.productName,
          qty:item.qty,sellPrice:item.sellPrice,
          rawMaterialCost:item.rawMaterialCost||0,
          treeCost:item.treeCost||0,
          machineWorkerWage:item.machineWorkerWage||0,
          assemblyWorkerWage:item.assemblyWorkerWage||0,
          notes:ord.notes,date:ord.date,
          delivered:true,
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        total++;
      });
    });
    await batch.commit();
    localStorage.removeItem(_PENDING_ORDERS_KEY);
    renderDlvPending();
    toast(`✅ تم تسليم ${total} منتج لـ ${orders.length} طلبات`);
  }catch(e){btn.disabled=false;btn.textContent='✅ تسليم الكل للكشف';toast('❌ '+e.message);}
}

function deletePendingOrder(orderId){
  if(!confirm('حذف هذا الطلب؟'))return;
  _savePendingOrdersLS(_loadPendingOrders().filter(o=>o.id!==orderId));
  renderDlvPending();
}

function clearDlvStore(sid){
  delete _dlvCarts[sid];
  renderDlvCart();
  renderDlvPending();
}

// --- Operator Products (منتجات المشغل) ---
let _opProductsList=[];
let _editingProductId=null;
let _oppCurrentImageUrl='';
let _oppColors=[];
let _oppPriceOptions=[];

function addOppPriceOption(){
  const lblInp=document.getElementById('opp_priceopt_label');
  const prInp=document.getElementById('opp_priceopt_price');
  const label=(lblInp?.value||'').trim();
  const price=parseFloat(prInp?.value);
  if(!label){toast('⚠️ اكتب اسم الخيار');return;}
  if(isNaN(price)||price<0){toast('⚠️ أدخل سعراً صحيحاً');return;}
  _oppPriceOptions.push({label,price});
  if(lblInp) lblInp.value='';
  if(prInp) prInp.value='';
  renderOppPriceOptionChips();
}
function removeOppPriceOption(i){
  _oppPriceOptions.splice(i,1);
  renderOppPriceOptionChips();
}
function renderOppPriceOptionChips(){
  const wrap=document.getElementById('opp_priceopts_chips');
  if(!wrap)return;
  wrap.innerHTML=_oppPriceOptions.length
    ?_oppPriceOptions.map((o,i)=>`<div style="display:inline-flex;align-items:center;gap:5px;background:#fef9c3;border:1px solid #fde047;border-radius:20px;padding:4px 10px;font-size:0.8rem;color:#854d0e;">
        <span><strong>${o.label}</strong> — ${(o.price||0).toFixed(2)} د.أ</span>
        <button onclick="removeOppPriceOption(${i})" style="background:none;border:none;cursor:pointer;color:#854d0e;font-size:0.85rem;padding:0;line-height:1;">✕</button>
      </div>`).join('')
    :'<div style="font-size:0.75rem;color:#9ca3af;">لا يوجد أسعار متعددة — المنتج بيستخدم سعر البيع العادي</div>';
}

function addOppColor(){
  const inp=document.getElementById('opp_color_input');
  const val=(inp?.value||'').trim();
  if(!val)return;
  if(!_oppColors.includes(val)) _oppColors.push(val);
  if(inp) inp.value='';
  renderOppColorChips();
}
function removeOppColor(i){
  _oppColors.splice(i,1);
  renderOppColorChips();
}
function renderOppColorChips(){
  const wrap=document.getElementById('opp_colors_chips');
  if(!wrap)return;
  wrap.innerHTML=_oppColors.length
    ?_oppColors.map((c,i)=>`<div style="display:inline-flex;align-items:center;gap:4px;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:20px;padding:4px 10px;font-size:0.8rem;color:#0369a1;">
        <span>${c}</span>
        <button onclick="removeOppColor(${i})" style="background:none;border:none;cursor:pointer;color:#0369a1;font-size:0.85rem;padding:0;line-height:1;">✕</button>
      </div>`).join('')
    :'<div style="font-size:0.75rem;color:#9ca3af;">لا يوجد ألوان — أضف لوناً من الأعلى</div>';
}

function _compressImg(dataUrl,maxPx,quality,cb){
  const img=new Image();
  img.onload=()=>{
    let w=img.width,h=img.height;
    if(w>maxPx||h>maxPx){if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;}}
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    cb(c.toDataURL('image/jpeg',quality));
  };
  img.src=dataUrl;
}

function onOppImageChange(input){
  const file=input.files&&input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    _compressImg(e.target.result,500,0.72,compressed=>{
      _oppCurrentImageUrl=compressed;
      _renderOppImgPreview();
    });
  };
  reader.readAsDataURL(file);
  input.value='';
}
function clearOppImage(){_oppCurrentImageUrl='';_renderOppImgPreview();}
function _renderOppImgPreview(){
  const wrap=document.getElementById('opp_img_preview');
  if(!wrap) return;
  if(!_oppCurrentImageUrl){wrap.innerHTML='';return;}
  wrap.innerHTML=`<div style="position:relative;display:inline-block;">
    <img src="${_oppCurrentImageUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:9px;border:1.5px solid #86efac;">
    <button onclick="clearOppImage()" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;background:#dc2626;color:#fff;border:none;border-radius:50%;cursor:pointer;font-size:0.7rem;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
  </div>`;
}

async function loadOpProducts(){
  try{
    const snap=await db.collection('operator_products').orderBy('name').get();
    _opProductsList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_opProductsList=[];}
  if(!_opStoresList.length){
    try{
      const snap=await db.collection('operator_stores').orderBy('name').get();
      _opStoresList=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){}
  }
  renderOpProductsList();
  renderStorePricesForm();
  // Populate category datalist
  const dl=document.getElementById('opp_category_list');
  if(dl){
    const cats=[...new Set(_opProductsList.map(p=>p.category||'').filter(Boolean))].sort();
    dl.innerHTML=cats.map(c=>`<option value="${c}">`).join('');
  }
}

function renderOpProductsList(){
  const wrap=document.getElementById('opp_list');
  if(!wrap) return;
  if(!_opProductsList.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;padding:20px;font-size:0.85rem;">لا يوجد منتجات — أضف منتجاً جديداً</div>';
    return;
  }
  wrap.innerHTML=_opProductsList.map(p=>{
    const spEntries=p.storePrices?Object.entries(p.storePrices).filter(([,v])=>v>0):[];
    const storePricesHtml=spEntries.length
      ?`<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-mid);margin-bottom:5px;">🏪 أسعار لكل متجر</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${spEntries.map(([sid,price])=>{
              const st=_opStoresList.find(s=>s.id===sid);
              if(!st) return '';
              return `<div style="background:#ecfdf5;border:1px solid #86efac;border-radius:6px;padding:3px 8px;font-size:0.73rem;">
                <span style="color:var(--text-mid);">${st.name}</span>
                <strong style="color:#166534;margin-right:4px;">${parseFloat(price).toFixed(2)} د.أ</strong>
              </div>`;
            }).join('')}
          </div>
        </div>`
      :'';
    const poEntries=Array.isArray(p.priceOptions)?p.priceOptions:[];
    const priceOptsHtml=poEntries.length
      ?`<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-mid);margin-bottom:5px;">💵 أسعار متعددة</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${poEntries.map(o=>`<div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:3px 8px;font-size:0.73rem;">
                <span style="color:var(--text-mid);">${o.label}</span>
                <strong style="color:#854d0e;margin-right:4px;">${(o.price||0).toFixed(2)} د.أ</strong>
              </div>`).join('')}
          </div>
        </div>`
      :'';
    const prodImg=p.imageDataUrl||'';
    return `
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          ${prodImg?`<img src="${prodImg}" style="width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0;">`:`<div style="width:46px;height:46px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">📦</div>`}
          <div style="font-weight:700;color:var(--green-dark);font-size:0.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}${p.requiresWriting?` <span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:6px;padding:1px 6px;font-size:0.68rem;font-weight:700;">✍️ كتابة</span>`:''}${p.isRawMaterial?` <span style="background:#faf5ff;color:#6d28d9;border:1px solid #e9d5ff;border-radius:6px;padding:1px 6px;font-size:0.68rem;font-weight:700;">🏭 خام</span>`:''}${p.category?` <span style="background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:6px;padding:1px 6px;font-size:0.68rem;font-weight:700;">📂 ${p.category}</span>`:''}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;">
          <button onclick="editOpProduct('${p.id}')" style="background:#eff6ff;color:#1e40af;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.82rem;">✏️</button>
          <button onclick="deleteOpProduct('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.85rem;">✕</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;font-size:0.78rem;">
        <div style="background:#fefce8;border-radius:7px;padding:7px;text-align:center;">
          <div style="color:#92400e;margin-bottom:2px;">🧱 مواد خام</div>
          <div style="font-weight:800;color:#92400e;">${(p.rawMaterialCost||0).toFixed(2)}</div>
        </div>
        <div style="background:#f0fdf4;border-radius:7px;padding:7px;text-align:center;">
          <div style="color:#15803d;margin-bottom:2px;">🌳 شجر</div>
          <div style="font-weight:800;color:#15803d;">${(p.treeCost||0).toFixed(2)}</div>
        </div>
        <div style="background:#eff6ff;border-radius:7px;padding:7px;text-align:center;">
          <div style="color:#1e40af;margin-bottom:2px;">⚙️ ماكينة</div>
          <div style="font-weight:800;color:#1e40af;">${(p.machineWorkerWage||0).toFixed(2)}</div>
        </div>
        <div style="background:#f5f3ff;border-radius:7px;padding:7px;text-align:center;">
          <div style="color:#7c3aed;margin-bottom:2px;">🔧 تركيب</div>
          <div style="font-weight:800;color:#7c3aed;">${(p.assemblyWorkerWage||0).toFixed(2)}</div>
        </div>
        <div style="background:#f0fdf4;border-radius:7px;padding:7px;text-align:center;">
          <div style="color:#166534;margin-bottom:2px;">💰 سعر المنتج</div>
          <div style="font-weight:800;color:#166534;">${(p.sellPrice||0).toFixed(2)}</div>
        </div>
      </div>
      ${storePricesHtml}
      ${priceOptsHtml}
    </div>`;
  }).join('');
}

function renderStorePricesForm(){
  const sec=document.getElementById('opp_store_prices_section');
  if(!sec) return;
  if(!_opStoresList.length){sec.innerHTML='';return;}
  sec.innerHTML=`
    <div style="margin-bottom:6px;font-size:0.82rem;font-weight:700;color:var(--text-mid);">🏪 سعر البيع لكل متجر (اختياري)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      ${_opStoresList.map(s=>`
        <div style="display:flex;align-items:center;gap:6px;background:#f9fafb;border:1px solid var(--border);border-radius:8px;padding:6px 8px;">
          <div style="flex:1;font-size:0.8rem;font-weight:600;color:var(--text-dark);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.name.replace(/"/g,'&quot;')}">${s.name}</div>
          <input type="number" id="opp_sp_${s.id}" min="0" step="0.5" placeholder="—"
            style="width:68px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-family:'Tajawal',sans-serif;font-size:0.82rem;background:var(--card-bg);color:var(--text-dark);text-align:center;">
        </div>`).join('')}
    </div>`;
}

function editOpProduct(id){
  const p=_opProductsList.find(x=>x.id===id);
  if(!p) return;
  _editingProductId=id;
  document.getElementById('opp_name').value=p.name||'';
  document.getElementById('opp_sell').value=p.sellPrice||'';
  document.getElementById('opp_raw').value=p.rawMaterialCost||'';
  document.getElementById('opp_tree').value=p.treeCost||'';
  document.getElementById('opp_machine').value=p.machineWorkerWage||'';
  document.getElementById('opp_assembly').value=p.assemblyWorkerWage||'';
  _oppCurrentImageUrl=p.imageDataUrl||'';
  _renderOppImgPreview();
  // Fill per-store prices
  _opStoresList.forEach(s=>{
    const inp=document.getElementById(`opp_sp_${s.id}`);
    if(inp) inp.value=(p.storePrices&&p.storePrices[s.id])||'';
  });
  _oppColors=Array.isArray(p.colors)?[...p.colors]:[];
  renderOppColorChips();
  _oppPriceOptions=Array.isArray(p.priceOptions)?p.priceOptions.map(o=>({label:o.label,price:o.price})):[];
  renderOppPriceOptionChips();
  const rw=document.getElementById('opp_requires_writing');
  if(rw) rw.checked=!!p.requiresWriting;
  const rm=document.getElementById('opp_is_raw_material');
  if(rm) rm.checked=!!p.isRawMaterial;
  const catEl=document.getElementById('opp_category');
  if(catEl) catEl.value=p.category||'';
  document.getElementById('opp_form_title').textContent='✏️ تعديل المنتج';
  document.getElementById('opp_save_btn').textContent='💾 حفظ التعديلات';
  document.getElementById('opp_cancel_btn').style.display='block';
  document.getElementById('opp_name').focus();
  document.getElementById('opp_name').scrollIntoView({behavior:'smooth',block:'center'});
}

function cancelEditProduct(){
  _editingProductId=null;
  ['opp_name','opp_raw','opp_tree','opp_machine','opp_assembly','opp_sell'].forEach(id=>{
    const el=document.getElementById(id);if(el) el.value='';
  });
  _opStoresList.forEach(s=>{
    const inp=document.getElementById(`opp_sp_${s.id}`);
    if(inp) inp.value='';
  });
  _oppCurrentImageUrl='';
  _renderOppImgPreview();
  _oppColors=[];
  renderOppColorChips();
  _oppPriceOptions=[];
  renderOppPriceOptionChips();
  const rw=document.getElementById('opp_requires_writing');
  if(rw) rw.checked=false;
  const rm=document.getElementById('opp_is_raw_material');
  if(rm) rm.checked=false;
  const catEl=document.getElementById('opp_category');
  if(catEl) catEl.value='';
  document.getElementById('opp_form_title').textContent='➕ إضافة منتج جديد';
  document.getElementById('opp_save_btn').textContent='💾 حفظ المنتج';
  document.getElementById('opp_cancel_btn').style.display='none';
}

async function saveOpProduct(){
  const name=document.getElementById('opp_name').value.trim();
  const raw=parseFloat(document.getElementById('opp_raw').value)||0;
  const tree=parseFloat(document.getElementById('opp_tree').value)||0;
  const machine=parseFloat(document.getElementById('opp_machine').value)||0;
  const assembly=parseFloat(document.getElementById('opp_assembly').value)||0;
  const sell=parseFloat(document.getElementById('opp_sell').value)||0;
  if(!name){toast('⚠️ أدخل اسم المنتج');return;}
  const storePrices={};
  _opStoresList.forEach(s=>{
    const inp=document.getElementById(`opp_sp_${s.id}`);
    const v=inp?parseFloat(inp.value):NaN;
    if(!isNaN(v)&&v>0) storePrices[s.id]=v;
  });
  try{
    const requiresWriting=document.getElementById('opp_requires_writing')?.checked||false;
    const isRawMaterial=document.getElementById('opp_is_raw_material')?.checked||false;
    const category=(document.getElementById('opp_category')?.value||'').trim();
    if(_editingProductId){
      await db.collection('operator_products').doc(_editingProductId).update({
        name,rawMaterialCost:raw,treeCost:tree,machineWorkerWage:machine,
        assemblyWorkerWage:assembly,sellPrice:sell,storePrices,
        colors:_oppColors,requiresWriting,isRawMaterial,category,imageDataUrl:_oppCurrentImageUrl||'',priceOptions:_oppPriceOptions
      });
      toast('✅ تم حفظ التعديلات');
    } else {
      await db.collection('operator_products').add({
        name,rawMaterialCost:raw,treeCost:tree,machineWorkerWage:machine,
        assemblyWorkerWage:assembly,sellPrice:sell,
        storePrices,colors:_oppColors,requiresWriting,isRawMaterial,category,imageDataUrl:_oppCurrentImageUrl||'',priceOptions:_oppPriceOptions,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('✅ تم حفظ المنتج');
    }
    cancelEditProduct();
    _empSharedProducts=null; // invalidate cache so orders picks up the change
    loadOpProducts();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteOpProduct(id){
  if(!confirm('حذف هذا المنتج؟')) return;
  try{
    await db.collection('operator_products').doc(id).delete();
    _empSharedProducts=null;
    toast('✅ تم الحذف');
    loadOpProducts();
  }catch(e){toast('❌ خطأ في الحذف');}
}

// --- Operator Stores (المتاجر) ---
let _opStoresList=[];
let _opAllStoresList=[]; // includes archived — used for accounting history

async function loadOpStores(){
  try{
    const snap=await db.collection('operator_stores').orderBy('name').get();
    const all=snap.docs.map(d=>({id:d.id,...d.data()}));
    _opAllStoresList=all;
    _opStoresList=all.filter(s=>!s.archived); // only active for new entries
    renderOpStoresList(all);
  }catch(e){_opStoresList=[];_opAllStoresList=[];}
  _fillOpStorePageSel();
}

async function _fillOpStorePageSel(){
  const sel=document.getElementById('opstore_page_sel');
  if(!sel)return;
  try{
    const snap=await db.collection('employee_pages').orderBy('name').get();
    const pages=snap.docs.map(d=>({id:d.id,...d.data()}));
    const linked=new Set(_opStoresList.filter(s=>s.pageId).map(s=>s.pageId));
    sel.innerHTML='<option value="">🔗 اربط بصفحة (اختياري)</option>'+
      pages.map(p=>`<option value="${p.id}" ${linked.has(p.id)?'disabled style="color:#9ca3af"':''}>${p.name}${linked.has(p.id)?' (مرتبطة)':''}</option>`).join('');
  }catch(e){}
}

function renderOpStoresList(allStores){
  const wrap=document.getElementById('opstore_list');
  if(!wrap) return;
  const stores=allStores||_opStoresList;
  if(!stores.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;padding:20px;font-size:0.85rem;">لا يوجد متاجر — أضف متجراً جديداً</div>';
    return;
  }
  const active=stores.filter(s=>!s.archived);
  const archived=stores.filter(s=>s.archived);
  const renderCard=(s)=>`
    <div style="background:${s.archived?'#f9fafb':'var(--card-bg)'};border:1px solid ${s.archived?'#e5e7eb':'var(--border)'};border-radius:12px;padding:14px;margin-bottom:8px;opacity:${s.archived?'0.7':'1'};">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:${s.archived?'#9ca3af':'var(--green-dark)'};font-size:1rem;">${s.archived?'🗂️':'🏪'} ${s.name}${s.archived?' <span style="font-size:0.68rem;color:#9ca3af;font-weight:400;">(مؤرشف)</span>':''}</div>
          ${!s.archived?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;">
            ${s.group
              ?`<div style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;border:1px solid #c4b5fd;border-radius:20px;padding:2px 8px;">
                  <span style="font-size:0.72rem;color:#6d28d9;font-weight:600;">👥 ${s.group}</span>
                  <button onclick="setStoreGroup('${s.id}','${(s.group||'').replace(/'/g,"\\'")}')" style="background:none;border:none;color:#6d28d9;cursor:pointer;font-size:0.7rem;padding:0;">✏️</button>
                </div>`
              :`<button onclick="setStoreGroup('${s.id}','')" style="background:#f5f3ff;border:1px dashed #c4b5fd;border-radius:20px;padding:2px 10px;font-family:'Tajawal',sans-serif;font-size:0.72rem;color:#7c3aed;cursor:pointer;">+ إضافة لمجموعة</button>`
            }
            ${s.pageId
              ?`<div style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;border:1px solid #86efac;border-radius:20px;padding:2px 8px;">
                  <span style="font-size:0.72rem;color:#166534;font-weight:600;">🔗 ${s.pageName}</span>
                  <button onclick="promptLinkStore('${s.id}')" style="background:none;border:none;color:#166534;cursor:pointer;font-size:0.7rem;padding:0;">✏️</button>
                </div>`
              :`<button onclick="promptLinkStore('${s.id}')" style="background:#f1f5f9;border:1px dashed #94a3b8;border-radius:20px;padding:2px 10px;font-family:'Tajawal',sans-serif;font-size:0.72rem;color:#64748b;cursor:pointer;">+ ربط بصفحة</button>`
            }
          </div>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${s.archived
            ?`<button onclick="unarchiveOpStore('${s.id}')" style="background:#dcfce7;color:#166534;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:0.78rem;font-family:'Tajawal',sans-serif;">↩️ إلغاء الأرشفة</button>`
            :`<button onclick="archiveOpStore('${s.id}')" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:0.78rem;font-family:'Tajawal',sans-serif;">🗂️ أرشفة</button>`
          }
          <button onclick="deleteOpStore('${s.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:0.85rem;">✕</button>
        </div>
      </div>
      ${!s.archived?`<div id="link_form_${s.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <select id="link_page_sel_${s.id}" style="width:100%;padding:8px 10px;border:1.5px solid #86efac;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.85rem;background:var(--card-bg);color:var(--text-dark);margin-bottom:6px;">
          <option value="">— بدون ربط —</option>
        </select>
        <div style="display:flex;gap:6px;">
          <button onclick="saveLinkStore('${s.id}')" style="flex:1;padding:8px;background:#166634;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-weight:700;font-size:0.82rem;cursor:pointer;">💾 حفظ</button>
          <button onclick="document.getElementById('link_form_${s.id}').style.display='none'" style="padding:8px 12px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.82rem;cursor:pointer;">✕</button>
        </div>
      </div>`:''}
    </div>`;
  let html=active.map(renderCard).join('');
  if(archived.length){
    html+=`<div style="font-size:0.75rem;color:#9ca3af;margin:14px 0 6px;font-weight:600;">🗂️ المتاجر المؤرشفة (${archived.length})</div>`;
    html+=archived.map(renderCard).join('');
  }
  wrap.innerHTML=html;
}

async function addOpStore(){
  const name=document.getElementById('opstore_name_inp').value.trim();
  if(!name){toast('⚠️ أدخل اسم المتجر');return;}
  const group=(document.getElementById('opstore_group_inp')?.value||'').trim();
  const pageSel=document.getElementById('opstore_page_sel');
  const pageId=pageSel?.value||'';
  const pageName=pageId?(pageSel.options[pageSel.selectedIndex].text.replace(' (مرتبطة)','')):'';
  try{
    await db.collection('operator_stores').add({
      name,
      ...(group?{group}:{}),
      ...(pageId?{pageId,pageName}:{}),
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('opstore_name_inp').value='';
    const gi=document.getElementById('opstore_group_inp');if(gi)gi.value='';
    if(pageSel)pageSel.value='';
    toast('✅ تم إضافة المتجر'+(group?` في مجموعة "${group}"`:''));
    loadOpStores();
  }catch(e){toast('❌ خطأ في الإضافة');}
}

async function setStoreGroup(id,currentGroup){
  const g=prompt('اسم المجموعة (اتركه فارغاً للإزالة):',currentGroup||'');
  if(g===null)return;
  try{
    await db.collection('operator_stores').doc(id).update({group:g.trim()||firebase.firestore.FieldValue.delete()});
    toast(g.trim()?`✅ تم تعيين المجموعة "${g.trim()}"`:'✅ تم إزالة المجموعة');
    loadOpStores();
  }catch(e){toast('❌ '+e.message);}
}

async function archiveOpStore(id){
  if(!confirm('أرشفة هذا المتجر؟ سيختفي من الحسابات لكن بياناته تبقى محفوظة.')) return;
  try{
    await db.collection('operator_stores').doc(id).update({archived:true});
    toast('🗂️ تم الأرشفة');
    loadOpStores();
  }catch(e){toast('❌ '+e.message);}
}

async function unarchiveOpStore(id){
  try{
    await db.collection('operator_stores').doc(id).update({archived:firebase.firestore.FieldValue.delete()});
    toast('✅ تم إلغاء الأرشفة');
    loadOpStores();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteOpStore(id){
  if(!confirm('حذف نهائي؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
  try{
    await db.collection('operator_stores').doc(id).delete();
    toast('✅ تم الحذف');
    loadOpStores();
  }catch(e){toast('❌ خطأ في الحذف');}
}

async function promptLinkStore(storeId){
  const form=document.getElementById(`link_form_${storeId}`);
  if(!form)return;
  const sel=document.getElementById(`link_page_sel_${storeId}`);
  if(!sel)return;
  // Load pages into the inline dropdown
  try{
    const snap=await db.collection('employee_pages').orderBy('name').get();
    const pages=snap.docs.map(d=>({id:d.id,...d.data()}));
    const linked=new Set(_opStoresList.filter(s=>s.pageId&&s.id!==storeId).map(s=>s.pageId));
    const cur=_opStoresList.find(s=>s.id===storeId);
    sel.innerHTML='<option value="">— بدون ربط —</option>'+
      pages.map(p=>`<option value="${p.id}" ${linked.has(p.id)?'disabled style="color:#9ca3af"':''} ${cur&&cur.pageId===p.id?'selected':''}>${p.name}${linked.has(p.id)?' (مرتبطة)':''}</option>`).join('');
  }catch(e){}
  form.style.display='block';
}

async function saveLinkStore(storeId){
  const sel=document.getElementById(`link_page_sel_${storeId}`);
  if(!sel)return;
  const pageId=sel.value;
  const pageName=pageId?sel.options[sel.selectedIndex].text.replace(' (مرتبطة)',''):'';
  try{
    await db.collection('operator_stores').doc(storeId).update(
      pageId?{pageId,pageName}:{pageId:firebase.firestore.FieldValue.delete(),pageName:firebase.firestore.FieldValue.delete()}
    );
    toast(pageId?`✅ تم الربط بـ "${pageName}"`:'✅ تم إزالة الربط');
    loadOpStores();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

// --- Store Daily Account (حسابات المتاجر اليومية) ---
let _currentStoreId=null;
let _currentStoreName='';
let _currentStoreDate='';
let _currentStoreOrder=null;

async function openStoreAccount(storeId,storeName,date){
  _currentStoreId=storeId;
  _currentStoreName=storeName;
  _currentStoreDate=date;
  const docId=`${storeId}_${date}`;
  try{
    const snap=await db.collection('operator_store_orders').doc(docId).get();
    _currentStoreOrder=snap.exists?snap.data():{storeId,storeName,date,items:[],deliveryFee:0,operatorWage:0,status:'open'};
  }catch(e){
    _currentStoreOrder={storeId,storeName,date,items:[],deliveryFee:0,operatorWage:0,status:'open'};
  }
  // Populate product dropdown
  const sel=document.getElementById('opsa_prod_sel');
  if(sel){
    sel.innerHTML='<option value="">اختر منتج...</option>'+
      _opProductsList.map(p=>`<option value="${p.id}" data-raw="${p.rawMaterialCost||0}" data-tree="${p.treeCost||0}" data-machine="${p.machineWorkerWage||0}" data-assembly="${p.assemblyWorkerWage||0}" data-sell="${p.sellPrice||0}">${p.name}</option>`).join('');
  }
  const dEl=document.getElementById('opsa_delivery');
  const wEl=document.getElementById('opsa_op_wage');
  if(dEl) dEl.value=_currentStoreOrder.deliveryFee||0;
  if(wEl) wEl.value=_currentStoreOrder.operatorWage||0;
  document.getElementById('opstore_account_title').textContent='🏪 '+storeName;
  document.getElementById('opstore_account_date').textContent=date;
  document.getElementById('opstore-list-view').style.display='none';
  document.getElementById('opstore-account-view').style.display='block';
  // Disable add form if closed
  const isClosed=_currentStoreOrder.status==='closed';
  const addForm=document.getElementById('opsa_prod_sel');
  if(addForm) addForm.disabled=isClosed;
  renderStoreOrderItems();
  calcStoreOrderSummary();
}

function backToStoreList(){
  document.getElementById('opstore-list-view').style.display='block';
  document.getElementById('opstore-account-view').style.display='none';
  _currentStoreId=null;_currentStoreOrder=null;
}

function addItemToStoreOrder(){
  if(!_currentStoreOrder){return;}
  if(_currentStoreOrder.status==='closed'){toast('🔒 الحساب مغلق');return;}
  const sel=document.getElementById('opsa_prod_sel');
  const opt=sel.options[sel.selectedIndex];
  if(!sel.value){toast('⚠️ اختر منتجاً');return;}
  const qty=parseFloat(document.getElementById('opsa_qty').value)||1;
  _currentStoreOrder.items.push({
    productId:sel.value,
    productName:opt.text,
    qty,
    rawMaterialCost:parseFloat(opt.dataset.raw)||0,
    treeCost:parseFloat(opt.dataset.tree)||0,
    machineWorkerWage:parseFloat(opt.dataset.machine)||0,
    assemblyWorkerWage:parseFloat(opt.dataset.assembly)||0,
    sellPrice:parseFloat(opt.dataset.sell)||0
  });
  document.getElementById('opsa_qty').value='1';
  renderStoreOrderItems();
  calcStoreOrderSummary();
}

function removeItemFromStoreOrder(index){
  if(!_currentStoreOrder||_currentStoreOrder.status==='closed') return;
  _currentStoreOrder.items.splice(index,1);
  renderStoreOrderItems();
  calcStoreOrderSummary();
}

function renderStoreOrderItems(){
  const wrap=document.getElementById('opsa_items_list');
  if(!wrap||!_currentStoreOrder) return;
  const isClosed=_currentStoreOrder.status==='closed';
  if(!_currentStoreOrder.items.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;padding:16px;font-size:0.85rem;background:var(--card-bg);border-radius:10px;border:1px dashed var(--border);">لا يوجد أصناف — اختر منتجاً وأضفه</div>';
    return;
  }
  wrap.innerHTML=`
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:400px;">
          <thead>
            <tr style="background:#f9fafb;font-size:0.72rem;color:var(--text-mid);">
              <th style="padding:8px;text-align:right;font-weight:600;">المنتج</th>
              <th style="padding:8px;text-align:center;font-weight:600;">كمية</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:#92400e;">🧱 مواد</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:#15803d;">🌳 شجر</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:#1e40af;">⚙️ ماكينة</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:#7c3aed;">🔧 تركيب</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:#166534;">💰 بيع</th>
              ${!isClosed?'<th></th>':''}
            </tr>
          </thead>
          <tbody>
            ${_currentStoreOrder.items.map((it,i)=>`
              <tr style="border-bottom:1px solid var(--border);font-size:0.8rem;">
                <td style="padding:8px;color:var(--text-dark);font-weight:600;">${it.productName}</td>
                <td style="padding:8px;text-align:center;">${it.qty}</td>
                <td style="padding:8px;text-align:center;color:#92400e;">${((it.rawMaterialCost||0)*it.qty).toFixed(2)}</td>
                <td style="padding:8px;text-align:center;color:#15803d;">${((it.treeCost||0)*it.qty).toFixed(2)}</td>
                <td style="padding:8px;text-align:center;color:#1e40af;">${((it.machineWorkerWage||0)*it.qty).toFixed(2)}</td>
                <td style="padding:8px;text-align:center;color:#7c3aed;">${((it.assemblyWorkerWage||0)*it.qty).toFixed(2)}</td>
                <td style="padding:8px;text-align:center;font-weight:700;color:#166534;">${((it.sellPrice||0)*it.qty).toFixed(2)}</td>
                ${!isClosed?`<td style="padding:8px;text-align:center;"><button onclick="removeItemFromStoreOrder(${i})" style="background:#fee2e2;color:#dc2626;border:none;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:0.75rem;">✕</button></td>`:''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function calcStoreOrderSummary(){
  const wrap=document.getElementById('opsa_summary');
  if(!wrap||!_currentStoreOrder) return;
  const delivery=parseFloat(document.getElementById('opsa_delivery')?.value)||0;
  const opWage=parseFloat(document.getElementById('opsa_op_wage')?.value)||0;
  const items=_currentStoreOrder.items||[];
  const totalRaw=items.reduce((s,it)=>s+(it.rawMaterialCost||0)*it.qty,0);
  const totalTree=items.reduce((s,it)=>s+(it.treeCost||0)*it.qty,0);
  const totalMachine=items.reduce((s,it)=>s+(it.machineWorkerWage||0)*it.qty,0);
  const totalAssembly=items.reduce((s,it)=>s+(it.assemblyWorkerWage||0)*it.qty,0);
  const totalSell=items.reduce((s,it)=>s+(it.sellPrice||0)*it.qty,0);
  const totalCost=totalRaw+totalTree+totalMachine+totalAssembly+delivery+opWage;
  const profit=totalSell-totalCost;
  const isP=profit>=0;
  const isClosed=_currentStoreOrder.status==='closed';
  const statusBadge=isClosed
    ?'<span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;">🔒 مغلق</span>'
    :'<span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;">🟢 مفتوح</span>';
  wrap.innerHTML=`
    <div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:14px;overflow:hidden;">
      <div style="background:${isP?'var(--green-dark)':'#991b1b'};padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:700;font-size:0.88rem;">📊 كشف — ${_currentStoreName}</span>
        ${statusBadge}
      </div>
      <div style="padding:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <div style="background:#fefce8;border-radius:9px;padding:9px;text-align:center;">
            <div style="font-size:0.7rem;color:#92400e;margin-bottom:2px;">🧱 مجموع المواد الخام</div>
            <div style="font-weight:800;color:#92400e;font-size:1rem;">${totalRaw.toFixed(2)} د.أ</div>
          </div>
          ${totalTree>0?`<div style="background:#f0fdf4;border-radius:9px;padding:9px;text-align:center;">
            <div style="font-size:0.7rem;color:#15803d;margin-bottom:2px;">🌳 تكلفة الشجر</div>
            <div style="font-weight:800;color:#15803d;font-size:1rem;">${totalTree.toFixed(2)} د.أ</div>
          </div>`:''}
          <div style="background:#eff6ff;border-radius:9px;padding:9px;text-align:center;">
            <div style="font-size:0.7rem;color:#1e40af;margin-bottom:2px;">⚙️ أجرة عامل الماكينة</div>
            <div style="font-weight:800;color:#1e40af;font-size:1rem;">${totalMachine.toFixed(2)} د.أ</div>
          </div>
          <div style="background:#f5f3ff;border-radius:9px;padding:9px;text-align:center;">
            <div style="font-size:0.7rem;color:#7c3aed;margin-bottom:2px;">🔧 أجرة عامل التركيب</div>
            <div style="font-weight:800;color:#7c3aed;font-size:1rem;">${totalAssembly.toFixed(2)} د.أ</div>
          </div>
          <div style="background:#fdf4ff;border-radius:9px;padding:9px;text-align:center;">
            <div style="font-size:0.7rem;color:#9d174d;margin-bottom:2px;">👤 أجرة المشغل</div>
            <div style="font-weight:800;color:#9d174d;font-size:1rem;">${opWage.toFixed(2)} د.أ</div>
          </div>
        </div>
        ${delivery>0?`<div style="background:#eff6ff;border-radius:9px;padding:9px;text-align:center;margin-bottom:10px;">
          <div style="font-size:0.7rem;color:#1e40af;margin-bottom:2px;">🚚 أجرة التوصيل</div>
          <div style="font-weight:800;color:#1e40af;font-size:1rem;">${delivery.toFixed(2)} د.أ</div>
        </div>`:''}
        <div style="border-top:1px dashed var(--border);margin:8px 0;padding-top:8px;">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:4px;">
            <span style="color:var(--text-mid);">إجمالي التكاليف</span>
            <span style="font-weight:700;color:#dc2626;">${totalCost.toFixed(2)} د.أ</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;">
            <span style="color:var(--text-mid);">إجمالي البيع</span>
            <span style="font-weight:700;color:#166534;">${totalSell.toFixed(2)} د.أ</span>
          </div>
        </div>
        <div style="background:${isP?'#dcfce7':'#fee2e2'};border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <span style="font-weight:800;color:${isP?'#166534':'#991b1b'};font-size:0.9rem;">صافي ${isP?'الربح':'الخسارة'}</span>
          <span style="font-weight:900;color:${isP?'#166534':'#991b1b'};font-size:1.25rem;">${Math.abs(profit).toFixed(2)} د.أ ${isP?'✅':'⚠️'}</span>
        </div>
      </div>
    </div>`;
}

function setDeliveryFee(amount,btn){
  const inp=document.getElementById('opsa_delivery');
  if(inp){inp.value=amount;calcStoreOrderSummary();}
  document.querySelectorAll('.delivery-quick-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

async function saveStoreOrder(){
  if(!_currentStoreOrder||!_currentStoreId) return;
  _currentStoreOrder.deliveryFee=parseFloat(document.getElementById('opsa_delivery').value)||0;
  _currentStoreOrder.operatorWage=parseFloat(document.getElementById('opsa_op_wage').value)||0;
  _currentStoreOrder.updatedAt=firebase.firestore.FieldValue.serverTimestamp();
  const docId=`${_currentStoreId}_${_currentStoreDate}`;
  try{
    await db.collection('operator_store_orders').doc(docId).set(_currentStoreOrder);
    toast('✅ تم الحفظ');
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function refreshStoreOrderCosts(){
  if(!_currentStoreOrder){return;}
  if(_currentStoreOrder.status==='closed'){toast('🔒 الحساب مغلق');return;}
  if(!_opProductsList.length) await loadOpProducts();
  let updated=0;
  _currentStoreOrder.items=_currentStoreOrder.items.map(item=>{
    const prod=_opProductsList.find(p=>p.id===item.productId);
    if(prod&&(prod.rawMaterialCost||prod.treeCost||prod.machineWorkerWage||prod.assemblyWorkerWage)){
      updated++;
      return{...item,rawMaterialCost:prod.rawMaterialCost||0,treeCost:prod.treeCost||0,machineWorkerWage:prod.machineWorkerWage||0,assemblyWorkerWage:prod.assemblyWorkerWage||0,sellPrice:prod.sellPrice||item.sellPrice||0};
    }
    return item;
  });
  await saveStoreOrder();
  renderStoreOrderItems();
  calcStoreOrderSummary();
  toast(`✅ تم تحديث تكاليف ${updated} منتج من قائمة المنتجات`);
}

async function closeStoreOrder(){
  if(!_currentStoreOrder) return;
  if(_currentStoreOrder.status==='closed'){toast('🔒 الحساب مغلق مسبقاً');return;}
  if(!confirm(`إغلاق حساب ${_currentStoreName} ليوم ${_currentStoreDate}؟`)) return;
  _currentStoreOrder.status='closed';
  _currentStoreOrder.closedAt=firebase.firestore.FieldValue.serverTimestamp();
  await saveStoreOrder();
  renderStoreOrderItems();
  calcStoreOrderSummary();
  toast('🔒 تم إغلاق الحساب');
}

function printStoreOrder(){
  if(!_currentStoreOrder) return;
  const delivery=parseFloat(document.getElementById('opsa_delivery')?.value)||0;
  const opWage=parseFloat(document.getElementById('opsa_op_wage')?.value)||0;
  const items=_currentStoreOrder.items||[];
  const totalRaw=items.reduce((s,it)=>s+(it.rawMaterialCost||0)*it.qty,0);
  const totalTree=items.reduce((s,it)=>s+(it.treeCost||0)*it.qty,0);
  const totalMachine=items.reduce((s,it)=>s+(it.machineWorkerWage||0)*it.qty,0);
  const totalAssembly=items.reduce((s,it)=>s+(it.assemblyWorkerWage||0)*it.qty,0);
  const totalSell=items.reduce((s,it)=>s+(it.sellPrice||0)*it.qty,0);
  const totalCost=totalRaw+totalTree+totalMachine+totalAssembly+delivery+opWage;
  const profit=totalSell-totalCost;
  const isP=profit>=0;
  const rows=items.map(it=>`
    <tr>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;">${it.productName}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${it.qty}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#92400e;">${((it.rawMaterialCost||0)*it.qty).toFixed(2)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#15803d;">${((it.treeCost||0)*it.qty).toFixed(2)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#1e40af;">${((it.machineWorkerWage||0)*it.qty).toFixed(2)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#7c3aed;">${((it.assemblyWorkerWage||0)*it.qty).toFixed(2)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:#166534;">${((it.sellPrice||0)*it.qty).toFixed(2)}</td>
    </tr>`).join('');
  const html=`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
<title>كشف حساب — ${_currentStoreName}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Tajawal',sans-serif;padding:30px;color:#1a1a1a;direction:rtl;}
h1{font-size:1.5rem;color:#1a3a2a;margin-bottom:4px;}
.meta{font-size:0.85rem;color:#6b7280;margin-bottom:20px;border-bottom:2px solid #1a3a2a;padding-bottom:8px;}
table{width:100%;border-collapse:collapse;margin-bottom:20px;}
thead th{background:#1a3a2a;color:#fff;padding:10px 8px;font-size:0.82rem;}
tbody tr:nth-child(even){background:#f9fafb;}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
.box{border-radius:8px;padding:10px;text-align:center;}
.box .lbl{font-size:0.7rem;margin-bottom:3px;}
.box .val{font-weight:800;font-size:1rem;}
.total{display:flex;justify-content:space-between;padding:14px 16px;border-radius:10px;font-size:1.1rem;font-weight:800;margin-top:10px;}
@media print{body{padding:10px;}}
</style></head><body>
<h1>🏪 كشف حساب — ${_currentStoreName}</h1>
<div class="meta">التاريخ: ${_currentStoreDate} | الحالة: ${_currentStoreOrder.status==='closed'?'🔒 مغلق':'🟢 مفتوح'}</div>
<table>
<thead><tr>
  <th style="text-align:right;">المنتج</th>
  <th>كمية</th>
  <th style="color:#fef3c7;">🧱 مواد خام</th>
  <th style="color:#bbf7d0;">🌳 شجر</th>
  <th style="color:#bfdbfe;">⚙️ ماكينة</th>
  <th style="color:#ddd6fe;">🔧 تركيب</th>
  <th style="color:#bbf7d0;">💰 بيع</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="summary">
  <div class="box" style="background:#fefce8;"><div class="lbl" style="color:#92400e;">🧱 مجموع المواد</div><div class="val" style="color:#92400e;">${totalRaw.toFixed(2)} د.أ</div></div>
  ${totalTree>0?`<div class="box" style="background:#f0fdf4;"><div class="lbl" style="color:#15803d;">🌳 تكلفة الشجر</div><div class="val" style="color:#15803d;">${totalTree.toFixed(2)} د.أ</div></div>`:''}
  <div class="box" style="background:#eff6ff;"><div class="lbl" style="color:#1e40af;">⚙️ أجرة الماكينة</div><div class="val" style="color:#1e40af;">${totalMachine.toFixed(2)} د.أ</div></div>
  <div class="box" style="background:#f5f3ff;"><div class="lbl" style="color:#7c3aed;">🔧 أجرة التركيب</div><div class="val" style="color:#7c3aed;">${totalAssembly.toFixed(2)} د.أ</div></div>
  ${opWage>0?`<div class="box" style="background:#fdf4ff;"><div class="lbl" style="color:#9d174d;">👤 أجرة المشغل</div><div class="val" style="color:#9d174d;">${opWage.toFixed(2)} د.أ</div></div>`:''}
</div>
${delivery>0?`<div class="box" style="background:#eff6ff;border-radius:8px;padding:10px;text-align:center;margin-bottom:12px;"><div class="lbl" style="color:#1e40af;">🚚 أجرة التوصيل</div><div class="val" style="color:#1e40af;">${delivery.toFixed(2)} د.أ</div></div>`:''}
<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:0.9rem;border-top:1px dashed #e5e7eb;margin-bottom:4px;">
  <span style="color:#6b7280;">إجمالي التكاليف</span><span style="font-weight:700;color:#dc2626;">${totalCost.toFixed(2)} د.أ</span>
</div>
<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:0.9rem;margin-bottom:8px;">
  <span style="color:#6b7280;">إجمالي البيع</span><span style="font-weight:700;color:#166534;">${totalSell.toFixed(2)} د.أ</span>
</div>
<div class="total" style="background:${isP?'#dcfce7':'#fee2e2'};color:${isP?'#166534':'#991b1b'};">
  <span>صافي ${isP?'الربح':'الخسارة'}</span>
  <span>${Math.abs(profit).toFixed(2)} د.أ ${isP?'✅':'⚠️'}</span>
</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;
  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
}

// ===== SALES TAB (مبيعات) =====

function initSalesTab(){
  // Populate store dropdown
  const stSel=document.getElementById('opsale_store_sel');
  if(stSel){
    stSel.innerHTML='<option value="">اختر المتجر...</option>'+
      _opStoresList.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
    if(!_opStoresList.length) loadOpStores().then(()=>{
      stSel.innerHTML='<option value="">اختر المتجر...</option>'+
        _opStoresList.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
    });
  }
  // Populate product dropdown
  const prSel=document.getElementById('opsale_prod_sel');
  if(prSel){
    prSel.innerHTML='<option value="">اختر المنتج...</option>'+
      _opProductsList.map(p=>`<option value="${p.id}" data-raw="${p.rawMaterialCost||0}" data-tree="${p.treeCost||0}" data-machine="${p.machineWorkerWage||0}" data-assembly="${p.assemblyWorkerWage||0}" data-sell="${p.sellPrice||0}">${p.name}</option>`).join('');
    if(!_opProductsList.length) loadOpProducts().then(()=>{
      prSel.innerHTML='<option value="">اختر المنتج...</option>'+
        _opProductsList.map(p=>`<option value="${p.id}" data-raw="${p.rawMaterialCost||0}" data-tree="${p.treeCost||0}" data-machine="${p.machineWorkerWage||0}" data-assembly="${p.assemblyWorkerWage||0}" data-sell="${p.sellPrice||0}">${p.name}</option>`).join('');
    });
  }
  loadTodaySales();
}

function loadTodaySales(){
  const wrap=document.getElementById('opsale_today_list');
  if(!wrap) return;
  if(_todaySalesUnsub){_todaySalesUnsub();_todaySalesUnsub=null;}
  wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:10px;">⏳ تحميل...</div>';
  _todaySalesUnsub=db.collection('operator_sales').where('delivered','==',false)
    .onSnapshot(snap=>{
      const pending=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(!pending.length){
        wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">لا يوجد مبيعات معلقة</div>';
        return;
      }
      wrap.innerHTML=pending.map(s=>{
        const total=(s.sellPrice||0)*(s.qty||1);
        const imgHtml=s.imageDataUrl?`<img src="${s.imageDataUrl}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0;" />`:'';
        const byHtml=s.addedBy?`<span style="font-size:0.72rem;color:#6b7280;">👤 ${s.addedBy}</span>`:'';
        const dateHtml=s.date?`<span style="font-size:0.7rem;color:#9ca3af;">📅 ${s.date}</span>`:'';
        return `<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            ${imgHtml}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:0.88rem;color:var(--green-dark);">${s.productName} ×${s.qty}</div>
              <div style="font-size:0.75rem;color:var(--text-mid);">🏪 ${s.storeName}${s.notes?' — '+s.notes:''}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">${byHtml}${dateHtml}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
              <span style="font-weight:800;color:#166534;font-size:0.9rem;">${total.toFixed(2)} د.أ</span>
              <div style="display:flex;gap:6px;">
                <button onclick="confirmSaleDelivery('${s.id}')" style="background:#dcfce7;color:#166534;border:1.5px solid #86efac;padding:4px 10px;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;">✅ تسليم</button>
                <button onclick="deleteSaleEntry('${s.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:0.8rem;">✕</button>
              </div>
            </div>
          </div>
        </div>`;
      }).join('');
    },()=>{wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;text-align:center;padding:10px;">خطأ في التحميل</div>';});
}

// Auto-fill sell price + show cost info when product or store selected
function onSaleProdChange(sel){
  updateSalePriceFromSelection();
}

function onSaleStoreChange(sel){
  updateSalePriceFromSelection();
}

function updateSalePriceFromSelection(){
  const stSel=document.getElementById('opsale_store_sel');
  const prSel=document.getElementById('opsale_prod_sel');
  const sellInp=document.getElementById('opsale_sell');
  const infoBox=document.getElementById('opsale_cost_info');
  if(!stSel||!prSel||!sellInp) return;
  if(!prSel.value){
    sellInp.value='';
    if(infoBox) infoBox.style.display='none';
    return;
  }
  const prod=_opProductsList.find(p=>p.id===prSel.value);
  if(!prod) return;
  const raw=prod.rawMaterialCost||0;
  const tree=prod.treeCost||0;
  const machine=prod.machineWorkerWage||0;
  const assembly=prod.assemblyWorkerWage||0;
  // Use store-specific price if available, else fall back to product default
  const storeSpecific=stSel.value&&prod.storePrices&&prod.storePrices[stSel.value];
  const effectiveSell=storeSpecific?prod.storePrices[stSel.value]:(prod.sellPrice||0);
  sellInp.value=effectiveSell||'';
  // Multiple price options chips
  const optsWrap=document.getElementById('opsale_price_options');
  const optsChips=document.getElementById('opsale_price_options_chips');
  const opts=_productPriceChoices(prod,effectiveSell);
  if(optsWrap&&optsChips){
    if(opts.length){
      optsWrap.style.display='block';
      optsChips.innerHTML=opts.map(o=>`<button type="button" onclick="pickSalePrice(${(o.price||0)})" style="padding:7px 12px;background:#fef9c3;border:1.5px solid #fde047;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;color:#854d0e;cursor:pointer;white-space:nowrap;">${o.label} — ${(o.price||0).toFixed(2)} د.أ</button>`).join('');
    }else{
      optsWrap.style.display='none';
      optsChips.innerHTML='';
    }
  }
  _recalcSaleInfo();
}

function pickSalePrice(price){
  const sellInp=document.getElementById('opsale_sell');
  if(sellInp) sellInp.value=price;
  _recalcSaleInfo();
}

function _recalcSaleInfo(){
  const prSel=document.getElementById('opsale_prod_sel');
  const sellInp=document.getElementById('opsale_sell');
  const infoBox=document.getElementById('opsale_cost_info');
  if(!prSel||!sellInp||!infoBox) return;
  const prod=_opProductsList.find(p=>p.id===prSel.value);
  if(!prod) return;
  const raw=prod.rawMaterialCost||0;
  const tree=prod.treeCost||0;
  const machine=prod.machineWorkerWage||0;
  const assembly=prod.assemblyWorkerWage||0;
  const sell=parseFloat(sellInp.value)||0;
  infoBox.style.display='block';
  document.getElementById('opsale_info_raw').textContent=raw.toFixed(2)+' د.أ';
  const treeEl=document.getElementById('opsale_info_tree');
  if(treeEl) treeEl.textContent=tree.toFixed(2)+' د.أ';
  document.getElementById('opsale_info_machine').textContent=machine.toFixed(2)+' د.أ';
  document.getElementById('opsale_info_assembly').textContent=assembly.toFixed(2)+' د.أ';
  const profit=sell-(raw+tree+machine+assembly);
  const pEl=document.getElementById('opsale_info_profit');
  pEl.textContent=profit.toFixed(2)+' د.أ';
  pEl.style.color=profit>=0?'#166534':'#dc2626';
}

async function saveSaleEntry(){
  const stSel=document.getElementById('opsale_store_sel');
  const prSel=document.getElementById('opsale_prod_sel');
  const qty=parseFloat(document.getElementById('opsale_qty').value)||1;
  const notes=document.getElementById('opsale_notes').value.trim();
  const customSell=parseFloat(document.getElementById('opsale_sell').value);
  if(!stSel.value){toast('⚠️ اختر المتجر');return;}
  if(!prSel.value){toast('⚠️ اختر المنتج');return;}
  if(isNaN(customSell)||customSell<0){toast('⚠️ أدخل سعر البيع');return;}
  const stOpt=stSel.options[stSel.selectedIndex];
  const prOpt=prSel.options[prSel.selectedIndex];
  const today=jordanDateStr();
  // السعر الرسمي = سعر المتجر الخاص أو سعر المنتج العام. customSell = السعر الفعلي المُدخل.
  const prodObj=_opProductsList.find(p=>p.id===prSel.value);
  const officialUnit=(prodObj&&(prodObj.storePrices?.[stSel.value]||prodObj.sellPrice))||customSell;
  try{
    await db.collection('operator_sales').add({
      storeId:stSel.value, storeName:stOpt.text,
      productId:prSel.value, productName:prOpt.text,
      qty,
      rawMaterialCost:parseFloat(prOpt.dataset.raw)||0,
      treeCost:parseFloat(prOpt.dataset.tree)||0,
      machineWorkerWage:parseFloat(prOpt.dataset.machine)||0,
      assemblyWorkerWage:parseFloat(prOpt.dataset.assembly)||0,
      sellPrice:officialUnit,
      soldPrice:customSell,
      notes, date:today,
      delivered:false,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    stSel.value=''; prSel.value='';
    document.getElementById('opsale_qty').value='1';
    document.getElementById('opsale_sell').value='';
    document.getElementById('opsale_notes').value='';
    const infoBox=document.getElementById('opsale_cost_info');
    if(infoBox) infoBox.style.display='none';
    toast('✅ تم حفظ المبيعة');
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteSaleEntry(id){
  if(!confirm('حذف هذه المبيعة؟')) return;
  try{
    await db.collection('operator_sales').doc(id).delete();
    toast('✅ تم الحذف');
  }catch(e){toast('❌ خطأ في الحذف');}
}

async function confirmSaleDelivery(id){
  try{
    await db.collection('operator_sales').doc(id).update({
      delivered:true,
      deliveredAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم التسليم وإضافته لكشف الحساب');
  }catch(e){toast('❌ خطأ في التسليم');}
}

// ===== STORE ACCOUNT STATEMENT =====

let _acctCurrentStore=null;
let _acctCurrentSales=[];
let _acctCurrentPayments=[];
let _acctCurrentRefunds=[];
let _acctGroupMode=false;
let _acctCurrentGroupName='';

async function openAcctDetail(storeId, storeName){
  _acctCurrentStore={id:storeId,name:storeName};
  document.getElementById('opacct_detail_title').textContent='🏪 '+storeName;
  document.getElementById('opacct-store-list').style.display='none';
  document.getElementById('opacct-detail-view').style.display='block';
  const body=document.getElementById('opacct_detail_body');
  body.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:30px;">⏳ تحميل...</div>';
  if(!_opProductsList.length) await loadOpProducts();
  try{
    const snap=await db.collection('operator_sales').where('storeId','==',storeId).get();
    _acctCurrentSales=snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.delivered!==false);
  }catch(e){_acctCurrentSales=[];}
  try{
    const snap=await db.collection('operator_store_payments').where('storeId','==',storeId).orderBy('date','desc').get();
    _acctCurrentPayments=snap.docs.map(d=>({id:d.id,...d.data(),_col:'operator_store_payments'})).filter(p=>p.withdrawalType!=='withdrawal');
  }catch(e){
    try{
      const snap=await db.collection('operator_store_payments').where('storeId','==',storeId).get();
      _acctCurrentPayments=snap.docs.map(d=>({id:d.id,...d.data(),_col:'operator_store_payments'})).filter(p=>p.withdrawalType!=='withdrawal');
    }catch(e2){_acctCurrentPayments=[];}
  }
  try{
    const snap=await db.collection('page_refunds').where('storeId','==',storeId).get();
    _acctCurrentRefunds=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_acctCurrentRefunds=[];}
  renderAcctDetail();
}

async function openGroupAcctDetail(groupName){
  if(!_opAllStoresList.length) await loadOpStores();
  const groupStores=_opAllStoresList.filter(s=>s.group===groupName);
  if(!groupStores.length){toast('لا توجد متاجر في هذه المجموعة');return;}
  _acctGroupMode=true;
  _acctCurrentGroupName=groupName;
  _acctCurrentStore={id:'__grp__'+groupName,name:groupName,isGroup:true,groupStores};
  document.getElementById('opacct_detail_title').textContent='👥 '+groupName;
  document.getElementById('opacct-store-list').style.display='none';
  document.getElementById('opacct-detail-view').style.display='block';
  const body=document.getElementById('opacct_detail_body');
  body.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:30px;">⏳ تحميل...</div>';
  if(!_opProductsList.length) await loadOpProducts();
  try{
    const storeIds=groupStores.map(s=>s.id);
    const [salesSnaps,paySnaps,refundSnaps,groupPaySnap]=await Promise.all([
      Promise.all(storeIds.map(id=>db.collection('operator_sales').where('storeId','==',id).get())),
      Promise.all(storeIds.map(id=>db.collection('operator_store_payments').where('storeId','==',id).get())),
      Promise.all(storeIds.map(id=>db.collection('page_refunds').where('storeId','==',id).get())),
      db.collection('operator_store_payments').where('storeId','==','__grp__'+groupName).get()
    ]);
    _acctCurrentSales=salesSnaps.flatMap(s=>s.docs.map(d=>({id:d.id,...d.data()}))).filter(s=>s.delivered!==false);
    _acctCurrentPayments=[
      ...paySnaps.flatMap(s=>s.docs.map(d=>({id:d.id,...d.data()}))),
      ...groupPaySnap.docs.map(d=>({id:d.id,...d.data()}))
    ].filter(p=>p.withdrawalType!=='withdrawal');
    _acctCurrentRefunds=refundSnaps.flatMap(s=>s.docs.map(d=>({id:d.id,...d.data()})));
  }catch(e){_acctCurrentSales=[];_acctCurrentPayments=[];_acctCurrentRefunds=[];}
  renderGroupAcctDetail();
}

function renderGroupAcctDetail(){
  const body=document.getElementById('opacct_detail_body');
  if(!body||!_acctCurrentStore?.isGroup) return;
  const groupStores=_acctCurrentStore.groupStores||[];
  const totalOwed=_acctCurrentSales.reduce((s,it)=>s+_acctItemCost(it)*(it.qty||1),0);
  const totalPaid=_acctCurrentPayments.reduce((s,p)=>s+(p.amount||0),0);
  const totalRefund=_acctCurrentRefunds.reduce((s,r)=>s+(r.totalCost||0),0);
  const totalDiscount=_acctCurrentSales.reduce((s,it)=>s+_acctItemDiscount(it)*(it.qty||1),0);
  const balance=totalOwed-totalPaid-totalRefund;
  const balColor=balance>0?'#92400e':balance<0?'#166534':'#374151';
  const balBg=balance>0?'#fff7ed':balance<0?'#f0fdf4':'#f9fafb';
  const balLabel=balance>0?'📊 باقي عليهم':balance<0?'💰 رصيد لهم':'✅ مسويين';

  // Per-store breakdown
  const storeBreakdown=groupStores.map(s=>{
    const sold=_acctCurrentSales.filter(x=>x.storeId===s.id).reduce((a,it)=>a+_acctItemCost(it)*(it.qty||1),0);
    const paid=_acctCurrentPayments.filter(x=>x.storeId===s.id).reduce((a,p)=>a+(p.amount||0),0);
    const refund=_acctCurrentRefunds.filter(x=>x.storeId===s.id).reduce((a,r)=>a+(r.totalCost||0),0);
    const bal=sold-paid-refund;
    const archivedBadge=s.archived?'<span style="font-size:0.62rem;background:#e5e7eb;color:#6b7280;padding:1px 5px;border-radius:5px;margin-right:4px;">مؤرشف</span>':'';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed #e5e7eb;font-size:0.82rem;${s.archived?'opacity:0.65;':''}">
      <span style="font-weight:700;color:var(--text-dark);">${s.archived?'🗂️':'🏪'} ${s.name}${archivedBadge}</span>
      <div style="display:flex;gap:10px;font-size:0.77rem;">
        <span style="color:#dc2626;">عليه: <strong>${sold.toFixed(2)}</strong></span>
        <span style="color:#166534;">دفع (فردي): <strong>${paid.toFixed(2)}</strong></span>
      </div>
    </div>`;
  }).join('');

  const sortedPays=[..._acctCurrentPayments].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const payRows=sortedPays.map(p=>{
    const isGroup=p.storeId==='__grp__'+_acctCurrentGroupName;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f0f0f0;font-size:0.82rem;">
      <div>
        <span style="font-size:0.7rem;background:${isGroup?'#ede9fe':'#f3f4f6'};color:${isGroup?'#6d28d9':'#6b7280'};padding:1px 7px;border-radius:10px;font-weight:600;">
          ${isGroup?'👥 دفعة للمجموعة':'🏪 '+(p.storeName||'')}
        </span>
        <span style="font-size:0.72rem;color:#9ca3af;margin-right:6px;">📅 ${p.date}</span>
        ${p.notes?`<span style="color:#9ca3af;font-size:0.72rem;"> — ${p.notes}</span>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:800;color:#166534;">${(p.amount||0).toFixed(2)} د.أ</span>
        <button onclick="deleteStorePayment('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 9px;font-size:0.75rem;cursor:pointer;">🗑</button>
      </div>
    </div>`;
  }).join('');

  body.innerHTML=`
    <div style="background:#ede9fe;border:1.5px solid #c4b5fd;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:0.78rem;font-weight:700;color:#6d28d9;margin-bottom:8px;">👥 ${_acctCurrentGroupName} — كشف مجمع</div>
      ${storeBreakdown}
    </div>
    <div style="display:grid;grid-template-columns:repeat(${totalDiscount>0?4:3},1fr);gap:8px;margin-bottom:16px;">
      <div style="background:#fee2e2;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#dc2626;font-weight:700;margin-bottom:4px;">💸 عليهم</div>
        <div style="font-weight:900;color:#dc2626;font-size:1.1rem;">${totalOwed.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#dc2626;margin-top:2px;">د.أ</div>
      </div>
      <div style="background:#dcfce7;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#166534;font-weight:700;margin-bottom:4px;">✅ دفعوا</div>
        <div style="font-weight:900;color:#166534;font-size:1.1rem;">${totalPaid.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#166534;margin-top:2px;">د.أ</div>
      </div>
      ${totalDiscount>0?`<div style="background:#fff7ed;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#b45309;font-weight:700;margin-bottom:4px;">🏷 خصومات</div>
        <div style="font-weight:900;color:#b45309;font-size:1.1rem;">${totalDiscount.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#b45309;margin-top:2px;">د.أ</div>
      </div>`:''}
      <div style="background:${balBg};border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:${balColor};font-weight:700;margin-bottom:4px;">${balLabel}</div>
        <div style="font-weight:900;color:${balColor};font-size:1.1rem;">${Math.abs(balance).toFixed(2)}</div>
        <div style="font-size:0.65rem;color:${balColor};margin-top:2px;">د.أ</div>
      </div>
    </div>
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:16px;">
      <div style="font-size:0.85rem;font-weight:700;color:#6d28d9;margin-bottom:10px;">💵 تسجيل دفعة للمجموعة كاملة</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <input type="number" id="acct_pay_amount" placeholder="المبلغ (د.أ)" min="0" step="0.5"
          style="padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:#fff;color:var(--text-dark);"
          onfocus="this.style.borderColor='#6d28d9'" onblur="this.style.borderColor='#e5e7eb'">
        <input type="date" id="acct_pay_date" value="${jordanDateStr()}"
          style="padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:#fff;color:var(--text-dark);"
          onfocus="this.style.borderColor='#6d28d9'" onblur="this.style.borderColor='#e5e7eb'">
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="acct_pay_notes" placeholder="ملاحظات (اختياري)"
          style="flex:1;padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:#fff;color:var(--text-dark);"
          onfocus="this.style.borderColor='#6d28d9'" onblur="this.style.borderColor='#e5e7eb'">
        <button onclick="addStorePayment()" style="padding:9px 16px;background:#6d28d9;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-weight:700;font-size:0.85rem;cursor:pointer;flex-shrink:0;">💾 حفظ</button>
      </div>
    </div>
    <div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;padding:14px;">
      <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;">
        <span>💵 سجل الدفعات</span><span style="color:#6b7280;">${_acctCurrentPayments.length} سجل</span>
      </div>
      ${payRows||'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;">لا يوجد دفعات مسجلة بعد</div>'}
    </div>`;
}

function _acctItemCost(it){
  if(it.sellPrice>0) return it.sellPrice;
  // sellPrice=0 — ابحث في قائمة المنتجات عن السعر الصحيح لهذا المتجر
  const prod=_opProductsList.find(p=>p.id===it.productId)||_opProductsList.find(p=>p.name===it.productName);
  if(prod){
    const sp=it.storeId&&prod.storePrices?.[it.storeId]||0;
    const tc=(prod.rawMaterialCost||0)+(prod.treeCost||0)+(prod.machineWorkerWage||0)+(prod.assemblyWorkerWage||0);
    if(sp||tc) return sp||tc;
  }
  return(it.rawMaterialCost||0)+(it.treeCost||0)+(it.machineWorkerWage||0)+(it.assemblyWorkerWage||0);
}

// الخصم لكل سطر = السعر الرسمي − السعر الفعلي (لما الفعلي أقل) — تتحمّله الصفحة
function _acctItemDiscount(it){
  const official=_acctItemCost(it);
  const sold=(it.soldPrice!=null?it.soldPrice:official);
  return Math.max(0,official-sold);
}

function renderAcctDetail(){
  const body=document.getElementById('opacct_detail_body');
  if(!body) return;
  const totalOwed=_acctCurrentSales.reduce((s,it)=>_acctItemCost(it)*(it.qty||1)+s,0);
  const totalPaid=_acctCurrentPayments.reduce((s,p)=>(p.amount||0)+s,0);
  const totalRefund=(_acctCurrentRefunds||[]).reduce((s,r)=>(r.totalCost||0)+s,0);
  const totalDiscount=_acctCurrentSales.reduce((s,it)=>_acctItemDiscount(it)*(it.qty||1)+s,0);
  const balance=totalOwed-totalPaid-totalRefund;
  const balColor=balance>0?'#92400e':balance<0?'#166534':'#374151';
  const balBg=balance>0?'#fff7ed':balance<0?'#f0fdf4':'#f9fafb';
  const balLabel=balance>0?'📊 باقي عليه':balance<0?'💰 رصيد له':'✅ مسوي';
  const _discCols=(totalRefund>0?1:0)+(totalDiscount>0?1:0);

  // Summary
  const summaryHTML=`
    <div style="display:grid;grid-template-columns:repeat(${3+_discCols},1fr);gap:8px;margin-bottom:16px;">
      <div style="background:#fee2e2;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#dc2626;font-weight:700;margin-bottom:4px;">💸 عليه</div>
        <div style="font-weight:900;color:#dc2626;font-size:1.1rem;">${totalOwed.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#dc2626;margin-top:2px;">د.أ</div>
      </div>
      <div style="background:#dcfce7;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#166534;font-weight:700;margin-bottom:4px;">✅ دفع</div>
        <div style="font-weight:900;color:#166534;font-size:1.1rem;">${totalPaid.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#166534;margin-top:2px;">د.أ</div>
      </div>
      ${totalDiscount>0?`<div style="background:#fff7ed;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#b45309;font-weight:700;margin-bottom:4px;">🏷 خصومات</div>
        <div style="font-weight:900;color:#b45309;font-size:1.1rem;">${totalDiscount.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#b45309;margin-top:2px;">د.أ</div>
      </div>`:''}
      ${totalRefund>0?`<div style="background:#fce7f3;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:#9d174d;font-weight:700;margin-bottom:4px;">↩️ رصيد له</div>
        <div style="font-weight:900;color:#9d174d;font-size:1.1rem;">${totalRefund.toFixed(2)}</div>
        <div style="font-size:0.65rem;color:#9d174d;margin-top:2px;">د.أ</div>
      </div>`:''}
      <div style="background:${balBg};border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:0.68rem;color:${balColor};font-weight:700;margin-bottom:4px;">${balLabel}</div>
        <div style="font-weight:900;color:${balColor};font-size:1.1rem;">${Math.abs(balance).toFixed(2)}</div>
        <div style="font-size:0.65rem;color:${balColor};margin-top:2px;">د.أ</div>
      </div>
    </div>`;

  // Payment form
  const payFormHTML=`
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:16px;">
      <div style="font-size:0.85rem;font-weight:700;color:var(--green-dark);margin-bottom:10px;">💵 تسجيل دفعة</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <input type="number" id="acct_pay_amount" placeholder="المبلغ (د.أ)" min="0" step="0.5"
          style="padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:var(--card-bg);color:var(--text-dark);"
          onfocus="this.style.borderColor='var(--green-dark)'" onblur="this.style.borderColor='#e5e7eb'">
        <input type="date" id="acct_pay_date" value="${jordanDateStr()}"
          style="padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:var(--card-bg);color:var(--text-dark);"
          onfocus="this.style.borderColor='var(--green-dark)'" onblur="this.style.borderColor='#e5e7eb'">
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="acct_pay_notes" placeholder="ملاحظات (اختياري)"
          style="flex:1;padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:var(--card-bg);color:var(--text-dark);"
          onfocus="this.style.borderColor='var(--green-dark)'" onblur="this.style.borderColor='#e5e7eb'">
        <button onclick="addStorePayment()" style="padding:9px 16px;background:var(--green-dark);color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-weight:700;font-size:0.85rem;cursor:pointer;flex-shrink:0;">💾 حفظ</button>
      </div>
      <button onclick="whatsappStoreSummary()" style="margin-top:8px;width:100%;padding:9px;background:#f0fdf4;color:#166534;border:1.5px solid #86efac;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.83rem;font-weight:700;cursor:pointer;">📱 إرسال كشف الرصيد للمتجر عبر واتساب</button>
    </div>`;

  // Payments list
  const sortedPays=[..._acctCurrentPayments].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const payRows=sortedPays.map(p=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f0f0f0;font-size:0.82rem;">
      <div>
        <span style="font-size:0.75rem;color:#6b7280;font-weight:600;">📅 ${p.date}</span>
        ${p.notes?`<span style="color:#9ca3af;font-size:0.75rem;margin-right:6px;">— ${p.notes}</span>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:800;color:#166534;">${(p.amount||0).toFixed(2)} د.أ</span>
        <button onclick="deleteStorePayment('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 9px;font-size:0.75rem;cursor:pointer;">🗑</button>
      </div>
    </div>`).join('');
  const paysSectionHTML=`
    <div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;">
      <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;">
        <span>💵 الدفعات</span><span style="color:#6b7280;">${_acctCurrentPayments.length} سجل</span>
      </div>
      ${payRows||'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;">لا يوجد دفعات مسجلة بعد</div>'}
    </div>`;

  // Sales grouped by date
  const byDate={};
  _acctCurrentSales.forEach(s=>{if(!byDate[s.date])byDate[s.date]=[];byDate[s.date].push(s);});
  const salesRows=Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,items])=>{
    const dayTotal=items.reduce((s,it)=>_acctItemCost(it)*(it.qty||1)+s,0);
    const rows=items.map(it=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px dashed #f0f0f0;font-size:0.82rem;">
        <div style="flex:1;min-width:0;">
          <span style="font-weight:600;color:var(--text-dark);">${it.productName}</span>
          <span style="color:var(--text-mid);margin-right:5px;">×${it.qty}</span>
          ${it.notes?`<span style="color:#9ca3af;font-size:0.74rem;">— ${it.notes}</span>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span style="font-weight:700;color:${_acctItemCost(it)===0?'#f59e0b':'#dc2626'};white-space:nowrap;">${(_acctItemCost(it)*(it.qty||1)).toFixed(2)} د.أ</span>
          <button onclick="editStoreSalePrice('${it.id}',${_acctItemCost(it)},${it.qty||1})" style="background:#fef3c7;color:#92400e;border:none;border-radius:6px;padding:3px 7px;font-size:0.72rem;cursor:pointer;">✏️</button>
          <button onclick="deleteStoreSale('${it.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 8px;font-size:0.72rem;cursor:pointer;">🗑</button>
        </div>
      </div>`).join('');
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;background:#f9fafb;padding:7px 10px;border-radius:8px;margin-bottom:4px;">
        <span style="font-size:0.77rem;font-weight:700;color:#6b7280;">📅 ${date}</span>
        <span style="font-size:0.8rem;font-weight:700;color:#dc2626;">${dayTotal.toFixed(2)} د.أ</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
  const salesSectionHTML=`
    <div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;">
      <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;">
        <span>📦 المشتريات</span><span style="color:#6b7280;">${_acctCurrentSales.length} سجل</span>
      </div>
      ${salesRows||'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:14px;">لا يوجد مبيعات مسجلة لهذا المتجر</div>'}
    </div>`;

  const refundRows=(_acctCurrentRefunds||[]).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>{
    const reasonLabel={'cancelled':'ملغي','returned':'مرتجع','refused':'مرفوض','deleted':'محذوف'}[r.reason]||r.reason;
    const itemsStr=(r.items||[]).map(i=>`${i.name}×${i.qty}`).join('، ');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 4px;border-bottom:1px dashed #fce7f3;font-size:0.82rem;">
      <div style="flex:1;min-width:0;">
        <span style="color:#374151;">${itemsStr}</span>
        <span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:8px;font-size:0.7rem;margin-right:4px;">${reasonLabel}</span>
        <span style="font-size:0.72rem;color:#9ca3af;">📅 ${r.date||''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-weight:800;color:#9d174d;">${(r.totalCost||0).toFixed(2)} د.أ</span>
        <button onclick="deletePageRefund('${r.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 8px;font-size:0.72rem;cursor:pointer;">🗑</button>
      </div>
    </div>`;
  }).join('');
  const refundSectionHTML=totalRefund>0?`
    <div style="background:#fdf2f8;border:1.5px solid #f9a8d4;border-radius:12px;padding:14px;margin-bottom:16px;">
      <div style="font-size:0.82rem;font-weight:700;color:#9d174d;margin-bottom:10px;display:flex;justify-content:space-between;">
        <span>↩️ رصيد له من المشغل</span><span style="color:#9d174d;">${totalRefund.toFixed(2)} د.أ</span>
      </div>
      ${refundRows}
    </div>`:'';

  body.innerHTML=summaryHTML+payFormHTML+paysSectionHTML+refundSectionHTML+salesSectionHTML;
}

async function addStorePayment(){
  if(!_acctCurrentStore){return;}
  const amt=parseFloat(document.getElementById('acct_pay_amount').value);
  const date=document.getElementById('acct_pay_date').value||jordanDateStr();
  const notes=document.getElementById('acct_pay_notes').value.trim();
  if(!amt||amt<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    const payData={
      storeId:_acctCurrentStore.id,
      storeName:_acctCurrentStore.name,
      amount:amt,date,notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    if(_acctGroupMode) payData.groupName=_acctCurrentGroupName;
    const doc=await db.collection('operator_store_payments').add(payData);
    _acctCurrentPayments.push({id:doc.id,...payData});
    document.getElementById('acct_pay_amount').value='';
    document.getElementById('acct_pay_notes').value='';
    toast('✅ تم تسجيل الدفعة');
    if(_acctGroupMode) renderGroupAcctDetail(); else renderAcctDetail();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

async function deleteStorePayment(id){
  if(!confirm('حذف هذه الدفعة؟'))return;
  const entry=_acctCurrentPayments.find(p=>p.id===id);
  const col=entry?._col||'operator_store_payments';
  try{
    const batch=db.batch();
    batch.delete(db.collection(col).doc(id));
    if(col==='operator_withdrawals'){
      const balSnap=await db.collection('operator_store_balance').where('sourceWithdrawalId','==',id).limit(1).get();
      if(!balSnap.empty) batch.delete(balSnap.docs[0].ref);
    } else if(entry?.sourceWithdrawalId){
      batch.delete(db.collection('operator_withdrawals').doc(entry.sourceWithdrawalId));
      const balSnap=await db.collection('operator_store_balance').where('sourceWithdrawalId','==',entry.sourceWithdrawalId).limit(1).get();
      if(!balSnap.empty) batch.delete(balSnap.docs[0].ref);
    }
    await batch.commit();
    _acctCurrentPayments=_acctCurrentPayments.filter(p=>p.id!==id);
    toast('🗑 تم الحذف');
    if(_acctGroupMode) renderGroupAcctDetail(); else renderAcctDetail();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

async function deleteStoreSale(id){
  if(!confirm('حذف هذه المشترية؟'))return;
  try{
    await db.collection('operator_sales').doc(id).delete();
    _acctCurrentSales=_acctCurrentSales.filter(s=>s.id!==id);
    toast('🗑 تم الحذف');
    renderAcctDetail();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

async function editStoreSalePrice(id,currentUnitPrice,qty){
  const newPrice=prompt(`سعر الوحدة الجديد (الإجمالي الحالي: ${(currentUnitPrice*qty).toFixed(2)})`,currentUnitPrice.toFixed(2));
  if(newPrice===null)return;
  const v=parseFloat(newPrice);
  if(isNaN(v)||v<0){toast('⚠️ سعر غير صحيح');return;}
  try{
    await db.collection('operator_sales').doc(id).update({sellPrice:v});
    _acctCurrentSales=_acctCurrentSales.map(s=>s.id===id?{...s,sellPrice:v}:s);
    renderAcctDetail();
    toast('✅ تم تحديث السعر');
  }catch(e){toast('❌ خطأ: '+e.message);}
}

function backToAcctList(){
  document.getElementById('opacct-store-list').style.display='block';
  document.getElementById('opacct-detail-view').style.display='none';
  document.getElementById('opacct-operator-view').style.display='none';
  _acctCurrentStore=null;_acctCurrentSales=[];_acctCurrentPayments=[];_acctCurrentRefunds=[];
  _acctGroupMode=false;_acctCurrentGroupName='';
  _opDailySales=[];_opDayRecord=null;_opDayOrders=[];
  checkOperatorDayStatus();
}

function printAcctStatement(){
  if(!_acctCurrentStore)return;
  const totalOwed=_acctCurrentSales.reduce((s,it)=>_acctItemCost(it)*(it.qty||1)+s,0);
  const totalPaid=_acctCurrentPayments.reduce((s,p)=>(p.amount||0)+s,0);
  const balance=totalOwed-totalPaid;
  const salesRows=_acctCurrentSales.map(it=>`
    <tr>
      <td>${it.date}</td><td>${it.productName}</td>
      <td style="text-align:center;">${it.qty}</td>
      <td style="text-align:center;">${_acctItemCost(it).toFixed(2)}</td>
      <td style="text-align:center;font-weight:700;color:#dc2626;">${(_acctItemCost(it)*(it.qty||1)).toFixed(2)}</td>
      <td style="color:#6b7280;font-size:0.8rem;">${it.notes||''}</td>
    </tr>`).join('');
  const payRows=[..._acctCurrentPayments].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(p=>`
    <tr>
      <td>${p.date}</td>
      <td style="font-weight:700;color:#166534;">${(p.amount||0).toFixed(2)} د.أ</td>
      <td style="color:#6b7280;">${p.notes||''}</td>
    </tr>`).join('');
  const html=`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
<title>كشف حساب — ${_acctCurrentStore.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Tajawal',sans-serif;padding:30px;color:#1a1a1a;direction:rtl;}
h1{font-size:1.4rem;color:#1a3a2a;margin-bottom:4px;}h2{font-size:1rem;color:#374151;margin:18px 0 8px;}
.meta{font-size:0.82rem;color:#6b7280;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #1a3a2a;}
.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;}
.sum-box{border-radius:10px;padding:14px;text-align:center;}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:0.85rem;}
thead th{background:#1a3a2a;color:#fff;padding:8px;text-align:right;}
tbody td{padding:7px 8px;border-bottom:1px solid #e5e7eb;}
@media print{body{padding:12px;}}</style></head><body>
<h1>🏪 كشف حساب — ${_acctCurrentStore.name}</h1>
<div class="meta">تاريخ الطباعة: ${jordanDisplayDate()}</div>
<div class="summary">
  <div class="sum-box" style="background:#fee2e2;"><div style="font-size:0.75rem;color:#dc2626;margin-bottom:4px;">💸 إجمالي المستحقات</div><div style="font-size:1.3rem;font-weight:900;color:#dc2626;">${totalOwed.toFixed(2)} د.أ</div></div>
  <div class="sum-box" style="background:#dcfce7;"><div style="font-size:0.75rem;color:#166534;margin-bottom:4px;">✅ إجمالي الدفعات</div><div style="font-size:1.3rem;font-weight:900;color:#166534;">${totalPaid.toFixed(2)} د.أ</div></div>
  <div class="sum-box" style="background:${balance>0?'#fff7ed':'#f0fdf4'};"><div style="font-size:0.75rem;color:${balance>0?'#92400e':'#166534'};margin-bottom:4px;">${balance>0?'📊 الرصيد المتبقي':'💰 رصيد للمتجر'}</div><div style="font-size:1.3rem;font-weight:900;color:${balance>0?'#92400e':'#166534'};">${Math.abs(balance).toFixed(2)} د.أ</div></div>
</div>
<h2>📦 المشتريات</h2>
<table><thead><tr><th>التاريخ</th><th>المنتج</th><th style="text-align:center;">كمية</th><th style="text-align:center;">سعر</th><th style="text-align:center;">الإجمالي</th><th>ملاحظات</th></tr></thead>
<tbody>${salesRows||'<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:14px;">لا يوجد مبيعات</td></tr>'}</tbody></table>
<h2>💵 الدفعات</h2>
<table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead>
<tbody>${payRows||'<tr><td colspan="3" style="text-align:center;color:#9ca3af;padding:14px;">لا يوجد دفعات</td></tr>'}</tbody></table>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;
  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
}

function whatsappAcctStatement(){
  if(!_acctCurrentStore)return;
  const totalOwed=_acctCurrentSales.reduce((s,it)=>_acctItemCost(it)*(it.qty||1)+s,0);
  const totalPaid=_acctCurrentPayments.reduce((s,p)=>(p.amount||0)+s,0);
  const balance=totalOwed-totalPaid;
  let msg=`🏪 كشف حساب — ${_acctCurrentStore.name}\n━━━━━━━━━━━━\n`;
  const byDate={};
  _acctCurrentSales.forEach(s=>{if(!byDate[s.date])byDate[s.date]=[];byDate[s.date].push(s);});
  if(Object.keys(byDate).length){
    msg+=`📦 المشتريات:\n`;
    Object.entries(byDate).sort().forEach(([date,items])=>{
      msg+=`📅 ${date}:\n`;
      items.forEach(it=>{msg+=`  • ${it.productName} ×${it.qty} = ${(_acctItemCost(it)*(it.qty||1)).toFixed(2)} د.أ${it.notes?' ('+it.notes+')':''}\n`;});
    });
  }
  if(_acctCurrentPayments.length){
    msg+=`\n💵 الدفعات:\n`;
    [..._acctCurrentPayments].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(p=>{
      msg+=`  ✅ ${p.date}: ${(p.amount||0).toFixed(2)} د.أ${p.notes?' ('+p.notes+')':''}\n`;
    });
  }
  msg+=`━━━━━━━━━━━━\n💸 المستحقات: ${totalOwed.toFixed(2)} د.أ\n✅ المدفوع: ${totalPaid.toFixed(2)} د.أ\n${balance>0?'📊 الباقي عليه':'💰 رصيد للمتجر'}: ${Math.abs(balance).toFixed(2)} د.أ`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

async function loadAcctStoreList(){
  if(!_opStoresList.length) await loadOpStores();
  const wrap=document.getElementById('opacct_stores_wrap');
  if(!wrap) return;
  loadWorkerAccounts(jordanDateStr());
  if(!_opStoresList.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;padding:20px;font-size:0.85rem;">لا يوجد متاجر — أضف متجراً من تبويب المتاجر</div>';
    return;
  }
  const threshold=getAcctThreshold();
  let refundByStore={},owedByStore={},paidByStore={};
  try{
    const [rSnap,sSnap,pSnap]=await Promise.all([
      db.collection('page_refunds').get(),
      db.collection('operator_sales').get(),
      db.collection('operator_store_payments').get()
    ]);
    rSnap.docs.forEach(d=>{const r=d.data();if(r.storeId)refundByStore[r.storeId]=(refundByStore[r.storeId]||0)+(r.totalCost||0);});
    sSnap.docs.forEach(d=>{const s=d.data();if(s.storeId&&s.delivered!==false)owedByStore[s.storeId]=(owedByStore[s.storeId]||0)+(s.sellPrice||0)*(s.qty||1);});
    pSnap.docs.forEach(d=>{const p=d.data();if(p.storeId&&p.withdrawalType!=='withdrawal')paidByStore[p.storeId]=(paidByStore[p.storeId]||0)+(p.amount||0);});
  }catch(e){}
  const thresholdRow=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:var(--card-bg);border:1.5px solid var(--border);border-radius:10px;font-family:'Tajawal',sans-serif;">
    <span style="font-size:0.8rem;color:#6b7280;flex:1;">⚠️ حد تنبيه الرصيد:</span>
    <input type="number" id="acctThresholdInp" value="${threshold}" min="0" step="10" onchange="saveAcctThreshold(this.value)" style="width:80px;padding:5px 8px;border:1.5px solid #e5e7eb;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.85rem;outline:none;text-align:center;" onfocus="this.style.borderColor='var(--green-dark)'" onblur="this.style.borderColor='#e5e7eb'">
    <span style="font-size:0.8rem;color:#6b7280;">د.أ</span>
  </div>`;
  // Group stores by their group field — use all stores (incl. archived) for correct balance
  const groups={};
  const ungrouped=[];
  (_opAllStoresList.length?_opAllStoresList:_opStoresList).forEach(s=>{
    if(s.group){
      if(!groups[s.group])groups[s.group]=[];
      groups[s.group].push(s);
    }else if(!s.archived){ungrouped.push(s);}
  });

  function storeCard(s){
    const refund=refundByStore[s.id]||0;
    const owed=owedByStore[s.id]||0;
    const paid=paidByStore[s.id]||0;
    const balance=owed-paid-refund;
    const high=balance>threshold&&threshold>0;
    return `<div data-sid="${s.id}" data-sname="${s.name.replace(/"/g,'&quot;')}" onclick="openAcctDetail(this.dataset.sid,this.dataset.sname)" style="background:var(--card-bg);border:1.5px solid ${high?'#fca5a5':'var(--border)'};border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='${high?'#ef4444':'var(--green-dark)'}'" onmouseout="this.style.borderColor='${high?'#fca5a5':'var(--border)'}'">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;color:var(--green-dark);font-size:1rem;">🏪 ${s.name}</div>
        <div style="display:flex;align-items:center;gap:7px;">
          ${high?`<span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:3px 9px;font-size:0.74rem;font-weight:700;">⚠️ ${balance.toFixed(2)} د.أ</span>`:''}
          <span style="color:var(--text-mid);font-size:1.2rem;">←</span>
        </div>
      </div>
      ${refund>0?`<div style="margin-top:8px;display:inline-block;background:#fce7f3;border:1px solid #f9a8d4;border-radius:8px;padding:3px 10px;font-size:0.78rem;font-weight:700;color:#9d174d;">↩️ مرتجع: ${refund.toFixed(2)} د.أ</div>`:''}
    </div>`;
  }

  function groupCard(groupName,stores){
    const totalOwed=stores.reduce((s,x)=>s+(owedByStore[x.id]||0),0);
    const totalPaid=stores.reduce((s,x)=>s+(paidByStore[x.id]||0),0)+(paidByStore['__grp__'+groupName]||0);
    const totalRefund=stores.reduce((s,x)=>s+(refundByStore[x.id]||0),0);
    const totalBalance=totalOwed-totalPaid-totalRefund;
    const high=totalBalance>threshold&&threshold>0;
    return `<div style="background:var(--card-bg);border:2px solid ${high?'#fca5a5':'#c4b5fd'};border-radius:14px;padding:14px 16px;margin-bottom:10px;">
      <div data-gname="${groupName.replace(/"/g,'&quot;')}" onclick="openGroupAcctDetail(this.dataset.gname)" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:pointer;padding:4px 0;">
        <div style="font-weight:800;color:#6d28d9;font-size:1rem;">👥 ${groupName} <span style="font-size:0.72rem;color:#a78bfa;font-weight:500;">← كشف مجمع</span></div>
        <div style="display:flex;align-items:center;gap:7px;">
          <span style="font-weight:800;color:${high?'#dc2626':'#166534'};font-size:0.9rem;">${totalBalance.toFixed(2)} د.أ</span>
          ${high?`<span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:2px 7px;font-size:0.72rem;font-weight:700;">⚠️</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;font-size:0.76rem;color:#6b7280;">
        <span>📈 مبيعات: <strong>${totalOwed.toFixed(2)}</strong></span>
        <span>💸 مدفوع: <strong>${totalPaid.toFixed(2)}</strong></span>
        ${totalRefund>0?`<span>↩️ مرتجع: <strong>${totalRefund.toFixed(2)}</strong></span>`:''}
      </div>
      <div style="padding-right:10px;border-right:3px solid #ede9fe;">
        ${stores.map(s=>`<div data-sid="${s.id}" data-sname="${s.name.replace(/"/g,'&quot;')}" onclick="openAcctDetail(this.dataset.sid,this.dataset.sname)" style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:10px;padding:11px 14px;margin-bottom:7px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-weight:700;color:var(--green-dark);font-size:0.95rem;">🏪 ${s.name}</div>
          <span style="color:var(--text-mid);font-size:1.1rem;">←</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  const cards=Object.entries(groups).map(([g,stores])=>groupCard(g,stores)).join('')
    +ungrouped.map(storeCard).join('');
  wrap.innerHTML=thresholdRow+cards;
}

// ===== OPERATOR DAILY ACCOUNT (حساب المشغل اليومي) =====
let _opDailySales=[];
let _opSessionRefunds=[];
let _opDayOrders=[];
let _opWithdrawals=[];
let _opDayExpenses=[];
let _opDayRecord=null;
let _opAcctOwed={};
let _opAcctPaid={};
let _opAcctRefund={};
let _opAcctDiscount={};
let _opViewDate=null;
let _opCurrentSession=null;
let _opMashghalWages=[];
function _fmtDate(d){if(!d)return '';const[y,m,day]=d.split('-');return `${day}/${m}/${y}`;}
const _opToday=()=>jordanDateStr();

function _opDateOffset(date, days){
  const d=new Date(date+'T00:00:00');
  d.setDate(d.getDate()+days);
  return d.toLocaleDateString('en-CA',{timeZone:'Asia/Amman'});
}

async function checkOperatorDayStatus(){await loadOpSessionStatus();}
async function loadOpSessionStatus(){
  const badge=document.getElementById('opacct_op_status_badge');
  try{
    const snap=await db.collection('operator_sessions').where('status','==','open').limit(1).get();
    if(!snap.empty){
      _opCurrentSession={id:snap.docs[0].id,...snap.docs[0].data()};
      if(badge){badge.textContent=`🟢 مفتوح منذ ${_fmtDate(_opCurrentSession.openedDate)}`;badge.style.background='rgba(255,255,255,0.2)';}
    } else {
      _opCurrentSession=null;
      if(badge){badge.textContent='⚫ لا يوجد كشف';badge.style.background='rgba(220,38,38,0.5)';}
    }
  }catch(e){}
  loadSessionArchive();
}
async function loadSessionArchive(){
  const el=document.getElementById('op_sessions_archive');
  if(!el)return;
  try{
    const snap=await db.collection('operator_sessions').where('status','==','closed').limit(20).get();
    const docs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.closedDate||'').localeCompare(a.closedDate||''));
    if(!docs.length){el.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.8rem;padding:12px;">لا توجد كشوفات مغلقة بعد</div>';return;}
    el.innerHTML=docs.map(s=>{
      return `<div onclick="openOperatorDailyAccount('${s.id}')" style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;color:var(--text-dark);font-size:0.88rem;">📋 ${_fmtDate(s.openedDate)} ← ${_fmtDate(s.closedDate)}</div>
          <div style="font-size:0.72rem;color:#9ca3af;margin-top:2px;">مغلق</div>
        </div>
        <span style="color:#9ca3af;font-size:1.1rem;">←</span>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#dc2626;font-size:0.8rem;padding:8px;">❌ '+e.message+'</div>';}
}

async function openOperatorDailyAccount(sessionId){
  document.getElementById('opacct-store-list').style.display='none';
  document.getElementById('opacct-operator-view').style.display='block';
  if(sessionId&&typeof sessionId==='string'&&sessionId.length>10){
    const snap=await db.collection('operator_sessions').doc(sessionId).get();
    if(snap.exists) _opCurrentSession={id:snap.id,...snap.data()};
  } else if(!_opCurrentSession){
    const snap=await db.collection('operator_sessions').where('status','==','open').limit(1).get();
    if(!snap.empty) _opCurrentSession={id:snap.docs[0].id,...snap.docs[0].data()};
    else _opCurrentSession=null;
  }
  await _loadOpSessionData();
}

async function _loadOpDayData(date){await _loadOpSessionData();}
async function _loadOpSessionData(){
  const body=document.getElementById('opacct_op_body');
  const actionsWrap=document.getElementById('opacct_op_actions');
  if(body) body.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:20px;">⏳ تحميل...</div>';
  if(!_opCurrentSession){
    if(body) body.innerHTML=`<div style="text-align:center;padding:40px;background:var(--card-bg);border:1.5px dashed var(--border);border-radius:14px;"><div style="font-size:2rem;margin-bottom:8px;">📋</div><div style="font-weight:700;color:var(--text-dark);margin-bottom:6px;">لا يوجد كشف مفتوح</div><div style="font-size:0.8rem;color:#9ca3af;margin-bottom:16px;">أنشئ كشفاً جديداً لبدء تسجيل المبيعات</div><button onclick="openNewSession()" style="padding:12px 24px;background:var(--green-dark);color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">➕ فتح كشف جديد</button></div>`;
    if(actionsWrap) actionsWrap.innerHTML='';
    const infoEl=document.getElementById('op_session_info');
    if(infoEl) infoEl.innerHTML='<span style="color:#9ca3af;">لا يوجد كشف مفتوح</span>';
    return;
  }
  _opDayRecord={status:_opCurrentSession.status};
  const from=_opCurrentSession.openedDate;
  const to=_opCurrentSession.closedDate||jordanDateStr();
  const infoEl=document.getElementById('op_session_info');
  if(infoEl){
    const isClosed=_opCurrentSession.status==='closed';
    infoEl.innerHTML=isClosed
      ?`<span style="color:#dc2626;font-weight:700;">🔒 مغلق — من ${_fmtDate(from)} إلى ${_fmtDate(to)}</span>`
      :`<span style="color:#166534;font-weight:700;">🟢 مفتوح منذ ${_fmtDate(from)}</span> <span style="color:#9ca3af;font-size:0.78rem;">— حتى اليوم ${_fmtDate(to)}</span>`;
  }
  try{
    const salesSnap=await db.collection('operator_sales').where('date','>=',from).where('date','<=',to).get();
    _opDailySales=salesSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(s=>s.delivered!==false)
      // exclude records that belong to a different session (old records with no sessionId are kept)
      .filter(s=>!s.sessionId||s.sessionId===_opCurrentSession.id);
  }catch(e){_opDailySales=[];}
  try{
    const wSnap=await db.collection('operator_withdrawals').where('sessionId','==',_opCurrentSession.id).get();
    _opWithdrawals=wSnap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_opWithdrawals=[];}
  try{
    const eSnap=await db.collection('operator_expenses').where('date','>=',from).where('date','<=',to).get();
    _opDayExpenses=eSnap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_opDayExpenses=[];}
  // Mashghal employee wages for this session period
  try{
    const [attSnap,ratesSnap,workersSnap]=await Promise.all([
      db.collection('attendance').where('date','>=',from).where('date','<=',to).get(),
      db.collection('emp_wage_rates').get(),
      db.collection('employee_workers').get()
    ]);
    const workers=workersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const ratesData={};ratesSnap.docs.forEach(d=>{ratesData[d.id]=d.data();});
    const byEmp={};
    attSnap.docs.forEach(d=>{
      const r=d.data();
      const secs=r.secondsWorked!=null?r.secondsWorked:(r.hoursWorked?Math.round(r.hoursWorked*3600):0);
      if(!byEmp[r.employeeId])byEmp[r.employeeId]={secs:0,days:0};
      byEmp[r.employeeId].secs+=secs;
      byEmp[r.employeeId].days+=1;
    });
    _opMashghalWages=Object.entries(byEmp).map(([empId,data])=>{
      const w=workers.find(x=>x.id===empId)||{id:empId};
      const hourlyRate=parseFloat(ratesData[empId]?.hourlyRate||0);
      const hrs=Math.round(data.secs/36)/100;
      const earned=hourlyRate?Math.round(hrs*hourlyRate*100)/100:0;
      return{id:empId,name:w.name||w.username||empId,secs:data.secs,days:data.days,hourlyRate,earned};
    }).filter(w=>w.secs>0);
  }catch(e){_opMashghalWages=[];}
  try{ await _loadDeliveryReps(); }catch(e){}
  // Load cumulative account balances for all stores
  try{
    const [sSnap,pSnap,rSnap,rSessionSnap]=await Promise.all([
      db.collection('operator_sales').get(),
      db.collection('operator_store_payments').get(),
      db.collection('page_refunds').get(),
      db.collection('page_refunds').where('date','>=',from).where('date','<=',to).get()
    ]);
    _opAcctOwed={};_opAcctPaid={};_opAcctRefund={};_opAcctDiscount={};
    sSnap.docs.forEach(d=>{const s=d.data();if(s.storeId&&s.delivered!==false){
      const qty=s.qty||1;
      // sellPrice = السعر الرسمي (المستحق دائماً). soldPrice = السعر الفعلي يلي انباع فيه.
      const official=(s.sellPrice||0);
      const sold=(s.soldPrice!=null?s.soldPrice:official);
      _opAcctOwed[s.storeId]=(_opAcctOwed[s.storeId]||0)+official*qty;
      // الخصم = الرسمي − الفعلي (لما الفعلي أقل) — تتحمّله الصفحة
      const disc=Math.max(0,official-sold)*qty;
      if(disc>0.0001) _opAcctDiscount[s.storeId]=(_opAcctDiscount[s.storeId]||0)+disc;
    }});
    pSnap.docs.forEach(d=>{const p=d.data();if(p.storeId&&p.withdrawalType!=='withdrawal'){_opAcctPaid[p.storeId]=(_opAcctPaid[p.storeId]||0)+(p.amount||0);}});
    rSnap.docs.forEach(d=>{const r=d.data();if(r.storeId){_opAcctRefund[r.storeId]=(_opAcctRefund[r.storeId]||0)+(r.totalCost||0);}});
    // Session-specific refunds: those within the session date range (for display in store cards)
    _opSessionRefunds=rSessionSnap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_opAcctOwed={};_opAcctPaid={};_opAcctRefund={};_opAcctDiscount={};_opSessionRefunds=[];}

  // Determine the cutoff timestamp: orders updated BEFORE this time belong to a previous session
  // Use openedAt of current session (exact moment it was created)
  let sessionOpenedAt=null; // Firestore Timestamp
  if(_opCurrentSession.status!=='closed'){
    if(_opCurrentSession.openedAt&&_opCurrentSession.openedAt.toDate){
      sessionOpenedAt=_opCurrentSession.openedAt;
    } else {
      // openedAt not in memory — reload session document to get it
      try{
        const sd=await db.collection('operator_sessions').doc(_opCurrentSession.id).get();
        if(sd.exists) sessionOpenedAt=sd.data().openedAt||null;
      }catch(e){}
    }
  }
  const ordersFrom=from;

  // Cancel previous statement listener and poll if any
  if(_opStmtUnsub){_opStmtUnsub();_opStmtUnsub=null;}
  if(_opStmtPollId){clearInterval(_opStmtPollId);_opStmtPollId=null;}

  // Filter an order: include if it was updated at/after the session opened
  // (handles same-day open/close — keeps only orders from THIS session)
  function _orderBelongsToSession(o){
    if(!sessionOpenedAt) return true; // closed sessions or no timestamp → no filter
    const oTs=o.updatedAt; // Firestore Timestamp
    if(!oTs||!oTs.toDate) return true; // no timestamp on order → include
    return oTs.toDate()>=sessionOpenedAt.toDate();
  }

  // Helper: fetch delivered orders for this session range
  async function _fetchStmtOrders(){
    try{
      const snap=await db.collection('employee_orders')
        .where('deliveredDate','>=',ordersFrom).where('deliveredDate','<=',to).get();
      const withDate=snap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(o=>o.status==='delivered'&&_orderBelongsToSession(o));
      const fromTs=firebase.firestore.Timestamp.fromDate(new Date(ordersFrom+'T00:00:00'));
      const toTs=firebase.firestore.Timestamp.fromDate(new Date(to+'T23:59:59'));
      let noDate=[];
      try{
        const snap2=await db.collection('employee_orders')
          .where('status','==','delivered')
          .where('updatedAt','>=',fromTs)
          .where('updatedAt','<=',toTs).get();
        noDate=snap2.docs.map(d=>({id:d.id,...d.data()}))
          .filter(o=>!o.deliveredDate&&_orderBelongsToSession(o));
      }catch(e2){}
      const map={};
      [...withDate,...noDate].forEach(o=>map[o.id]=o);
      return Object.values(map);
    }catch(e){return _opDayOrders;}
  }

  // Real-time listener on deliveredDate range
  _opStmtUnsub=db.collection('employee_orders')
    .where('deliveredDate','>=',ordersFrom)
    .where('deliveredDate','<=',to)
    .onSnapshot(async snap=>{
      const withDate=snap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(o=>o.status==='delivered'&&_orderBelongsToSession(o));
      const noDateOrders=_opDayOrders.filter(o=>!o.deliveredDate);
      const map={};
      [...withDate,...noDateOrders].forEach(o=>map[o.id]=o);
      _opDayOrders=Object.values(map);
      renderOperatorDailyView();
    },e=>{console.error('opStatement listener error:',e);});

  // AUTO-SYNC: any delivered order not yet recorded in operator_sales is synced
  // automatically — no manual "تسليم" button needed. Reuses the proven sync logic,
  // runs in admin context (correct session + product costs + store link), dedups
  // via fromOrderId, and only touches OPEN sessions (never archived/closed ones).
  async function _autoSyncDeliveredToSales(orders){
    if(!orders||!orders.length) return false;
    if(_opCurrentSession.status==='closed') return false;
    const syncedIds=new Set(_opDailySales.map(s=>s.fromOrderId).filter(Boolean));
    const unsynced=orders.filter(o=>!syncedIds.has(o.id));
    if(!unsynced.length) return false;
    let did=0;
    for(const o of unsynced){
      try{ await syncOrderToAccounting(o.id,o,o.deliveredDate||jordanDateStr(),true,_opCurrentSession.id); did++; }catch(e){}
    }
    if(did){
      try{
        const s2=await db.collection('operator_sales').where('date','>=',from).where('date','<=',to).get();
        _opDailySales=s2.docs.map(d=>({id:d.id,...d.data()}))
          .filter(s=>s.delivered!==false)
          .filter(s=>!s.sessionId||s.sessionId===_opCurrentSession.id);
      }catch(e){}
    }
    return did>0;
  }

  // Fallback poll every 30s (also catches reps' deliveries live while admin is viewing)
  _opStmtPollId=setInterval(async()=>{
    if(!_opCurrentSession)return;
    _opDayOrders=await _fetchStmtOrders();
    await _autoSyncDeliveredToSales(_opDayOrders);
    renderOperatorDailyView();
  },30000);

  _fetchStmtOrders().then(async orders=>{
    _opDayOrders=orders;
    renderOperatorDailyView();
    const changed=await _autoSyncDeliveredToSales(orders);
    if(changed) renderOperatorDailyView();
  });
}

function prevOpDay(){
  _opViewDate=_opDateOffset(_opViewDate,-1);
  const dateEl=document.getElementById('opview_date');
  if(dateEl) dateEl.value=_opViewDate;
  const nextBtn=document.getElementById('opview_next_btn');
  if(nextBtn) nextBtn.disabled=false;
  _loadOpDayData(_opViewDate);
}

function nextOpDay(){
  const today=_opToday();
  if(_opViewDate>=today) return;
  _opViewDate=_opDateOffset(_opViewDate,1);
  const dateEl=document.getElementById('opview_date');
  if(dateEl) dateEl.value=_opViewDate;
  const nextBtn=document.getElementById('opview_next_btn');
  if(nextBtn) nextBtn.disabled=(_opViewDate>=today);
  _loadOpDayData(_opViewDate);
}

function goOpToday(){
  _opViewDate=_opToday();
  const dateEl=document.getElementById('opview_date');
  if(dateEl) dateEl.value=_opViewDate;
  const nextBtn=document.getElementById('opview_next_btn');
  if(nextBtn) nextBtn.disabled=true;
  _loadOpDayData(_opViewDate);
}

function jumpOpDate(val){
  if(!val) return;
  const today=_opToday();
  _opViewDate=val>today?today:val;
  const dateEl=document.getElementById('opview_date');
  if(dateEl) dateEl.value=_opViewDate;
  const nextBtn=document.getElementById('opview_next_btn');
  if(nextBtn) nextBtn.disabled=(_opViewDate>=today);
  _loadOpDayData(_opViewDate);
}

function renderOperatorDailyView(){
  const body=document.getElementById('opacct_op_body');
  const actionsWrap=document.getElementById('opacct_op_actions');
  if(!body||!actionsWrap) return;
  const isClosed=_opDayRecord&&_opDayRecord.status==='closed';
  const totExp=(_opDayExpenses||[]).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  // Only skip render when closed and truly nothing to show
  if(isClosed&&!_opDailySales.length&&!_opDayOrders.length&&!_opWithdrawals.length){
    body.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:24px;background:var(--card-bg);border-radius:12px;border:1px dashed var(--border);">لا يوجد مبيعات أو طلبات مُسلَّمة في هذه الفترة</div>';
    actionsWrap.innerHTML='<div style="text-align:center;color:#dc2626;font-size:0.85rem;font-weight:700;padding:10px;">🔒 الكشف مغلق</div>';
    return;
  }
  let html='';
  if(isClosed) html+='<div style="background:#fee2e2;border-radius:10px;padding:10px 14px;margin-bottom:12px;text-align:center;font-weight:700;color:#dc2626;font-size:0.88rem;">🔒 الكشف مغلق — من '+_fmtDate(_opCurrentSession?.openedDate)+' إلى '+_fmtDate(_opCurrentSession?.closedDate)+'</div>';
  if(!_opDailySales.length&&!_opDayOrders.length) html+='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:16px;background:var(--card-bg);border-radius:12px;border:1px dashed var(--border);margin-bottom:12px;">لا يوجد مبيعات أو طلبات مُسلَّمة في هذه الفترة</div>';
  // ===== Sales table (only if sales exist) =====
  if(_opDailySales.length){
    const byProd={};
    _opDailySales.forEach(function(s){
      const key=s.productName;
      if(!byProd[key]) byProd[key]={name:key,qty:0,raw:0,tree:0,machine:0,assembly:0,sell:0};
      byProd[key].qty+=s.qty||1;
      byProd[key].raw+=(s.rawMaterialCost||0)*(s.qty||1);
      byProd[key].tree+=(s.treeCost||0)*(s.qty||1);
      byProd[key].machine+=(s.machineWorkerWage||0)*(s.qty||1);
      byProd[key].assembly+=(s.assemblyWorkerWage||0)*(s.qty||1);
      byProd[key].sell+=(s.sellPrice||0)*(s.qty||1);
    });
    const prods=Object.values(byProd);
    const totRaw=prods.reduce(function(s,p){return s+p.raw;},0);
    const totTree=prods.reduce(function(s,p){return s+p.tree;},0);
    const totMachine=prods.reduce(function(s,p){return s+p.machine;},0);
    const totAssembly=prods.reduce(function(s,p){return s+p.assembly;},0);
    const totSell=prods.reduce(function(s,p){return s+p.sell;},0);
    const totCost=totRaw+totTree+totMachine+totAssembly;
    const totProfit=totSell-totCost;
    const isP=totProfit>=0;
    const rows=prods.map(function(p){
      const cost=p.raw+p.tree+p.machine+p.assembly;
      const profit=p.sell-cost;
      return '<tr style="border-bottom:1px solid var(--border);font-size:0.78rem;"><td style="padding:7px 8px;font-weight:600;color:var(--text-dark);">'+p.name+'</td><td style="padding:7px 8px;text-align:center;">'+p.qty+'</td><td style="padding:7px 8px;text-align:center;color:#92400e;">'+p.raw.toFixed(2)+'</td><td style="padding:7px 8px;text-align:center;color:#15803d;">'+p.tree.toFixed(2)+'</td><td style="padding:7px 8px;text-align:center;color:#1e40af;">'+p.machine.toFixed(2)+'</td><td style="padding:7px 8px;text-align:center;color:#7c3aed;">'+p.assembly.toFixed(2)+'</td><td style="padding:7px 8px;text-align:center;font-weight:700;color:#166534;">'+p.sell.toFixed(2)+'</td><td style="padding:7px 8px;text-align:center;font-weight:700;color:'+(profit>=0?'#166534':'#dc2626')+';">'+profit.toFixed(2)+'</td></tr>';
    }).join('');
    html+='<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:14px;"><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:480px;"><thead><tr style="background:#1a3a2a;color:#fff;font-size:0.72rem;"><th style="padding:8px;text-align:right;font-weight:600;">المنتج</th><th style="padding:8px;text-align:center;font-weight:600;">كمية</th><th style="padding:8px;text-align:center;font-weight:600;color:#fef3c7;">🧱 مواد</th><th style="padding:8px;text-align:center;font-weight:600;color:#bbf7d0;">🌳 شجر</th><th style="padding:8px;text-align:center;font-weight:600;color:#bfdbfe;">⚙️ ماكينة</th><th style="padding:8px;text-align:center;font-weight:600;color:#ddd6fe;">🔧 تركيب</th><th style="padding:8px;text-align:center;font-weight:600;color:#bbf7d0;">💰 بيع</th><th style="padding:8px;text-align:center;font-weight:600;color:#d4a843;">💵 ربح</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr style="background:#f9fafb;font-size:0.8rem;font-weight:800;border-top:2px solid var(--border);"><td style="padding:8px;color:var(--text-dark);">المجموع</td><td style="padding:8px;text-align:center;">'+prods.reduce(function(s,p){return s+p.qty;},0)+'</td><td style="padding:8px;text-align:center;color:#92400e;">'+totRaw.toFixed(2)+'</td><td style="padding:8px;text-align:center;color:#15803d;">'+totTree.toFixed(2)+'</td><td style="padding:8px;text-align:center;color:#1e40af;">'+totMachine.toFixed(2)+'</td><td style="padding:8px;text-align:center;color:#7c3aed;">'+totAssembly.toFixed(2)+'</td><td style="padding:8px;text-align:center;color:#166534;">'+totSell.toFixed(2)+'</td><td style="padding:8px;text-align:center;color:'+(isP?'#166534':'#dc2626')+';">'+totProfit.toFixed(2)+'</td></tr></tfoot></table></div></div>';
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"><div style="background:#fefce8;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#92400e;margin-bottom:2px;">🧱 مجموع المواد الخام</div><div style="font-weight:800;color:#92400e;font-size:1rem;">'+totRaw.toFixed(2)+' د.أ</div></div><div style="background:#f0fdf4;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#15803d;margin-bottom:2px;">🌳 مجموع تكلفة الشجر</div><div style="font-weight:800;color:#15803d;font-size:1rem;">'+totTree.toFixed(2)+' د.أ</div></div><div style="background:#eff6ff;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#1e40af;margin-bottom:2px;">⚙️ أجرة عامل الماكينة</div><div style="font-weight:800;color:#1e40af;font-size:1rem;">'+totMachine.toFixed(2)+' د.أ</div></div><div style="background:#f5f3ff;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#7c3aed;margin-bottom:2px;">🔧 أجرة عامل التركيب</div><div style="font-weight:800;color:#7c3aed;font-size:1rem;">'+totAssembly.toFixed(2)+' د.أ</div></div><div style="background:#fef2f2;border-radius:9px;padding:9px;text-align:center;grid-column:1/-1;"><div style="font-size:0.7rem;color:#dc2626;margin-bottom:2px;">💸 إجمالي التكاليف</div><div style="font-weight:800;color:#dc2626;font-size:1rem;">'+totCost.toFixed(2)+' د.أ</div></div></div>';
    const totProfitAfterExp=totProfit-totExp;
    const isPE=totProfitAfterExp>=0;
    const expCell=totExp>0?'<div style="background:#fff7ed;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#9a3412;margin-bottom:2px;">🧾 مصاريف</div><div style="font-weight:800;color:#9a3412;font-size:1.1rem;">'+totExp.toFixed(2)+' د.أ</div></div>':'';
    const gridCols=totExp>0?'1fr 1fr 1fr':'1fr 1fr';
    html+='<div style="display:grid;grid-template-columns:'+gridCols+';gap:8px;margin-bottom:12px;"><div style="background:#f0fdf4;border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:#166534;margin-bottom:2px;">💰 إجمالي البيع</div><div style="font-weight:800;color:#166534;font-size:1.1rem;">'+totSell.toFixed(2)+' د.أ</div></div>'+expCell+'<div style="background:'+(isPE?'#dcfce7':'#fee2e2')+'";border-radius:9px;padding:9px;text-align:center;"><div style="font-size:0.7rem;color:'+(isPE?'#166534':'#dc2626')+';margin-bottom:2px;">'+(isPE?'✅ صافي الربح':'⚠️ الخسارة')+(totExp>0?' (بعد المصاريف)':'')+'</div><div style="font-weight:900;color:'+(isPE?'#166534':'#dc2626')+';font-size:1.2rem;">'+Math.abs(totProfitAfterExp).toFixed(2)+' د.أ</div></div></div>';
  }
  // ===== Store payments panel =====
  if(!isClosed&&(_opStoresList||[]).length){
    const grpMap={};
    const ungroupedRows=[];
    const allSt=(_opAllStoresList.length?_opAllStoresList:_opStoresList);
    allSt.forEach(s=>{
      const owed=_opAcctOwed[s.id]||0;
      const paid=_opAcctPaid[s.id]||0;
      const refund=_opAcctRefund[s.id]||0;
      const discount=_opAcctDiscount[s.id]||0;
      if(s.group){
        if(!grpMap[s.group])grpMap[s.group]={name:s.group,owed:0,paid:0,refund:0,discount:0};
        grpMap[s.group].owed+=owed;grpMap[s.group].paid+=paid;grpMap[s.group].refund+=refund;grpMap[s.group].discount+=discount;
      } else if(!s.archived){
        const bal=owed-paid-refund;
        if(bal>0.01) ungroupedRows.push({id:s.id,name:s.name,bal,owed,paid,discount});
      }
    });
    Object.values(grpMap).forEach(g=>{g.paid+=(_opAcctPaid['__grp__'+g.name]||0);});
    const grpRows=Object.values(grpMap).sort((a,b)=>a.name.localeCompare(b.name,'ar')).map(g=>{
      const bal=g.owed-g.paid-g.refund;if(bal<=0.01)return '';
      const safeG=g.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div style="padding:9px 14px;border-bottom:1px solid #e5e7eb;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:8px;">
          <span style="font-weight:800;color:#111;font-size:0.85rem;">🗂 ${g.name}</span>
          <button onclick="showAddWithdrawalModalForGroup('${safeG}','payment')" style="padding:5px 12px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;">💳 دفعة</button>
        </div>
        <div style="display:flex;gap:10px;font-size:0.72rem;flex-wrap:wrap;">
          <span style="color:#dc2626;">المستحق: <strong>${g.owed.toFixed(2)}</strong></span>
          <span style="color:#166534;">المدفوع: <strong>${g.paid.toFixed(2)}</strong></span>
          ${g.discount>0?`<span style="color:#b45309;">🏷 خصومات: <strong>${g.discount.toFixed(2)}</strong></span>`:''}
          <span style="color:#92400e;font-weight:800;">الباقي: ${bal.toFixed(2)} د.أ</span>
        </div>
      </div>`;}).join('');
    const storeRows=ungroupedRows.sort((a,b)=>b.bal-a.bal).map(s=>{
      const safeN=s.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div style="padding:9px 14px;border-bottom:1px solid #e5e7eb;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:8px;">
          <span style="font-weight:700;color:#374151;font-size:0.85rem;">🏪 ${s.name}</span>
          <button onclick="showAddWithdrawalModalForStore('${s.id}','${safeN}','payment')" style="padding:5px 12px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;">💳 دفعة</button>
        </div>
        <div style="display:flex;gap:10px;font-size:0.72rem;flex-wrap:wrap;">
          <span style="color:#dc2626;">المستحق: <strong>${s.owed.toFixed(2)}</strong></span>
          <span style="color:#166534;">المدفوع: <strong>${s.paid.toFixed(2)}</strong></span>
          ${s.discount>0?`<span style="color:#b45309;">🏷 خصومات: <strong>${s.discount.toFixed(2)}</strong></span>`:''}
          <span style="color:#92400e;font-weight:800;">الباقي: ${s.bal.toFixed(2)} د.أ</span>
        </div>
      </div>`;}).join('');
    if(grpRows||storeRows){
      html+=`<div style="background:var(--card-bg);border:1.5px solid #fca5a5;border-radius:12px;overflow:hidden;margin-bottom:14px;">
        <div style="background:#dc2626;padding:9px 14px;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#fff;font-weight:800;font-size:0.88rem;">💳 دفعات المتاجر</span>
          <span style="color:#fca5a5;font-size:0.75rem;">الرصيد الكلي المتراكم</span>
        </div>
        ${grpRows}${storeRows}
      </div>`;
    }
  }
  // ===== Mashghal wages section =====
  if(_opMashghalWages&&_opMashghalWages.length){
    const totW=_opMashghalWages.reduce((s,w)=>s+w.earned,0);
    const rows=_opMashghalWages.map(w=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid #dbeafe;font-size:0.8rem;">
        <span style="font-weight:700;color:#1e3a5f;">👤 ${w.name}</span>
        <span style="color:#6b7280;">${w.days} يوم · ${_fmtDuration(w.secs)}</span>
        <span style="font-weight:900;color:#1d4ed8;">${w.earned>0?w.earned.toFixed(2)+' د.أ':'—'}</span>
      </div>`).join('');
    html+=`<div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;overflow:hidden;margin-bottom:14px;">
      <div style="background:#1e40af;padding:9px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:800;font-size:0.85rem;">👥 رواتب موظفين المشغل</span>
        <span style="color:#bfdbfe;font-weight:900;font-size:0.95rem;">${totW.toFixed(2)} د.أ</span>
      </div>
      ${rows}
    </div>`;
  }
  body.innerHTML=html;
  // ===== Delivered orders + per-store balance =====
  if(_opDayOrders.length){
    const excludedRepNames=new Set((_deliveryRepsCache||[]).filter(r=>r.excludeFromBalance).map(r=>r.name));
    const byStore={};
    _opDayOrders.forEach(o=>{
      const sname=o.pageName||o.storeName||o.source||'الموقع الإلكتروني';
      if(!byStore[sname]){
        const storeObj=(_opStoresList||[]).find(s=>s.name===sname);
        byStore[sname]={name:sname,storeId:storeObj?.id||null,group:storeObj?.group||null,orders:[],total:0,eligibleTotal:0};
      }
      const amt=Math.max(0,(o.netPrice!=null?o.netPrice:(o.totalPrice||0))-(o.deliveryFee||0));
      const isExcl=!!(o.deliveryRepName&&excludedRepNames.has(o.deliveryRepName));
      byStore[sname].orders.push({...o,collectAmt:amt,excludedFromBalance:isExcl});
      byStore[sname].total+=amt;
      if(!isExcl) byStore[sname].eligibleTotal+=amt;
    });
    const orderStoreNames=new Set(Object.keys(byStore));

    // Helper: render one store card (used for grouped + ungrouped)
    const _storeCard=(store,indent,inGroup)=>{
      const eligibleReps={};const excludedReps={};
      store.orders.forEach(o=>{
        if(o.excludedFromBalance){
          const k=o.deliveryRepName;
          if(!excludedReps[k]){excludedReps[k]={name:k,orders:[],total:0};}
          excludedReps[k].orders.push(o);excludedReps[k].total+=o.collectAmt;
        } else {
          const k=o.deliveryRepName||'__norep__';
          if(!eligibleReps[k]){eligibleReps[k]={name:o.deliveryRepName||null,orders:[],total:0};}
          eligibleReps[k].orders.push(o);eligibleReps[k].total+=o.collectAmt;
        }
      });
      const storeWds=_opWithdrawals.filter(w=>w.storeName===store.name&&w.withdrawalType!=='payment');
      const storeWdTotal=storeWds.reduce((s,w)=>s+(w.amount||0),0);
      const storeBalance=store.eligibleTotal-storeWdTotal;
      const balColor=storeBalance>=0?'#166534':'#dc2626';
      const balBg=storeBalance>=0?'#dcfce7':'#fee2e2';
      const eligBlocks=Object.values(eligibleReps).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar')).map(rep=>{
        const safeName=(rep.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:0.82rem;font-weight:700;color:#1e40af;">${rep.name?'🚚 '+rep.name:'بدون مندوب'}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.75rem;color:#6b7280;">${rep.orders.length} طلب</span>
            <span style="font-size:0.88rem;font-weight:900;color:#166534;">${rep.total.toFixed(2)} د.أ</span>
            ${rep.name?`<button onclick="toggleRepBalanceByName('${safeName}')" style="padding:3px 7px;background:#fff3cd;color:#92400e;border:1px solid #fde68a;border-radius:6px;font-size:0.68rem;cursor:pointer;font-family:'Tajawal',sans-serif;white-space:nowrap;">🚫 استبعد</button>`:''}
          </div>
        </div>`;}).join('');
      const exclBlocks=Object.values(excludedReps).length?`
        <div style="background:#fffbeb;border-top:1px dashed #fde68a;padding:6px 14px;">
          <div style="font-size:0.68rem;color:#92400e;margin-bottom:3px;font-weight:700;">🚚 شركات توصيل — لا تدخل بالرصيد</div>
          ${Object.values(excludedReps).map(rep=>{
            const safeName=(rep.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
              <span style="font-size:0.78rem;color:#92400e;">${rep.name}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:0.78rem;color:#92400e;">${rep.orders.length} طلب — ${rep.total.toFixed(2)} د.أ</span>
                <button onclick="toggleRepBalanceByName('${safeName}')" style="padding:3px 7px;background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:6px;font-size:0.68rem;cursor:pointer;font-family:'Tajawal',sans-serif;white-space:nowrap;">✅ أضف للرصيد</button>
              </div>
            </div>`;}).join('')}
        </div>`:'';
      const wdRows=storeWds.map(w=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px dashed #fecaca;gap:6px;">
          <div style="flex:1;min-width:0;">
            ${w.notes?`<span style="font-size:0.72rem;color:#6b7280;">${w.notes} — </span>`:''}
            <span style="font-size:0.7rem;color:#9ca3af;">${w.date||''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            <span style="font-weight:700;color:#dc2626;font-size:0.82rem;">${(w.amount||0).toFixed(2)} د.أ</span>
            ${!isClosed?`<button onclick="deleteOperatorWithdrawal('${w.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:5px;width:20px;height:20px;font-size:0.75rem;cursor:pointer;font-weight:900;line-height:1;">×</button>`:''}
          </div>
        </div>`).join('');
      const safeStoreName=store.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      // Session refunds for this store
      const storeRefunds=(_opSessionRefunds||[]).filter(r=>r.storeId===store.storeId);
      const storeRefundTotal=storeRefunds.reduce((s,r)=>s+(r.totalCost||0),0);
      const refundBlock=storeRefunds.length?`
        <div style="border-top:1.5px dashed #fecaca;margin:0;">
          <div style="padding:8px 14px 4px;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.75rem;font-weight:800;color:#9d174d;">↩️ مرتجعات هذا الكشف (${storeRefunds.length} طلب)</div>
            <div style="font-size:0.82rem;font-weight:900;color:#9d174d;">${storeRefundTotal.toFixed(2)} د.أ</div>
          </div>
          ${storeRefunds.map(r=>{
            const orderLabel=r.orderNum?`#${r.orderNum}`:'';
            const itemsSummary=(r.items||[]).map(i=>`${i.name}${i.qty>1?' ×'+i.qty:''}`).join('، ');
            return `<div style="padding:5px 14px 5px;border-top:1px solid #fee2e2;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div style="min-width:0;">
                <div style="font-size:0.75rem;font-weight:700;color:#7f1d1d;">${r.customerName||''} <span style="color:#9d174d;font-weight:600;">${orderLabel}</span></div>
                <div style="font-size:0.68rem;color:#b91c1c;margin-top:1px;">${itemsSummary}</div>
              </div>
              <div style="font-size:0.75rem;font-weight:800;color:#9d174d;flex-shrink:0;">${(r.totalCost||0).toFixed(2)}</div>
            </div>`;
          }).join('')}
          <div style="height:6px;"></div>
        </div>`:'';
      // Account balance (cumulative)
      const acctOwed=_opAcctOwed[store.storeId]||0;
      const acctPaid=_opAcctPaid[store.storeId]||0;
      const acctRefund=_opAcctRefund[store.storeId]||0;
      const acctDiscount=_opAcctDiscount[store.storeId]||0;
      const acctBal=acctOwed-acctPaid-acctRefund;
      const acctBalColor=acctBal>0?'#92400e':acctBal<0?'#166534':'#6b7280';
      const acctBg=acctBal>0?'#fff7ed':acctBal<0?'#f0fdf4':'#f9fafb';
      const acctLabel=acctBal>0?'📊 ضايل عليه':acctBal<0?'💰 رصيد له':'✅ مسوّى';
      const acctRow=store.storeId?`
        <div style="border-top:1px solid #e5e7eb;padding:8px 14px;background:${acctBg};display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="font-size:0.72rem;font-weight:700;color:#374151;">🗂 رصيد الحساب الكلي</div>
          <div style="display:flex;gap:10px;font-size:0.72rem;flex-wrap:wrap;">
            <span style="color:#dc2626;">مبيعات: <strong>${acctOwed.toFixed(2)}</strong></span>
            <span style="color:#166534;">مدفوع: <strong>${acctPaid.toFixed(2)}</strong></span>
            ${acctDiscount>0?`<span style="color:#b45309;">🏷 خصومات: <strong>${acctDiscount.toFixed(2)}</strong></span>`:''}
            ${acctRefund>0?`<span style="color:#9d174d;">مرتجع: <strong>${acctRefund.toFixed(2)}</strong></span>`:''}
            <span style="color:${acctBalColor};font-weight:800;">${acctLabel}: ${Math.abs(acctBal).toFixed(2)} د.أ</span>
          </div>
        </div>`:'';
      // When inside a group: compact view — no per-store session balance/withdrawals/account balance
      if(inGroup){
        return `<div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:8px;">
          <div style="background:#1a3a2a;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">
            <div style="color:#fff;font-weight:700;font-size:0.84rem;">🏪 ${store.name} <span style="font-size:0.7rem;font-weight:400;opacity:0.65;">(${store.orders.length} طلب)</span></div>
            <div style="color:#86efac;font-weight:900;font-size:0.84rem;">${store.eligibleTotal.toFixed(2)} د.أ</div>
          </div>
          ${eligBlocks}
          ${exclBlocks}
        </div>`;
      }
      return `<div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:12px;">
        <div style="background:#1a3a2a;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
          <div style="color:#fff;font-weight:800;font-size:0.88rem;">🏪 ${store.name} <span style="font-size:0.72rem;font-weight:400;opacity:0.7;">(${store.orders.length} طلب)</span></div>
          <div style="color:#86efac;font-weight:900;font-size:0.9rem;">${store.total.toFixed(2)} د.أ</div>
        </div>
        ${eligBlocks}
        ${exclBlocks}
        <div style="padding:10px 14px;background:#f9fafb;border-top:1px solid #e5e7eb;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:${storeWds.length||!isClosed?'8px':'0'};">
            <div style="text-align:center;background:#f0fdf4;border-radius:8px;padding:7px 4px;">
              <div style="font-size:0.62rem;color:#166534;margin-bottom:1px;">💰 قابل للسحب</div>
              <div style="font-weight:800;color:#166534;font-size:0.88rem;">${store.eligibleTotal.toFixed(2)}</div>
            </div>
            <div style="text-align:center;background:#fff5f5;border-radius:8px;padding:7px 4px;">
              <div style="font-size:0.62rem;color:#dc2626;margin-bottom:1px;">💸 مسحوب</div>
              <div style="font-weight:800;color:#dc2626;font-size:0.88rem;">${storeWdTotal.toFixed(2)}</div>
            </div>
            <div style="text-align:center;background:${balBg};border-radius:8px;padding:7px 4px;">
              <div style="font-size:0.62rem;color:${balColor};margin-bottom:1px;">📊 رصيد الكشف</div>
              <div style="font-weight:900;color:${balColor};font-size:0.88rem;">${storeBalance.toFixed(2)}</div>
            </div>
          </div>
          ${storeWds.length?`<div style="margin-bottom:6px;">${wdRows}</div>`:''}
          ${!isClosed?`<button onclick="showAddWithdrawalModalForStore('${store.storeId||''}','${safeStoreName}')" style="width:100%;padding:8px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer;">💸 إضافة مسحوب — ${store.name}</button>`:''}
        </div>
        ${refundBlock}
        ${acctRow}
      </div>`;
    };

    // Split stores into groups and ungrouped
    const storeGroups={};const ungroupedStores=[];
    Object.values(byStore).sort((a,b)=>a.name.localeCompare(b.name,'ar')).forEach(store=>{
      if(store.group){if(!storeGroups[store.group])storeGroups[store.group]=[];storeGroups[store.group].push(store);}
      else ungroupedStores.push(store);
    });

    // Build group cards
    const groupCards=Object.entries(storeGroups).sort((a,b)=>a[0].localeCompare(b[0],'ar')).map(([groupName,stores])=>{
      const grpEligible=stores.reduce((s,st)=>s+st.eligibleTotal,0);
      // group-level withdrawals: those tagged with groupName OR any per-store withdrawal for stores in this group
      const grpWds=_opWithdrawals.filter(w=>(w.groupName===groupName||stores.some(st=>st.name===w.storeName))&&w.withdrawalType!=='payment');
      const grpWdTotal=grpWds.reduce((s,w)=>s+(w.amount||0),0);
      const grpBalance=grpEligible-grpWdTotal;
      const grpBalColor=grpBalance>=0?'#fff':'#fca5a5';
      const grpTotalOrders=stores.reduce((s,st)=>s+st.orders.length,0);
      const grpTotalAmt=stores.reduce((s,st)=>s+st.total,0);
      const safeGrpName=groupName.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      // Group cumulative account balance — use ALL stores in group (incl. archived) not just session stores
      const allGrpStores=(_opAllStoresList.length?_opAllStoresList:_opStoresList).filter(s=>s.group===groupName);
      const grpAcctOwed=allGrpStores.reduce((s,st)=>s+(_opAcctOwed[st.id]||0),0);
      const grpAcctPaid=allGrpStores.reduce((s,st)=>s+(_opAcctPaid[st.id]||0),0)+(_opAcctPaid['__grp__'+groupName]||0);
      const grpAcctRefund=allGrpStores.reduce((s,st)=>s+(_opAcctRefund[st.id]||0),0);
      const grpAcctDiscount=allGrpStores.reduce((s,st)=>s+(_opAcctDiscount[st.id]||0),0);
      const grpAcctBal=grpAcctOwed-grpAcctPaid-grpAcctRefund;
      const grpAcctLabel=grpAcctBal>0?'ضايل عليهم':grpAcctBal<0?'رصيد لهم':'مسويين';
      const grpAcctColor=grpAcctBal>0?'#fde68a':grpAcctBal<0?'#bbf7d0':'rgba(255,255,255,0.6)';
      const grpWdRows=grpWds.map(w=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,0.2);gap:6px;">
          <div style="flex:1;min-width:0;">
            ${w.notes?`<span style="font-size:0.72rem;color:rgba(255,255,255,0.75);">${w.notes} — </span>`:''}
            <span style="font-size:0.7rem;color:rgba(255,255,255,0.55);">${w.date||''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            <span style="font-weight:700;color:#fca5a5;font-size:0.82rem;">${(w.amount||0).toFixed(2)} د.أ</span>
            ${!isClosed?`<button onclick="deleteOperatorWithdrawal('${w.id}')" style="background:rgba(220,38,38,0.4);color:#fff;border:none;border-radius:5px;width:20px;height:20px;font-size:0.75rem;cursor:pointer;font-weight:900;line-height:1;">×</button>`:''}
          </div>
        </div>`).join('');
      return `<div style="border:2px solid #7c3aed;border-radius:14px;overflow:hidden;margin-bottom:14px;">
        <div style="background:linear-gradient(135deg,#5b21b6,#7c3aed);padding:12px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="color:#fff;font-weight:800;font-size:0.92rem;">👥 ${groupName} <span style="font-size:0.72rem;font-weight:400;opacity:0.7;">(${stores.length} متاجر — ${grpTotalOrders} طلب)</span></div>
            <div style="color:#e9d5ff;font-weight:900;font-size:0.88rem;">${grpTotalAmt.toFixed(2)} د.أ</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:${grpWds.length||!isClosed?'10px':'0'};">
            <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:7px;text-align:center;">
              <div style="font-size:0.6rem;color:rgba(255,255,255,0.75);margin-bottom:2px;">💰 قابل للسحب</div>
              <div style="font-weight:800;color:#fff;font-size:0.9rem;">${grpEligible.toFixed(2)}</div>
            </div>
            <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:7px;text-align:center;">
              <div style="font-size:0.6rem;color:rgba(255,255,255,0.75);margin-bottom:2px;">💸 مسحوب</div>
              <div style="font-weight:800;color:#fca5a5;font-size:0.9rem;">${grpWdTotal.toFixed(2)}</div>
            </div>
            <div style="background:${grpBalance>=0?'rgba(255,255,255,0.25)':'rgba(220,38,38,0.4)'};border-radius:8px;padding:7px;text-align:center;">
              <div style="font-size:0.6rem;color:${grpBalColor};margin-bottom:2px;">📊 الرصيد الكلي</div>
              <div style="font-weight:900;color:${grpBalColor};font-size:0.92rem;">${grpBalance.toFixed(2)}</div>
            </div>
          </div>
          ${grpWdRows?`<div style="margin-bottom:8px;">${grpWdRows}</div>`:''}
          ${!isClosed?`<button onclick="showAddWithdrawalModalForGroup('${safeGrpName}')" style="width:100%;padding:9px;background:rgba(255,255,255,0.2);color:#fff;border:1.5px solid rgba(255,255,255,0.4);border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;">💸 إضافة مسحوب للمجموعة</button>`:''}
        </div>
        <div style="padding:8px 12px;background:#f3e8ff;border-top:2px solid #c4b5fd;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="font-size:0.72rem;font-weight:700;color:#5b21b6;">🗂 رصيد الحساب الكلي للمجموعة</div>
          <div style="display:flex;gap:10px;font-size:0.72rem;flex-wrap:wrap;">
            <span style="color:#dc2626;">مبيعات: <strong>${grpAcctOwed.toFixed(2)}</strong></span>
            <span style="color:#166534;">مدفوع: <strong>${grpAcctPaid.toFixed(2)}</strong></span>
            ${grpAcctDiscount>0?`<span style="color:#b45309;">🏷 خصومات: <strong>${grpAcctDiscount.toFixed(2)}</strong></span>`:''}
            ${grpAcctRefund>0?`<span style="color:#9d174d;">مرتجع: <strong>${grpAcctRefund.toFixed(2)}</strong></span>`:''}
            <span style="color:${grpAcctBal>0?'#92400e':grpAcctBal<0?'#166534':'#6b7280'};font-weight:800;">${grpAcctLabel}: ${Math.abs(grpAcctBal).toFixed(2)} د.أ</span>
          </div>
        </div>
        <div style="padding:8px 8px 4px;background:#faf5ff;">
          ${stores.map(s=>_storeCard(s,true,true)).join('')}
        </div>
      </div>`;
    }).join('');

    const ungroupedCards=ungroupedStores.map(s=>_storeCard(s,false,false)).join('');

    body.innerHTML+=`
      <div style="margin-top:16px;">
        <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
          <span>📦 طلبات التوصيل المُسلَّمة (${_opDayOrders.length})</span>
          <span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${_opDayOrders.reduce((s,o)=>s+Math.max(0,(o.netPrice!=null?o.netPrice:(o.totalPrice||0))-(o.deliveryFee||0)),0).toFixed(2)} د.أ</span>
        </div>
        ${groupCards}${ungroupedCards}
      </div>`;
    // orphan withdrawals (for stores not in orders) — split by type
    const orphanWds=_opWithdrawals.filter(w=>!orderStoreNames.has(w.storeName));
    if(orphanWds.length){
      const _oRow=(w,color,bg,border)=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ${border};gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:700;color:#1a3a2a;">${w.storeName||'—'}</div>
            ${w.notes?`<div style="font-size:0.73rem;color:#9ca3af;">${w.notes}</div>`:''}
            <div style="font-size:0.7rem;color:#9ca3af;">${w.date||''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span style="font-weight:900;color:${color};font-size:0.88rem;">${(w.amount||0).toFixed(2)} <span style="font-size:0.65rem;">د.أ</span></span>
            ${!isClosed?`<button onclick="deleteOperatorWithdrawal('${w.id}')" style="background:${bg};color:${color};border:none;border-radius:6px;width:22px;height:22px;font-size:0.8rem;cursor:pointer;font-weight:900;line-height:1;">×</button>`:''}
          </div>
        </div>`;
      const orphanStore=orphanWds.filter(w=>w.storeId);
      const orphanGeneral=orphanWds.filter(w=>!w.storeId);
      if(orphanStore.length){
        const tot=orphanStore.reduce((s,w)=>s+(w.amount||0),0);
        body.innerHTML+=`
          <div style="margin-top:12px;">
            <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span>💰 دفعات مُستَلَمَة (${orphanStore.length})</span>
              <span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${tot.toFixed(2)} د.أ</span>
            </div>
            <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;overflow:hidden;">
              <div style="padding:4px 14px 8px;">${orphanStore.map(w=>_oRow(w,'#166534','#dcfce7','#86efac')).join('')}</div>
            </div>
          </div>`;
      }
      if(orphanGeneral.length){
        const tot=orphanGeneral.reduce((s,w)=>s+(w.amount||0),0);
        body.innerHTML+=`
          <div style="margin-top:12px;">
            <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span>💸 مسحوبات أخرى (${orphanGeneral.length})</span>
              <span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${tot.toFixed(2)} د.أ</span>
            </div>
            <div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:12px;overflow:hidden;">
              <div style="padding:4px 14px 8px;">${orphanGeneral.map(w=>_oRow(w,'#dc2626','#fee2e2','#fecaca')).join('')}</div>
            </div>
          </div>`;
      }
    }
  }

  // ===== Withdrawals section (no orders at all) =====
  if(!_opDayOrders.length&&(_opWithdrawals.length||!isClosed)){
    const storeWds=_opWithdrawals.filter(w=>w.storeId);
    const generalWds=_opWithdrawals.filter(w=>!w.storeId);
    const _wRow=(w,color,bg,border)=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ${border};gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.82rem;font-weight:700;color:#1a3a2a;">${w.storeName||'—'}</div>
          ${w.notes?`<div style="font-size:0.73rem;color:#9ca3af;">${w.notes}</div>`:''}
          <div style="font-size:0.7rem;color:#9ca3af;">${w.date||''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <div style="font-weight:900;color:${color};font-size:0.88rem;white-space:nowrap;">${(w.amount||0).toFixed(2)} <span style="font-size:0.65rem;">د.أ</span></div>
          ${!isClosed?`<button onclick="deleteOperatorWithdrawal('${w.id}')" style="background:${bg};color:${color};border:none;border-radius:6px;width:22px;height:22px;font-size:0.8rem;cursor:pointer;font-weight:900;line-height:1;" title="حذف">×</button>`:''}
        </div>
      </div>`;
    if(storeWds.length){
      const totS=storeWds.reduce((s,w)=>s+(w.amount||0),0);
      const sRows=storeWds.map(w=>_wRow(w,'#166534','#dcfce7','#86efac')).join('');
      body.innerHTML+=`
        <div style="margin-top:16px;">
          <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
            <span>💰 دفعات مُستَلَمَة (${storeWds.length})</span>
            <span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${totS.toFixed(2)} د.أ</span>
          </div>
          <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;overflow:hidden;">
            <div style="padding:4px 14px 8px;">${sRows}</div>
          </div>
        </div>`;
    }
    if(generalWds.length||!isClosed){
      const totG=generalWds.reduce((s,w)=>s+(w.amount||0),0);
      const gRows=generalWds.map(w=>_wRow(w,'#dc2626','#fee2e2','#fecaca')).join('');
      body.innerHTML+=`
        <div style="margin-top:16px;">
          <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
            <span>💸 مسحوبات (${generalWds.length})</span>
            ${generalWds.length?`<span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${totG.toFixed(2)} د.أ</span>`:''}
          </div>
          <div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:12px;overflow:hidden;">
            <div style="padding:4px 14px 8px;">${gRows||'<div style="text-align:center;color:#9ca3af;font-size:0.8rem;padding:14px;">لا توجد مسحوبات</div>'}</div>
            ${!isClosed?`<div style="padding:8px 14px;border-top:1px solid #fecaca;"><button onclick="showAddWithdrawalModal()" style="width:100%;padding:9px;background:#dc2626;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;">➕ إضافة مسحوب</button></div>`:''}
          </div>
        </div>`;
    }
  }

  // ===== Expenses section (list + inline form) =====
  if((_opDayExpenses&&_opDayExpenses.length)||!isClosed){
    const expRows=(_opDayExpenses||[]).map(e=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #fed7aa;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.82rem;font-weight:700;color:#9a3412;">
            <span style="background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:1px 6px;margin-left:6px;font-size:0.7rem;">${e.category||'أخرى'}</span>${parseFloat(e.amount||0).toFixed(2)} د.أ
          </div>
          ${e.notes?`<div style="font-size:0.73rem;color:#9ca3af;">${e.notes}</div>`:''}
          <div style="font-size:0.7rem;color:#9ca3af;">${e.date||''}</div>
        </div>
      </div>`).join('');
    body.innerHTML+=`
      <div style="margin-top:16px;">
        <div style="font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
          <span>🧾 مصاريف الفترة (${(_opDayExpenses||[]).length})</span>
          ${totExp>0?`<span style="background:#fff7ed;color:#9a3412;padding:2px 10px;border-radius:10px;font-size:0.78rem;">${totExp.toFixed(2)} د.أ</span>`:''}
        </div>
        <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;overflow:hidden;">
          <div style="padding:4px 14px 8px;">${expRows||'<div style="text-align:center;color:#9ca3af;font-size:0.8rem;padding:14px;">لا توجد مصاريف في هذه الفترة</div>'}</div>
          ${!isClosed?`<div style="padding:8px 14px;border-top:1px solid #fed7aa;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="number" id="inline_exp_amt" placeholder="مبلغ د.أ" min="0" step="0.01" style="width:100px;padding:7px 10px;border:1.5px solid #fed7aa;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.82rem;outline:none;background:#fff;">
              <select id="inline_exp_cat" style="padding:7px 8px;border:1.5px solid #fed7aa;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.8rem;outline:none;background:#fff;cursor:pointer;">
                <option value="">-- الفئة --</option>
                <option value="قهوة">☕ قهوة</option>
                <option value="مي">💧 مي</option>
                <option value="أكل">🍔 أكل</option>
                <option value="وقود">⛽ وقود</option>
                <option value="كهرباء">🔌 كهرباء</option>
                <option value="تغليف">📦 تغليف</option>
                <option value="صيانة">🛠️ صيانة</option>
                <option value="مواصلات">🚗 مواصلات</option>
                <option value="اتصالات">📱 اتصالات</option>
                <option value="إيجار">🏠 إيجار</option>
                <option value="أخرى">📌 أخرى</option>
              </select>
              <input type="text" id="inline_exp_notes" placeholder="تفاصيل (اختياري)" style="flex:1;min-width:100px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.8rem;outline:none;background:#fff;">
              <button onclick="addExpenseFromSession()" style="padding:7px 13px;background:#ea580c;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;white-space:nowrap;">➕ إضافة</button>
            </div>
          </div>`:''}
        </div>
      </div>`;
  }

  // ===== Net summary card =====
  const totSalesRevenue=_opDailySales.reduce((s,x)=>s+(x.sellPrice||0)*(x.qty||1),0);
  const totOrdersRevenue=_opDayOrders.reduce((s,o)=>s+Math.max(0,(o.netPrice!=null?o.netPrice:(o.totalPrice||0))-(o.deliveryFee||0)),0);
  const totWd=_opWithdrawals.reduce((s,w)=>s+(w.amount||0),0);
  const netFinal=totSalesRevenue+totOrdersRevenue-totWd-totExp;
  if(totSalesRevenue||totOrdersRevenue||totWd||totExp){
    body.innerHTML+=`
      <div style="background:linear-gradient(135deg,#0f2419,#1a3a2a);border-radius:14px;padding:16px;margin-top:18px;">
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.55);margin-bottom:10px;">📊 ملخص الكشف</div>
        <div style="display:flex;flex-direction:column;gap:7px;">
          ${totSalesRevenue?`<div style="display:flex;justify-content:space-between;font-size:0.82rem;"><span style="color:rgba(255,255,255,0.7);">💰 إيرادات المبيعات</span><span style="color:#a7f3d0;font-weight:700;">+ ${totSalesRevenue.toFixed(2)} د.أ</span></div>`:''}
          ${totOrdersRevenue?`<div style="display:flex;justify-content:space-between;font-size:0.82rem;"><span style="color:rgba(255,255,255,0.7);">📦 إيرادات التوصيل</span><span style="color:#a7f3d0;font-weight:700;">+ ${totOrdersRevenue.toFixed(2)} د.أ</span></div>`:''}
          ${totWd?`<div style="display:flex;justify-content:space-between;font-size:0.82rem;"><span style="color:rgba(255,255,255,0.7);">💸 مسحوبات</span><span style="color:#fca5a5;font-weight:700;">− ${totWd.toFixed(2)} د.أ</span></div>`:''}
          ${totExp?`<div style="display:flex;justify-content:space-between;font-size:0.82rem;"><span style="color:rgba(255,255,255,0.7);">🧾 مصاريف</span><span style="color:#fde68a;font-weight:700;">− ${totExp.toFixed(2)} د.أ</span></div>`:''}
          <div style="border-top:1px solid rgba(255,255,255,0.2);padding-top:9px;display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#fff;font-weight:800;font-size:0.9rem;">💵 الصافي الكلي</span>
            <span style="font-size:1.2rem;font-weight:900;color:${netFinal>=0?'#86efac':'#fca5a5'};">${netFinal.toFixed(2)} د.أ</span>
          </div>
        </div>
      </div>`;
  }

  // Action buttons
  const printBtn=`<button onclick="printOperatorDay()" style="flex:1;min-width:100px;padding:12px;background:#1e40af;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">🖨️ طباعة</button>`;
  const waBtn=`<button onclick="whatsappOperatorDay()" style="flex:1;min-width:100px;padding:12px;background:#25D366;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">📱 واتساب</button>`;
  if(!isClosed){
    const editDateBtn=`<button onclick="editSessionStartDate()" style="flex:1;min-width:100px;padding:12px;background:#0369a1;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">📅 تعديل تاريخ البداية</button>`;
    const deliverRepsBtn=`<button onclick="fetchRepDeliveries(this)" style="flex:1;min-width:100px;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">✅ تسليم</button>`;
    const deleteSessionBtn=`<button onclick="deleteCurrentSession()" style="flex:1;min-width:100px;padding:12px;background:#6b7280;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">🗑️ حذف الكشف</button>`;
    actionsWrap.innerHTML=`<button onclick="closeOperatorSession()" style="flex:1;min-width:100px;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">🔒 غلق الكشف</button>${deliverRepsBtn}${deleteSessionBtn}${editDateBtn}${printBtn}${waBtn}`;
  } else {
    actionsWrap.innerHTML=`<button onclick="openNewSession()" style="flex:1;min-width:100px;padding:12px;background:var(--green-dark);color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">➕ فتح كشف جديد</button>${printBtn}${waBtn}`;
  }
}

async function removeOrderFromStatement(orderId){
  if(!confirm('إزالة هذا الطلب من الكشف؟')) return;
  try{
    await db.collection('employee_orders').doc(orderId).update({
      deliveredDate:firebase.firestore.FieldValue.delete()
    });
    _opDayOrders=_opDayOrders.filter(o=>o.id!==orderId);
    renderOperatorDailyView();
  }catch(e){toast('❌ '+e.message);}
}

async function fetchRepDeliveries(btn){
  if(!_opCurrentSession){toast('⚠️ لا يوجد كشف مفتوح');return;}
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري الجلب...';}
  try{
    const from=_opCurrentSession.openedDate;
    const to=_opCurrentSession.closedDate||jordanDateStr();
    const fromTs=firebase.firestore.Timestamp.fromDate(new Date(from+'T00:00:00'));
    const toTs=firebase.firestore.Timestamp.fromDate(new Date(to+'T23:59:59'));

    // Two queries: by deliveredDate range AND by updatedAt range (catch old orders without deliveredDate)
    const [snap1,snap2]=await Promise.all([
      db.collection('employee_orders').where('deliveredDate','>=',from).where('deliveredDate','<=',to).get(),
      db.collection('employee_orders').where('updatedAt','>=',fromTs).where('updatedAt','<=',toTs).get()
    ]);

    const map={};
    snap1.docs.forEach(d=>{const o={id:d.id,...d.data()};if(o.status==='delivered') map[o.id]=o;});
    snap2.docs.forEach(d=>{const o={id:d.id,...d.data()};if(o.status==='delivered'&&!o.deliveredDate) map[o.id]=o;});
    const allDelivered=Object.values(map);

    if(!allDelivered.length){toast('لا توجد تسليمات في هذه الفترة');return;}

    // Sync each delivered order into operator_sales (same as admin flow)
    // syncOrderToAccounting already skips duplicates (checks fromOrderId)
    let synced=0;
    for(const order of allDelivered){
      try{
        await syncOrderToAccounting(order.id,order,order.deliveredDate||jordanDateStr(),true,_opCurrentSession.id);
        synced++;
      }catch(e){console.error('fetchRepDeliveries sync error:',order.id,e);}
    }

    toast('✅ تم مزامنة '+synced+' طلب مع الكشف');
    // Reload statement fully so _opDailySales picks up the new operator_sales records
    await _loadOpSessionData();
  }catch(e){toast('❌ '+e.message);}
  finally{if(btn){btn.disabled=false;btn.textContent='🚚 جلب تسليمات المناديب';}}
}
async function editSessionStartDate(){
  if(!_opCurrentSession||_opCurrentSession.status==='closed') return;
  const current=_opCurrentSession.openedDate;
  const newDate=prompt(`تعديل تاريخ بداية الكشف (الحالي: ${current})\nأدخل التاريخ بصيغة YYYY-MM-DD:`,current);
  if(!newDate||newDate===current) return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){toast('❌ صيغة التاريخ غلط، استخدم: YYYY-MM-DD');return;}
  try{
    await db.collection('operator_sessions').doc(_opCurrentSession.id).update({openedDate:newDate});
    _opCurrentSession.openedDate=newDate;
    toast('✅ تم تعديل تاريخ البداية');
    await _loadOpSessionData();
  }catch(e){toast('❌ '+e.message);}
}
function showAddWithdrawalModal(){
  if(!_opCurrentSession||_opCurrentSession.status==='closed'){toast('⚠️ لا يوجد كشف مفتوح');return;}
  if(!_opStoresList.length){toast('⚠️ جاري تحميل المتاجر...');loadOpStores().then(()=>showAddWithdrawalModal());return;}
  const storeOptions=_opStoresList.map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
  const today=jordanDateStr();
  const overlay=document.createElement('div');
  overlay.id='withdrawal_modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML=`
    <div style="background:#fff;border-radius:16px;padding:22px;width:100%;max-width:400px;font-family:'Tajawal',sans-serif;">
      <div style="font-weight:800;font-size:1.05rem;color:#1a3a2a;margin-bottom:18px;text-align:center;">💸 تسجيل مسحوب</div>
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">المتجر</label>
      <select id="wd_store" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;">
        <option value="">— اختر المتجر —</option>${storeOptions}
      </select>
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">المبلغ (د.أ)</label>
      <input id="wd_amount" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">التاريخ</label>
      <input id="wd_date" type="date" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">ملاحظة (اختياري)</label>
      <input id="wd_notes" type="text" placeholder="..." style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:18px;box-sizing:border-box;">
      <div style="display:flex;gap:10px;">
        <button onclick="saveOperatorWithdrawal()" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">💸 حفظ</button>
        <button onclick="document.getElementById('withdrawal_modal').remove()" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay) overlay.remove();});
}

async function saveOperatorWithdrawal(){
  const storeEl=document.getElementById('wd_store');
  const amountEl=document.getElementById('wd_amount');
  const dateEl=document.getElementById('wd_date');
  const notesEl=document.getElementById('wd_notes');
  const storeId=storeEl?.value;
  const storeName=storeEl?.options[storeEl.selectedIndex]?.dataset?.name||'';
  const amount=parseFloat(amountEl?.value||'0');
  const date=dateEl?.value||jordanDateStr();
  const notes=notesEl?.value?.trim()||'';
  if(!storeId){toast('⚠️ اختر المتجر');return;}
  if(!amount||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    const batch=db.batch();
    // Save to operator_withdrawals (for statement)
    const wRef=db.collection('operator_withdrawals').doc();
    batch.set(wRef,{
      sessionId:_opCurrentSession.id,
      storeId,storeName,amount,date,notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const pmtRef2=db.collection('operator_store_payments').doc();
    batch.set(pmtRef2,{
      storeId,storeName,amount,date,
      notes:(notes||''),
      sourceWithdrawalId:wRef.id,
      sessionId:_opCurrentSession.id,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    _opAcctPaid[storeId]=(_opAcctPaid[storeId]||0)+amount;
    document.getElementById('withdrawal_modal')?.remove();
    toast('✅ تم تسجيل المسحوب في الكشف ورصيد المحل');
    const wSnap=await db.collection('operator_withdrawals').where('sessionId','==',_opCurrentSession.id).get();
    _opWithdrawals=wSnap.docs.map(d=>({id:d.id,...d.data()}));
    renderOperatorDailyView();
  }catch(e){toast('❌ '+e.message);}
}

async function deleteOperatorWithdrawal(wid){
  if(!confirm('حذف هذا المسحوب؟')) return;
  try{
    const [balSnap,pmtSnap]=await Promise.all([
      db.collection('operator_store_balance').where('sourceWithdrawalId','==',wid).limit(1).get(),
      db.collection('operator_store_payments').where('sourceWithdrawalId','==',wid).limit(1).get()
    ]);
    const batch=db.batch();
    batch.delete(db.collection('operator_withdrawals').doc(wid));
    if(!balSnap.empty) batch.delete(balSnap.docs[0].ref);
    if(!pmtSnap.empty) batch.delete(pmtSnap.docs[0].ref);
    await batch.commit();
    const wd=_opWithdrawals.find(w=>w.id===wid);
    if(wd?.storeId&&wd.withdrawalType!=='withdrawal') _opAcctPaid[wd.storeId]=Math.max(0,(_opAcctPaid[wd.storeId]||0)-(wd.amount||0));
    _opWithdrawals=_opWithdrawals.filter(w=>w.id!==wid);
    renderOperatorDailyView();
    toast('✅ تم حذف المسحوب');
  }catch(e){toast('❌ '+e.message);}
}

function showAddWithdrawalModalForGroup(groupName,type='withdrawal'){
  if(!_opCurrentSession||_opCurrentSession.status==='closed'){toast('⚠️ لا يوجد كشف مفتوح');return;}
  const today=jordanDateStr();
  const isPayment=type==='payment';
  const overlay=document.createElement('div');
  overlay.id='withdrawal_modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML=`
    <div style="background:#fff;border-radius:16px;padding:22px;width:100%;max-width:400px;font-family:'Tajawal',sans-serif;">
      <div style="font-weight:800;font-size:1.05rem;color:${isPayment?'#dc2626':'#5b21b6'};margin-bottom:4px;text-align:center;">${isPayment?'💳 دفعة مجتمع':'👥 مسحوب مجتمع'}</div>
      <div style="text-align:center;font-size:0.8rem;color:${isPayment?'#ef4444':'#7c3aed'};margin-bottom:16px;">${groupName}</div>
      <input type="hidden" id="wd_group_name_fixed" value="${groupName}">
      <input type="hidden" id="wd_withdrawal_type" value="${type}">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">المبلغ (د.أ)</label>
      <input id="wd_amount" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">التاريخ</label>
      <input id="wd_date" type="date" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">ملاحظة (اختياري)</label>
      <input id="wd_notes" type="text" placeholder="..." style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:18px;box-sizing:border-box;">
      <div style="display:flex;gap:10px;">
        <button onclick="saveGroupWithdrawal()" style="flex:1;padding:12px;background:${isPayment?'#dc2626':'#7c3aed'};color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">${isPayment?'💳 حفظ الدفعة':'💸 حفظ'}</button>
        <button onclick="document.getElementById('withdrawal_modal').remove()" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay) overlay.remove();});
}

async function saveGroupWithdrawal(){
  const groupName=document.getElementById('wd_group_name_fixed')?.value||'';
  const withdrawalType=document.getElementById('wd_withdrawal_type')?.value||'withdrawal';
  const amount=parseFloat(document.getElementById('wd_amount')?.value||'0');
  const date=document.getElementById('wd_date')?.value||jordanDateStr();
  const notes=(document.getElementById('wd_notes')?.value||'').trim();
  if(!groupName){toast('⚠️ خطأ: لا يوجد مجموعة');return;}
  if(!amount||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    const grpStoreId='__grp__'+groupName;
    const batch=db.batch();
    const wRef=db.collection('operator_withdrawals').doc();
    batch.set(wRef,{
      sessionId:_opCurrentSession.id,
      groupName, storeName:groupName,
      storeId:grpStoreId,
      withdrawalType,
      amount, date, notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const pmtRef=db.collection('operator_store_payments').doc();
    batch.set(pmtRef,{
      storeId:grpStoreId,storeName:groupName,amount,date,
      withdrawalType,
      notes:(notes||''),
      sourceWithdrawalId:wRef.id,
      sessionId:_opCurrentSession.id,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    if(withdrawalType==='payment') _opAcctPaid[grpStoreId]=(_opAcctPaid[grpStoreId]||0)+amount;
    document.getElementById('withdrawal_modal')?.remove();
    toast(withdrawalType==='payment'?'✅ تم تسجيل الدفعة للمجموعة':'✅ تم تسجيل المسحوب للمجموعة');
    const wSnap=await db.collection('operator_withdrawals').where('sessionId','==',_opCurrentSession.id).get();
    _opWithdrawals=wSnap.docs.map(d=>({id:d.id,...d.data()}));
    renderOperatorDailyView();
  }catch(e){toast('❌ '+e.message);}
}

function showAddWithdrawalModalForStore(storeId, storeName, type='withdrawal'){
  if(!_opCurrentSession||_opCurrentSession.status==='closed'){toast('⚠️ لا يوجد كشف مفتوح');return;}
  const today=jordanDateStr();
  const isPayment=type==='payment';
  const overlay=document.createElement('div');
  overlay.id='withdrawal_modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML=`
    <div style="background:#fff;border-radius:16px;padding:22px;width:100%;max-width:400px;font-family:'Tajawal',sans-serif;">
      <div style="font-weight:800;font-size:1.05rem;color:#1a3a2a;margin-bottom:18px;text-align:center;">${isPayment?'💳 دفعة':'💸 مسحوب'} — ${storeName}</div>
      <input type="hidden" id="wd_store_id_fixed" value="${storeId}">
      <input type="hidden" id="wd_store_name_fixed" value="${storeName}">
      <input type="hidden" id="wd_withdrawal_type" value="${type}">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">المبلغ (د.أ)</label>
      <input id="wd_amount" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">التاريخ</label>
      <input id="wd_date" type="date" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:12px;box-sizing:border-box;">
      <label style="font-size:0.82rem;font-weight:700;color:#374151;display:block;margin-bottom:4px;">ملاحظة (اختياري)</label>
      <input id="wd_notes" type="text" placeholder="..." style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;margin-bottom:18px;box-sizing:border-box;">
      <div style="display:flex;gap:10px;">
        <button onclick="saveOperatorWithdrawalFixed()" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">${isPayment?'💳 حفظ الدفعة':'💸 حفظ'}</button>
        <button onclick="document.getElementById('withdrawal_modal').remove()" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay) overlay.remove();});
}

async function saveOperatorWithdrawalFixed(){
  const storeId=document.getElementById('wd_store_id_fixed')?.value||'';
  const storeName=document.getElementById('wd_store_name_fixed')?.value||'';
  const withdrawalType=document.getElementById('wd_withdrawal_type')?.value||'withdrawal';
  const amount=parseFloat(document.getElementById('wd_amount')?.value||'0');
  const date=document.getElementById('wd_date')?.value||jordanDateStr();
  const notes=(document.getElementById('wd_notes')?.value||'').trim();
  if(!storeName){toast('⚠️ خطأ: لا يوجد متجر');return;}
  if(!amount||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    const batch=db.batch();
    const wRef=db.collection('operator_withdrawals').doc();
    batch.set(wRef,{
      sessionId:_opCurrentSession.id,
      storeId,storeName,amount,date,notes,
      withdrawalType,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const pmtRef=db.collection('operator_store_payments').doc();
    batch.set(pmtRef,{
      storeId,storeName,amount,date,
      withdrawalType,
      notes:(notes||''),
      sourceWithdrawalId:wRef.id,
      sessionId:_opCurrentSession.id,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    if(withdrawalType==='payment') _opAcctPaid[storeId]=(_opAcctPaid[storeId]||0)+amount;
    document.getElementById('withdrawal_modal')?.remove();
    toast(withdrawalType==='payment'?'✅ تم تسجيل الدفعة':'✅ تم تسجيل المسحوب');
    const wSnap=await db.collection('operator_withdrawals').where('sessionId','==',_opCurrentSession.id).get();
    _opWithdrawals=wSnap.docs.map(d=>({id:d.id,...d.data()}));
    renderOperatorDailyView();
  }catch(e){toast('❌ '+e.message);}
}

async function closeOperatorDay(){await closeOperatorSession();}
async function closeOperatorSession(){
  if(!_opCurrentSession||_opCurrentSession.status==='closed'){toast('⚠️ لا يوجد كشف مفتوح');return;}
  const today=jordanDateStr();
  if(!confirm(`إغلاق الكشف؟\nالفترة: من ${_fmtDate(_opCurrentSession.openedDate)} إلى ${_fmtDate(today)}`)) return;
  try{
    await db.collection('operator_sessions').doc(_opCurrentSession.id).update({
      status:'closed',closedDate:today,closedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    _opCurrentSession={..._opCurrentSession,status:'closed',closedDate:today};
    toast('🔒 تم إغلاق الكشف');
    loadOpSessionStatus();
    _loadOpSessionData();
  }catch(e){toast('❌ خطأ في الإغلاق: '+e.message);}
}
async function deleteCurrentSession(){
  if(!_opCurrentSession){toast('⚠️ لا يوجد كشف مفتوح');return;}
  if(!confirm('⚠️ سيتم حذف هذا الكشف وكل مبيعاته نهائياً.\nهل أنت متأكد؟')) return;
  try{
    const sid=_opCurrentSession.id;
    const from=_opCurrentSession.openedDate;
    const to=jordanDateStr();
    // Delete operator_sales records for this session only
    const snap=await db.collection('operator_sales').where('sessionId','==',sid).get();
    const BATCH=400;
    for(let i=0;i<snap.docs.length;i+=BATCH){
      const b=db.batch();
      snap.docs.slice(i,i+BATCH).forEach(d=>b.delete(d.ref));
      await b.commit();
    }
    // Delete operator_withdrawals for this session
    const wSnap=await db.collection('operator_withdrawals').where('sessionId','==',sid).get();
    for(let i=0;i<wSnap.docs.length;i+=BATCH){
      const b=db.batch();
      wSnap.docs.slice(i,i+BATCH).forEach(d=>b.delete(d.ref));
      await b.commit();
    }
    // Delete the session itself
    await db.collection('operator_sessions').doc(sid).delete();
    _opCurrentSession=null;
    _opDailySales=[];
    _opDayOrders=[];
    _opWithdrawals=[];
    toast('✅ تم حذف الكشف');
    loadOpSessionStatus();
    _loadOpSessionData();
  }catch(e){toast('❌ '+e.message);}
}

async function openNewSession(){
  if(_opCurrentSession&&_opCurrentSession.status==='open'){
    if(!confirm('يوجد كشف مفتوح بالفعل. هل تريد إغلاقه وفتح كشف جديد؟'))return;
    await closeOperatorSession();
  }
  try{
    const today=jordanDateStr();
    // Retroactively stamp any untagged operator_sales records from the previous session
    // so they don't bleed into the new session
    if(_opCurrentSession){
      try{
        const prevFrom=_opCurrentSession.openedDate;
        const prevTo=_opCurrentSession.closedDate||today;
        const oldSnap=await db.collection('operator_sales').where('date','>=',prevFrom).where('date','<=',prevTo).get();
        const untagged=oldSnap.docs.filter(d=>!d.data().sessionId);
        if(untagged.length){
          const BATCH=400;
          for(let i=0;i<untagged.length;i+=BATCH){
            const b=db.batch();
            untagged.slice(i,i+BATCH).forEach(d=>b.update(d.ref,{sessionId:_opCurrentSession.id}));
            await b.commit();
          }
        }
      }catch(e){console.warn('stamp old records:',e);}
    }
    const ref=await db.collection('operator_sessions').add({
      status:'open',openedDate:today,closedDate:null,
      openedAt:firebase.firestore.FieldValue.serverTimestamp(),closedAt:null
    });
    _opCurrentSession={id:ref.id,status:'open',openedDate:today,closedDate:null};
    toast('✅ تم فتح كشف جديد');
    loadOpSessionStatus();
    _loadOpSessionData();
  }catch(e){toast('❌ خطأ: '+e.message);}
}

function _buildOpDayHTML(forPrint){
  const today=_opViewDate||_opToday();
  const byProd={};
  _opDailySales.forEach(s=>{
    const key=s.productName;
    if(!byProd[key]) byProd[key]={name:key,qty:0,raw:0,tree:0,machine:0,assembly:0,sell:0};
    byProd[key].qty+=s.qty||1;
    byProd[key].raw+=(s.rawMaterialCost||0)*(s.qty||1);
    byProd[key].tree+=(s.treeCost||0)*(s.qty||1);
    byProd[key].machine+=(s.machineWorkerWage||0)*(s.qty||1);
    byProd[key].assembly+=(s.assemblyWorkerWage||0)*(s.qty||1);
    byProd[key].sell+=(s.sellPrice||0)*(s.qty||1);
  });
  const prods=Object.values(byProd);
  const totRaw=prods.reduce((s,p)=>s+p.raw,0);
  const totTree=prods.reduce((s,p)=>s+p.tree,0);
  const totMachine=prods.reduce((s,p)=>s+p.machine,0);
  const totAssembly=prods.reduce((s,p)=>s+p.assembly,0);
  const totSell=prods.reduce((s,p)=>s+p.sell,0);
  const totCost=totRaw+totTree+totMachine+totAssembly;
  const totProfit=totSell-totCost;
  const isP=totProfit>=0;
  const rows=prods.map(p=>`<tr>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;">${p.name}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.qty}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#92400e;">${p.raw.toFixed(2)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#15803d;">${p.tree.toFixed(2)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#1e40af;">${p.machine.toFixed(2)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#7c3aed;">${p.assembly.toFixed(2)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:#166534;">${p.sell.toFixed(2)}</td>
    <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${(p.sell-(p.raw+p.tree+p.machine+p.assembly))>=0?'#166534':'#dc2626'};">${(p.sell-(p.raw+p.tree+p.machine+p.assembly)).toFixed(2)}</td>
  </tr>`).join('');
  const isClosed=_opDayRecord&&_opDayRecord.status==='closed';
  return {rows,totRaw,totTree,totMachine,totAssembly,totSell,totCost,totProfit,isP,today,isClosed,prods};
}

function printOperatorDay(){
  const d=_buildOpDayHTML(true);
  const html=`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
<title>حساب المشغل — ${d.today}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Tajawal',sans-serif;padding:30px;color:#1a1a1a;direction:rtl;}
h1{font-size:1.5rem;color:#1a3a2a;margin-bottom:2px;}
.meta{font-size:0.85rem;color:#6b7280;margin-bottom:18px;padding-bottom:8px;border-bottom:2px solid #1a3a2a;}
table{width:100%;border-collapse:collapse;margin-bottom:20px;}
thead th{background:#1a3a2a;color:#fff;padding:10px 8px;font-size:0.8rem;}
tfoot td{background:#f9fafb;font-weight:800;padding:8px;}
tbody tr:nth-child(even){background:#f9fafb;}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}
.box{border-radius:8px;padding:10px;text-align:center;}
.box .lbl{font-size:0.7rem;margin-bottom:3px;}
.box .val{font-weight:800;font-size:1rem;}
.total{display:flex;justify-content:space-between;padding:14px;border-radius:10px;font-size:1.1rem;font-weight:800;}
@media print{body{padding:10px;}}
</style></head><body>
<h1>👤 حساب المشغل</h1>
<div class="meta">التاريخ: ${d.today} | الحالة: ${d.isClosed?'🔒 مغلق':'🟢 مفتوح'} | عدد المبيعات: ${_opDailySales.length}</div>
<table>
<thead><tr>
  <th style="text-align:right;">المنتج</th><th>كمية</th>
  <th style="color:#fef3c7;">🧱 مواد</th><th style="color:#bbf7d0;">🌳 شجر</th><th style="color:#bfdbfe;">⚙️ ماكينة</th>
  <th style="color:#ddd6fe;">🔧 تركيب</th><th style="color:#bbf7d0;">💰 بيع</th>
  <th style="color:#d4a843;">💵 ربح</th>
</tr></thead>
<tbody>${d.rows}</tbody>
<tfoot><tr>
  <td style="padding:8px;">المجموع</td><td style="text-align:center;">${d.prods.reduce((s,p)=>s+p.qty,0)}</td>
  <td style="text-align:center;color:#92400e;">${d.totRaw.toFixed(2)}</td>
  <td style="text-align:center;color:#15803d;">${d.totTree.toFixed(2)}</td>
  <td style="text-align:center;color:#1e40af;">${d.totMachine.toFixed(2)}</td>
  <td style="text-align:center;color:#7c3aed;">${d.totAssembly.toFixed(2)}</td>
  <td style="text-align:center;color:#166534;">${d.totSell.toFixed(2)}</td>
  <td style="text-align:center;color:${d.isP?'#166534':'#dc2626'};">${d.totProfit.toFixed(2)}</td>
</tr></tfoot>
</table>
<div class="grid">
  <div class="box" style="background:#fefce8;"><div class="lbl" style="color:#92400e;">🧱 مواد خام</div><div class="val" style="color:#92400e;">${d.totRaw.toFixed(2)} د.أ</div></div>
  <div class="box" style="background:#f0fdf4;"><div class="lbl" style="color:#15803d;">🌳 تكلفة الشجر</div><div class="val" style="color:#15803d;">${d.totTree.toFixed(2)} د.أ</div></div>
  <div class="box" style="background:#eff6ff;"><div class="lbl" style="color:#1e40af;">⚙️ أجرة ماكينة</div><div class="val" style="color:#1e40af;">${d.totMachine.toFixed(2)} د.أ</div></div>
  <div class="box" style="background:#f5f3ff;"><div class="lbl" style="color:#7c3aed;">🔧 أجرة تركيب</div><div class="val" style="color:#7c3aed;">${d.totAssembly.toFixed(2)} د.أ</div></div>
</div>
<div class="total" style="background:${d.isP?'#dcfce7':'#fee2e2'};color:${d.isP?'#166534':'#991b1b'};">
  <div><div style="font-size:0.8rem;margin-bottom:4px;">إجمالي التكاليف: ${d.totCost.toFixed(2)} د.أ &nbsp;|&nbsp; إجمالي البيع: ${d.totSell.toFixed(2)} د.أ</div>
  <div>صافي ${d.isP?'الربح':'الخسارة'}: ${Math.abs(d.totProfit).toFixed(2)} د.أ ${d.isP?'✅':'⚠️'}</div></div>
</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;
  const win=window.open('','_blank');
  if(win){win.document.write(html);win.document.close();}
}

function whatsappOperatorDay(){
  const d=_buildOpDayHTML(false);
  let msg=`👤 حساب المشغل — ${d.today}\n`;
  msg+=d.isClosed?'🔒 مغلق\n':'🟢 مفتوح\n';
  msg+=`━━━━━━━━━━━━\n`;
  d.prods.forEach(p=>{
    const cost=p.raw+p.tree+p.machine+p.assembly;
    msg+=`📦 ${p.name} ×${p.qty}\n`;
    msg+=`  🧱 مواد: ${p.raw.toFixed(2)} | 🌳 شجر: ${p.tree.toFixed(2)} | ⚙️ ماكينة: ${p.machine.toFixed(2)} | 🔧 تركيب: ${p.assembly.toFixed(2)}\n`;
    msg+=`  💰 بيع: ${p.sell.toFixed(2)} | 💵 ربح: ${(p.sell-cost).toFixed(2)}\n`;
  });
  msg+=`━━━━━━━━━━━━\n`;
  msg+=`🧱 مجموع المواد: ${d.totRaw.toFixed(2)} د.أ\n`;
  msg+=`🌳 مجموع الشجر: ${d.totTree.toFixed(2)} د.أ\n`;
  msg+=`⚙️ مجموع الماكينة: ${d.totMachine.toFixed(2)} د.أ\n`;
  msg+=`🔧 مجموع التركيب: ${d.totAssembly.toFixed(2)} د.أ\n`;
  msg+=`💸 إجمالي التكاليف: ${d.totCost.toFixed(2)} د.أ\n`;
  msg+=`💰 إجمالي البيع: ${d.totSell.toFixed(2)} د.أ\n`;
  msg+=`${d.isP?'✅ صافي الربح':'⚠️ الخسارة'}: ${Math.abs(d.totProfit).toFixed(2)} د.أ`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

// ===== OPERATOR LEDGER (existing — kept as-is under "الكشف" sub-tab) =====
let _opChannels=[];
function getOpDate(){return document.getElementById('op_date').value||jordanDateStr();}
function _opDefaultChannels(){return [{name:'الموقع الإلكتروني',type:'site',items:[]}];}

async function loadOperatorLedger(){
  const date=getOpDate();
  try{
    const snap=await db.collection('operator_ledger').doc(date).get();
    if(snap.exists){
      const d=snap.data();
      _opChannels=d.channels||_opDefaultChannels();
      document.getElementById('op_operator_wage').value=d.operatorWage||'';
      document.getElementById('op_notes').value=d.notes||'';
    } else {
      _opChannels=_opDefaultChannels();
      document.getElementById('op_operator_wage').value='';
      document.getElementById('op_notes').value='';
    }
  }catch(e){ _opChannels=_opDefaultChannels(); }
  renderOpChannels();
  calcOpSummary();
}

function _opProdOptions(){
  return products.map(p=>`<option value="${p._docId||p.id}" data-price="${p.price||0}" data-wood="${p.woodCost||0}" data-worker="${p.workerWage||0}">${p.name}</option>`).join('');
}

function renderOpChannels(){
  const wrap=document.getElementById('op_channels_wrap');
  if(!wrap) return;
  const fld=(s,v)=>`style="flex:${s};padding:7px 8px;border:1.5px solid var(--border);border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.82rem;background:var(--card-bg);color:var(--text-dark);" value="${v}"`;
  wrap.innerHTML=_opChannels.map((ch,ci)=>{
    const isSite=ch.type==='site';
    const bgColor=isSite?'var(--green-dark)':'#1e40af';
    const rev=ch.items.reduce((s,it)=>s+(it.sellPrice||0)*(it.qty||0),0);
    const cost=ch.items.reduce((s,it)=>s+((it.woodCost||0)+(it.workerWage||0))*(it.qty||0),0);
    const profit=rev-cost;
    const rows=ch.items.length
      ? ch.items.map((it,ii)=>{
          const itRev=(it.sellPrice||0)*(it.qty||0);
          const itCost=((it.woodCost||0)+(it.workerWage||0))*(it.qty||0);
          const itProfit=itRev-itCost;
          return `<tr style="font-size:0.8rem;border-bottom:1px solid var(--border);">
            <td style="padding:6px 8px;color:var(--text-dark);">${it.productName}</td>
            <td style="padding:6px 8px;text-align:center;">${it.qty}</td>
            <td style="padding:6px 8px;text-align:center;color:#166534;font-weight:700;">${itRev.toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:center;color:#92400e;">${itCost.toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;color:${itProfit>=0?'#166534':'#991b1b'};">${itProfit.toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:center;"><button onclick="removeOpItem(${ci},${ii})" style="background:#fee2e2;color:#dc2626;border:none;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:0.75rem;">×</button></td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="6" style="text-align:center;padding:10px;font-size:0.8rem;color:#9ca3af;">لا يوجد مبيعات — اختر منتجاً وأضفه</td></tr>`;
    return `<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden;">
      <div style="background:${bgColor};padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:700;font-size:0.88rem;">${isSite?'🌐':'📱'} ${ch.name}</span>
        ${!isSite?`<button onclick="removeOpChannel(${ci})" style="background:rgba(255,255,255,0.2);color:#fff;border:none;width:26px;height:26px;border-radius:50%;cursor:pointer;">✕</button>`:''}
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:340px;">
          <thead><tr style="background:#f9fafb;font-size:0.73rem;color:var(--text-mid);">
            <th style="padding:6px 8px;text-align:right;font-weight:600;">المنتج</th>
            <th style="padding:6px 8px;font-weight:600;">كمية</th>
            <th style="padding:6px 8px;font-weight:600;">إيراد</th>
            <th style="padding:6px 8px;font-weight:600;">تكلفة</th>
            <th style="padding:6px 8px;font-weight:600;">ربح</th>
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:8px 10px;display:flex;gap:5px;border-top:1px solid var(--border);flex-wrap:wrap;">
        <select id="op_prod_${ci}" ${fld('2','')} style="flex:2;padding:7px 8px;border:1.5px solid var(--border);border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.82rem;background:var(--card-bg);color:var(--text-dark);">
          <option value="">اختر منتج...</option>${_opProdOptions()}
        </select>
        <input type="number" id="op_qty_${ci}" min="1" value="1" style="flex:0 0 54px;padding:7px 6px;border:1.5px solid var(--border);border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.82rem;background:var(--card-bg);color:var(--text-dark);">
        <button onclick="addOpItem(${ci})" style="padding:7px 14px;background:${bgColor};color:#fff;border:none;border-radius:7px;font-size:0.9rem;cursor:pointer;font-weight:700;">+</button>
      </div>
      <div style="padding:8px 14px;background:#f9fafb;display:flex;justify-content:space-around;font-size:0.8rem;border-top:1px solid var(--border);">
        <span>إيراد: <strong style="color:#166534;">${rev.toFixed(2)}</strong></span>
        <span>تكلفة: <strong style="color:#dc2626;">${cost.toFixed(2)}</strong></span>
        <span>ربح: <strong style="color:${profit>=0?'#166534':'#991b1b'};">${profit.toFixed(2)} ${profit>=0?'✅':'⚠️'}</strong></span>
      </div>
    </div>`;
  }).join('');
}

function addOpChannel(){
  const el=document.getElementById('op_new_channel_name');
  const name=el.value.trim();
  if(!name){toast('⚠️ أدخل اسم القناة');return;}
  _opChannels.push({name,type:'external',items:[]});
  el.value='';
  renderOpChannels(); calcOpSummary();
}
function removeOpChannel(ci){_opChannels.splice(ci,1);renderOpChannels();calcOpSummary();}

function addOpItem(ci){
  const sel=document.getElementById(`op_prod_${ci}`);
  const opt=sel.options[sel.selectedIndex];
  if(!sel.value){toast('⚠️ اختر منتجاً');return;}
  const qty=parseFloat(document.getElementById(`op_qty_${ci}`).value)||1;
  _opChannels[ci].items.push({
    productId:sel.value,
    productName:opt.text,
    qty,
    sellPrice:parseFloat(opt.dataset.price)||0,
    woodCost:parseFloat(opt.dataset.wood)||0,
    workerWage:parseFloat(opt.dataset.worker)||0
  });
  document.getElementById(`op_qty_${ci}`).value='1';
  renderOpChannels(); calcOpSummary();
}
function removeOpItem(ci,ii){_opChannels[ci].items.splice(ii,1);renderOpChannels();calcOpSummary();}

function calcOpSummary(){
  const opWage=parseFloat(document.getElementById('op_operator_wage')?.value)||0;
  let totalRev=0, totalCost=0;
  const chRows=_opChannels.map(ch=>{
    const rev=ch.items.reduce((s,it)=>s+(it.sellPrice||0)*(it.qty||0),0);
    const cost=ch.items.reduce((s,it)=>s+((it.woodCost||0)+(it.workerWage||0))*(it.qty||0),0);
    totalRev+=rev; totalCost+=cost;
    const p=rev-cost;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--border);font-size:0.83rem;">
      <span>${ch.type==='site'?'🌐':'📱'} ${ch.name}</span>
      <div style="display:flex;gap:10px;">
        <span>إيراد: <b style="color:#166534;">${rev.toFixed(2)}</b></span>
        <span>تكلفة: <b style="color:#dc2626;">${cost.toFixed(2)}</b></span>
        <span>ربح: <b style="color:${p>=0?'#166534':'#991b1b'};">${p.toFixed(2)}</b></span>
      </div>
    </div>`;
  }).join('');
  totalCost+=opWage;
  const net=totalRev-totalCost;
  const isP=net>=0;
  document.getElementById('op_summary').innerHTML=`
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-top:4px;">
      <div style="background:${isP?'var(--green-dark)':'#991b1b'};padding:12px 16px;color:#fff;font-weight:700;font-size:0.9rem;">📊 كشف يوم ${getOpDate()}</div>
      <div style="padding:16px;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-mid);letter-spacing:1px;margin-bottom:8px;">تفصيل القنوات</div>
        ${chRows||'<div style="font-size:0.82rem;color:#9ca3af;">لا توجد قنوات بعد</div>'}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
          <div style="background:#f0fdf4;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.72rem;color:#166534;margin-bottom:2px;">إجمالي الإيرادات</div>
            <div style="font-size:1.1rem;font-weight:800;color:#166534;">${totalRev.toFixed(2)} د.أ</div>
          </div>
          <div style="background:#fef2f2;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.72rem;color:#dc2626;margin-bottom:2px;">إجمالي التكاليف</div>
            <div style="font-size:1.1rem;font-weight:800;color:#dc2626;">${totalCost.toFixed(2)} د.أ</div>
          </div>
        </div>
        ${opWage?`<div style="font-size:0.76rem;color:#7c3aed;margin-top:4px;text-align:center;">* شامل أجرة المشغل: ${opWage.toFixed(2)} د.أ</div>`:''}
        <div style="margin-top:12px;background:${isP?'#dcfce7':'#fee2e2'};border-radius:12px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:800;color:${isP?'#166534':'#991b1b'};font-size:0.95rem;">صافي ${isP?'الربح':'الخسارة'}</span>
          <span style="font-weight:800;color:${isP?'#166534':'#991b1b'};font-size:1.3rem;">${Math.abs(net).toFixed(2)} د.أ ${isP?'✅':'⚠️'}</span>
        </div>
      </div>
    </div>`;
}

async function saveOperatorLedger(){
  const date=getOpDate();
  const opWage=parseFloat(document.getElementById('op_operator_wage').value)||0;
  const notes=document.getElementById('op_notes').value.trim();
  try{
    await db.collection('operator_ledger').doc(date).set({
      date,channels:_opChannels,operatorWage:opWage,notes,
      savedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم حفظ الكشف');
  }catch(e){ toast('❌ خطأ في الحفظ'); }
}

function shareOperatorReport(){
  const opWage=parseFloat(document.getElementById('op_operator_wage')?.value)||0;
  let totalRev=0,totalCost=0;
  let msg=`📊 كشف حساب يوم ${getOpDate()}\n━━━━━━━━━━━━\n`;
  _opChannels.forEach(ch=>{
    const rev=ch.items.reduce((s,it)=>s+(it.sellPrice||0)*(it.qty||0),0);
    const cost=ch.items.reduce((s,it)=>s+((it.woodCost||0)+(it.workerWage||0))*(it.qty||0),0);
    totalRev+=rev; totalCost+=cost;
    msg+=`${ch.type==='site'?'🌐':'📱'} ${ch.name}:\n`;
    ch.items.forEach(it=>{
      const itp=(it.sellPrice-(it.woodCost||0)-(it.workerWage||0))*it.qty;
      msg+=`  • ${it.productName} ×${it.qty} | إيراد: ${(it.sellPrice*it.qty).toFixed(2)} | ربح: ${itp.toFixed(2)}\n`;
    });
    msg+=`  ↳ ربح القناة: ${(rev-cost).toFixed(2)} د.أ\n\n`;
  });
  totalCost+=opWage;
  const net=totalRev-totalCost;
  msg+=`━━━━━━━━━━━━\n💰 إجمالي الإيرادات: ${totalRev.toFixed(2)} د.أ\n`;
  msg+=`💸 إجمالي التكاليف: ${totalCost.toFixed(2)} د.أ\n`;
  if(opWage) msg+=`  (شامل أجرة المشغل: ${opWage.toFixed(2)} د.أ)\n`;
  msg+=`${net>=0?'✅ صافي الربح':'⚠️ الخسارة'}: ${Math.abs(net).toFixed(2)} د.أ`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
}

// ===== VISITOR TRACKING =====
async function trackVisit(){
  try{
    const today=jordanDateStr();
    const ref=db.collection('settings').doc('visitors');
    const snap=await ref.get();
    const existing=snap.exists?snap.data():{};
    const inc=firebase.firestore.FieldValue.increment(1);
    const update={total:inc,showPublic:existing.showPublic||false};
    if(existing.todayDate===today){
      update.today=inc;
    } else {
      update.today=1;
      update.todayDate=today;
    }
    await ref.set(update,{merge:true});
    if(existing.showPublic){
      const total=(existing.total||0)+1;
      document.getElementById('publicVisitorCount').textContent=total.toLocaleString('ar');
      document.getElementById('visitorCountWidget').style.display='block';
    }
  }catch(e){}
}

async function loadVisitorStats(){
  try{
    const snap=await db.collection('settings').doc('visitors').get();
    const d=snap.exists?snap.data():{};
    document.getElementById('stat-visitors-total').textContent=(d.total||0).toLocaleString('ar');
    document.getElementById('stat-visitors-today').textContent=(d.today||0).toLocaleString('ar');
    const isOn=d.showPublic||false;
    const toggle=document.getElementById('visitorToggle');
    const thumb=document.getElementById('visitorToggleThumb');
    if(toggle) toggle.style.background=isOn?'#16a34a':'#d1d5db';
    if(thumb) thumb.style.right=isOn?'2px':'20px';
  }catch(e){}
}

async function toggleVisitorPublic(){
  try{
    const snap=await db.collection('settings').doc('visitors').get();
    const current=(snap.exists&&snap.data().showPublic)||false;
    const newVal=!current;
    await db.collection('settings').doc('visitors').set({showPublic:newVal},{merge:true});
    const toggle=document.getElementById('visitorToggle');
    const thumb=document.getElementById('visitorToggleThumb');
    toggle.style.background=newVal?'#16a34a':'#d1d5db';
    thumb.style.right=newVal?'2px':'20px';
    const widget=document.getElementById('visitorCountWidget');
    if(newVal&&snap.exists){
      document.getElementById('publicVisitorCount').textContent=(snap.data().total||0).toLocaleString('ar');
      widget.style.display='block';
    } else {
      widget.style.display='none';
    }
    toast(newVal?'✅ سيظهر عداد الزيارات للزبائن':'✅ تم إخفاء العداد عن الزبائن');
  }catch(e){ toast('❌ خطأ'); }
}

async function loadStats(){
  try{
    const snap = await db.collection('orders').get();
    const orders = snap.docs.map(d=>({...d.data(),id:d.id}));
    const today = new Date().toDateString();
    
    let total = 0, todayCount = 0, deliveredCount = 0;
    const productSales = {};
    
    orders.forEach(o=>{
      const amount = parseFloat((o.total||'0').toString().replace(/[^0-9.]/g,''))||0;
      total += amount;
      if(new Date(o.createdAt?.toDate?.() || o.date).toDateString()===today) todayCount++;
      if(o.status==='تم التسليم') deliveredCount++;
      (o.items||[]).forEach(item=>{
        productSales[item.name]=(productSales[item.name]||0)+item.qty;
      });
    });
    
    document.getElementById('stat-total').textContent = total.toFixed(2);
    document.getElementById('stat-count').textContent = orders.length;
    document.getElementById('stat-today').textContent = todayCount;
    document.getElementById('stat-delivered').textContent = deliveredCount;
    
    const topProducts = Object.entries(productSales).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topEl = document.getElementById('stat-top-products');
    if(topProducts.length){
      topEl.innerHTML = topProducts.map(([name,qty],i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;">
          <span style="font-size:0.85rem;">${i+1}. ${name}</span>
          <span style="font-weight:700;color:var(--green-dark);">${qty} مبيعة</span>
        </div>
      `).join('');
    } else {
      topEl.innerHTML = '<div class="empty-msg">لا توجد طلبات بعد</div>';
    }
  }catch(e){console.log('Stats error:',e);}
}


// Badge settings
let badgeSettings = {bronze:1, silver:3, gold:7, vip:15};

async function loadBadgeSettings(){
  try{
    const doc = await db.collection('settings').doc('badges').get();
    if(doc.exists) badgeSettings = {...badgeSettings, ...doc.data()};
    document.getElementById('badge-bronze').value = badgeSettings.bronze;
    document.getElementById('badge-silver').value = badgeSettings.silver;
    document.getElementById('badge-gold').value = badgeSettings.gold;
    document.getElementById('badge-vip').value = badgeSettings.vip;
  }catch(e){}
}

async function saveBadgeSettings(){
  badgeSettings = {
    bronze: parseInt(document.getElementById('badge-bronze').value)||1,
    silver: parseInt(document.getElementById('badge-silver').value)||3,
    gold: parseInt(document.getElementById('badge-gold').value)||7,
    vip: parseInt(document.getElementById('badge-vip').value)||15,
  };
  await db.collection('settings').doc('badges').set(badgeSettings);
  toast('تم حفظ إعدادات الشارات ✅');
}

function getUserBadge(orderCount){
  if(orderCount >= badgeSettings.vip) return {label:'💎 VIP', bg:'linear-gradient(135deg,#667eea,#764ba2)', color:'#fff'};
  if(orderCount >= badgeSettings.gold) return {label:'🥇 Gold', bg:'linear-gradient(135deg,#f7971e,#ffd200)', color:'#7a4f00'};
  if(orderCount >= badgeSettings.silver) return {label:'🥈 Silver', bg:'linear-gradient(135deg,#bdc3c7,#8e9eab)', color:'#fff'};
  if(orderCount >= badgeSettings.bronze) return {label:'🥉 Bronze', bg:'#cd7f32', color:'#fff'};
  return null;
}

async function deleteOrder(orderId){
  if(!confirm('هل أنت متأكد من حذف هذا الطلب؟')) return;
  try{
    await db.collection('orders').doc(orderId).delete();
    toast('تم حذف الطلب');
    renderOrders();
  }catch(e){
    toast('حدث خطأ في الحذف');
  }
}

async function updateOrderStatus(orderId, newStatus, cancelReason=''){
  const updateData={status:newStatus};
  if(cancelReason) updateData.cancelReason=cancelReason;
  if(newStatus!=='ملغي') updateData.cancelReason='';
  await db.collection('orders').doc(String(orderId)).update(updateData);
  toast('✅ تم تحديث حالة الطلب');
  renderOrders();
  if(newStatus==='ملغي') return;
  const snap=await db.collection('orders').doc(String(orderId)).get();
  const order=snap.data();
  if(!order||!order.phone) return;
  const statusMsgs={
    'جديد':'📋 تم استلام طلبك وسيتم مراجعته قريباً.',
    'قيد التجهيز':'⚙️ طلبك الآن قيد التجهيز والتحضير.',
    'بالطريق':'🚚 طلبك في الطريق إليك! سيصلك قريباً.',
    'تم التسليم':'✅ تم توصيل طلبك بنجاح! نشكر ثقتك بنا 🌿'
  };
  const msg=`🌿 *الكسواني روزميري*\n\nأهلاً ${order.name}،\n\n${statusMsgs[newStatus]}\n\n📦 رقم طلبك: ${order.orderNum||'#'+String(order.id).slice(-6)}\n💰 الإجمالي: ${order.total}\n\nللاستفسار تواصل معنا 🙏`;
  const phone=order.phone.replace(/[^0-9]/g,'');
  const intlPhone=phone.startsWith('0')?'962'+phone.slice(1):phone;
  const waUrl=`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
  showWANotifModal(order.name, newStatus, waUrl);
}

function showWANotifModal(name, status, waUrl){
  const statusLabels={
    'جديد':'📋 استلام الطلب',
    'قيد التجهيز':'⚙️ قيد التجهيز',
    'بالطريق':'🚚 في الطريق',
    'تم التسليم':'✅ تم التسليم'
  };
  document.getElementById('waNotifName').textContent=name;
  document.getElementById('waNotifStatus').textContent=statusLabels[status]||status;
  document.getElementById('waNotifSendBtn').onclick=()=>{window.open(waUrl,'_blank');closeWANotifModal();};
  document.getElementById('waNotifOverlay').style.display='flex';
}
function closeWANotifModal(){document.getElementById('waNotifOverlay').style.display='none';}

let _cancelTargetOrderId=null;

function openCancelDialog(orderId){
  _cancelTargetOrderId=orderId;
  document.getElementById('cancelReasonInput').value='';
  document.querySelectorAll('.cancel-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  const overlay=document.getElementById('cancelDialogOverlay');
  overlay.style.display='flex';
}

function closeCancelDialog(){
  document.getElementById('cancelDialogOverlay').style.display='none';
  _cancelTargetOrderId=null;
}

function selectCancelReason(btn, reason){
  document.querySelectorAll('.cancel-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  btn.style.borderColor='#dc2626';btn.style.background='#fee2e2';btn.style.color='#991b1b';
  document.getElementById('cancelReasonInput').value=reason;
}

async function confirmCancelOrder(){
  const reason=document.getElementById('cancelReasonInput').value.trim();
  if(!reason){toast('⚠️ يرجى اختيار أو كتابة سبب الإلغاء');return;}
  if(!_cancelTargetOrderId){return;}
  closeCancelDialog();
  await updateOrderStatus(_cancelTargetOrderId,'ملغي',reason);
  renderOrders();
}

// ===== PRODUCT PAGE =====
let currentProductPage=null;
let currentSlide=0;
let selectedColor='';
let selectedSize=null;

function openProductPage(id){
  try{
  const sid=String(id);
  const p=products.find(x=>x._docId===sid||String(x.id)===sid);
  if(!p){toast('⚠️ المنتج غير موجود');return;}
  currentProductPage=p;
  currentSlide=0;
  selectedColor='';
  selectedSize=null;
  document.getElementById('ppTitle').textContent=p.name;
  document.getElementById('ppCat').textContent=p.cat;
  // نفذ المخزون
  const ppAddBtn=document.getElementById('ppAddToCartBtn');
  const ppOosMsg=document.getElementById('ppOutOfStockMsg');
  if(p.outOfStock){
    if(ppAddBtn) ppAddBtn.style.display='none';
    if(ppOosMsg) ppOosMsg.style.display='block';
  } else {
    if(ppAddBtn) ppAddBtn.style.display='block';
    if(ppOosMsg) ppOosMsg.style.display='none';
  }
  document.getElementById('ppName').textContent=p.name;
  document.getElementById('ppDesc').textContent=p.desc||'';
  // تفاصيل المنتج
  const detailsEl=document.getElementById('ppDetails');
  const detailsContent=document.getElementById('ppDetailsContent');
  const details=[];
  if(p.height) details.push({icon:'📏',label:'الطول',val:p.height+' سم'});
  if(p.width) details.push({icon:'↔️',label:'العرض',val:p.width+' سم'});
  if(p.material) details.push({icon:'🪵',label:'المادة',val:p.material});
  if(details.length){
    detailsEl.style.display='block';
    detailsContent.innerHTML=details.map(d=>
      '<div style="background:#fff;border-radius:8px;padding:8px 12px;border:1px solid #e5e7eb;font-size:0.82rem;">'+
      '<span style="color:#6b7280;">'+d.icon+' '+d.label+': </span>'+
      '<span style="font-weight:700;color:#111827;">'+d.val+'</span></div>'
    ).join('');
  } else {
    detailsEl.style.display='none';
  }
  const priceNum=parseFloat(p.price)||0;
  let priceHTML=`${priceNum} دينار أردني`;
  if(p.oldPrice){const disc=Math.round((1-priceNum/p.oldPrice)*100);priceHTML=`<span style="text-decoration:line-through;color:#aaa;font-size:1rem;">${p.oldPrice} دينار أردني</span> <span style="background:#e53e3e;color:#fff;padding:2px 8px;border-radius:8px;font-size:0.8rem;">-${disc}%</span><br>${priceNum} دينار أردني`;}
  document.getElementById('ppPrice').innerHTML=priceHTML;
  const reviews=p.reviews||[];
  document.getElementById('ppStars').innerHTML=reviews.length?`<span style="color:#f6ad55;">${'⭐'.repeat(Math.round(reviews.reduce((s,r)=>s+r.stars,0)/reviews.length))}</span> <span style="color:#aaa;font-size:0.82rem;">(${reviews.length} تقييم)</span>`:'<span style="color:#aaa;font-size:0.82rem;">لا يوجد تقييمات بعد</span>';
  const images=p.images&&p.images.length?p.images:p.img?[p.img]:[];
  const slider=document.getElementById('ppSlider');
  if(slider){slider.innerHTML='';}
  const colorsSection=document.getElementById('ppOptionsSection');
  let pColors=p.colors||[];
  if(typeof pColors==='string'){try{pColors=JSON.parse(pColors);}catch(e){pColors=pColors?[pColors]:[];}}
  const hasColors=(pColors&&pColors.length>0)&&(p.showColors!==false);
  const hasWriting=p.writing;
  let pPots=p.pots||[];
  if(typeof pPots==='string'){try{pPots=JSON.parse(pPots);}catch(e){pPots=[];}}
  const hasPots=(pPots&&pPots.length>0)&&(p.showPots!==false);
  let pSizes=p.sizes||[];
  if(typeof pSizes==='string'){try{pSizes=JSON.parse(pSizes);}catch(e){pSizes=[];}}
  const hasSizes=(pSizes&&pSizes.length>0)&&(p.showSizes!==false);
  selectedPot='';
  if(hasColors||hasWriting||hasPots||hasSizes){
    colorsSection.style.display='block';
    const colorBtn=document.getElementById('ppTabColorBtn');
    const sizeBtn=document.getElementById('ppTabSizeBtn');
    const potBtn=document.getElementById('ppTabPotBtn');
    const writeBtn=document.getElementById('ppTabWriteBtn');
    if(colorBtn) colorBtn.style.display=hasColors?'block':'none';
    if(sizeBtn) sizeBtn.style.display=hasSizes?'block':'none';
    if(potBtn) potBtn.style.display=hasPots?'block':'none';
    if(writeBtn) writeBtn.style.display=hasWriting?'block':'none';
    if(hasColors){
      document.getElementById('ppColorsList').innerHTML=pColors.map(c=>`<button onclick="selectColor('${c}',this)" style="padding:9px 20px;border-radius:20px;border:2px solid #e0e0e0;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.88rem;cursor:pointer;transition:all 0.3s;">${c}</button>`).join('');
    }
    if(hasSizes){
      document.getElementById('ppSizesList').innerHTML=pSizes.map(s=>`
        <button onclick="selectSize(${JSON.stringify(s).replace(/"/g,'&quot;')},this)"
          style="padding:10px 18px;border-radius:20px;border:2px solid #e0e0e0;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.88rem;cursor:pointer;transition:all 0.3s;display:flex;flex-direction:column;align-items:center;gap:2px;">
          <span style="font-weight:700;">${s.name}</span>
          <span style="font-size:0.78rem;color:#1d4ed8;font-weight:800;">${parseFloat(s.price).toFixed(2)} د.أ</span>
        </button>`).join('');
    }
    if(hasPots) renderPpPots(pPots, p.potImages||{});
    if(hasColors) switchPPTab('color');
    else if(hasSizes) switchPPTab('size');
    else if(hasPots) switchPPTab('pot');
    else switchPPTab('write');
  } else {
    colorsSection.style.display='none';
  }
  document.getElementById('ppWritingInput').value='';
  const revEl=document.getElementById('ppReviews');
  revEl.innerHTML=reviews.length?reviews.slice().reverse().map(r=>`<div style="background:var(--cream);border-radius:10px;padding:12px;margin-bottom:8px;"><div style="color:#f6ad55;">${'⭐'.repeat(r.stars)}</div>${r.text?`<div style="font-size:0.85rem;margin-top:4px;">${r.text}</div>`:''}<div style="font-size:0.75rem;color:#aaa;margin-top:4px;">${r.author||'زبون'} · ${r.date||''}</div></div>`).join(''):'<div style="color:#aaa;font-size:0.85rem;">لا يوجد تقييمات بعد</div>';
  document.getElementById('productPageOverlay').classList.add('open');
  document.querySelector('#productPageOverlay .modal').scrollTop=0;
  // Push state so back button closes modal instead of leaving page
  history.pushState({productPage:true, id:String(id)}, '', '#product-'+String(id));
  // Video section
  const videoSec=document.getElementById('ppVideoSection');
  const videoCont=document.getElementById('ppVideoContainer');
  if(p.video){
    videoSec.style.display='block';
    const embedUrl=getVideoEmbed(p.video);
    if(embedUrl){
      videoCont.innerHTML=`<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;" allowfullscreen allow="autoplay"></iframe>`;
    } else {
      videoCont.innerHTML=`<video src="${p.video}" controls playsinline style="width:100%;height:100%;object-fit:contain;"></video>`;
    }
  } else {
    videoSec.style.display='none';
    videoCont.innerHTML='';
  }
  // Images grid (Temu style)
  const imagesGrid=document.getElementById('ppImagesGrid');
  const mainImg=document.getElementById('ppMainImage');
  if(images.length>0){
    imagesGrid.style.display='block';
    mainImg.src=images[0];
    mainImg.onclick=()=>openFullImg(mainImg.src);
    mainImg.style.cursor='zoom-in';
  } else {
    imagesGrid.style.display='none';
  }
  }catch(e){toast('خطأ: '+e.message);console.error(e);}
}

function closeProductPage(){
  document.getElementById('productPageOverlay').classList.remove('open');
  document.getElementById('ppVideoContainer').innerHTML='';
  // Clean URL without triggering popstate
  if(location.hash.startsWith('#product-')){
    history.replaceState(null,'',location.pathname);
  }
}
function goToSlide(n){}
function slideImg(dir){}

// Full image viewer
let _fullImgOverlay=null;

function openFullImg(src){
  const ov=document.createElement('div');
  ov.id='fullImgOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;display:flex;align-items:center;justify-content:center;';
  ov.innerHTML='<img src="'+src+'" style="max-width:100%;max-height:100%;object-fit:contain;"><button onclick="closeFullImg()" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:#fff;border:none;width:40px;height:40px;border-radius:50%;font-size:1.2rem;cursor:pointer;">✕</button>';
  ov.onclick=function(e){if(e.target===ov)closeFullImg();};
  document.body.appendChild(ov);
  _fullImgOverlay=ov;
  // Push state so back button closes the image first
  history.pushState({fullImg:true},'','#img');
}

function closeFullImg(){
  if(_fullImgOverlay){
    _fullImgOverlay.remove();
    _fullImgOverlay=null;
  }
  if(location.hash==='#img'){
    history.replaceState(null,'',location.pathname+(location.hash.includes('product')?location.hash:''));
  }
}
window.openFullImg=openFullImg;
window.closeFullImg=closeFullImg;
function switchVideoTab(tab){
  const uploadArea=document.getElementById('vUploadArea');
  const linkArea=document.getElementById('vLinkArea');
  const uploadBtn=document.getElementById('vTabUpload');
  const linkBtn=document.getElementById('vTabLink');
  if(tab==='upload'){
    uploadArea.style.display='block'; linkArea.style.display='none';
    uploadBtn.style.background='var(--green-dark)'; uploadBtn.style.color='#fff'; uploadBtn.style.borderColor='var(--green-dark)';
    linkBtn.style.background='#fff'; linkBtn.style.color='var(--text-mid)'; linkBtn.style.borderColor='#e0e0e0';
  } else {
    uploadArea.style.display='none'; linkArea.style.display='block';
    linkBtn.style.background='var(--green-dark)'; linkBtn.style.color='#fff'; linkBtn.style.borderColor='var(--green-dark)';
    uploadBtn.style.background='#fff'; uploadBtn.style.color='var(--text-mid)'; uploadBtn.style.borderColor='#e0e0e0';
  }
}
function prevVideo(input){
  const f=input.files[0];
  if(!f)return;
  const nameEl=document.getElementById('vPrevName');
  nameEl.textContent='✅ '+f.name+' ('+Math.round(f.size/1024/1024*10)/10+' MB)';
  nameEl.style.display='block';
  document.getElementById('vUpPh').textContent='🎬 '+f.name;
}
function clearExistingVideo(){
  document.getElementById('vExistingArea').style.display='none';
  document.getElementById('vExistingText').textContent='';
}

function getVideoEmbed(url){
  // YouTube
  const yt=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s?]+)/);
  if(yt) return `https://www.youtube.com/embed/${yt[1]}?autoplay=0&rel=0`;
  // TikTok
  const tt=url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if(tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  // Instagram Reels
  if(url.includes('instagram.com/reel')||url.includes('instagram.com/p/')){
    const ig=url.match(/instagram\.com\/(?:reel|p)\/([^/?]+)/);
    if(ig) return `https://www.instagram.com/p/${ig[1]}/embed`;
  }
  return null; // direct video file
}

function switchPPTab(tab){
  ['Color','Size','Write','Pot'].forEach(t=>{
    const el=document.getElementById('ppTab'+t);
    if(el)el.style.display='none';
    const btn=document.getElementById('ppTab'+t+'Btn');
    if(btn){btn.style.background='#fff';btn.style.color='var(--text-mid)';btn.style.fontWeight='400';}
  });
  const activeEl=document.getElementById('ppTab'+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(activeEl)activeEl.style.display='block';
  const activeBtn=document.getElementById('ppTab'+tab.charAt(0).toUpperCase()+tab.slice(1)+'Btn');
  if(activeBtn){
    activeBtn.style.background=tab==='pot'?'#c9a84c':tab==='size'?'#1d4ed8':'var(--green-dark)';
    activeBtn.style.color='#fff';
    activeBtn.style.fontWeight='700';
  }
}

function selectSize(sizeObj,btn){
  selectedSize=sizeObj;
  document.querySelectorAll('#ppSizesList button').forEach(b=>{b.style.borderColor='#e0e0e0';b.style.background='#fff';});
  btn.style.borderColor='#1d4ed8';btn.style.background='#eff6ff';
  const priceEl=document.getElementById('ppPrice');
  if(priceEl){
    const p=currentProductPage;
    if(p&&p.oldPrice){const disc=Math.round((1-sizeObj.price/p.oldPrice)*100);priceEl.innerHTML=`<span style="text-decoration:line-through;color:#aaa;font-size:1rem;">${p.oldPrice} دينار أردني</span> <span style="background:#e53e3e;color:#fff;padding:2px 8px;border-radius:8px;font-size:0.8rem;">-${disc}%</span><br>${sizeObj.price} دينار أردني`;}
    else{priceEl.innerHTML=`${sizeObj.price} دينار أردني`;}
  }
}

function selectColor(color,btn){
  selectedColor=color;
  document.querySelectorAll('#ppColorsList button').forEach(b=>{b.style.borderColor='#e0e0e0';b.style.background='#fff';b.style.color='inherit';});
  btn.style.borderColor='var(--green-dark)';btn.style.background='var(--green-dark)';btn.style.color='#fff';
  // Change product image based on color
  const p=currentProductPage;
  if(p&&p.colorImages&&p.colorImages[color]){
    const mainImg=document.getElementById('ppMainImage');
    if(mainImg) mainImg.src=p.colorImages[color];
  }
}
function addToCartFromPage(){
  const p=currentProductPage;if(!p)return;
  let pPots=p.pots||[];
  if(typeof pPots==='string'){try{pPots=JSON.parse(pPots);}catch(e){pPots=[];}}
  let pSizes=p.sizes||[];
  if(typeof pSizes==='string'){try{pSizes=JSON.parse(pSizes);}catch(e){pSizes=[];}}
  const hasSizes=(pSizes&&pSizes.length>0)&&(p.showSizes!==false);
  const hasColors=(p.colors&&p.colors.length)&&(p.showColors!==false);
  const hasPots=pPots.length&&(p.showPots!==false);
  if(hasColors&&!selectedColor){toast('🎨 يرجى اختيار اللون أولاً');return;}
  if(hasSizes&&!selectedSize){toast('📐 يرجى اختيار الحجم أولاً');return;}
  if(hasPots&&!selectedPot){toast('🪴 يرجى اختيار شكل القوار أولاً');return;}
  const writing=p.writing?document.getElementById('ppWritingInput').value.trim():'';
  let extras=writing;
  if(selectedColor) extras+=(extras?' | ':'')+' لون: '+selectedColor;
  if(selectedSize) extras+=(extras?' | ':'')+' حجم: '+selectedSize.name;
  if(selectedPot) extras+=(extras?' | ':'')+' قوار: '+selectedPot;
  const productForCart=selectedSize?{...p,price:selectedSize.price}:p;
  addToCartDirect(productForCart,extras);
  closeProductPage();
  toast('✅ تمت الإضافة للسلة!');
}
function openRatingFromPage(){closeProductPage();setTimeout(()=>openRatingModal(currentProductPage?.id),300);}

function shareProduct(){
  const p=currentProductPage;
  if(!p) return;
  const price=parseFloat(p.price)||0;
  const url='https://alkiswanirosemary.com';
  var shareLines=[
    'الكسواني روزميري',
    '',
    'شوف هالمنتج!',
    '',
    p.name,
    p.cat,
    price+' دينار اردني',
    '',
    p.desc||'',
    '',
    'تسوق الان: '+url
  ];
  var msg=shareLines.join('\n');
    var a=document.createElement('a');
  a.href='https://wa.me/?text='+encodeURIComponent(msg);
  a.target='_blank';
  a.rel='noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== PWA =====
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js')
      .then(()=>console.log('✅ PWA ready'))
      .catch(e=>console.log('SW:',e));
  });
}

// ===== SOCIAL PROOF NOTIFICATIONS (REAL ORDERS) =====
let spTimer=null;

async function startSocialProof(){
  // Get last 10 real orders
  try{
    const snap=await db.collection('orders').orderBy('id','desc').limit(8).get();
    if(snap.empty) return;
    const orders=snap.docs.map(d=>d.data()).filter(o=>o.name&&o.items?.length);
    if(!orders.length) return;
    let idx=0;
    const showNext=()=>{
      const o=orders[idx%orders.length];
      idx++;
      const item=o.items[0];
      const p=products.find(x=>x.name===item?.name)||products[0];
      const notif=document.getElementById('spNotif');
      const imgEl=document.getElementById('spImg');
      // Show first name only for privacy
      const firstName=o.name.split(' ')[0];
      const city=o.area||'الأردن';
      document.getElementById('spName').textContent=firstName+' من '+city;
      document.getElementById('spProduct').textContent='اشترى: '+(item?.name||p?.name||'منتج');
      // Calculate time ago
      const orderId=o.id||Date.now();
      const diff=Math.floor((Date.now()-orderId)/60000);
      const timeText=diff<1?'للتو':diff<60?'منذ '+diff+' دقيقة':diff<1440?'منذ '+(Math.floor(diff/60))+' ساعة':'منذ '+Math.floor(diff/1440)+' يوم';
      document.getElementById('spTime').textContent=timeText;
      if(p?.images?.[0]){imgEl.innerHTML=`<img src="${p.images[0]}" alt="">`;}
      else if(p?.img){imgEl.innerHTML=`<img src="${p.img}" alt="">`;}
      else{imgEl.textContent=p?.emoji||'📦';}
      notif.classList.add('show');
      setTimeout(()=>notif.classList.remove('show'),5000);
      spTimer=setTimeout(showNext,Math.random()*20000+15000);
    };
    spTimer=setTimeout(showNext,8000);
  }catch(e){console.log('Social proof error:',e);}
}

// ===== CUSTOMER PHOTOS =====
function openPhotoModal(){document.getElementById('photoModalOverlay').classList.add('open');}
function closePhotoModal(){document.getElementById('photoModalOverlay').classList.remove('open');}
function prevPhotoUpload(input){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=e=>{
    const img=document.getElementById('pmImgPrev');
    img.src=e.target.result;img.style.display='block';
    document.getElementById('pmUpPh').style.display='none';
  };
  r.readAsDataURL(f);
}
async function submitCustomerPhoto(){
  const name=document.getElementById('pmName').value.trim();
  const phone=document.getElementById('pmPhone').value.trim();
  const city=document.getElementById('pmCity').value.trim();
  const file=document.getElementById('pmImg').files[0];
  if(!name||!phone||!file){toast('❌ أدخل اسمك ورقمك واختر صورة');return;}
  // Check if already submitted
  const existing=await db.collection('customerPhotos').where('phone','==',phone).get();
  if(!existing.empty){
    toast('❌ أرسلت صورة من قبل برقم هذا الهاتف');return;
  }
  toast('⏳ جاري الإرسال...');
  try{
    const imgUrl=await uploadImageToFirebase(file,'customer_'+Date.now());
    // Generate unique discount code
    const discCode='PHOTO'+phone.replace(/[^0-9]/g,'').slice(-4)+Math.random().toString(36).slice(-3).toUpperCase();
    await db.collection('customerPhotos').add({
      name,phone,city:city||'الأردن',img:imgUrl,
      status:'pending',discountCode:discCode,
      date:jordanDisplayDate()
    });
    // Save discount code in discounts collection (1 use, 5%)
    await db.collection('discounts').doc(discCode).set({
      code:discCode,type:'percent',value:5,limit:1,
      usedCount:0,expiry:'',isWelcome:false,scope:'all',products_allowed:[],
      isPhotoCode:true,phone,
      createdAt:jordanDisplayDate()
    });
    closePhotoModal();
    document.getElementById('pmName').value='';
    document.getElementById('pmPhone').value='';
    document.getElementById('pmCity').value='';
    document.getElementById('pmImg').value='';
    document.getElementById('pmImgPrev').style.display='none';
    document.getElementById('pmUpPh').style.display='block';
    // Show success with code
    setTimeout(()=>{
      toast(`✅ شكراً ${name}! بعد مراجعة مشاركتك سيصلك كودك: ${discCode} 🎁`);
    },300);
    // Send WA message with code to admin to notify customer
    const adminMsg=`📸 *صورة زبون جديدة*\n\nالاسم: ${name}\nالهاتف: ${phone}\n\nبعد الموافقة على الصورة، ابعت للزبون كوده:\n🎁 *${discCode}*\nخصم 5% على طلبه القادم`;
    setTimeout(()=>window.open(`https://wa.me/${WA}?text=${encodeURIComponent(adminMsg)}`,'_blank'),1000);
  }catch(e){
    toast('❌ خطأ: '+e.message);
  }
}

async function loadCustomerPhotos(){
  const snap=await db.collection('customerPhotos').where('status','==','approved').get();
  const photos=snap.docs.map(d=>({id:d.id,...d.data()}));
  const section=document.getElementById('customerPhotosSection');
  const grid=document.getElementById('customerPhotosGrid');
  if(photos.length>0||true){
    section.style.display='block';
    grid.innerHTML=`<div class="upload-photo-btn" onclick="openPhotoModal()">
      <span style="font-size:2rem;">📸</span><span>شارك تجربتك معنا</span>
    </div>`+photos.map(p=>`
      <div class="customer-photo-item">
        <img src="${p.img}" alt="${p.name}">
        <div class="customer-photo-overlay">
          <span class="customer-photo-name">${p.name} - ${p.city||'الأردن'}</span>
        </div>
      </div>
    `).join('');
  }
}

async function renderPhotosAdmin(){
  const snap=await db.collection('customerPhotos').get();
  const all=snap.docs.map(d=>({id:d.id,...d.data()}));
  const pending=all.filter(p=>p.status==='pending');
  const approved=all.filter(p=>p.status==='approved');
  document.getElementById('pendingPhotosCount').textContent=pending.length;
  document.getElementById('approvedPhotosCount').textContent=approved.length;
  const renderPhotoRow=(p,showApprove)=>`
    <div class="prod-row" style="flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <img src="${p.img}" style="width:75px;height:75px;object-fit:cover;border-radius:10px;cursor:pointer;" onclick="openFullImg('${p.img}')">
        <div style="flex:1;">
          <div style="font-weight:700;">${p.name} · ${p.city||'الأردن'}</div>
          ${p.phone?`<a href="https://wa.me/962${p.phone.replace(/[^0-9]/g,'').replace(/^0/,'')}" target="_blank" style="color:#25D366;font-size:0.82rem;text-decoration:none;">📱 ${p.phone}</a>`:''}
          <div style="font-size:0.78rem;color:#aaa;">${p.date||''}</div>
          ${p.discountCode?`<div style="margin-top:4px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:4px 8px;font-size:0.78rem;color:#166534;">🎁 كود الخصم: <strong>${p.discountCode}</strong></div>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${showApprove?`<button onclick="approvePhoto('${p.id}')" style="padding:6px 12px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">✅ نشر وإبلاغ</button>`:''}
          <button onclick="deletePhoto('${p.id}')" style="padding:6px 12px;background:#fff0f0;color:#e53e3e;border:1px solid #fecaca;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">🗑️ حذف</button>
        </div>
      </div>
    </div>`;
  document.getElementById('pendingPhotosList').innerHTML=pending.length?pending.map(p=>renderPhotoRow(p,true)).join(''):'<div class="empty-msg">لا يوجد صور بعد</div>';
  document.getElementById('approvedPhotosList').innerHTML=approved.length?approved.map(p=>renderPhotoRow(p,false)).join(''):'<div class="empty-msg">لا يوجد صور منشورة</div>';
}
async function approvePhoto(id){
  const snap=await db.collection('customerPhotos').doc(id).get();
  const p=snap.data();
  await db.collection('customerPhotos').doc(id).update({status:'approved'});
  toast('✅ تم نشر الصورة!');
  renderPhotosAdmin();
  loadCustomerPhotos();
  // Send WA to customer with their discount code
  if(p?.phone&&p?.discountCode){
    const phone=p.phone.replace(/[^0-9]/g,'');
    const intlPhone=phone.startsWith('0')?'962'+phone.slice(1):phone;
    const msg=`🌿 *الكسواني روزميري*\n\nأهلاً ${p.name}! 🎉\n\nشكراً لمشاركتك تجربتك معنا 📸\n\nهدية منا لك — كود خصم 5% على طلبك القادم:\n\n🎁 *${p.discountCode}*\n\nاستخدمه عند إتمام طلبك القادم 💚`;
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`,'_blank');
  }
}
async function deletePhoto(id){
  if(!confirm('حذف هذه الصورة؟'))return;
  await db.collection('customerPhotos').doc(id).delete();
  toast('🗑️ تم الحذف');
  renderPhotosAdmin();
  loadCustomerPhotos();
}

// ===== WELCOME POPUP =====
function getTimeOfDay(){
  const h=new Date().getHours();
  if(h>=5&&h<12) return 'morning';
  if(h>=12&&h<17) return 'afternoon';
  if(h>=17&&h<21) return 'evening';
  return 'night';
}

function buildGreetingScene(time){
  const scene=document.getElementById('greetingScene');
  if(time==='morning'||time==='afternoon'){
    // شمس مع أشعة
    scene.innerHTML='<div class="scene-sun"></div><div class="scene-horizon"></div>';
  } else {
    // قمر + نجوم
    const stars='<div class="scene-stars">'+'<span></span>'.repeat(8)+'</div>';
    const moon='<div class="scene-moon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e2e8f0"/><stop offset="50%" stop-color="#c4b5fd"/><stop offset="100%" stop-color="#818cf8"/></linearGradient><filter id="mgl"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M 62 18 A 34 34 0 1 0 62 82 A 26 26 0 1 1 62 18 Z" fill="url(#mg)" filter="url(#mgl)"/></svg></div>';
    scene.innerHTML=stars+moon+'<div class="scene-horizon"></div>';
  }
}

function showWelcome(){
  // مفتاح فريد لكل فترة + يوم
  const today=jordanDateStr();
  const time=getTimeOfDay();
  const key='ak_greeting_'+today+'_'+time;
  if(localStorage.getItem(key)) return;
  const card=document.getElementById('greetingCard');
  const label=document.getElementById('greetingLabel');
  const title=document.getElementById('greetingTitle');
  const subtitle=document.getElementById('greetingSubtitle');
  // تعيين الكلاس
  card.className='greeting-card '+time;
  // بناء المشهد
  buildGreetingScene(time);
  // النصوص
  const greetings={
    morning:{label:'صباح الخير ☀️',title:'أهلاً وسهلاً!',sub:'ابدأ يومك باقتناء شيء جميل 🌿'},
    afternoon:{label:'مساء النور 🌤️',title:'أهلاً بك!',sub:'تصفح مجموعتنا الرائعة من الخشبيات والأشجار'},
    evening:{label:'مساء الخير 🌙',title:'أهلاً بك!',sub:'أضف لمسة جمال لمنزلك هذا المساء ✨'},
    night:{label:'ليلة سعيدة 🌟',title:'أهلاً بك!',sub:'نوّر بيتك بأجمل الخشبيات وأشجار الزينة 🌿'}
  };
  label.textContent=greetings[time].label;
  title.textContent=greetings[time].title;
  subtitle.textContent=greetings[time].sub;
  // إظهار
  setTimeout(function(){
    document.getElementById('greetingOverlay').classList.add('show');
  },3200);
}

function closeGreeting(){
  document.getElementById('greetingOverlay').classList.remove('show');
  const today=jordanDateStr();
  const time=getTimeOfDay();
  const key='ak_greeting_'+today+'_'+time;
  localStorage.setItem(key,'1');
}

function closeWelcome(){
  closeGreeting();
}

function useWelcomeCode(){
  const code=document.getElementById('welcomeCode').textContent;
  navigator.clipboard?.writeText(code).catch(()=>{});
  closeGreeting();
  document.getElementById('products').scrollIntoView({behavior:'smooth'});
  toast('✅ تم نسخ الكود: '+code);
}

// ===== REFERRAL SYSTEM =====
function copyReferral(){
  const link=document.getElementById('referralLink').textContent;
  navigator.clipboard.writeText(link).then(()=>toast('✅ تم نسخ الرابط!')).catch(()=>{
    const el=document.createElement('textarea');
    el.value=link;document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);
    toast('✅ تم نسخ الرابط!');
  });
}
function shareReferral(){
  const link=document.getElementById('referralLink').textContent;
  const msg=`🌿 *الكسواني روزميري*\n\nتسوق معي من أجمل متجر خشبيات وأشجار زينة في الأردن!\n\n${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}
function checkReferral(){
  const params=new URLSearchParams(location.search);
  const ref=params.get('ref');
  if(ref) localStorage.setItem('ak_ref',ref);
}
async function processReferralOnOrder(phone,name){
  const refCode=localStorage.getItem('ak_ref');
  if(!refCode) return;
  if(refCode==='REF'+phone.replace(/[^0-9]/g,'').slice(-6)) return;
  const existing=await db.collection('referrals').where('refCode','==',refCode).where('phone','==',phone).get();
  if(!existing.empty) return;
  await db.collection('referrals').add({refCode,phone,name,date:jordanDisplayDate()});
  localStorage.removeItem('ak_ref');
  const referrerPhone='962'+refCode.replace('REF','');
  const rewardCode='REWARD'+refCode+Date.now().toString().slice(-4);
  await db.collection('discounts').doc(rewardCode).set({
    code:rewardCode,type:'percent',value:10,limit:1,usedCount:0,
    expiry:'',isWelcome:false,scope:'all',products_allowed:[],isReferral:true,
    createdAt:jordanDisplayDate()
  });
  const msg=`🌿 *الكسواني روزميري*\n\n🎉 مبروك! ${name} طلب من رابط دعوتك!\n\nهديتك كود خصم 10%:\n\n🎁 *${rewardCode}*\n\nاستخدمه على طلبك القادم 💚`;
  setTimeout(()=>window.open(`https://wa.me/${referrerPhone}?text=${encodeURIComponent(msg)}`,'_blank'),2000);
}

// ===== WISHLIST =====

function toggleWishlist(pid){
  const p=products.find(x=>x._docId===pid||String(x.id)===pid);
  if(!p) return;
  const idx=wishlist.findIndex(x=>x._docId===pid||String(x.id)===pid);
  if(idx>=0){
    wishlist.splice(idx,1);
    toast('💔 تمت الإزالة من الأمنيات');
  } else {
    wishlist.push(p);
    toast('❤️ تمت الإضافة للأمنيات!');
  }
  save('ak_wish',wishlist);
  localStorage.setItem('ak_wish',JSON.stringify(wishlist));
  if(currentUser) saveUserData();
  updateWishBadge();
  renderStore(document.querySelector('.filter-btn.active')?.textContent||'الكل');
}

function updateWishBadge(){
  const badge=document.getElementById('wishBadge');
  if(!badge) return;
  if(wishlist.length>0){
    badge.style.display='flex';
    badge.textContent=wishlist.length;
  } else {
    badge.style.display='none';
  }
  document.getElementById('wishCount').textContent=wishlist.length;
}

function openWishlist(){
  const items=document.getElementById('wishlistItems');
  if(!wishlist.length){
    items.innerHTML=`<div class="wishlist-empty"><div style="font-size:4rem;margin-bottom:16px;">🤍</div><div style="font-size:1.1rem;font-weight:700;color:var(--text-dark);margin-bottom:8px;">قائمة أمنياتك فاضية</div><div style="font-size:0.88rem;color:#aaa;">اضغط ❤️ على أي منتج لحفظه</div></div>`;
  } else {
    items.innerHTML=wishlist.map(p=>{
      const pid=p._docId||String(p.id);
      return `<div class="wishlist-item">
        <div class="wishlist-item-img">${p.images?.[0]||p.img?`<img src="${p.images?.[0]||p.img}" alt="">`:`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;">${p.emoji}</div>`}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;color:var(--green-dark);margin-bottom:4px;">${p.name}</div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--brown);margin-bottom:10px;">${parseFloat(p.price)||0} دينار أردني</div>
          <div style="display:flex;gap:8px;">
            <button onclick="handleAddToCart('${pid}');closeWishlist();" style="flex:1;padding:8px;background:var(--green-dark);color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">🛒 أضف للسلة</button>
            <button onclick="toggleWishlist('${pid}');renderWishlist();" style="padding:8px 12px;background:#fff0f0;color:#e53e3e;border:1px solid #fecaca;border-radius:8px;cursor:pointer;">🗑️</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('wishlistPage').classList.add('open');
}

function renderWishlist(){
  const items=document.getElementById('wishlistItems');
  if(!items) return;
  openWishlist();
}

function closeWishlist(){
  document.getElementById('wishlistPage').classList.remove('open');
}
function toggleDarkMode(){
  const isDark=document.body.classList.toggle('dark-mode');
  localStorage.setItem('ak_dark',isDark?'1':'0');
  document.getElementById('darkToggle').textContent=isDark?'☀️':'🌙';
}
function initDarkMode(){
  if(localStorage.getItem('ak_dark')==='1'){
    document.body.classList.add('dark-mode');
    document.getElementById('darkToggle').textContent='☀️';
  }
}

// ===== EID SETTINGS =====
let countdownTimer=null;

function updateEidPositions(){
  const nav=document.querySelector('nav');
  const navH=nav?nav.offsetHeight:62;
  const banner=document.getElementById('eidBanner');
  const countdown=document.getElementById('eidCountdown');
  const bannerVisible=banner.classList.contains('show');
  const countdownVisible=countdown.classList.contains('show');
  // ضع البانر تحت الـ nav
  banner.style.top=navH+'px';
  // ضع العداد تحت البانر
  const bannerH=bannerVisible?banner.offsetHeight:0;
  countdown.style.top=(navH+bannerH)+'px';
  // اضبط padding الهيرو
  const countdownH=countdownVisible?countdown.offsetHeight:0;
  const totalFixed=navH+bannerH+countdownH;
  const hero=document.querySelector('.hero');
  if(hero) hero.style.paddingTop=(totalFixed+10)+'px';
}

async function loadEidSettings(){
  try{
    let d;
    try{
      const raw=sessionStorage.getItem('_cache_eid');
      if(raw){const c=JSON.parse(raw);if(Date.now()-c.ts<5*60*1000)d=c.data;}
    }catch(e){}
    if(!d){
      const snap=await db.collection('settings').doc('eid').get();
      if(!snap.exists) return;
      d=snap.data();
      try{sessionStorage.setItem('_cache_eid',JSON.stringify({data:d,ts:Date.now()}));}catch(e){}
    }
    // Banner
    if(d.bannerEnabled){
      document.getElementById('eidBanner').classList.add('show');
      if(d.bannerText) document.getElementById('eidBannerText').textContent=d.bannerText;
    }
    // Countdown
    if(d.countdownEnabled&&d.eidDate){
      document.getElementById('eidCountdown').classList.add('show');
      if(d.countdownTitle) document.getElementById('eidCountdownTitle').textContent=d.countdownTitle;
      startCountdown(new Date(d.eidDate));
    }
    // استدعاء مرتين عشان يتأكد من الارتفاع الصحيح
    setTimeout(updateEidPositions,100);
    setTimeout(updateEidPositions,500);
  }catch(e){}
}

function startCountdown(targetDate){
  if(countdownTimer) clearInterval(countdownTimer);
  function update(){
    const now=new Date();
    const diff=targetDate-now;
    if(diff<=0){
      document.getElementById('eidCountdown').classList.remove('show');
      clearInterval(countdownTimer);
      return;
    }
    const days=Math.floor(diff/86400000);
    const hours=Math.floor((diff%86400000)/3600000);
    const mins=Math.floor((diff%3600000)/60000);
    const secs=Math.floor((diff%60000)/1000);
    document.getElementById('cdDays').textContent=String(days).padStart(2,'0');
    document.getElementById('cdHours').textContent=String(hours).padStart(2,'0');
    document.getElementById('cdMins').textContent=String(mins).padStart(2,'0');
    document.getElementById('cdSecs').textContent=String(secs).padStart(2,'0');
  }
  update();
  countdownTimer=setInterval(update,1000);
}

async function saveEidSettings(){
  const data={
    bannerEnabled:document.getElementById('eidBannerEnabled').checked,
    bannerText:document.getElementById('eidBannerTextInput').value.trim()||'🌙 عروض العيد الخاصة!',
    countdownEnabled:document.getElementById('eidCountdownEnabled').checked,
    countdownTitle:document.getElementById('eidCountdownTitleInput').value.trim()||'⏳ تبقى على العيد',
    eidDate:document.getElementById('eidDateInput').value
  };
  await db.collection('settings').doc('eid').set(data);
  try{sessionStorage.removeItem('_cache_eid');}catch(e){}
  // Apply immediately
  const banner=document.getElementById('eidBanner');
  const countdown=document.getElementById('eidCountdown');
  document.getElementById('eidBannerText').textContent=data.bannerText;
  data.bannerEnabled?banner.classList.add('show'):banner.classList.remove('show');
  if(data.countdownEnabled&&data.eidDate){
    if(data.countdownTitle) document.getElementById('eidCountdownTitle').textContent=data.countdownTitle;
    countdown.classList.add('show');
    startCountdown(new Date(data.eidDate));
  } else {
    countdown.classList.remove('show');
    if(countdownTimer) clearInterval(countdownTimer);
  }
  setTimeout(updateEidPositions,100);
  toast('✅ تم حفظ إعدادات العيد!');
}

async function loadEidAdminUI(){
  try{
    const snap=await db.collection('settings').doc('eid').get();
    if(!snap.exists) return;
    const d=snap.data();
    document.getElementById('eidBannerEnabled').checked=d.bannerEnabled||false;
    document.getElementById('eidBannerTextInput').value=d.bannerText||'';
    document.getElementById('eidCountdownEnabled').checked=d.countdownEnabled||false;
    document.getElementById('eidCountdownTitleInput').value=d.countdownTitle||'';
    document.getElementById('eidDateInput').value=d.eidDate||'';
  }catch(e){}
}

// Intersection Observer للـ lazy loading
function initLazyImages(){
  if(!('IntersectionObserver' in window)) return;
  const obs=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){
        const img=entry.target;
        if(img.dataset.src){
          img.src=img.dataset.src;
          img.removeAttribute('data-src');
          obs.unobserve(img);
        }
      }
    });
  },{rootMargin:'200px'});
  document.querySelectorAll('img[data-src]').forEach(function(img){obs.observe(img);});
  return obs;
}
let _lazyObs=null;

async function init(){
  if(new URLSearchParams(window.location.search).has('rep')){_initRepApp();return;}
  const _gToken=new URLSearchParams(window.location.search).get('g');
  if(_gToken){_initPublicSlideshow(_gToken);return;}
  // Ensure Firestore is online before loading any data
  await _ensureNet();
  try{ initDarkMode(); }catch(e){}
  try{ checkReferral(); }catch(e){}
  try{ updateWishBadge(); }catch(e){}
  // Run all 3 critical reads in parallel instead of one after another
  await Promise.all([
    loadPointsSettings().catch(()=>{}),
    loadCategories().catch(e=>console.log('loadCategories error',e)),
    loadProducts().catch(e=>console.error('loadProducts error:',e))
  ]);
  // Non-critical: run in background, don't block the page
  loadCustomerPhotos().catch(()=>{});
  loadEidSettings().catch(()=>{});
  loadAboutSettings().catch(()=>{});
  try{ trackVisit(); }catch(e){}
  try{ updateCartCount(); }catch(e){}
  try{ updateNavUser(); }catch(e){}
  try{ startSocialProof(); }catch(e){}
  try{ showWelcome(); }catch(e){}
  _initTrackingPage().catch(()=>{});
  _initDeliveryBatchPage().catch(()=>{});
}

// ===== CATEGORIES MANAGEMENT =====
let storeCategories=[];
let selectedCatColor1='#134e2a';
let selectedCatColor2='#2d7a4a';

async function loadCategories(){
  try{
    const snap=await db.collection('categories').orderBy('order','asc').get();
    if(!snap.empty){
      storeCategories=snap.docs.map(d=>({id:d.id,...d.data()}));
    } else {
      // أقسام افتراضية لأول مرة
      storeCategories=[
        {id:'cat1',name:'أشجار الزينة',emoji:'🌳',color1:'#134e2a',color2:'#2d7a4a',order:1},
        {id:'cat2',name:'الخشبيات',emoji:'🪵',color1:'#78350f',color2:'#b45309',order:2},
        {id:'cat3',name:'براويز التخرج',emoji:'🎓',color1:'#1e3a5f',color2:'#2563eb',order:3},
        {id:'cat4',name:'مباخر',emoji:'🕯️',color1:'#3b0764',color2:'#7c3aed',order:4},
        {id:'cat5',name:'طقوم الضيافة',emoji:'☕',color1:'#7f1d1d',color2:'#dc2626',order:5},
        {id:'cat6',name:'هدايا الأعياد',emoji:'🎁',color1:'#92400e',color2:'#d97706',order:6},
        {id:'cat7',name:'مناظر تعليق',emoji:'🖼️',color1:'#164e63',color2:'#0891b2',order:7},
      ];
    }
    renderCatsSection();
    renderFilterBar();
    updateProductCatSelect();
  }catch(e){ console.log('loadCategories error',e); }
}

function renderCatsSection(){
  const scroll=document.querySelector('.cats-scroll');
  if(!scroll) return;
  scroll.innerHTML=storeCategories.map(function(cat){
    var inner=cat.img
      ?'<img src="'+cat.img+'" style="width:100%;height:100%;object-fit:cover;border-radius:18px;">'
      :'<div class="cat-bg" style="background:linear-gradient(145deg,'+cat.color1+','+cat.color2+');"></div><span class="cat-emoji">'+cat.emoji+'</span>';
    return '<div class="cat-item" data-cat="'+cat.name+'" onclick="filterCat(this)">'
      +inner
      +'<span class="cat-label">'+cat.name+'</span>'
      +'</div>';
  }).join('');
}

function renderFilterBar(){
  const bar=document.querySelector('.filter-bar');
  if(!bar) return;
  var allBtn='<button class="filter-btn active" onclick="filterAll()">الكل</button>';
  var catBtns=storeCategories.map(function(cat){
    return '<button class="filter-btn" data-cat="'+cat.name+'" onclick="filterCat(this)">'+cat.name+'</button>';
  }).join('');
  bar.innerHTML=allBtn+catBtns;
}

function updateProductCatSelect(){
  const sel=document.getElementById('pCat');
  if(!sel) return;
  const current=sel.value;
  sel.innerHTML='<option value="">اختر القسم</option>'
    +storeCategories.map(c=>`<option value="${c.name}" ${c.name===current?'selected':''}>${c.name}</option>`).join('');
}

function selectCatColor(c1,c2,el){
  selectedCatColor1=c1;
  selectedCatColor2=c2;
  document.getElementById('catColor1').value=c1;
  document.getElementById('catColor2').value=c2;
  document.querySelectorAll('#catColorPicker div').forEach(d=>d.style.border='3px solid transparent');
  el.style.border='3px solid #1a3a2a';
}

let _catImgFile=null;

function prevCatImg(input){
  const file=input.files[0];
  if(!file) return;
  _catImgFile=file;
  const r=new FileReader();
  r.onload=function(e){
    const prev=document.getElementById('catImgPreview');
    prev.src=e.target.result;
    prev.style.display='block';
    document.getElementById('catImgPh').style.display='none';
    document.getElementById('catExistingImgWrap').style.display='none';
  };
  r.readAsDataURL(file);
}

function clearCatImg(){
  _catImgFile=null;
  document.getElementById('catImg').value='';
  document.getElementById('catImgPreview').style.display='none';
  document.getElementById('catImgPh').style.display='block';
  document.getElementById('catExistingImgWrap').style.display='none';
  document.getElementById('catExistingImgUrl').value='';
}

async function saveCategory(){
  const name=document.getElementById('catName').value.trim();
  const emoji=document.getElementById('catEmoji').value.trim()||'📦';
  const c1=document.getElementById('catColor1').value||'#134e2a';
  const c2=document.getElementById('catColor2').value||'#2d7a4a';
  const editingId=document.getElementById('catEditingId').value;
  const existingImg=document.getElementById('catExistingImgUrl').value;
  if(!name){toast('❌ اكتب اسم القسم');return;}
  // رفع الصورة لو في صورة جديدة
  let imgUrl=existingImg||'';
  if(_catImgFile){
    toast('⏳ جاري رفع الصورة...');
    try{
      const compressed=await compressImage(_catImgFile,400,0.85);
      const ref=storage.ref('categories/cat_'+Date.now()+'.jpg');
      await ref.put(compressed);
      imgUrl=await ref.getDownloadURL();
    }catch(e){toast('❌ خطأ في رفع الصورة');return;}
  }
  if(editingId){
    // تعديل
    const cat=storeCategories.find(c=>c.id===editingId);
    if(!cat) return;
    cat.name=name;cat.emoji=emoji;cat.color1=c1;cat.color2=c2;cat.img=imgUrl;
    await db.collection('categories').doc(editingId).update({name,emoji,color1:c1,color2:c2,img:imgUrl});
    toast('✅ تم تعديل القسم!');
  } else {
    // إضافة جديد
    if(storeCategories.find(c=>c.name===name)){toast('❌ هذا القسم موجود');return;}
    const id='cat_'+Date.now();
    const cat={id,name,emoji,color1:c1,color2:c2,img:imgUrl,order:storeCategories.length+1};
    await db.collection('categories').doc(id).set(cat);
    storeCategories.push(cat);
    toast('✅ تم إضافة القسم!');
  }
  cancelCatEdit();
  renderCatsSection();
  renderFilterBar();
  updateProductCatSelect();
  renderCategoriesAdmin();
}

function cancelCatEdit(){
  document.getElementById('catName').value='';
  document.getElementById('catEmoji').value='';
  document.getElementById('catEditingId').value='';
  document.getElementById('catExistingImgUrl').value='';
  document.getElementById('catSaveBtn').textContent='✅ إضافة القسم';
  document.getElementById('catCancelBtn').style.display='none';
  document.getElementById('catFormTitle').textContent='➕ إضافة قسم جديد';
  clearCatImg();
}

function editCategory(id){
  const cat=storeCategories.find(c=>c.id===id);
  if(!cat) return;
  document.getElementById('catName').value=cat.name;
  document.getElementById('catEmoji').value=cat.emoji||'';
  document.getElementById('catColor1').value=cat.color1;
  document.getElementById('catColor2').value=cat.color2;
  document.getElementById('catEditingId').value=id;
  // تحديد اللون في picker
  document.querySelectorAll('#catColorPicker div').forEach(function(d){d.style.border='3px solid transparent';});
  // عرض الصورة الحالية لو في
  if(cat.img){
    document.getElementById('catExistingImgUrl').value=cat.img;
    document.getElementById('catExistingImg').src=cat.img;
    document.getElementById('catExistingImgWrap').style.display='flex';
    document.getElementById('catImgPh').style.display='none';
    document.getElementById('catImgPreview').style.display='none';
  } else {
    clearCatImg();
  }
  document.getElementById('catFormTitle').textContent='✏️ تعديل القسم: '+cat.name;
  document.getElementById('catSaveBtn').textContent='💾 حفظ التعديل';
  document.getElementById('catCancelBtn').style.display='block';
  document.querySelector('#tab-categories .form-card').scrollIntoView({behavior:'smooth'});
}

function editCategoryById(btn){ editCategory(btn.getAttribute('data-cid')); }
function deleteCategoryById(btn){ deleteCategory(btn.getAttribute('data-cid')); }
async function deleteCategory(id){
  if(!confirm('حذف هذا القسم؟')) return;
  await db.collection('categories').doc(id).delete();
  storeCategories=storeCategories.filter(c=>c.id!==id);
  renderCatsSection();
  renderFilterBar();
  updateProductCatSelect();
  renderCategoriesAdmin();
  toast('🗑️ تم حذف القسم');
}

function renderCategoriesAdmin(){
  const list=document.getElementById('categoriesList');
  if(!list) return;
  if(!storeCategories.length){list.innerHTML='<div class="empty-msg">لا يوجد أقسام</div>';return;}
  list.innerHTML=storeCategories.map(function(cat){
    var thumb=cat.img
      ?'<img src="'+cat.img+'" style="width:44px;height:44px;object-fit:cover;border-radius:10px;flex-shrink:0;">'
      :'<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,'+cat.color1+','+cat.color2+');display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">'+cat.emoji+'</div>';
    return '<div class="prod-row">'
      +thumb
      +'<div class="prod-info"><div class="prod-name">'+cat.name+'</div></div>'
      +'<div style="display:flex;gap:6px;">'
      +'<button class="btn-del" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;" data-cid="'+cat.id+'" onclick="editCategoryById(this)">✏️</button>'
      +'<button class="btn-del" data-cid="'+cat.id+'" onclick="deleteCategoryById(this)">🗑️</button>'
      +'</div></div>';
  }).join('');
}

async function toggleOutOfStock(btn){
  const pid=btn.getAttribute('data-pid');
  const isOos=btn.getAttribute('data-oos')==='1';
  const newVal=!isOos;
  try{
    await db.collection('products').doc(pid).update({outOfStock:newVal});
    const p=products.find(x=>x._docId===pid||String(x.id)===pid);
    if(p) p.outOfStock=newVal;
    // تحديث الزر
    btn.setAttribute('data-oos',newVal?'1':'0');
    btn.textContent=newVal?'❌ نفذ':'✅ متوفر';
    btn.style.background=newVal?'#fef2f2':'#f0fdf4';
    btn.style.color=newVal?'#dc2626':'#16a34a';
    btn.style.borderColor=newVal?'#fca5a5':'#86efac';
    renderStore();
    toast(newVal?'تم تحديده كـ نفذ المخزون':'✅ المنتج متوفر الآن');
  }catch(e){toast('❌ خطأ في التحديث');}
}

// ===== BACK BUTTON HANDLER =====
window.addEventListener('popstate', function(e){
  // 1. الصورة الكبيرة
  if(_fullImgOverlay){
    _fullImgOverlay.remove();
    _fullImgOverlay=null;
    return;
  }
  // 2. صفحة المنتج
  const overlay = document.getElementById('productPageOverlay');
  if(overlay && overlay.classList.contains('open')){
    overlay.classList.remove('open');
    document.getElementById('ppVideoContainer').innerHTML='';
    if(location.hash.startsWith('#product-')){
      history.replaceState(null,'',location.pathname);
    }
    return;
  }
  // 3. صفحة "من نحن"
  const aboutOv = document.getElementById('aboutOverlay');
  if(aboutOv && aboutOv.classList.contains('open')){
    aboutOv.classList.remove('open');
    return;
  }
  // 4. صفحة تتبع الطلب
  const trackOv = document.getElementById('orderStatusOverlay');
  if(trackOv && trackOv.classList.contains('open')){
    trackOv.classList.remove('open');
    return;
  }
  // 5. السلة
  const cart = document.getElementById('cartDrawer');
  if(cart && cart.classList.contains('open')){
    closeCart();
    return;
  }
});

// ===== GLOBALS =====
window.openAuth=openAuth; window.closeAuth=closeAuth;
window.openCart=openCart; window.closeCart=closeCart;
window.filterProds=filterProds; window.searchProducts=searchProducts;
window.handleAddToCart=handleAddToCart;
window.selectWritingOpt=selectWritingOpt;
window.closeWritingModal=closeWritingModal;
window.confirmWritingAndAdd=confirmWritingAndAdd;
window.changeQty=changeQty; window.removeCart=removeCart;
window.openCheckout=openCheckout; window.closeCheckout=closeCheckout;
window.checkoutWA=checkoutWA; window.applyDiscount=applyDiscount;
window.confirmOrder=confirmOrder; window.clearCart=clearCart;
window.switchAuthTab=switchAuthTab;
window.doCustomerLogin=doCustomerLogin; window.doCustomerRegister=doCustomerRegister;
window.openProfile=openProfile; window.closeProfile=closeProfile;
window.logoutCustomer=logoutCustomer;
window.openAdminLogin=openAdminLogin; window.closeAdminLogin=closeAdminLogin;
window.doAdminLogin=doAdminLogin;
window.openAdmin=openAdmin; window.closeAdmin=closeAdmin; window.logoutAdmin=logoutAdmin;
window.switchAdminTab=switchAdminTab;
window.loadAdminUsers=loadAdminUsers; window.addAdminUser=addAdminUser; window.deleteAdminUser=deleteAdminUser;
window.openEmpLogin=openEmpLogin; window.closeEmpLogin=closeEmpLogin; window.doEmpLogin=doEmpLogin;
window.closeEmpPanel=closeEmpPanel; window.logoutEmp=logoutEmp;
window.onEmpImageChange=onEmpImageChange; window.clearEmpImage=clearEmpImage;
window.submitEmpOrder=submitEmpOrder;
window.addEmpWorker=addEmpWorker; window.deleteEmpWorker=deleteEmpWorker; window.editEmpWorker=editEmpWorker;
// ============================
// ATTENDANCE SYSTEM
// ============================
let _attToken=null;
let _qrScanCallback=null;
let _netEnablePromise=null;
let _netEnabledOnce=false;
function _ensureNet(){
  if(_netEnabledOnce) return Promise.resolve();
  if(!_netEnablePromise)
    _netEnablePromise=firebase.firestore().enableNetwork()
      .then(()=>{_netEnabledOnce=true;})
      .catch(()=>{})
      .finally(()=>{_netEnablePromise=null;});
  return _netEnablePromise;
}

async function _getOrCreateAttToken(){
  if(_attToken) return _attToken;
  // try up to 2 times (server then cache fallback)
  for(const src of [{source:'server'},{}]){
    try{
      await _ensureNet();
      const snap=await db.collection('config').doc('attendance_qr').get(src);
      if(snap.exists&&snap.data().token){_attToken=snap.data().token;return _attToken;}
    }catch(e){console.warn('AttToken fetch',src,e);}
  }
  // create new token if none exists
  try{
    const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const tok='ATT-'+Array.from({length:12},()=>c[Math.floor(Math.random()*c.length)]).join('');
    await db.collection('config').doc('attendance_qr').set({token:tok,createdAt:new Date().toISOString()});
    _attToken=tok;
    return _attToken;
  }catch(e){console.error('AttToken create',e);return null;}
}

function openAttendanceScan(){
  if(!_empCurrentUser){alert('سجّل دخولك أولاً');return;}
  _qrScanCallback=_handleAttendanceScan;
  openQRScanner();
}

async function _handleAttendanceScan(raw){
  _qrScanCallback=null;
  const token=await _getOrCreateAttToken();
  if(!token){
    _showAttResult('error','تعذّر الاتصال — تأكد من الإنترنت وأعد المسح');
    return;
  }
  if(raw.trim()!==token.trim()){
    _showAttResult('error','كود خاطئ — امسح QR الدوام الموجود بالمشغل');
    return;
  }
  const emp=_empCurrentUser;
  const now=new Date();
  const date=now.toLocaleDateString('en-CA');
  const docId=(emp.id||emp.username)+'_'+date;
  try{
    const snap=await db.collection('attendance').doc(docId).get();
    if(!snap.exists||!snap.data().checkIn){
      await db.collection('attendance').doc(docId).set({
        employeeId:emp.id||emp.username,
        employeeName:emp.displayName||emp.username,
        date,checkIn:now.toISOString(),checkOut:null,hoursWorked:null
      });
      _showAttResult('in',now.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}));
    } else if(!snap.data().checkOut){
      const secs=Math.floor((now-new Date(snap.data().checkIn))/1000);
      await db.collection('attendance').doc(docId).update({checkOut:now.toISOString(),secondsWorked:secs});
      _showAttResult('out',now.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}),secs);
    } else {
      _showAttResult('done',snap.data().secondsWorked||0);
    }
  }catch(e){_showAttResult('error',e.message);}
}

function _fmtDuration(secs){
  if(!secs&&secs!==0)return'—';
  const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;
  if(h>0)return`${h}س ${m}د`;
  if(m>0)return`${m}د ${s}ث`;
  return`${s}ث`;
}
function _secsToDecimalHrs(secs){return Math.round(secs/36)/100;}

function _showAttResult(type,...args){
  const ex=document.getElementById('attResultOverlay');
  if(ex)ex.remove();
  let icon,title,sub='',color;
  if(type==='in'){icon='✅';title='تم تسجيل الدخول';sub=`<div style="font-size:1.6rem;font-weight:900;color:#fff;margin:6px 0;">${args[0]}</div>`;color='#4ade80';}
  else if(type==='out'){icon='✅';title='تم تسجيل الخروج';sub=`<div style="font-size:1.6rem;font-weight:900;color:#fff;margin:6px 0;">${args[0]}</div><div style="color:rgba(255,255,255,0.6);font-size:0.9rem;">المجموع: ${_fmtDuration(args[1])}</div>`;color='#60a5fa';}
  else if(type==='done'){icon='ℹ️';title='دوام اليوم مكتمل';sub=`<div style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-top:6px;">المجموع: ${_fmtDuration(args[0])}</div>`;color='#fbbf24';}
  else{icon='❌';title=args[0];color='#f87171';}
  const ov=document.createElement('div');
  ov.id='attResultOverlay';
  ov.style.cssText='position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;font-family:\'Tajawal\',sans-serif;';
  ov.innerHTML=`<div style="background:#111;border-radius:22px;padding:34px 28px;text-align:center;max-width:290px;width:88%;border:2px solid ${color}33;">
    <div style="font-size:2.8rem;">${icon}</div>
    <div style="font-size:1.1rem;font-weight:900;color:${color};margin:10px 0 4px;">${title}</div>
    ${sub}
    <button onclick="document.getElementById('attResultOverlay').remove()" style="margin-top:18px;padding:12px 32px;background:${color};color:#000;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.95rem;font-weight:900;cursor:pointer;">موافق</button>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>{const e=document.getElementById('attResultOverlay');if(e)e.remove();},5000);
}

async function openAttendanceModal(){
  document.getElementById('attendanceModal').style.display='block';
  document.body.style.overflow='hidden';
  const today=new Date().toLocaleDateString('en-CA');
  document.getElementById('attDateFilter').value=today;
  await _loadAttQR();
  await _loadAttendanceData(today);
}
function closeAttendanceModal(){
  document.getElementById('attendanceModal').style.display='none';
  document.body.style.overflow='';
}

async function _loadAttQR(){
  const token=await _getOrCreateAttToken();
  const imgEl=document.getElementById('attQRImg');
  if(!token||!imgEl)return;
  const qrUrl='https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(token)+'&size=180x180&bgcolor=ffffff&color=000000&margin=10';
  imgEl.innerHTML=`<img src="${qrUrl}" style="width:160px;height:160px;border-radius:8px;border:3px solid #fff;">`;
}

function _printAttQR(){
  if(!_attToken)return;
  const qrUrl='https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(_attToken)+'&size=500x500&bgcolor=ffffff&color=000000&margin=10';
  const w=window.open('','_blank','width=300,height=340');
  w.document.write(`<html><head><title>QR الدوام</title><style>
    @page{size:5cm 7cm;margin:0;}
    *{box-sizing:border-box;}
    body{margin:0;width:5cm;height:7cm;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;font-family:Tajawal,Arial,sans-serif;direction:rtl;overflow:hidden;}
    .title{font-size:11pt;font-weight:900;color:#166534;margin-bottom:3mm;letter-spacing:0.5px;}
    img{width:4cm;height:4cm;display:block;}
    .sub{font-size:7.5pt;color:#555;margin-top:3mm;text-align:center;line-height:1.4;}
  </style></head><body>
    <div class="title">⏱ دوام المشغل</div>
    <img src="${qrUrl}">
    <div class="sub">امسح الكود لتسجيل<br>الدخول / الخروج</div>
  <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

async function _loadAttendanceData(date){
  const container=document.getElementById('attRecordsContainer');
  const totalEl=document.getElementById('attTotalSection');
  if(!container)return;
  container.innerHTML='<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);">⏳ تحميل...</div>';
  if(totalEl)totalEl.innerHTML='';
  try{
    const snap=await db.collection('attendance').where('date','==',date).get();
    if(snap.empty){container.innerHTML='<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);">لا يوجد سجلات لهذا اليوم</div>';return;}
    const records=snap.docs.map(d=>d.data()).sort((a,b)=>(a.checkIn||'').localeCompare(b.checkIn||''));
    // Fetch hourly rates for all employees
    const empIds=[...new Set(records.map(r=>r.employeeId))];
    const rateMap={};
    await Promise.all(empIds.map(async id=>{
      try{const rd=await db.collection('emp_wage_rates').doc(id).get();rateMap[id]=parseFloat(rd.exists?rd.data().hourlyRate||0:0);}catch(e){rateMap[id]=0;}
    }));
    let totalSecs=0,totalEarned=0;
    let html=`<table style="width:100%;border-collapse:collapse;font-size:0.8rem;direction:rtl;">
      <thead><tr style="background:#1a2e1a;">
        <th style="padding:9px 10px;text-align:right;color:#4ade80;font-weight:800;">الموظف</th>
        <th style="padding:9px 6px;text-align:center;color:#4ade80;font-weight:800;">دخول</th>
        <th style="padding:9px 6px;text-align:center;color:#60a5fa;font-weight:800;">خروج</th>
        <th style="padding:9px 6px;text-align:center;color:#c9a84c;font-weight:800;">المدة</th>
        <th style="padding:9px 6px;text-align:center;color:#f97316;font-weight:800;">الأجر</th>
      </tr></thead><tbody>`;
    records.forEach(r=>{
      const inT=r.checkIn?new Date(r.checkIn).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—';
      const outT=r.checkOut?new Date(r.checkOut).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—';
      const secs=r.secondsWorked!=null?r.secondsWorked:(r.hoursWorked!=null?Math.round(r.hoursWorked*3600):null);
      const hrRate=rateMap[r.employeeId]||0;
      const earned=secs!=null&&hrRate?Math.round(_secsToDecimalHrs(secs)*hrRate*100)/100:null;
      if(secs!=null){totalSecs+=secs;if(earned)totalEarned+=earned;}
      const durLabel=secs!=null?_fmtDuration(secs):r.checkIn&&!r.checkOut?'<span style="color:#fbbf24;font-size:0.75rem;">جارٍ</span>':'—';
      const earnLabel=earned!=null?earned.toFixed(2)+' د.أ':hrRate?'—':'<span style="color:#555;font-size:0.72rem;">لم يُحدد</span>';
      html+=`<tr style="border-bottom:1px solid #222;">
        <td style="padding:9px 10px;font-weight:700;color:#fff;">${r.employeeName||r.employeeId}</td>
        <td style="padding:8px 6px;text-align:center;color:#4ade80;font-weight:700;">${inT}</td>
        <td style="padding:8px 6px;text-align:center;color:#60a5fa;font-weight:700;">${outT}</td>
        <td style="padding:8px 6px;text-align:center;color:#c9a84c;font-weight:800;">${durLabel}</td>
        <td style="padding:8px 6px;text-align:center;color:#f97316;font-weight:800;">${earnLabel}</td>
      </tr>`;
    });
    html+='</tbody></table>';
    container.innerHTML=html;
    if(totalEl){
      let summary='';
      if(totalSecs>0)summary+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;"><span style="color:rgba(255,255,255,0.6);font-size:0.85rem;">إجمالي الساعات</span><span style="color:#4ade80;font-weight:900;">${_fmtDuration(totalSecs)}</span></div>`;
      if(totalEarned>0)summary+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-top:1px solid #222;"><span style="color:rgba(255,255,255,0.6);font-size:0.85rem;">إجمالي الأجر</span><span style="color:#f97316;font-weight:900;">${totalEarned.toFixed(2)} د.أ</span></div>`;
      if(summary)totalEl.innerHTML=`<div style="background:#1a1a1a;border-radius:12px;border:1px solid #222;overflow:hidden;">${summary}</div>`;
    }
  }catch(e){container.innerHTML=`<div style="color:#f87171;padding:20px;text-align:center;">❌ ${e.message}</div>`;}
}

window.loadEmpWages=loadEmpWages; window.ewOpenStore=ewOpenStore; window.ewOpenMashghal=ewOpenMashghal; window.ewOpenEmployee=ewOpenEmployee; window.ewSaveRate=ewSaveRate; window.ewRecordPayment=ewRecordPayment; window.ewDeletePayment=ewDeletePayment; window.ewBack=ewBack; window.ewBackToStore=ewBackToStore;
window.openAttendanceScan=openAttendanceScan; window.openAttendanceModal=openAttendanceModal; window.closeAttendanceModal=closeAttendanceModal; window._loadAttendanceData=_loadAttendanceData; window._printAttQR=_printAttQR;
window.ewSaveHourlyRate=ewSaveHourlyRate;
window.openFrameGallery=openFrameGallery; window.closeFrameGallery=closeFrameGallery; window.markFramePhotoTaken=markFramePhotoTaken;
window.toggleFrameSelectMode=toggleFrameSelectMode; window._toggleFrameSelect=_toggleFrameSelect; window.frameSelectAll=frameSelectAll; window.markSelectedFramesTaken=markSelectedFramesTaken; window._downloadOrderImages=_downloadOrderImages;
window.openGalleryMgmt=openGalleryMgmt; window.closeGalleryMgmt=closeGalleryMgmt; window.searchGalleryCustomer=searchGalleryCustomer; window.createGalleryCustomer=createGalleryCustomer; window.uploadGalleryPhotos=uploadGalleryPhotos; window.deleteGalleryPhoto=deleteGalleryPhoto; window._printGalleryQR=_printGalleryQR; window._previewGalleryPhoto=_previewGalleryPhoto;
window._slideshowNext=_slideshowNext; window._slideshowPrev=_slideshowPrev; window._slideshowGoTo=_slideshowGoTo;
window.onEmpPageChange=onEmpPageChange; window.onEmpProductChange=onEmpProductChange;
window.addToEmpCart=addToEmpCart; window.removeFromEmpCart=removeFromEmpCart; window.changeEmpQty=changeEmpQty; window.updateCartItemColor=updateCartItemColor; window.updateCartItemWriting=updateCartItemWriting; window.updateCartItemPrice=updateCartItemPrice; window.updateEmpEditPrice=updateEmpEditPrice;
window.selectEmpProduct=selectEmpProduct; window.renderEmpProductPicker=renderEmpProductPicker;
window.selectEmpColor=selectEmpColor;
window.addOppColor=addOppColor; window.removeOppColor=removeOppColor;
window.addOppPriceOption=addOppPriceOption; window.removeOppPriceOption=removeOppPriceOption;
window.filterEmpProductGrid=filterEmpProductGrid; window.clearEmpProductSearch=clearEmpProductSearch; window.filterEmpProductCategory=filterEmpProductCategory; window.toggleEmpUrgent=toggleEmpUrgent;
window.runSmartPaste=runSmartPaste; window.onEmpPhoneInput=onEmpPhoneInput; window.applyEmpCustomer=applyEmpCustomer;
window.onOppImageChange=onOppImageChange; window.clearOppImage=clearOppImage;
window.loadEmpPagesAdmin=loadEmpPagesAdmin; window.addEmpPage=addEmpPage; window.deleteEmpPage=deleteEmpPage; window.editEmpPage=editEmpPage; window.toggleEmpPageVisibility=toggleEmpPageVisibility;
window.loadEmpProductsAdmin=loadEmpProductsAdmin; window.addEmpProduct=addEmpProduct; window.deleteEmpProduct=deleteEmpProduct; window.editEmpProduct=editEmpProduct;
window.loadEmpOrders=loadEmpOrders; window.loadOperatorOrders=loadOperatorOrders;
window.toggleOpSelectMode=toggleOpSelectMode; window.opToggleSelect=opToggleSelect; window.opSelectAll=opSelectAll; window.opClearSelect=opClearSelect; window.printSelectedOrders=printSelectedOrders; window.printSelectedLabels=printSelectedLabels;
window.setEmpOrderFilter=setEmpOrderFilter; window.setOpOrderFilter=setOpOrderFilter; window.deleteEmpOrder=deleteEmpOrder;
window.updateEmpOrderStatus=updateEmpOrderStatus; window.printEmpOrder=printEmpOrder; window.printOrderQR=printOrderQR;

// Auto-open order from QR scan: ?order=ORDER_ID (requires login)
(function(){
  const p=new URLSearchParams(window.location.search);
  const qrOrder=p.get('order');
  if(!qrOrder) return;
  // Clean the URL so refreshing won't re-open
  try{window.history.replaceState(null,'',window.location.pathname);}catch(e){}
  // Guard: if this same order was already opened from QR more than 2 min ago, skip.
  // This prevents PWA shortcuts saved with ?order= from re-opening on every launch.
  const LS_KEY='_qrTs_'+qrOrder;
  const last=parseInt(localStorage.getItem(LS_KEY)||'0');
  const now=Date.now();
  if(now-last > 2*60*1000){
    localStorage.setItem(LS_KEY,String(now));
  } else {
    return; // already handled recently, skip
  }
  let tries=0;
  const tryOpen=()=>{
    const loggedIn=_currentAdminUser||_empCurrentUser;
    if(!loggedIn){
      if(++tries<40) setTimeout(tryOpen,400);
      return;
    }
    if(typeof openOpOrderDetail==='function'){
      openOpOrderDetail(qrOrder);
    } else if(++tries<40){
      setTimeout(tryOpen,400);
    }
  };
  setTimeout(tryOpen,800);
})();
window.saveFCMSettings=saveFCMSettings; window.loadFCMSettings=loadFCMSettings; window.enableMyNotifications=enableMyNotifications; window.testFCMNotification=testFCMNotification; window.enableEmpNotifications=enableEmpNotifications;
window.syncOrderToAccounting=syncOrderToAccounting;
window.setEmpDeliveryFee=setEmpDeliveryFee; window.updateEmpNet=updateEmpNet;
window.openEmpOrderImage=openEmpOrderImage; window.switchEmpSubTab=switchEmpSubTab;
window.loadDaySheet=loadDaySheet; window.printDaySheet=printDaySheet;
window.openDaysheetStoreDetail=openDaysheetStoreDetail; window.backToDaysheetList=backToDaysheetList;
window.onEmpDlvStoreChange=onEmpDlvStoreChange; window.addEmpDlvItem=addEmpDlvItem;
window.removeEmpDlvItem=removeEmpDlvItem; window.changeEmpDlvQty=changeEmpDlvQty;
window.onEmpDlvImageChange=onEmpDlvImageChange; window.clearEmpDlvImage=clearEmpDlvImage;
window.submitEmpDelivery=submitEmpDelivery;
window.cancelEmpOrder=cancelEmpOrder; window.openEmpOrderEdit=openEmpOrderEdit; window.closeEmpOrderEdit=closeEmpOrderEdit; window.saveEmpOrderEdit=saveEmpOrderEdit; window.openOpOrderDetail=openOpOrderDetail; window.closeOpOrderDetail=closeOpOrderDetail; window._cancelOpOrderFromDetail=_cancelOpOrderFromDetail; window._returnOpOrderFromDetail=_returnOpOrderFromDetail; window._openRepPickerFromDetail=_openRepPickerFromDetail;

// ===== DELIVERY REPS =====
let _deliveryModalOrder=null;
let _deliveryBatchOrders=[];
let _deliveryRepsCache=null; // null = not loaded yet

async function _loadDeliveryReps(){
  if(_deliveryRepsCache!==null)return _deliveryRepsCache;
  try{
    const snap=await db.collection('operator_config').doc('delivery_reps').get();
    if(snap.exists&&snap.data().reps){
      _deliveryRepsCache=snap.data().reps;
    }else{
      // one-time migration from localStorage
      const legacy=JSON.parse(localStorage.getItem('delivery_reps')||'[]');
      _deliveryRepsCache=legacy;
      if(legacy.length) await db.collection('operator_config').doc('delivery_reps').set({reps:legacy});
      localStorage.removeItem('delivery_reps');
    }
  }catch(e){_deliveryRepsCache=JSON.parse(localStorage.getItem('delivery_reps')||'[]');}
  return _deliveryRepsCache;
}

async function _saveDeliveryReps(reps){
  _deliveryRepsCache=reps;
  await db.collection('operator_config').doc('delivery_reps').set({reps});
}

// ===== DELIVERY BATCH CONFIRMATION LINK =====
function _genBatchId(){return Date.now().toString(36)+Math.random().toString(36).substr(2,6);}

async function _initDeliveryBatchPage(){
  const params=new URLSearchParams(window.location.search);
  const batchId=params.get('deliverBatch');
  if(!batchId) return;
  document.getElementById('deliverBatchOverlay').style.display='block';
  document.body.style.overflow='hidden';
  const content=document.getElementById('deliverBatchContent');
  try{
    const snap=await db.collection('delivery_batches').doc(batchId).get();
    if(!snap.exists){content.innerHTML='<div style="text-align:center;padding:30px;color:#dc2626;">❌ الرابط غير صالح</div>';return;}
    const orders=snap.data().orders||[];
    const statusMap={};
    await Promise.all(orders.map(async o=>{
      try{const s=await db.collection('employee_orders').doc(o.id).get();if(s.exists)statusMap[o.id]=s.data().status;}catch(e){}
    }));
    _renderBatchConfirmPage(batchId,orders,statusMap,content);
  }catch(e){content.innerHTML='<div style="text-align:center;padding:30px;color:#dc2626;">❌ خطأ في التحميل</div>';}
}

function _renderBatchConfirmPage(batchId,orders,statusMap,content){
  content.innerHTML=orders.map(o=>{
    const isDone=statusMap[o.id]==='delivered';
    const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
    const prods=(o.products||[]).map(p=>`${p.name}${(p.qty||1)>1?' × '+p.qty:''}`).join('، ');
    const net=(o.netPrice||0).toFixed(2);
    return `<div id="batchCard_${o.id}" style="background:${isDone?'#f0fdf4':'#fff'};border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.07);${isDone?'border:2px solid #86efac;':''}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div><div style="font-weight:800;color:#1a3a2a;font-size:0.95rem;">${o.pageName||''}</div><div style="font-size:0.76rem;color:#6b7280;">${label}</div></div>
        <div style="font-weight:800;color:#166534;font-size:1rem;">${net} د.أ</div>
      </div>
      <div style="font-size:0.8rem;color:#374151;margin-bottom:2px;">📞 ${o.customerPhone||''}</div>
      <div style="font-size:0.8rem;color:#374151;margin-bottom:8px;">📍 ${o.address||''}${o.area?' ('+o.area+')':''}</div>
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:12px;">📦 ${prods}</div>
      ${isDone
        ?`<div style="text-align:center;background:#dcfce7;color:#166534;padding:10px;border-radius:10px;font-weight:700;">✅ تم التسليم</div>`
        :`<button id="btn_${o.id}" onclick="confirmBatchOrder('${batchId}','${o.id}')"
            style="width:100%;padding:13px;background:#1a3a2a;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:1rem;font-weight:700;cursor:pointer;">
            ✅ تم التسليم
          </button>`
      }
    </div>`;
  }).join('');
}

async function confirmBatchOrder(batchId,orderId){
  const btn=document.getElementById('btn_'+orderId);
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري التحديث...';}
  try{
    const docRef=db.collection('employee_orders').doc(orderId);
    const snap=await docRef.get();
    if(!snap.exists){if(btn){btn.disabled=false;btn.textContent='❌ طلب غير موجود';}return;}
    const data=snap.data();
    const now=new Date();
    const amman=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Amman'}));
    const deliveredDate=amman.toISOString().split('T')[0];
    const editEntry={by:'مندوب',at:deliveredDate,note:'مُسلَّم ← قيد التوصيل'};
    await docRef.update({status:'delivered',deliveredDate,editHistory:[...(data.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    try{await syncOrderToAccounting(orderId,{...data,status:'delivered'});}catch(e){}
    const card=document.getElementById('batchCard_'+orderId);
    if(card){
      card.style.background='#f0fdf4';
      card.style.border='2px solid #86efac';
      const btnWrap=btn?.parentElement;
      if(btnWrap) btnWrap.innerHTML='<div style="text-align:center;background:#dcfce7;color:#166534;padding:10px;border-radius:10px;font-weight:700;">✅ تم التسليم</div>';
    }
    if(!document.querySelector('[id^="btn_"]:not(:disabled)')){
      setTimeout(()=>{document.getElementById('deliverBatchContent').innerHTML=`<div style="text-align:center;padding:40px;"><div style="font-size:3rem;margin-bottom:12px;">🎉</div><div style="font-weight:800;color:#166534;font-size:1.1rem;">تم تسليم جميع الطلبات</div></div>`;},400);
    }
  }catch(e){if(btn){btn.disabled=false;btn.textContent='❌ حاول مرة ثانية';}}
}

function _buildDeliveryMsg(o){
  const orderLabel=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
  const prods=(o.products||[]).map(p=>`• ${p.name}${(p.qty||1)>1?' × '+(p.qty||1):''}`).join('\n');
  const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
  const dlv=o.deliveryFee||0;
  let msg=`🚚 طلب توصيل جديد\n${orderLabel}\n──────────────\n`;
  msg+=`📄 الصفحة: ${o.pageName||''}\n`;
  msg+=`📞 الزبون: ${o.customerPhone||''}\n`;
  msg+=`📍 العنوان: ${o.address||''}`;
  if(o.area)msg+=`\n🗺 المنطقة: ${o.area}`;
  msg+=`\n\n📦 المنتجات:\n${prods}\n`;
  msg+=`\n💰 المجموع: ${net.toFixed(2)} د.أ`;
  if(dlv>0)msg+=` (توصيل ${dlv.toFixed(2)})`;
  if(o.notes)msg+=`\n📝 ملاحظات: ${o.notes}`;
  return msg;
}

async function _renderDeliveryModal(){
  const o=_deliveryModalOrder;
  if(!o)return;
  const isBatch=_deliveryBatchOrders.length>1;
  const infoEl=document.getElementById('deliveryModalOrderInfo');
  if(infoEl){
    if(isBatch){
      const totalNet=_deliveryBatchOrders.reduce((s,x)=>{const n=x.netPrice!=null?x.netPrice:(x.totalPrice||0);return s+n;},0);
      const areas=[...new Set(_deliveryBatchOrders.map(x=>x.area||'بدون منطقة'))].join(' · ');
      infoEl.innerHTML=`<div style="font-weight:800;color:#1a3a2a;font-size:0.9rem;margin-bottom:5px;">📦 ${_deliveryBatchOrders.length} طلبات محددة</div>
        <div style="font-size:0.79rem;color:#6b7280;">🗺 ${areas}</div>
        <div style="font-size:0.82rem;color:#166534;font-weight:700;margin-top:3px;">💰 الإجمالي: ${totalNet.toFixed(2)} د.أ</div>
        <div style="margin-top:6px;font-size:0.74rem;color:#6b7280;">${_deliveryBatchOrders.map(x=>(x.orderNum?`#${x.orderNum}`:'#'+x.id.slice(-6).toUpperCase())+' — '+x.customerPhone).join('\n')}</div>`;
    }else{
      const orderLabel=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
      const prodsStr=(o.products||[]).map(p=>`${p.name} × ${p.qty||1}`).join(' · ');
      infoEl.innerHTML=`<div style="font-weight:800;color:#1a3a2a;font-size:0.9rem;margin-bottom:4px;">${orderLabel} — ${o.pageName||''}</div>
        <div style="font-size:0.8rem;color:#374151;">📞 ${o.customerPhone||''} &nbsp;·&nbsp; 📍 ${o.address||''}</div>
        <div style="font-size:0.78rem;color:#6b7280;margin-top:3px;">📦 ${prodsStr}</div>`;
    }
  }
  const reps=await _loadDeliveryReps();
  const msg=isBatch?_buildBatchDeliveryMsg(_deliveryBatchOrders):_buildDeliveryMsg(o);
  const encoded=encodeURIComponent(msg);
  const listEl=document.getElementById('deliveryRepsList');
  if(listEl){
    listEl.innerHTML=reps.length
      ?reps.map((r,i)=>{const waUrl=`https://wa.me/${r.phone.replace(/[^\d+]/g,'')}?text=${encoded}`;const safeName=(r.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");const safePhone=(r.phone||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");return`<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;margin-bottom:7px;">
          <div><div style="font-weight:700;color:#1a3a2a;font-size:0.85rem;">${r.name}</div><div style="font-size:0.73rem;color:#6b7280;">${r.phone}</div></div>
          <button onclick="sendAndMarkDelivering_withRep('${waUrl.replace(/'/g,"\\'").replace(/\\/g,'\\\\')}','${safeName}','${safePhone}')" style="display:inline-flex;align-items:center;gap:5px;padding:8px 16px;background:#25D366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.83rem;font-weight:700;cursor:pointer;">📱 إرسال</button>
        </div>`;}).join('')
      :'<div style="text-align:center;color:#9ca3af;font-size:0.8rem;padding:12px 0;">لا يوجد مناديب محفوظون — أضف أدناه</div>';
  }
  const manageEl=document.getElementById('deliveryRepsManage');
  if(manageEl){
    manageEl.innerHTML=reps.length
      ?reps.map((r,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:#f9fafb;border-radius:7px;margin-bottom:4px;">
          <span style="font-size:0.78rem;color:#374151;">${r.name} — ${r.phone}</span>
          <button onclick="removeDeliveryRep(${i})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:0.72rem;font-family:'Tajawal',sans-serif;">🗑</button>
        </div>`).join('')
      :'<div style="font-size:0.75rem;color:#9ca3af;padding:4px 0;">لا يوجد مناديب</div>';
  }
}

async function openDeliveryModal(orderId){
  try{
    const snap=await db.collection('employee_orders').doc(orderId).get();
    if(!snap.exists){toast('⚠️ لم يُعثر على الطلب');return;}
    _deliveryModalOrder={id:snap.id,...snap.data()};
    await _renderDeliveryModal();
    document.getElementById('deliveryRepModal').style.display='block';
    document.body.style.overflow='hidden';
  }catch(e){toast('❌ '+e.message);}
}

function closeDeliveryModal(){
  document.getElementById('deliveryRepModal').style.display='none';
  document.body.style.overflow='';
  _deliveryModalOrder=null;
  _deliveryBatchOrders=[];
}

async function addDeliveryRep(){
  const name=(document.getElementById('newRepName').value||'').trim();
  const phone=(document.getElementById('newRepPhone').value||'').trim();
  if(!name){toast('⚠️ أدخل اسم المندوب');return;}
  const reps=await _loadDeliveryReps();
  reps.push({name,phone});
  await _saveDeliveryReps(reps);
  document.getElementById('newRepName').value='';
  document.getElementById('newRepPhone').value='';
  await _renderDeliveryModal();
  toast('✅ تم إضافة المندوب');
}

async function removeDeliveryRep(idx){
  const reps=await _loadDeliveryReps();
  reps.splice(idx,1);
  await _saveDeliveryReps(reps);
  await _renderDeliveryModal();
  renderOpRepsPanelList();
}

// ===== OPERATOR REPS PANEL =====
async function renderOpRepsPanelList(){
  const wrap=document.getElementById('opRepsPanelList');
  if(!wrap)return;
  const reps=await _loadDeliveryReps();
  if(!reps.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.8rem;padding:10px 0;">لا يوجد مناديب — أضف من الأسفل</div>';
    return;
  }
  wrap.innerHTML=reps.map((r,i)=>{
    const borderColor=r.excludeFromBalance?'#fca5a5':r.role==='supervisor'?'#c4b5fd':'#bae6fd';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#fff;border:1.5px solid ${borderColor};border-radius:10px;margin-bottom:6px;">
      <div>
        <div style="font-weight:700;color:#0c4a6e;font-size:0.86rem;">${r.name}${r.role==='supervisor'?' <span style="font-size:0.68rem;background:#ede9fe;color:#7c3aed;padding:2px 6px;border-radius:6px;font-weight:800;">مشرف</span>':''}${r.excludeFromBalance?' <span style="font-size:0.68rem;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:6px;font-weight:800;">خارج الرصيد</span>':''}</div>
        <div style="font-size:0.75rem;color:#6b7280;direction:ltr;text-align:right;">${r.phone||'<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">بدون رقم</span>'}</div>
      </div>
      <div style="display:flex;gap:5px;">
        <button onclick="toggleRepExcludeBalance(${i})" style="padding:6px 10px;background:${r.excludeFromBalance?'#fee2e2':'#f0fdf4'};color:${r.excludeFromBalance?'#dc2626':'#166534'};border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-family:'Tajawal',sans-serif;font-weight:700;" title="${r.excludeFromBalance?'مستبعد من حساب الرصيد':'مضمّن في حساب الرصيد'}">${r.excludeFromBalance?'🚚':'💰'}</button>
        <button onclick="toggleRepSupervisor(${i})" style="padding:6px 10px;background:${r.role==='supervisor'?'#ede9fe':'#f3f4f6'};color:${r.role==='supervisor'?'#7c3aed':'#6b7280'};border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-family:'Tajawal',sans-serif;font-weight:700;" title="مشرف مناديب">🗂</button>
        ${r.phone?`<a href="https://wa.me/${r.phone.replace(/[^\d+]/g,'')}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 11px;background:#25D366;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;text-decoration:none;">📱</a>`:''}
        <button onclick="removeRepFromPanel(${i})" style="padding:6px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-family:'Tajawal',sans-serif;font-weight:700;">🗑</button>
      </div>
    </div>`;}).join('');
}

async function toggleRepsPanel(btn){
  const panel=document.getElementById('opRepsPanel');
  if(!panel)return;
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'block';
  _styleToggleBtn(btn,!isOpen);
  if(!isOpen) await renderOpRepsPanelList();
}

async function addRepFromPanel(){
  const name=(document.getElementById('opNewRepName')?.value||'').trim();
  const phone=(document.getElementById('opNewRepPhone')?.value||'').trim();
  if(!name){toast('⚠️ أدخل اسم المندوب');return;}
  const reps=await _loadDeliveryReps();
  reps.push({name,phone});
  await _saveDeliveryReps(reps);
  document.getElementById('opNewRepName').value='';
  document.getElementById('opNewRepPhone').value='';
  await renderOpRepsPanelList();
  toast('✅ تم إضافة المندوب');
}

async function removeRepFromPanel(idx){
  const reps=await _loadDeliveryReps();
  reps.splice(idx,1);
  await _saveDeliveryReps(reps);
  renderOpRepsPanelList();
  toast('✅ تم الحذف');
}

async function toggleRepSupervisor(idx){
  const reps=await _loadDeliveryReps();
  reps[idx].role=reps[idx].role==='supervisor'?'rep':'supervisor';
  await _saveDeliveryReps(reps);
  renderOpRepsPanelList();
  toast(reps[idx].role==='supervisor'?'✅ صار مشرف مناديب':'تم إلغاء صلاحية المشرف');
}

async function toggleRepExcludeBalance(idx){
  const reps=await _loadDeliveryReps();
  reps[idx].excludeFromBalance=!reps[idx].excludeFromBalance;
  await _saveDeliveryReps(reps);
  renderOpRepsPanelList();
  toast(reps[idx].excludeFromBalance?'🚚 سيُستبعد من حساب الرصيد':'💰 سيُضمَّن في حساب الرصيد');
}

async function toggleRepBalanceByName(name){
  const reps=await _loadDeliveryReps();
  const rep=reps.find(r=>r.name===name);
  if(!rep){toast('⚠️ المندوب غير موجود بالقائمة');return;}
  rep.excludeFromBalance=!rep.excludeFromBalance;
  await _saveDeliveryReps(reps);
  toast(rep.excludeFromBalance?`🚚 "${name}" خارج الرصيد الآن`:`💰 "${name}" ضمن الرصيد الآن`);
  renderOperatorDailyView();
}

function sendAndMarkDelivering(waUrl){
  window.open(waUrl,'_blank');
  const isBatch=_deliveryBatchOrders.length>1;
  const ids=isBatch?_deliveryBatchOrders.map(x=>x.id):[_deliveryModalOrder?.id].filter(Boolean);
  closeDeliveryModal();
  ids.forEach(id=>updateEmpOrderStatus(id,'delivering'));
}

function sendDeliveryToCustomPhone(){
  const raw=(document.getElementById('deliveryCustomPhone').value||'').trim();
  if(!raw){toast('⚠️ أدخل رقم الهاتف');return;}
  const phone=raw.replace(/[^\d+]/g,'');
  const isBatch=_deliveryBatchOrders.length>1;
  const msg=isBatch?_buildBatchDeliveryMsg(_deliveryBatchOrders):_buildDeliveryMsg(_deliveryModalOrder);
  sendAndMarkDelivering_withRep(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'','');
}

// ===== INTERNAL NOTE (Feature 2) =====
function openInternalNote(id, current){
  const note=prompt('ملاحظة داخلية (للمشغل فقط):', current||'');
  if(note===null)return;
  const update=note.trim()
    ?{internalNote:note.trim()}
    :{internalNote:firebase.firestore.FieldValue.delete()};
  db.collection('employee_orders').doc(id).update(update)
    .then(()=>toast('✅ تم حفظ الملاحظة'))
    .catch(e=>toast('❌ '+e.message));
}

// ===== GROUP BY AREA (Feature 3) =====
let _empGroupByArea=false,_opGroupByArea=false;
let _empKanbanBoardView=false,_opKanbanBoardView=false;

function _styleToggleBtn(btn,active){
  btn.style.background=active?'#111':'#fff';
  btn.style.color=active?'#fff':'#555';
  btn.style.borderColor=active?'#111':'#ebebeb';
}

function toggleEmpGroupArea(btn){
  _empGroupByArea=!_empGroupByArea;
  if(_empGroupByArea){_empKanbanBoardView=false;const kb=document.getElementById('empKanbanBtn');if(kb)_styleToggleBtn(kb,false);}
  _styleToggleBtn(btn,_empGroupByArea);
  _renderEmpOrdersView();
}
function toggleOpGroupArea(btn){
  _opGroupByArea=!_opGroupByArea;
  if(_opGroupByArea){_opKanbanBoardView=false;const kb=document.getElementById('opKanbanBtn');if(kb)_styleToggleBtn(kb,false);}
  _styleToggleBtn(btn,_opGroupByArea);
  _renderOpOrdersView();
}
function toggleEmpKanban(btn){
  _empKanbanBoardView=!_empKanbanBoardView;
  if(_empKanbanBoardView){_empGroupByArea=false;const gb=document.getElementById('empGroupAreaBtn');if(gb)_styleToggleBtn(gb,false);}
  _styleToggleBtn(btn,_empKanbanBoardView);
  _renderEmpOrdersView();
}
function toggleOpKanban(btn){
  _opKanbanBoardView=!_opKanbanBoardView;
  if(_opKanbanBoardView){_opGroupByArea=false;const gb=document.getElementById('opGroupAreaBtn');if(gb)_styleToggleBtn(gb,false);}
  _styleToggleBtn(btn,_opKanbanBoardView);
  _renderOpOrdersView();
}

function _renderGroupedByArea(orders,isOperator,customerHist){
  const prepared=orders.filter(o=>o.status==='prepared');
  if(!prepared.length)return '<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:30px;">لا يوجد طلبات جاهزة للتوصيل في هذا الوقت</div>';
  const grouped={};
  prepared.forEach(o=>{const k=o.area||'بدون منطقة';if(!grouped[k])grouped[k]=[];grouped[k].push(o);});
  const keys=Object.keys(grouped).sort((a,b)=>grouped[b].length-grouped[a].length||a.localeCompare(b,'ar'));
  const batchBar=`<div id="areaBatchBar" style="position:sticky;top:6px;z-index:200;background:linear-gradient(135deg,#1a3a2a,#2d6a4f);border-radius:12px;padding:11px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 14px rgba(0,0,0,0.22);">
    <span id="areaBatchCount" style="color:#a7f3d0;font-weight:700;font-size:0.85rem;">حدد الطلبات للإرسال</span>
    <button onclick="openBatchDeliveryModal()" id="areaBatchSendBtn" disabled style="padding:8px 16px;background:#25D366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;opacity:0.45;transition:opacity 0.2s;">📱 إرسال للمندوب</button>
  </div>`;
  const areaCards=keys.map(area=>{
    const list=grouped[area];
    const safeArea=area.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const cards=list.map(o=>{
      const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
      const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
      const prodsStr=(o.products||[]).map(p=>`${p.name} × ${p.qty||1}`).join(' · ');
      return `<label for="chk_${o.id}" style="display:flex;gap:10px;align-items:flex-start;background:#fff;border:1.5px solid #d1fae5;border-radius:11px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#25D366'" onmouseout="this.style.borderColor='#d1fae5'">
        <input type="checkbox" id="chk_${o.id}" value="${o.id}" onchange="updateBatchBar()" style="width:19px;height:19px;margin-top:2px;accent-color:#25D366;flex-shrink:0;cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div>
              <div style="font-weight:700;color:#1a3a2a;font-size:0.85rem;">${label} — ${o.pageName||''}</div>
              <div style="font-size:0.75rem;color:#6b7280;margin-top:1px;">📞 ${o.customerPhone||''}</div>
              ${_repeatBadge(o.customerPhone,customerHist,'sm')}
              <div style="font-size:0.75rem;color:#6b7280;">📍 ${o.address||''}</div>
            </div>
            <div style="font-weight:800;color:#166534;font-size:0.9rem;flex-shrink:0;">${net.toFixed(2)} د.أ</div>
          </div>
          <div style="font-size:0.77rem;color:#374151;margin-top:4px;">${prodsStr}</div>
          ${o.notes?`<div style="font-size:0.72rem;color:#9ca3af;margin-top:2px;">📝 ${o.notes}</div>`:''}
        </div>
      </label>`;
    }).join('');
    return `<div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:linear-gradient(135deg,#1a3a2a,#2d6a4f);border-radius:10px;margin-bottom:8px;">
        <span style="color:#a7f3d0;font-size:0.88rem;font-weight:700;">🗺 ${area} <span style="font-weight:400;font-size:0.76rem;opacity:0.8;">(${list.length} طلب)</span></span>
        <button onclick="selectAreaOrders('${safeArea}')" style="padding:4px 11px;background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.75rem;cursor:pointer;font-weight:600;">اختر الكل</button>
      </div>
      ${cards}
    </div>`;
  }).join('');
  return batchBar+areaCards;
}

function updateBatchBar(){
  const checked=document.querySelectorAll('[id^="chk_"]:checked');
  const n=checked.length;
  const el=document.getElementById('areaBatchCount');
  const btn=document.getElementById('areaBatchSendBtn');
  if(el)el.textContent=n?`${n} طلب محدد للإرسال`:'حدد الطلبات للإرسال';
  if(btn){btn.disabled=!n;btn.style.opacity=n?'1':'0.45';}
}

function selectAreaOrders(area){
  const allOrders=[...(_empOrdersAllData||[]),...(_opOrdersAllData||[])];
  const seen=new Set();
  allOrders.filter(o=>o.status==='prepared'&&(o.area||'بدون منطقة')===area&&!seen.has(o.id)&&seen.add(o.id))
    .forEach(o=>{const c=document.getElementById('chk_'+o.id);if(c)c.checked=true;});
  updateBatchBar();
}

function viewCustomerHistory(phone){
  const trim=(phone||'').trim();
  if(!trim){toast('❌ لا يوجد رقم هاتف');return;}
  const allOrders=[...(_empOrdersAllData||[]),...(_opOrdersAllData||[])];
  const seen=new Set();
  const orders=[];
  allOrders.forEach(o=>{
    if(seen.has(o.id))return;
    seen.add(o.id);
    if((o.customerPhone||'').trim()===trim)orders.push(o);
  });
  orders.sort((a,b)=>{
    const ad=a.createdAt?.toMillis?.()||0;
    const bd=b.createdAt?.toMillis?.()||0;
    return bd-ad;
  });
  const customer=orders[0]||{};
  const totalSpent=orders.filter(o=>o.status==='delivered').reduce((s,o)=>s+(o.netPrice!=null?o.netPrice:(o.totalPrice||0)),0);
  const deliveredCount=orders.filter(o=>o.status==='delivered').length;
  const cancelledCount=orders.filter(o=>['cancelled','returned','refused'].includes(o.status)).length;
  const cardsHtml=orders.map(o=>{
    const st=_empSt(o.status);
    const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
    const dt=o.createdAt?.toDate?o.createdAt.toDate().toLocaleString('ar-JO',{dateStyle:'short',timeStyle:'short'}):(o.date||'—');
    const prods=(o.products||[]).map(p=>`${p.name}${(p.qty||1)>1?' × '+(p.qty||1):''}`).join(' · ');
    return `<div style="background:#fff;border:1.5px solid ${st.border};border-radius:10px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:5px;">
        <div style="font-weight:700;color:#1a3a2a;font-size:0.83rem;">${o.pageName||''}</div>
        <span style="background:${st.bg};color:${st.color};border:1px solid ${st.border};border-radius:6px;padding:2px 8px;font-size:0.7rem;font-weight:700;">${st.label}</span>
      </div>
      <div style="font-size:0.74rem;color:#6b7280;margin-bottom:4px;">🕐 ${dt}</div>
      <div style="font-size:0.78rem;color:#374151;margin-bottom:4px;">${prods}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:0.72rem;color:#6b7280;">📍 ${o.address||'—'}</div>
        <div style="font-weight:800;color:#166534;font-size:0.85rem;">${net.toFixed(2)} د.أ</div>
      </div>
    </div>`;
  }).join('');
  const html=`<div id="custHistOverlay" onclick="if(event.target===this)closeCustomerHistory()" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:5000;display:flex;align-items:center;justify-content:center;padding:14px;">
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:14px 16px;background:linear-gradient(135deg,#1a3a2a,#2d6a4f);color:#fff;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:800;font-size:0.95rem;">🔁 سجل الزبون</div>
          <div style="font-size:0.75rem;opacity:0.85;margin-top:2px;">📞 ${trim}${customer.workerName?` · 👤 ${customer.workerName}`:''}</div>
        </div>
        <button onclick="closeCustomerHistory()" style="background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:8px;width:30px;height:30px;font-size:1rem;cursor:pointer;">✕</button>
      </div>
      <div style="padding:11px 16px;background:#f0fdf4;border-bottom:1.5px solid #d1fae5;display:flex;justify-content:space-around;text-align:center;">
        <div><div style="font-weight:900;color:#166534;font-size:1.05rem;">${orders.length}</div><div style="font-size:0.68rem;color:#6b7280;">إجمالي</div></div>
        <div><div style="font-weight:900;color:#22c55e;font-size:1.05rem;">${deliveredCount}</div><div style="font-size:0.68rem;color:#6b7280;">مسلّمة</div></div>
        <div><div style="font-weight:900;color:#ef4444;font-size:1.05rem;">${cancelledCount}</div><div style="font-size:0.68rem;color:#6b7280;">ملغاة</div></div>
        <div><div style="font-weight:900;color:#166534;font-size:1.05rem;">${totalSpent.toFixed(2)}</div><div style="font-size:0.68rem;color:#6b7280;">د.أ مجموع</div></div>
      </div>
      <div style="padding:14px;overflow-y:auto;flex:1;">
        ${cardsHtml||'<div style="text-align:center;color:#9ca3af;padding:20px;">لا يوجد طلبات</div>'}
      </div>
    </div>
  </div>`;
  const div=document.createElement('div');
  div.innerHTML=html;
  document.body.appendChild(div.firstElementChild);
}

function closeCustomerHistory(){
  const el=document.getElementById('custHistOverlay');
  if(el)el.remove();
}

function _buildBatchDeliveryMsg(orders){
  let totalNet=0;
  let msg=`🚚 طلبات توصيل — ${orders.length} طلبات\n${'═'.repeat(20)}\n`;
  orders.forEach((o,i)=>{
    const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
    const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
    totalNet+=net;
    msg+=`\n📦 ${label} — ${o.pageName||''}\n`;
    msg+=`📞 ${o.customerPhone||''}\n`;
    msg+=`📍 ${o.address||''}`;
    if(o.area)msg+=` (${o.area})`;
    msg+='\n';
    (o.products||[]).forEach(p=>{msg+=`  • ${p.name}${(p.qty||1)>1?' × '+(p.qty||1):''}\n`;});
    msg+=`💰 ${net.toFixed(2)} د.أ`;
    if(o.notes)msg+=`\n📝 ${o.notes}`;
    if(i<orders.length-1)msg+=`\n${'─'.repeat(14)}`;
  });
  msg+=`\n${'═'.repeat(20)}\n💰 الإجمالي: ${totalNet.toFixed(2)} د.أ`;
  return msg;
}

async function openBatchDeliveryModal(){
  const checked=[...document.querySelectorAll('[id^="chk_"]:checked')];
  if(!checked.length){toast('⚠️ حدد طلباً واحداً على الأقل');return;}
  const ids=checked.map(c=>c.value);
  const allOrders=[...(_empOrdersAllData||[]),...(_opOrdersAllData||[])];
  const seen=new Set();
  const orders=ids.map(id=>allOrders.find(o=>o.id===id)).filter(o=>o&&!seen.has(o.id)&&seen.add(o.id));
  _deliveryBatchOrders=orders;
  _deliveryModalOrder=orders[0];
  await _renderDeliveryModal();
  document.getElementById('deliveryRepModal').style.display='block';
  document.body.style.overflow='hidden';
}

// ===== BALANCE THRESHOLD ALERT (Feature 5) =====
function getAcctThreshold(){return parseFloat(localStorage.getItem('acct_balance_threshold')||'100');}
function saveAcctThreshold(val){
  const v=parseFloat(val);
  if(!isNaN(v)&&v>=0){localStorage.setItem('acct_balance_threshold',v);loadAcctStoreList();}
}

// ===== ASSEMBLY WORKER ACCOUNTS =====
let _workersList=[];
let _activeWorkerTxnId=null;
let _activeWorkerTxnName=null;
let _workerTxnType='deposit';

async function _loadWorkersList(){
  try{
    const snap=await db.collection('operator_assembly_workers').orderBy('createdAt').get();
    _workersList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_workersList=[];}
  return _workersList;
}

async function loadWorkerAccounts(date){
  const wrap=document.getElementById('worker_accounts_wrap');
  if(!wrap)return;
  wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">⏳ تحميل...</div>';
  try{
    await _loadWorkersList();
    if(!_workersList.length){
      wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:20px;">لا يوجد عمال — اضغط "+ إضافة عامل"</div>';
      return;
    }
    const [allSnap,daySnap]=await Promise.all([
      db.collection('operator_worker_transactions').get(),
      db.collection('operator_worker_transactions').where('date','==',date).get()
    ]);
    const allTxns=allSnap.docs.map(d=>({id:d.id,...d.data()}));
    const dayTxns=daySnap.docs.map(d=>({id:d.id,...d.data()}));
    wrap.innerHTML=_workersList.map(w=>{
      const wAll=allTxns.filter(t=>t.workerId===w.id);
      const wDay=dayTxns.filter(t=>t.workerId===w.id);
      const totalBalance=wAll.reduce((s,t)=>t.type==='deposit'?s+t.amount:s-t.amount,0);
      const dayNet=wDay.reduce((s,t)=>t.type==='deposit'?s+t.amount:s-t.amount,0);
      const balColor=totalBalance>=0?'#166534':'#dc2626';
      const dayColor=dayNet>0?'#166534':dayNet<0?'#dc2626':'#9ca3af';
      const safeName=w.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:13px 14px;margin-bottom:9px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:#1a3a2a;font-size:0.88rem;">👷 ${w.name}</div>
          ${w.phone?`<div style="font-size:0.72rem;color:#6b7280;">📞 ${w.phone}</div>`:''}
          <div style="display:flex;gap:10px;margin-top:5px;">
            <div style="font-size:0.72rem;color:#6b7280;">اليوم: <span style="font-weight:700;color:${dayColor};">${dayNet>0?'+':''}${dayNet.toFixed(2)} د.أ</span></div>
            <div style="font-size:0.72rem;color:#6b7280;">الرصيد: <span style="font-weight:800;color:${balColor};">${totalBalance.toFixed(2)} د.أ</span></div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;">
          <button onclick="openWorkerTxnModal('${w.id}','${safeName}')" style="padding:7px 12px;background:#1a3a2a;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.75rem;cursor:pointer;">📒 سجل</button>
          <button onclick="deleteWorker('${w.id}')" style="padding:7px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.75rem;cursor:pointer;">🗑</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    wrap.innerHTML=`<div style="text-align:center;color:#dc2626;font-size:0.82rem;padding:20px;">❌ ${e.message}</div>`;
  }
}

function openAddWorkerModal(){
  document.getElementById('addWorkerModal').style.display='flex';
  setTimeout(()=>document.getElementById('newAssemblyWorkerName').focus(),100);
}
function closeAddWorkerModal(){
  document.getElementById('addWorkerModal').style.display='none';
  document.getElementById('newAssemblyWorkerName').value='';
  document.getElementById('newAssemblyWorkerPhone').value='';
}
async function saveNewWorker(){
  const name=(document.getElementById('newAssemblyWorkerName').value||'').trim();
  if(!name){toast('⚠️ أدخل اسم العامل');return;}
  const phone=(document.getElementById('newAssemblyWorkerPhone').value||'').trim();
  try{
    await db.collection('operator_assembly_workers').add({name,phone,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    closeAddWorkerModal();
    loadWorkerAccounts(jordanDateStr());
    toast('✅ تم إضافة العامل');
  }catch(e){toast('❌ '+e.message);}
}
async function deleteWorker(id){
  if(!confirm('حذف هذا العامل وكل سجلاته؟'))return;
  try{
    const txns=await db.collection('operator_worker_transactions').where('workerId','==',id).get();
    const batch=db.batch();
    txns.docs.forEach(d=>batch.delete(d.ref));
    batch.delete(db.collection('operator_assembly_workers').doc(id));
    await batch.commit();
    loadWorkerAccounts(jordanDateStr());
    toast('✅ تم حذف العامل');
  }catch(e){toast('❌ '+e.message);}
}

async function openWorkerTxnModal(workerId,workerName){
  _activeWorkerTxnId=workerId;
  _activeWorkerTxnName=workerName;
  _workerTxnType='deposit';
  document.getElementById('workerTxnModalTitle').textContent='👷 '+workerName;
  document.getElementById('workerTxnAmount').value='';
  document.getElementById('workerTxnNote').value='';
  setWorkerTxnType('deposit');
  document.getElementById('workerTxnModal').style.display='flex';
  await _loadWorkerTxnHistory();
}
function closeWorkerTxnModal(){
  document.getElementById('workerTxnModal').style.display='none';
  _activeWorkerTxnId=null;
}
function setWorkerTxnType(type){
  _workerTxnType=type;
  const dep=document.getElementById('txnTypeDeposit');
  const wit=document.getElementById('txnTypeWithdrawal');
  if(dep){dep.style.background=type==='deposit'?'#d1fae5':'#f3f4f6';dep.style.borderColor=type==='deposit'?'#86efac':'#e5e7eb';dep.style.color=type==='deposit'?'#166534':'#374151';}
  if(wit){wit.style.background=type==='withdrawal'?'#fee2e2':'#f3f4f6';wit.style.borderColor=type==='withdrawal'?'#fca5a5':'#e5e7eb';wit.style.color=type==='withdrawal'?'#dc2626':'#374151';}
}
async function _loadWorkerTxnHistory(){
  const histEl=document.getElementById('workerTxnHistory');
  const balEl=document.getElementById('workerTxnModalBalance');
  if(!histEl||!_activeWorkerTxnId)return;
  histEl.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">⏳ تحميل...</div>';
  try{
    const snap=await db.collection('operator_worker_transactions').where('workerId','==',_activeWorkerTxnId).get();
    const txns=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
    const totalBalance=txns.reduce((s,t)=>t.type==='deposit'?s+t.amount:s-t.amount,0);
    const balColor=totalBalance>=0?'#a7f3d0':'#fca5a5';
    if(balEl)balEl.innerHTML=`الرصيد الإجمالي: <span style="font-weight:900;color:${balColor};">${totalBalance.toFixed(2)} د.أ</span>`;
    if(!txns.length){histEl.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:20px;">لا يوجد حركات بعد</div>';return;}
    histEl.innerHTML=txns.map(t=>{
      const isD=t.type==='deposit';
      const dt=t.createdAt?.toDate?t.createdAt.toDate().toLocaleString('ar-JO',{dateStyle:'short',timeStyle:'short'}):(t.date||'—');
      return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid #f3f4f6;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:0.78rem;font-weight:700;color:${isD?'#166534':'#dc2626'};">${isD?'⬆️ إيداع':'⬇️ سحب'}</span>
            <span style="font-weight:800;color:${isD?'#166534':'#dc2626'};font-size:0.85rem;">${isD?'+':'−'}${t.amount.toFixed(2)} د.أ</span>
          </div>
          ${t.note?`<div style="font-size:0.72rem;color:#6b7280;margin-top:2px;">📝 ${t.note}</div>`:''}
          <div style="font-size:0.68rem;color:#9ca3af;margin-top:1px;">🕐 ${dt}</div>
        </div>
        <button onclick="deleteWorkerTxn('${t.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 7px;font-size:0.65rem;cursor:pointer;flex-shrink:0;">🗑</button>
      </div>`;
    }).join('');
  }catch(e){histEl.innerHTML=`<div style="color:#dc2626;font-size:0.8rem;padding:12px;">❌ ${e.message}</div>`;}
}
async function saveWorkerTxn(){
  if(!_activeWorkerTxnId){toast('⚠️ خطأ');return;}
  const amount=parseFloat(document.getElementById('workerTxnAmount').value)||0;
  if(amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  const note=(document.getElementById('workerTxnNote').value||'').trim();
  const today=jordanDateStr();
  try{
    await db.collection('operator_worker_transactions').add({
      workerId:_activeWorkerTxnId,
      workerName:_activeWorkerTxnName,
      date:today,type:_workerTxnType,amount,note,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('workerTxnAmount').value='';
    document.getElementById('workerTxnNote').value='';
    await _loadWorkerTxnHistory();
    loadWorkerAccounts(today);
    toast('✅ تم تسجيل الحركة');
  }catch(e){toast('❌ '+e.message);}
}
async function deleteWorkerTxn(txnId){
  if(!confirm('حذف هذه الحركة؟'))return;
  try{
    await db.collection('operator_worker_transactions').doc(txnId).delete();
    await _loadWorkerTxnHistory();
    loadWorkerAccounts(jordanDateStr());
    toast('✅ تم حذف الحركة');
  }catch(e){toast('❌ '+e.message);}
}

window.openAddWorkerModal=openAddWorkerModal; window.closeAddWorkerModal=closeAddWorkerModal; window.saveNewWorker=saveNewWorker; window.deleteWorker=deleteWorker;
window.openWorkerTxnModal=openWorkerTxnModal; window.closeWorkerTxnModal=closeWorkerTxnModal; window.setWorkerTxnType=setWorkerTxnType; window.saveWorkerTxn=saveWorkerTxn; window.deleteWorkerTxn=deleteWorkerTxn;

// ===== FEATURE 12: AREA PRICING =====
async function _loadAreaFees(){
  if(_areaFeesCache!==null)return _areaFeesCache;
  try{
    const snap=await db.collection('operator_config').doc('area_fees').get();
    _areaFeesCache=(snap.exists&&snap.data().fees)?snap.data().fees:[];
  }catch(e){_areaFeesCache=[];}
  return _areaFeesCache;
}
async function _saveAreaFees(fees){
  _areaFeesCache=fees;
  await db.collection('operator_config').doc('area_fees').set({fees});
}
async function renderAreaFeesList(){
  const fees=await _loadAreaFees();
  // Populate datalist for autocomplete in order form
  const dl=document.getElementById('areaFeesList');
  if(dl)dl.innerHTML=fees.map(f=>`<option value="${f.area}">`).join('');
  // Populate management list in settings
  const wrap=document.getElementById('areaFeesList_wrap');
  if(!wrap)return;
  if(!fees.length){wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:12px;">لا يوجد مناطق — أضف منطقة أعلاه</div>';return;}
  wrap.innerHTML=fees.map((f,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 11px;background:#f8fafc;border-radius:8px;margin-bottom:5px;border:1px solid #e5e7eb;">
    <div>
      <span style="font-weight:700;color:#1a3a2a;font-size:0.88rem;">🗺 ${f.area}</span>
      <span style="font-size:0.8rem;color:#6b7280;margin-right:8px;">— ${f.fee} د.أ</span>
    </div>
    <button onclick="removeAreaFee(${i})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.75rem;font-family:'Tajawal',sans-serif;">🗑</button>
  </div>`).join('');
}
async function addAreaFee(){
  const name=(document.getElementById('newAreaName').value||'').trim();
  const fee=parseFloat(document.getElementById('newAreaFee').value)||0;
  if(!name){toast('⚠️ أدخل اسم المنطقة');return;}
  const fees=await _loadAreaFees();
  if(fees.find(f=>f.area===name)){toast('⚠️ المنطقة موجودة مسبقاً');return;}
  fees.push({area:name,fee});
  await _saveAreaFees(fees);
  document.getElementById('newAreaName').value='';
  document.getElementById('newAreaFee').value='';
  renderAreaFeesList();
  toast('✅ تم إضافة المنطقة');
}
async function removeAreaFee(idx){
  const fees=await _loadAreaFees();
  fees.splice(idx,1);
  await _saveAreaFees(fees);
  renderAreaFeesList();
  toast('🗑 تم الحذف');
}
async function onEmpAreaChange(){
  const area=(document.getElementById('emp_area')?.value||'').trim();
  const hint=document.getElementById('emp_area_fee_hint');
  if(!area){if(hint)hint.style.display='none';return;}
  const fees=await _loadAreaFees();
  const match=fees.find(f=>f.area===area);
  if(match){
    if(hint){hint.textContent=`✅ تم تعيين أجرة توصيل: ${match.fee} د.أ`;hint.style.display='block';}
    // auto-set delivery fee
    const customEl=document.getElementById('emp_delivery_custom');
    document.querySelectorAll('#empDeliveryBtns button').forEach(b=>{
      b.style.background='#fff';b.style.color='#374151';b.style.borderColor='#e5e7eb';
    });
    if(false){
      // area-based delivery fee disabled — fixed at 2 JD
      _empDeliveryFee=0;
    }else{
      _empDeliveryFee=2;
      if(customEl){customEl.style.display='block';customEl.value=match.fee;}
    }
    updateEmpNet();
  }else{
    if(hint)hint.style.display='none';
  }
}
// Load area fees datalist on settings tab open
async function _initAreaFeesUI(){
  await renderAreaFeesList();
}

// ===== FEATURE 13: PRODUCT IMAGES IN FORM =====
function onEmpProductChange(){
  // Legacy stub — product selection now handled by selectEmpProduct()
}

// ===== FEATURE 3: ON HOLD STATUS =====
function openEmpHoldModal(id){
  _empHoldTargetId=id;
  document.getElementById('empHoldReasonInput').value='';
  document.getElementById('empHoldFollowupDate').value='';
  document.querySelectorAll('.emp-hold-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  document.getElementById('empHoldModal').style.display='flex';
}
function closeEmpHoldModal(){
  document.getElementById('empHoldModal').style.display='none';
  _empHoldTargetId=null;
}
function selectEmpHoldReason(btn,reason){
  document.querySelectorAll('.emp-hold-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  btn.style.borderColor='#d97706';btn.style.background='#fef3c7';btn.style.color='#92400e';
  document.getElementById('empHoldReasonInput').value=reason;
}
async function confirmEmpHold(){
  const reason=(document.getElementById('empHoldReasonInput').value||'').trim();
  if(!reason){toast('⚠️ أدخل سبب التعليق');return;}
  const followup=document.getElementById('empHoldFollowupDate').value||'';
  if(!_empHoldTargetId)return;
  const id=_empHoldTargetId;
  closeEmpHoldModal();
  try{
    await db.collection('employee_orders').doc(id).update({
      status:'onhold',holdReason:reason,...(followup?{holdFollowup:followup}:{}),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('⏸ تم تعليق الطلب');
  }catch(e){toast('❌ '+e.message);}
}

// ===== FEATURE 6: CANCELLATION REASON =====
function openEmpCancelModal(id){
  _empCancelTargetId=id;
  document.getElementById('empCancelReasonInput').value='';
  document.querySelectorAll('.emp-cancel-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  document.getElementById('empCancelReasonModal').style.display='flex';
}
function closeEmpCancelModal(){
  document.getElementById('empCancelReasonModal').style.display='none';
  _empCancelTargetId=null;
}
function selectEmpCancelReason(btn,reason){
  document.querySelectorAll('.emp-cancel-reason-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  btn.style.borderColor='#ef4444';btn.style.background='#fee2e2';btn.style.color='#991b1b';
  document.getElementById('empCancelReasonInput').value=reason;
}
async function confirmEmpCancel(){
  const reason=(document.getElementById('empCancelReasonInput').value||'').trim();
  if(!reason){toast('⚠️ اختر أو اكتب سبب الإلغاء');return;}
  if(!_empCancelTargetId)return;
  const id=_empCancelTargetId;
  closeEmpCancelModal();
  try{
    const docRef=db.collection('employee_orders').doc(id);
    const snap=await docRef.get();
    const data=snap.data();
    const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:`${_empSt(data.status).label} ← ${_empSt('cancelled').label}`};
    await docRef.update({
      status:'cancelled',cancelReason:reason,
      editHistory:[...(data.editHistory||[]),editEntry],
      needsReview:firebase.firestore.FieldValue.delete(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم إلغاء الطلب');
    // simple cancel: no accounting effect — use 'إلغاء مع إرجاع' for refund flow
    if(!['cancelled','returned','refused','delivered'].includes(data.status)){removePageRefundEntry(id);}
  }catch(e){toast('❌ '+e.message);}
}
function renderCancelReport(){
  const wrap=document.getElementById('opCancelReport');
  if(!wrap)return;
  const cancelled=_opOrdersAllData.filter(o=>o.status==='cancelled'&&o.cancelReason);
  if(!cancelled.length){wrap.style.display='none';return;}
  const counts={};
  cancelled.forEach(o=>{const r=o.cancelReason||'غير محدد';counts[r]=(counts[r]||0)+1;});
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const total=cancelled.length;
  wrap.style.display='block';
  wrap.innerHTML=`<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:14px;margin-top:8px;">
    <div style="font-weight:800;color:#374151;font-size:0.9rem;margin-bottom:10px;">📊 تحليل أسباب الإلغاء (${total} طلب)</div>
    ${sorted.map(([reason,count])=>{
      const pct=Math.round((count/total)*100);
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
          <span style="font-size:0.82rem;color:#374151;">${reason}</span>
          <span style="font-size:0.78rem;font-weight:700;color:#ef4444;">${count} (${pct}%)</span>
        </div>
        <div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden;">
          <div style="height:100%;background:#ef4444;border-radius:4px;width:${pct}%;transition:width 0.4s;"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ===== FEATURE 4: ADVANCED FILTER =====
function toggleEmpAdvFilter(btn){
  const panel=document.getElementById('empAdvFilterPanel');
  if(!panel)return;
  const open=panel.style.display==='none'||!panel.style.display;
  panel.style.display=open?'block':'none';
  _styleToggleBtn(btn,open);
}
function toggleOpAdvFilter(btn){
  const panel=document.getElementById('opAdvFilterPanel');
  if(!panel)return;
  const open=panel.style.display==='none'||!panel.style.display;
  panel.style.display=open?'block':'none';
  _styleToggleBtn(btn,open);
}
function _getAdvFilter(prefix){
  const g=id=>document.getElementById(prefix+id);
  const from=g('Flt_from')?.value||'';
  const to=g('Flt_to')?.value||'';
  const minP=parseFloat(g('Flt_minPrice')?.value||'')||null;
  const maxP=parseFloat(g('Flt_maxPrice')?.value||'')||null;
  const area=(g('Flt_area')?.value||'').trim().toLowerCase();
  const page=(g('Flt_page')?.value||'').trim().toLowerCase();
  if(!from&&!to&&!minP&&!maxP&&!area&&!page)return null;
  return{from,to,minP,maxP,area,page};
}
function _applyAdvFilter(orders,f){
  if(!f)return orders;
  return orders.filter(o=>{
    if(f.from&&(o.date||'')&&o.date<f.from)return false;
    if(f.to&&(o.date||'')&&o.date>f.to)return false;
    const price=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
    if(f.minP!==null&&price<f.minP)return false;
    if(f.maxP!==null&&price>f.maxP)return false;
    if(f.area&&!(o.area||'').toLowerCase().includes(f.area))return false;
    if(f.page&&!(o.pageName||'').toLowerCase().includes(f.page))return false;
    return true;
  });
}
function applyEmpAdvFilter(){_empAdvFilter=_getAdvFilter('emp');_renderEmpOrdersView();}
function applyOpAdvFilter(){_opAdvFilter=_getAdvFilter('op');_renderOpOrdersView();}
function clearEmpAdvFilter(){
  ['empFlt_from','empFlt_to','empFlt_minPrice','empFlt_maxPrice','empFlt_area','empFlt_page'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  _empAdvFilter=null;_renderEmpOrdersView();
}
function clearOpAdvFilter(){
  ['opFlt_from','opFlt_to','opFlt_minPrice','opFlt_maxPrice','opFlt_area','opFlt_page'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  _opAdvFilter=null;_renderOpOrdersView();
}

// ===== FEATURE 11: DELIVERY REP LINKING =====
let _pendingDeliveryRepInfo={name:'',phone:''};
async function sendAndMarkDelivering_withRep(waUrl, repName, repPhone){
  const isBatch=_deliveryBatchOrders.length>1;
  const orders=isBatch?_deliveryBatchOrders:[_deliveryModalOrder].filter(Boolean);
  const ids=orders.map(o=>o.id);
  // Create batch document and append confirmation link to WhatsApp message
  let finalWaUrl=waUrl;
  try{
    const batchId=_genBatchId();
    await db.collection('delivery_batches').doc(batchId).set({
      orders:orders.map(o=>({
        id:o.id,orderNum:o.orderNum||'',pageName:o.pageName||'',
        customerPhone:o.customerPhone||'',address:o.address||'',area:o.area||'',
        products:o.products||[],netPrice:o.netPrice!=null?o.netPrice:(o.totalPrice||0),notes:o.notes||''
      })),
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const batchLink=`\n\n✅ رابط تأكيد التسليم:\n${location.origin+location.pathname}?deliverBatch=${batchId}`;
    const urlObj=new URL(waUrl);
    const text=urlObj.searchParams.get('text')||'';
    urlObj.searchParams.set('text',text+batchLink);
    finalWaUrl=urlObj.toString();
  }catch(e){}
  window.open(finalWaUrl,'_blank');
  closeDeliveryModal();
  const repUpdate=repName?{deliveryRepName:repName,deliveryRepPhone:repPhone||''}:{};
  // Shared batch timestamp so all orders handed over together group as one دفعة
  const _batchAssignedAt=firebase.firestore.Timestamp.now();
  ids.forEach(async id=>{
    try{
      const docRef=db.collection('employee_orders').doc(id);
      const snap=await docRef.get();
      const data=snap.data();
      const prevStatus=data?.status||'prepared';
      const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:`${_empSt(prevStatus).label} ← ${_empSt('delivering').label}`};
      await docRef.update({status:'delivering',...repUpdate,assignedAt:_batchAssignedAt,editHistory:[...(data?.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }catch(e){}
  });
}
function renderRepReport(){
  const all=_opOrdersAllData.filter(o=>o.deliveryRepName);
  if(!all.length)return '';
  const reps={};
  all.forEach(o=>{
    const n=o.deliveryRepName;
    if(!reps[n])reps[n]={name:n,phone:o.deliveryRepPhone||'',total:0,delivered:0,cancelled:0};
    reps[n].total++;
    if(o.status==='delivered')reps[n].delivered++;
    if(['cancelled','returned','refused'].includes(o.status))reps[n].cancelled++;
  });
  const sorted=Object.values(reps).sort((a,b)=>b.total-a.total);
  return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:14px;margin-top:14px;">
    <div style="font-weight:800;color:#374151;font-size:0.9rem;margin-bottom:10px;">🚚 أداء المناديب</div>
    ${sorted.map(r=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;">
      <div>
        <div style="font-weight:700;color:#1a3a2a;font-size:0.85rem;">${r.name}</div>
        <div style="font-size:0.72rem;color:#6b7280;">${r.phone}</div>
      </div>
      <div style="display:flex;gap:8px;font-size:0.78rem;">
        <span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:8px;font-weight:700;">${r.total} طلب</span>
        <span style="background:#d1fae5;color:#166534;padding:2px 8px;border-radius:8px;">✅ ${r.delivered}</span>
        ${r.cancelled?`<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;">❌ ${r.cancelled}</span>`:''}
      </div>
    </div>`).join('')}
  </div>`;
}

// ===== FEATURE 1: TV MODE =====
function openTVMode(){
  _tvModeActive=true;
  document.getElementById('tvModeOverlay').style.display='block';
  document.body.style.overflow='hidden';
  _renderTVMode();
  _tvModeInterval=setInterval(_updateTVClock,1000);
}
function closeTVMode(){
  _tvModeActive=false;
  document.getElementById('tvModeOverlay').style.display='none';
  document.body.style.overflow='';
  if(_tvModeInterval){clearInterval(_tvModeInterval);_tvModeInterval=null;}
}
function _updateTVClock(){
  const el=document.getElementById('tvModeClock');
  if(el)el.textContent=new Date().toLocaleTimeString('ar-JO',{timeZone:'Asia/Amman',hour12:false});
}
function _renderTVMode(){
  const ACTIVE=['pending','preparing','prepared','delivering','onhold'];
  let orders=(_opOrdersAllData.length?_opOrdersAllData:_empOrdersAllData)
    .filter(o=>ACTIVE.includes(o.status))
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const countEl=document.getElementById('tvModeOrderCount');
  if(countEl)countEl.textContent=`${orders.length} طلب نشط`;
  const board=document.getElementById('tvModeBoard');
  if(!board)return;
  if(!orders.length){board.innerHTML='<div style="color:rgba(255,255,255,0.4);font-size:1.5rem;text-align:center;padding:60px;grid-column:1/-1;">لا يوجد طلبات نشطة</div>';return;}
  board.innerHTML=orders.map(o=>{
    const st=_empSt(o.status);
    const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-6).toUpperCase();
    const prods=(o.products||[{name:o.productName||'?',qty:1}]);
    const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
    return `<div style="background:${st.bg};border:2px solid ${st.border};border-radius:14px;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:900;color:${st.color};font-size:1rem;">${st.label}</span>
        <span style="font-weight:800;color:#1a3a2a;font-size:0.88rem;">${label}</span>
      </div>
      <div style="font-size:0.88rem;color:#374151;font-weight:700;margin-bottom:4px;">${o.pageName||''}</div>
      <div style="font-size:0.82rem;color:#6b7280;margin-bottom:6px;">📞 ${o.customerPhone||''}</div>
      <div style="font-size:0.8rem;color:#4b5563;margin-bottom:6px;">${prods.map(p=>`${p.name} × ${p.qty||1}`).join(' · ')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:0.78rem;color:#6b7280;">📍 ${o.area||o.address||'—'}</div>
        <div style="font-weight:900;color:#166534;font-size:1rem;">${net.toFixed(2)} د.أ</div>
      </div>
      ${o.holdReason?`<div style="margin-top:6px;font-size:0.75rem;color:#92400e;background:#fef3c7;border-radius:6px;padding:3px 8px;">⏸ ${o.holdReason}</div>`:''}
      ${o.deliveryRepName?`<div style="margin-top:6px;font-size:0.75rem;color:#1e40af;background:#dbeafe;border-radius:6px;padding:3px 8px;">🚚 ${o.deliveryRepName}</div>`:''}
    </div>`;
  }).join('');
  _updateTVClock();
}

// ===== FEATURE 2: CUSTOMER TRACKING LINK =====
function copyOrderTrackingLink(orderId){
  const url=window.location.origin+window.location.pathname+'?track='+orderId;
  navigator.clipboard.writeText(url).then(()=>toast('✅ تم نسخ رابط التتبع')).catch(()=>{
    prompt('انسخ الرابط:',url);
  });
}
async function _initTrackingPage(){
  const params=new URLSearchParams(window.location.search);
  const trackId=params.get('track');
  if(!trackId)return;
  // Show tracking overlay
  document.getElementById('trackingOverlay').style.display='block';
  document.body.style.overflow='hidden';
  const content=document.getElementById('trackingContent');
  try{
    const snap=await db.collection('employee_orders').doc(trackId).get();
    if(!snap.exists){
      content.innerHTML='<div style="text-align:center;padding:30px;color:#dc2626;">❌ الطلب غير موجود أو تم حذفه</div>';
      return;
    }
    const o={id:snap.id,...snap.data()};
    const st=_empSt(o.status);
    const STEPS=['pending','preparing','prepared','delivering','delivered'];
    const activeIdx=STEPS.indexOf(o.status);
    const prods=(o.products||[{name:o.productName||'?',qty:1}]);
    const net=o.netPrice!=null?o.netPrice:(o.totalPrice||0);
    const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
    content.innerHTML=`
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-block;background:${st.bg};border:2px solid ${st.border};border-radius:12px;padding:10px 22px;font-weight:800;color:${st.color};font-size:1.1rem;">${st.label}</div>
        <div style="font-size:0.85rem;color:#6b7280;margin-top:8px;">رقم الطلب: ${label}</div>
      </div>
      ${o.status==='cancelled'?`<div style="background:#fee2e2;border-radius:10px;padding:12px;text-align:center;color:#dc2626;font-size:0.88rem;margin-bottom:16px;">🚫 تم إلغاء هذا الطلب${o.cancelReason?` — ${o.cancelReason}`:''}</div>`:''}
      ${o.status!=='cancelled'&&o.status!=='delivered'?`<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;position:relative;padding:0 10px;">
          <div style="position:absolute;top:12px;left:10px;right:10px;height:3px;background:#e5e7eb;z-index:0;"></div>
          <div style="position:absolute;top:12px;left:10px;height:3px;background:#22c55e;z-index:1;width:${Math.max(0,activeIdx/4*100)}%;transition:width 0.5s;"></div>
          ${STEPS.map((s,i)=>{const sst=_empSt(s);const done=i<activeIdx;const active=i===activeIdx;return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;z-index:2;">
            <div style="width:24px;height:24px;border-radius:50%;background:${active?sst.color:done?'#22c55e':'#e5e7eb'};border:2px solid ${active||done?'transparent':'#e5e7eb'};display:flex;align-items:center;justify-content:center;">
              ${done?'<span style="color:#fff;font-size:0.7rem;">✓</span>':`<span style="width:8px;height:8px;border-radius:50%;background:${active?'#fff':'#9ca3af'};"></span>`}
            </div>
            <div style="font-size:0.62rem;color:${active?sst.color:done?'#22c55e':'#9ca3af'};font-weight:${active||done?'700':'400'};white-space:nowrap;">${sst.label}</div>
          </div>`}).join('')}
        </div>
      </div>`:''}
      <div style="margin-bottom:14px;">
        <div style="font-size:0.78rem;font-weight:700;color:#374151;margin-bottom:6px;">📦 المنتجات</div>
        ${prods.map(p=>`<div style="font-size:0.85rem;color:#374151;padding:4px 0;">• ${p.name} × ${p.qty||1} — <strong>${(p.price*(p.qty||1)).toFixed(2)} د.أ</strong></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border-radius:10px;padding:12px 14px;">
        <div style="font-size:0.85rem;font-weight:700;color:#374151;">💰 الإجمالي</div>
        <div style="font-weight:900;color:#166534;font-size:1.05rem;">${net.toFixed(2)} د.أ</div>
      </div>
      ${o.deliveryRepName?`<div style="margin-top:10px;background:#eff6ff;border-radius:8px;padding:8px 12px;font-size:0.82rem;color:#1e40af;">🚚 المندوب: ${o.deliveryRepName}</div>`:''}
    `;
  }catch(e){
    content.innerHTML=`<div style="text-align:center;padding:30px;color:#dc2626;">❌ خطأ في التحميل: ${e.message}</div>`;
  }
}

// window exports for new features
window.addAreaFee=addAreaFee; window.removeAreaFee=removeAreaFee; window.onEmpAreaChange=onEmpAreaChange;
window.openEmpHoldModal=openEmpHoldModal; window.closeEmpHoldModal=closeEmpHoldModal; window.selectEmpHoldReason=selectEmpHoldReason; window.confirmEmpHold=confirmEmpHold;
window.openEmpCancelModal=openEmpCancelModal; window.closeEmpCancelModal=closeEmpCancelModal; window.selectEmpCancelReason=selectEmpCancelReason; window.confirmEmpCancel=confirmEmpCancel;
window.toggleEmpAdvFilter=toggleEmpAdvFilter; window.toggleOpAdvFilter=toggleOpAdvFilter;
window.applyEmpAdvFilter=applyEmpAdvFilter; window.applyOpAdvFilter=applyOpAdvFilter;
window.clearEmpAdvFilter=clearEmpAdvFilter; window.clearOpAdvFilter=clearOpAdvFilter;
// ===== REP DELIVERY APP =====
let _repCurrentUser=null;
let _repMyOrdersUnsub=null;
let _repMyOrdersUnsub2=null;
let _repMyOrdersUnsub3=null;
let _repLocActive=false;
let _repGeoWatchId=null;
let _repQRMode=false;

function _initRepApp(){
  document.getElementById('repAppPanel').style.display='block';
  document.body.style.overflow='hidden';
  try{const s=localStorage.getItem('_repUser');if(s)_repCurrentUser=JSON.parse(s);}catch(e){}
  if(_repCurrentUser)_repShowMain();
  else _repShowLogin();
}

function _repShowLogin(){
  document.getElementById('repLoginView').style.display='block';
  document.getElementById('repMainView').style.display='none';
}

function _repShowMain(){
  document.getElementById('repLoginView').style.display='none';
  document.getElementById('repMainView').style.display='block';
  const lbl=document.getElementById('repNameLabel');
  if(lbl)lbl.textContent=_repCurrentUser.name||'';
  loadRepOrders();
}

async function repLogin(){
  const phoneEl=document.getElementById('repLoginPhone');
  const errEl=document.getElementById('repLoginError');
  const phone=(phoneEl?.value||'').trim().replace(/\s/g,'');
  if(!phone){if(errEl){errEl.textContent='أدخل رقم الهاتف';errEl.style.display='block';}return;}
  if(errEl)errEl.style.display='none';
  try{
    const snap=await db.collection('operator_config').doc('delivery_reps').get();
    const reps=(snap.exists?snap.data()?.reps:[])||[];
    const rep=reps.find(r=>{
      const rp=(r.phone||'').replace(/\D/g,'');
      const lp=phone.replace(/\D/g,'');
      return rp===lp||rp.slice(-8)===lp.slice(-8);
    });
    if(!rep){
      if(errEl){errEl.textContent='رقم الهاتف غير موجود في قائمة المناديب — تواصل مع الإدارة';errEl.style.display='block';}
      return;
    }
    _repCurrentUser={name:rep.name,phone:rep.phone};
    localStorage.setItem('_repUser',JSON.stringify(_repCurrentUser));
    _repShowMain();
  }catch(e){if(errEl){errEl.textContent='❌ '+e.message;errEl.style.display='block';}}
}

function repLogout(){
  if(_repMyOrdersUnsub){_repMyOrdersUnsub();_repMyOrdersUnsub=null;}
  if(_repMyOrdersUnsub2){_repMyOrdersUnsub2();_repMyOrdersUnsub2=null;}
  if(_repMyOrdersUnsub3){_repMyOrdersUnsub3();_repMyOrdersUnsub3=null;}
  repStopLocation();
  _repCurrentUser=null;
  localStorage.removeItem('_repUser');
  _repShowLogin();
}

function loadRepOrders(){
  const wrap=document.getElementById('repOrdersList');
  if(!wrap||!_repCurrentUser)return;
  if(_repMyOrdersUnsub){_repMyOrdersUnsub();_repMyOrdersUnsub=null;}
  if(_repMyOrdersUnsub2){_repMyOrdersUnsub2();_repMyOrdersUnsub2=null;}
  if(_repMyOrdersUnsub3){_repMyOrdersUnsub3();_repMyOrdersUnsub3=null;}
  wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:40px;background:#fff;border-radius:14px;">⏳ تحميل...</div>';
  const {phone,name}=_repCurrentUser;
  const normName=name?name.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').trim():'';
  let _byPhone=[],_byExact=[],_byNorm=[];
  function _mergeAndRender(){
    const seen=new Set();
    const all=[..._byPhone,..._byExact,..._byNorm].filter(o=>{
      if(seen.has(o.id))return false; seen.add(o.id); return true;
    }).filter(o=>!['delivered','cancelled','returned','refused'].includes(o.status))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    _renderRepOrders(all);
  }
  // Query 1: by phone
  _repMyOrdersUnsub=db.collection('employee_orders')
    .where('deliveryRepPhone','==',phone).limit(80)
    .onSnapshot(snap=>{_byPhone=snap.docs.map(d=>({id:d.id,...d.data()}));_mergeAndRender();},
    e=>{wrap.innerHTML='<div style="color:#dc2626;font-size:0.82rem;padding:12px;text-align:center;">❌ '+e.message+'</div>';});
  // Query 2: by exact name
  if(name){
    _repMyOrdersUnsub2=db.collection('employee_orders')
      .where('deliveryRepName','==',name).limit(80)
      .onSnapshot(snap=>{_byExact=snap.docs.map(d=>({id:d.id,...d.data()}));_mergeAndRender();},()=>{});
  }
  // Query 3: by normalized name (أ/إ/آ → ا) — only if different from exact
  if(name&&normName!==name){
    _repMyOrdersUnsub3=db.collection('employee_orders')
      .where('deliveryRepName','==',normName).limit(80)
      .onSnapshot(snap=>{_byNorm=snap.docs.map(d=>({id:d.id,...d.data()}));_mergeAndRender();},()=>{});
  }
}

function _renderRepOrders(orders){
  const wrap=document.getElementById('repOrdersList');
  const countEl=document.getElementById('repOrdersCount');
  if(!wrap)return;
  if(countEl)countEl.textContent=orders.length;
  if(!orders.length){
    wrap.innerHTML='<div style="text-align:center;padding:36px;background:#fff;border-radius:14px;border:1.5px dashed #e5e7eb;"><div style="font-size:2.5rem;margin-bottom:8px;">📭</div><div style="color:#9ca3af;font-size:0.85rem;">لا يوجد طلبات نشطة<br><span style="font-size:0.75rem;">امسح QR لحجز طلب جديد</span></div></div>';
    return;
  }
  const SL={delivering:'قيد التوصيل',queued:'قائمة التوصيل',waiting_rep:'انتظار التسليم',onhold:'عالق',postponed:'مؤجل',pending:'جديد',preparing:'قيد التجهيز',prepared:'جاهز'};
  const SC={delivering:'#8b5cf6',queued:'#0ea5e9',waiting_rep:'#d97706',onhold:'#d97706',postponed:'#f59e0b',pending:'#f59e0b',preparing:'#f97316',prepared:'#3b82f6'};
  wrap.innerHTML=orders.map(o=>{
    const sc=SC[o.status]||'#6b7280',sl=SL[o.status]||o.status;
    const prods=(o.products||[{name:o.productName||'?',qty:1}]);
    const prodStr=prods.map(p=>`${p.name}${(p.qty||1)>1?' ×'+p.qty:''}`).join('، ');
    const total=(o.netPrice!=null?o.netPrice:(o.totalPrice||0)).toFixed(2);
    const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
    return `<div onclick="repOpenOrderById('${o.id}')" style="background:#fff;border-radius:14px;padding:15px 16px;margin-bottom:10px;border:1.5px solid #e5e7eb;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:800;font-size:0.9rem;color:#1a3a2a;">${label}</span>
        <span style="background:${sc}20;color:${sc};padding:3px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;">${sl}</span>
      </div>
      ${o.customerPhone?`<div style="font-size:0.82rem;color:#374151;margin-bottom:4px;">📱 ${o.customerPhone}</div>`:''}
      <div style="font-size:0.79rem;color:#6b7280;margin-bottom:4px;">📦 ${prodStr}</div>
      ${o.address?`<div style="font-size:0.79rem;color:#6b7280;margin-bottom:4px;">📍 ${o.address}</div>`:''}
      <div style="font-weight:800;color:#166534;font-size:0.92rem;text-align:left;direction:ltr;">${total} د.أ</div>
    </div>`;
  }).join('');
}

async function repOpenOrderById(id){
  try{
    const snap=await db.collection('employee_orders').doc(id).get();
    if(snap.exists)_showRepOrderDetail({id:snap.id,...snap.data()});
    else toast('❌ الطلب غير موجود');
  }catch(e){toast('❌ '+e.message);}
}

function repOpenQRScanner(){_repQRMode=true;openQRScanner();}

function _showRepOrderDetail(o){
  const modal=document.getElementById('repOrderModal');
  const content=document.getElementById('repOrderDetailContent');
  if(!modal||!content)return;
  const prods=o.products||[{name:o.productName||'?',qty:1,price:o.totalPrice||0}];
  const total=(o.netPrice!=null?o.netPrice:(o.totalPrice||0));
  const dlv=o.deliveryFee||0;
  const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
  const st=EMP_STATUSES[o.status]||{label:o.status,color:'#6b7280'};
  const isTerminal=['delivered','cancelled','returned','refused'].includes(o.status);
  content.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-weight:900;font-size:1.05rem;color:#1a3a2a;">${label}</div>
      <span style="background:${st.color}20;color:${st.color};padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:700;">${st.label}</span>
    </div>
    <div style="background:#f9fafb;border-radius:12px;padding:13px 15px;margin-bottom:14px;">
      ${o.customerPhone?`<div style="font-size:0.85rem;color:#374151;margin-bottom:7px;display:flex;align-items:center;gap:8px;">📱 <a href="tel:${o.customerPhone}" style="color:#1d4ed8;text-decoration:none;font-weight:700;">${o.customerPhone}</a></div>`:''}
      ${o.name?`<div style="font-size:0.83rem;color:#374151;margin-bottom:6px;">👤 ${o.name}</div>`:''}
      ${o.address?`<div style="font-size:0.83rem;color:#374151;margin-bottom:6px;">📍 ${o.address}</div>`:''}
      ${o.area?`<div style="font-size:0.8rem;color:#6b7280;margin-bottom:4px;">🗺 ${o.area}</div>`:''}
      ${o.notes?`<div style="font-size:0.8rem;color:#d97706;background:#fffbeb;border-radius:7px;padding:6px 9px;margin-top:4px;">📝 ${o.notes}</div>`:''}
    </div>
    <div style="margin-bottom:14px;">
      ${prods.map(p=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:0.83rem;"><span style="color:#374151;">${p.name}${(p.qty||1)>1?` <b>×${p.qty}</b>`:''}</span><span style="font-weight:700;color:#374151;">${((p.price||0)*(p.qty||1)).toFixed(2)} د.أ</span></div>`).join('')}
      ${dlv?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:0.83rem;"><span style="color:#6b7280;">🚗 التوصيل</span><span style="color:#374151;">${dlv.toFixed(2)} د.أ</span></div>`:''}
      <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:1rem;"><span style="font-weight:800;color:#1a3a2a;">الإجمالي</span><span style="font-weight:900;color:#166534;font-size:1.1rem;">${total.toFixed(2)} د.أ</span></div>
    </div>
    ${isTerminal
      ?`<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:12px;background:#f9fafb;border-radius:10px;">هذا الطلب أُغلق</div>`
      :`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <button onclick="repSetStatus('${o.id}','delivering',this)" style="padding:14px 8px;background:#8b5cf6;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:1.3rem;">🚚</span>تم حجز الطلب</button>
        <button onclick="repSetStatus('${o.id}','delivered',this)" style="padding:14px 8px;background:#22c55e;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:1.3rem;">✅</span>تسليم</button>
        <button onclick="repSetStatus('${o.id}','postponed',this)" style="padding:14px 8px;background:#f59e0b;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:1.3rem;">⏸</span>مؤجل</button>
        <button onclick="repSetStatus('${o.id}','onhold',this)" style="padding:14px 8px;background:#d97706;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:1.3rem;">⚠️</span>عالق</button>
        <button onclick="repSetStatus('${o.id}','cancelled',this)" style="padding:14px 8px;background:#ef4444;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;grid-column:1/-1;flex-direction:row;gap:8px;justify-content:center;"><span style="font-size:1.2rem;">❌</span>ملغي</button>
      </div>
      <button onclick="repShareLocation('${o.customerPhone||''}')" style="width:100%;padding:12px;background:#f0fdf4;color:#166534;border:1.5px solid #86efac;border-radius:11px;font-family:'Tajawal',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;">📍 أرسل موقعي للزبون عبر واتساب</button>`
    }`;
  modal.style.display='block';
}

function closeRepOrderModal(){document.getElementById('repOrderModal').style.display='none';}

async function repSetStatus(orderId,status,btn){
  if(btn){btn.disabled=true;btn.style.opacity='0.6';}
  try{
    const upd={status,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
    if(status==='delivered')upd.deliveredDate=jordanDateStr();
    if(status==='delivering'&&_repCurrentUser){
      upd.deliveryRepName=_repCurrentUser.name;
      upd.deliveryRepPhone=_repCurrentUser.phone;
    }
    await db.collection('employee_orders').doc(orderId).update(upd);
    closeRepOrderModal();
    const msgs={delivering:'✅ تم حجز الطلب — وصلنا للأدمن',delivered:'✅ تم تسجيل التسليم',postponed:'⏸ تم تأجيل الطلب',onhold:'⚠️ تم تحديد الطلب كعالق',cancelled:'❌ تم إلغاء الطلب'};
    toast(msgs[status]||'✅ تم التحديث');
  }catch(e){
    if(btn){btn.disabled=false;btn.style.opacity='';}
    toast('❌ '+e.message);
  }
}

function repToggleLocation(){if(_repLocActive)repStopLocation();else repStartLocation();}

function repStartLocation(){
  if(!navigator.geolocation){toast('GPS غير مدعوم في هذا الجهاز');return;}
  const btn=document.getElementById('repLocBtn');
  if(btn){btn.textContent='⏳ ...';btn.disabled=true;}
  navigator.geolocation.getCurrentPosition(pos=>{
    _repLocActive=true;
    _repSendRepLocation(pos.coords.latitude,pos.coords.longitude);
    _repGeoWatchId=navigator.geolocation.watchPosition(
      p=>_repSendRepLocation(p.coords.latitude,p.coords.longitude),
      ()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:20000}
    );
    if(btn){btn.textContent='⏹ موقع';btn.disabled=false;btn.style.background='rgba(239,68,68,0.7)';}
    toast('📍 بدأ مشاركة الموقع مع الأدمن');
  },()=>{
    if(btn){btn.textContent='📍 موقع';btn.disabled=false;}
    toast('تعذر تحديد الموقع — تأكد من تفعيل GPS');
  },{enableHighAccuracy:true,timeout:12000});
}

function repStopLocation(){
  if(_repGeoWatchId!==null){navigator.geolocation.clearWatch(_repGeoWatchId);_repGeoWatchId=null;}
  _repLocActive=false;
  if(_repCurrentUser){
    db.collection('rep_locations').doc(_repCurrentUser.phone||_repCurrentUser.name)
      .set({isActive:false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
  }
  const btn=document.getElementById('repLocBtn');
  if(btn){btn.style.background='rgba(255,255,255,0.12)';btn.textContent='📍 موقع';}
}

function _repSendRepLocation(lat,lng){
  if(!_repCurrentUser)return;
  const key=_repCurrentUser.phone||_repCurrentUser.name;
  db.collection('rep_locations').doc(key).set({
    repId:key,repName:_repCurrentUser.name,
    lat,lng,isActive:true,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(()=>{});
}

function repShareLocation(customerPhone){
  navigator.geolocation.getCurrentPosition(pos=>{
    const url=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
    const msg=`📍 موقعي الحالي:\n${url}`;
    const clean=(customerPhone||'').replace(/\D/g,'');
    if(clean)window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`,'_blank');
    else{navigator.clipboard?.writeText(msg).then(()=>toast('تم نسخ رابط الموقع')).catch(()=>window.open(url,'_blank'));}
  },()=>{toast('تعذر تحديد الموقع');},{enableHighAccuracy:true,timeout:10000});
}

window.addEventListener('beforeunload',()=>{if(_repLocActive)repStopLocation();});
window.repLogin=repLogin; window.repLogout=repLogout;
window.repOpenQRScanner=repOpenQRScanner; window.repOpenOrderById=repOpenOrderById;
window.repSetStatus=repSetStatus; window.closeRepOrderModal=closeRepOrderModal;
window.repToggleLocation=repToggleLocation; window.repShareLocation=repShareLocation;
window.loadRepOrders=loadRepOrders;

// ===== REP LOCATION TRACKING =====
let _empGeoWatchId=null;
let _empLocShareActive=false;
const _repMapColors=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
let _repMapInstance=null;
let _repMapUnsub=null;
let _repMapMarkers=[];
let _repMapInitialFit=false;

function _empToggleLocationShare(){
  if(_empLocShareActive)_empStopLocationShare();
  else _empStartLocationShare();
}

function _empStartLocationShare(){
  if(!navigator.geolocation){alert('GPS غير مدعوم في هذا المتصفح');return;}
  const btn=document.getElementById('empLocShareBtn');
  const status=document.getElementById('empLocStatus');
  if(btn){btn.textContent='جاري التحديد...';btn.disabled=true;}
  navigator.geolocation.getCurrentPosition(pos=>{
    _empLocShareActive=true;
    _empSendLocation(pos.coords.latitude,pos.coords.longitude);
    _empGeoWatchId=navigator.geolocation.watchPosition(
      p=>_empSendLocation(p.coords.latitude,p.coords.longitude),
      ()=>{},
      {enableHighAccuracy:true,maximumAge:0,timeout:30000}
    );
    if(btn){btn.textContent='⏹ إيقاف';btn.disabled=false;btn.style.background='#dc2626';}
    if(status)status.textContent='✅ موقعك يُشارك الآن مع الأدمن';
  },()=>{
    if(btn){btn.textContent='تفعيل';btn.disabled=false;}
    alert('تعذر تحديد موقعك. تأكد من تفعيل GPS والسماح للموقع بالوصول إليه.');
  },{enableHighAccuracy:true,timeout:12000});
}

function _empStopLocationShare(){
  if(_empGeoWatchId!==null){navigator.geolocation.clearWatch(_empGeoWatchId);_empGeoWatchId=null;}
  _empLocShareActive=false;
  if(_empCurrentUser?.id){
    db.collection('rep_locations').doc(_empCurrentUser.id)
      .set({isActive:false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
  }
  const btn=document.getElementById('empLocShareBtn');
  const status=document.getElementById('empLocStatus');
  if(btn){btn.textContent='تفعيل';btn.style.background='#1d4ed8';}
  if(status)status.textContent='شارك موقعك مع الأدمن أثناء التوصيل';
}

function _empSendLocation(lat,lng){
  if(!_empCurrentUser?.id)return;
  db.collection('rep_locations').doc(_empCurrentUser.id).set({
    repId:_empCurrentUser.id,
    repName:_empCurrentUser.displayName||_empCurrentUser.username||'مندوب',
    lat,lng,isActive:true,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(()=>{});
}

window.addEventListener('beforeunload',()=>{if(_empLocShareActive)_empStopLocationShare();});

async function openRepMap(){
  const modal=document.getElementById('repMapModal');
  if(modal)modal.style.display='block';
  if(!window.L){
    const loading=document.getElementById('repMapLoading');
    if(loading)loading.style.display='flex';
    await new Promise((res,rej)=>{
      const link=document.createElement('link');
      link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const s=document.createElement('script');
      s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload=res;s.onerror=rej;document.head.appendChild(s);
    });
  }
  const loading=document.getElementById('repMapLoading');
  if(!_repMapInstance){
    if(loading)loading.style.display='none';
    _repMapInstance=L.map('repMapContainer',{zoomControl:true}).setView([31.95,35.93],11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a>',maxZoom:19
    }).addTo(_repMapInstance);
  } else {
    if(loading)loading.style.display='none';
    setTimeout(()=>_repMapInstance.invalidateSize(),200);
  }
  if(_repMapUnsub)_repMapUnsub();
  _repMapInitialFit=false;
  _repMapUnsub=db.collection('rep_locations').where('isActive','==',true)
    .onSnapshot(snap=>{_updateRepMapMarkers(snap.docs.map(d=>({id:d.id,...d.data()})));});
}

function closeRepMap(){
  const modal=document.getElementById('repMapModal');
  if(modal)modal.style.display='none';
  if(_repMapUnsub){_repMapUnsub();_repMapUnsub=null;}
  _repMapInitialFit=false;
}

function _updateRepMapMarkers(reps){
  if(!_repMapInstance)return;
  _repMapMarkers.forEach(m=>m.remove());
  _repMapMarkers=[];
  const countEl=document.getElementById('repMapActiveCount');
  const legend=document.getElementById('repMapLegend');
  const active=reps.filter(r=>r.lat&&r.lng);
  if(countEl){
    if(active.length){countEl.textContent=active.length+' نشط';countEl.style.display='inline-block';}
    else countEl.style.display='none';
  }
  if(!active.length){
    if(legend)legend.textContent='لا يوجد مناديب نشطين حالياً';
    return;
  }
  const bounds=[];
  active.forEach((rep,i)=>{
    const name=rep.repName||'مندوب';
    const initials=name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2)||'م';
    const updatedMs=rep.updatedAt?.toDate?rep.updatedAt.toDate().getTime():0;
    const ageMin=updatedMs?Math.floor((Date.now()-updatedMs)/60000):999;
    const isStale=ageMin>5;
    const color=isStale?'#9ca3af':_repMapColors[i%_repMapColors.length];
    const timeStr=updatedMs
      ?rep.updatedAt.toDate().toLocaleTimeString('ar-JO',{timeStyle:'short'}):'—';
    const agoStr=ageMin<1?'الآن':ageMin<60?`منذ ${ageMin} د`:`منذ ${Math.floor(ageMin/60)} س`;
    const staleWarning=isStale?`<div style="margin-top:5px;font-size:0.72rem;color:#ef4444;font-weight:600;">⚠️ موقع قديم — قد يكون الجهاز في الخلفية</div>`:'';
    const icon=L.divIcon({
      html:`<div style="background:${color};color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.75rem;border:3px solid ${isStale?'#d1d5db':'#fff'};box-shadow:0 2px 8px rgba(0,0,0,0.35);font-family:'Tajawal',sans-serif;opacity:${isStale?'0.7':'1'};">${initials}</div>`,
      className:'',iconSize:[34,34],iconAnchor:[17,17]
    });
    const marker=L.marker([rep.lat,rep.lng],{icon})
      .addTo(_repMapInstance)
      .bindPopup(`<div style="direction:rtl;font-family:'Tajawal',sans-serif;min-width:160px;text-align:right;"><div style="font-weight:800;font-size:0.9rem;color:#1a3a2a;margin-bottom:4px;">🧑 ${name}</div><div style="font-size:0.76rem;color:#6b7280;">آخر تحديث: ${timeStr} (${agoStr})</div>${staleWarning}</div>`);
    _repMapMarkers.push(marker);
    bounds.push([rep.lat,rep.lng]);
  });
  if(!_repMapInitialFit){
    _repMapInitialFit=true;
    if(bounds.length>1)_repMapInstance.fitBounds(bounds,{padding:[40,40]});
    else if(bounds.length===1)_repMapInstance.setView(bounds[0],14);
  }
  if(legend){
    legend.innerHTML=active.map((r,i)=>{
      const ageMin=r.updatedAt?.toDate?Math.floor((Date.now()-r.updatedAt.toDate().getTime())/60000):999;
      const isStale=ageMin>5;
      const color=isStale?'#9ca3af':_repMapColors[i%_repMapColors.length];
      const agoStr=ageMin<1?'الآن':ageMin<60?`${ageMin}د`:`${Math.floor(ageMin/60)}س`;
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#fff;border-radius:20px;border:1px solid ${isStale?'#fca5a5':'#e5e7eb'};"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span><span style="font-size:0.78rem;font-weight:600;color:${isStale?'#9ca3af':'#374151'};">${r.repName||'مندوب'} <span style="font-weight:400;font-size:0.7rem;">${agoStr}</span></span></span>`;
    }).join('');
  }
}

// ===== REP ACCOUNTING =====
let _repAcctRep=null;

async function loadRepAccounting(){
  const listEl=document.getElementById('repAcctList');
  if(!listEl)return;
  listEl.innerHTML='<div style="text-align:center;color:#9ca3af;padding:24px;">⏳ تحميل...</div>';
  if(!_pointValue)await loadPointValueSetting();
  try{
    const _OWED_STATUSES=['delivered','delivering','queued','waiting_rep','onhold','postponed'];
    const [repSnap,paymentsSnap,ordersSnap,pointsSnap]=await Promise.all([
      db.collection('operator_config').doc('delivery_reps').get(),
      db.collection('rep_payments').get(),
      db.collection('employee_orders').where('status','in',_OWED_STATUSES).get(),
      db.collection('rep_points_payments').get()
    ]);
    const reps=((repSnap.exists?repSnap.data()?.reps:[])||[]);
    if(!reps.length){listEl.innerHTML='<div style="text-align:center;color:#9ca3af;padding:24px;">لا يوجد مناديب مسجلين — أضفهم من قائمة المناديب في تاب الطلبات</div>';return;}
    const _ca=o=>{const t=o.netPrice!=null?o.netPrice:(o.totalPrice||0);return Math.max(0,t-(o.deliveryFee||0));};
    // مطلوب منه = كل الطلبات اللي أخذها (معه + مُسلَّمة)، المرتجع/الملغي مستثنى
    const paidByPhone={};
    paymentsSnap.docs.forEach(d=>{const p=d.data();paidByPhone[p.repPhone]=(paidByPhone[p.repPhone]||0)+(p.amount||0);});
    const owedByPhone={};
    const countByPhone={};
    const deliveredCountByPhone={};
    ordersSnap.docs.forEach(d=>{const o=d.data();let pKey=o.deliveryRepPhone;if(!pKey&&o.deliveryRepName){const mr=reps.find(r=>r.name===o.deliveryRepName);if(mr?.phone)pKey=mr.phone;}if(pKey){owedByPhone[pKey]=(owedByPhone[pKey]||0)+_ca(o);countByPhone[pKey]=(countByPhone[pKey]||0)+1;if(o.status==='delivered')deliveredCountByPhone[pKey]=(deliveredCountByPhone[pKey]||0)+1;}});
    const paidPointsByPhone={};
    pointsSnap.docs.forEach(d=>{const p=d.data();paidPointsByPhone[p.repPhone]=(paidPointsByPhone[p.repPhone]||0)+(p.points||0);});

    // Summary bar totals
    let grandOwed=0,grandPaid=0,repsWithBalance=0;
    reps.forEach(r=>{const b=(owedByPhone[r.phone]||0)-(paidByPhone[r.phone]||0);if(b>0){grandOwed+=b;repsWithBalance++;}grandPaid+=paidByPhone[r.phone]||0;});

    const summaryBar=grandOwed>0?`
      <div style="background:linear-gradient(135deg,#1a3a2a,#2d6a4f);border-radius:12px;padding:13px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.7);margin-bottom:2px;">إجمالي المطلوب من المناديب</div>
          <div style="font-size:1.2rem;font-weight:900;color:#fff;">${grandOwed.toFixed(2)} <span style="font-size:0.75rem;font-weight:600;">د.أ</span></div>
        </div>
        <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:6px 14px;text-align:center;">
          <div style="font-size:0.68rem;color:rgba(255,255,255,0.7);">مناديب عليهم رصيد</div>
          <div style="font-size:1rem;font-weight:800;color:#fbbf24;">${repsWithBalance} مندوب</div>
        </div>
      </div>`:
      `<div style="background:#dcfce7;border:1.5px solid #86efac;border-radius:12px;padding:12px 16px;margin-bottom:14px;text-align:center;">
        <div style="font-size:0.85rem;font-weight:700;color:#166534;">✅ جميع المناديب حساباتهم مسوّاة</div>
      </div>`;

    listEl.innerHTML=summaryBar+reps.map(r=>{
      const owed=owedByPhone[r.phone]||0;
      const paid=paidByPhone[r.phone]||0;
      const balance=owed-paid;
      const count=countByPhone[r.phone]||0;
      const deliveredCount=deliveredCountByPhone[r.phone]||0;
      const paidPts=paidPointsByPhone[r.phone]||0;
      const pendingPts=Math.max(0,deliveredCount-paidPts);
      const safePhone=(r.phone||'').replace(/'/g,"&#39;");
      const safeName=(r.name||'').replace(/'/g,"&#39;");
      const settled=balance<=0;
      return `<div onclick="showRepStatement('${safePhone}','${safeName}')" style="background:#fff;border:2px solid ${settled?'#86efac':'#fca5a5'};border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:box-shadow .15s;" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,0.12)'" onmouseout="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;">
          <div>
            <span style="font-weight:800;font-size:0.95rem;color:#1a3a2a;">🚚 ${r.name||'مندوب'}</span>
            ${r.phone?`<div style="font-size:0.72rem;color:#9ca3af;margin-top:1px;">${r.phone}</div>`:''}
          </div>
          <span style="padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:800;background:${settled?'#dcfce7':'#fee2e2'};color:${settled?'#166534':'#dc2626'};">${settled?'✓ مسوّى':'● عليه رصيد'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr${_pointValue&&pendingPts>0?' 1fr':''};gap:8px;">
          <div style="background:#fee2e2;border-radius:10px;padding:9px;text-align:center;">
            <div style="font-size:0.62rem;color:#dc2626;margin-bottom:3px;">مطلوب منه</div>
            <div style="font-weight:900;font-size:0.95rem;color:#dc2626;">${owed.toFixed(2)}</div>
            <div style="font-size:0.6rem;color:#9ca3af;">د.أ</div>
          </div>
          <div style="background:#dcfce7;border-radius:10px;padding:9px;text-align:center;">
            <div style="font-size:0.62rem;color:#166534;margin-bottom:3px;">دفع</div>
            <div style="font-weight:900;font-size:0.95rem;color:#166534;">${paid.toFixed(2)}</div>
            <div style="font-size:0.6rem;color:#9ca3af;">د.أ</div>
          </div>
          <div style="background:${settled?'#dcfce7':'#fee2e2'};border-radius:10px;padding:9px;text-align:center;">
            <div style="font-size:0.62rem;color:${settled?'#166534':'#dc2626'};margin-bottom:3px;">${settled?'مسوّى':'الرصيد'}</div>
            <div style="font-weight:900;font-size:0.95rem;color:${settled?'#166534':'#dc2626'};">${Math.abs(balance).toFixed(2)}</div>
            <div style="font-size:0.6rem;color:#9ca3af;">د.أ</div>
          </div>
          ${_pointValue&&pendingPts>0?`<div style="background:#fef9c3;border-radius:10px;padding:9px;text-align:center;">
            <div style="font-size:0.62rem;color:#92400e;margin-bottom:3px;">⭐ نقاط</div>
            <div style="font-weight:900;font-size:0.95rem;color:#b45309;">${pendingPts}</div>
            <div style="font-size:0.6rem;color:#9ca3af;">${(pendingPts*_pointValue).toFixed(2)} د.أ</div>
          </div>`:''}
        </div>
        <div style="margin-top:8px;font-size:0.72rem;color:#6b7280;text-align:left;">${count} طلب أخذها (${deliveredCount} مُسلَّم · ${count-deliveredCount} معه) ←</div>
      </div>`;
    }).join('');
  }catch(e){listEl.innerHTML='<div style="color:#dc2626;padding:10px;font-size:0.82rem;">❌ '+e.message+'</div>';}
}

async function showRepStatement(phone,name){
  _repAcctRep={phone,name};
  document.getElementById('repAcctListView').style.display='none';
  document.getElementById('repAcctDetailView').style.display='block';
  const titleEl=document.getElementById('repAcctDetailTitle');
  if(titleEl)titleEl.textContent='🚚 '+name;
  const summaryEl=document.getElementById('repAcctSummary');
  const detailEl=document.getElementById('repAcctDetail');
  if(detailEl)detailEl.innerHTML='<div style="text-align:center;color:#9ca3af;padding:24px;">⏳ تحميل...</div>';
  try{
    // Normalize Arabic name: replace أ/إ/آ → ا, ة → ه (handles spelling variants)
    const _normName=n=>n.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').trim();
    const nameNorm=_normName(name);
    const nameQueries=[
      db.collection('employee_orders').where('deliveryRepPhone','==',phone).get(),
      db.collection('employee_orders').where('deliveryRepName','==',name).get(),
      ...(nameNorm!==name?[db.collection('employee_orders').where('deliveryRepName','==',nameNorm).get()]:[]),
    ];
    const [paymentsSnap,refundsSnap,...orderSnaps]=await Promise.all([
      db.collection('rep_payments').where('repPhone','==',phone).get(),
      db.collection('rep_refunds').where('repPhone','==',phone).get(),
      ...nameQueries
    ]);
    // Merge all order results (deduplicate by id)
    const seenIds=new Set();
    const allOrders=orderSnaps.flatMap(s=>s.docs)
      .filter(d=>{if(seenIds.has(d.id))return false;seenIds.add(d.id);return true;})
      .map(d=>({id:d.id,...d.data()}));
    const activeOrders=allOrders.filter(o=>['delivering','queued','waiting_rep','onhold','postponed'].includes(o.status))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const orders=allOrders.filter(o=>o.status==='delivered')
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const returnedOrders=allOrders.filter(o=>o.status==='cancelled'||o.status==='returned')
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const payments=paymentsSnap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const repRefunds=refundsSnap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    // Render points section (non-blocking)
    _renderRepPoints(phone,name,orders.length);
    const _collectAmt=o=>{const t=o.netPrice!=null?o.netPrice:(o.totalPrice||0);return Math.max(0,t-(o.deliveryFee||0));};
    // NEW MODEL: مطلوب منه = كل الطلبات اللي أخذها (معه الآن + المُسلَّمة)، المرتجع/الملغي مستثنى
    const deliveredTotal=orders.reduce((s,o)=>s+_collectAmt(o),0);
    const activeTotal=activeOrders.reduce((s,o)=>s+_collectAmt(o),0);
    const totalOwed=deliveredTotal+activeTotal;
    const totalPaid=payments.reduce((s,p)=>s+(p.amount||0),0);
    const totalReturnOwed=returnedOrders.reduce((s,o)=>s+_collectAmt(o),0);
    const totalReturnPaid=repRefunds.reduce((s,r)=>s+(r.amount||0),0);
    const balance=totalOwed-totalPaid;
    const returnBalance=totalReturnOwed-totalReturnPaid;
    if(summaryEl){
      const stLabel={delivering:'قيد التوصيل',queued:'قائمة التوصيل',waiting_rep:'انتظار',onhold:'عالق',postponed:'مؤجل'};
      // Group active orders by assignment batch (assignedAt → date+time)
      const _batchKey=o=>{
        const ts=o.assignedAt||o.updatedAt||o.createdAt;
        if(!ts||!ts.toDate) return 'دفعة سابقة';
        const d=ts.toDate();
        return d.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      };
      const batches={};
      activeOrders.forEach(o=>{const k=_batchKey(o);if(!batches[k])batches[k]={orders:[],total:0};batches[k].orders.push(o);batches[k].total+=_collectAmt(o);});
      const batchKeys=Object.keys(batches);
      const activeHtml=batchKeys.map((k,i)=>{
        const b=batches[k];
        const rows=b.orders.map(o=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #dbeafe;">
            <div>
              <span style="font-size:0.8rem;font-weight:700;color:#1e3a8a;">#${o.orderNum||o.id.slice(-6).toUpperCase()}</span>
              <span style="font-size:0.7rem;color:#6b7280;margin-right:5px;">${o.pageName||''}</span>
              <span style="font-size:0.66rem;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:6px;">${stLabel[o.status]||o.status}</span>
            </div>
            <span style="font-size:0.85rem;font-weight:900;color:#1e40af;">${_collectAmt(o).toFixed(2)}</span>
          </div>`).join('');
        return `<div style="background:#fff;border:1px solid #bfdbfe;border-radius:10px;padding:9px 11px;margin-bottom:${i<batchKeys.length-1?'8px':'0'};">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:0.72rem;font-weight:800;color:#1e40af;">📅 دفعة ${k}</span>
            <span style="font-size:0.72rem;font-weight:800;color:#1e40af;">${b.orders.length} طلب — ${b.total.toFixed(2)} د.أ</span>
          </div>
          ${rows}
        </div>`;
      }).join('');

      summaryEl.innerHTML=`
        ${activeOrders.length>0?`<div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:14px;padding:13px 15px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-size:0.88rem;font-weight:800;color:#1e40af;">📦 معه الآن (لم تُسلَّم)</span>
            <span style="background:#3b82f6;color:#fff;padding:4px 12px;border-radius:20px;font-size:0.82rem;font-weight:800;">${activeOrders.length} طلب — ${activeTotal.toFixed(2)} د.أ</span>
          </div>
          <div style="max-height:220px;overflow-y:auto;">${activeHtml}</div>
        </div>`:''}

        <div style="background:${balance>0?'#fee2e2':'#dcfce7'};border:2px solid ${balance>0?'#fca5a5':'#86efac'};border-radius:14px;padding:14px 16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${balance!==0?'10px':'0'};">
            <div>
              <div style="font-size:0.72rem;color:${balance>0?'#dc2626':balance<0?'#1e40af':'#166534'};margin-bottom:3px;">${balance>0?'الرصيد المطلوب':balance<0?'دفع مقدّم — له رصيد':'الحساب'}</div>
              <div style="font-size:1.5rem;font-weight:900;color:${balance>0?'#dc2626':balance<0?'#1e40af':'#166534'};">${Math.abs(balance).toFixed(2)} <span style="font-size:0.8rem;font-weight:600;">د.أ</span></div>
            </div>
            <div style="font-size:2rem;">${balance>0?'🔴':balance<0?'💙':'✅'}</div>
          </div>
          ${balance!==0?`<button onclick="settleRepBalance(${balance.toFixed(2)})" style="width:100%;padding:9px;background:${balance>0?'#dc2626':'#1e40af'};color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:800;cursor:pointer;">${balance>0?`⚡ تسوية — سجّل ${balance.toFixed(2)} د.أ`:`🔄 تصفير — استرداد الزائد ${Math.abs(balance).toFixed(2)} د.أ`}</button>`:''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:${totalReturnOwed>0?'12px':'0'};">
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 6px;text-align:center;">
            <div style="font-size:0.62rem;color:#9a3412;margin-bottom:3px;">مطلوب منه</div>
            <div style="font-weight:900;font-size:0.95rem;color:#9a3412;">${totalOwed.toFixed(2)}</div>
            <div style="font-size:0.58rem;color:#c2622f;">معه ${activeTotal.toFixed(0)} + مُسلَّم ${deliveredTotal.toFixed(0)}</div>
          </div>
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:10px 6px;text-align:center;">
            <div style="font-size:0.62rem;color:#166534;margin-bottom:3px;">دفع</div>
            <div style="font-weight:900;font-size:0.95rem;color:#166534;">${totalPaid.toFixed(2)}</div>
            <div style="font-size:0.58rem;color:#16a34a;">د.أ</div>
          </div>
          <div style="background:${balance>0?'#fee2e2':'#dcfce7'};border:1px solid ${balance>0?'#fca5a5':'#86efac'};border-radius:10px;padding:10px 6px;text-align:center;">
            <div style="font-size:0.62rem;color:${balance>0?'#dc2626':'#166534'};margin-bottom:3px;">${balance>0?'الرصيد':'مسوّى'}</div>
            <div style="font-weight:900;font-size:0.95rem;color:${balance>0?'#dc2626':'#166534'};">${Math.abs(balance).toFixed(2)}</div>
            <div style="font-size:0.58rem;color:#9ca3af;">د.أ</div>
          </div>
        </div>

        ${totalReturnOwed>0?`<div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:12px 14px;margin-bottom:4px;">
          <div style="font-size:0.78rem;font-weight:700;color:#6d28d9;margin-bottom:8px;">↩️ مرتجعات (${returnedOrders.length} طلب)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
            <div style="background:#ede9fe;border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:0.62rem;color:#6d28d9;margin-bottom:2px;">مرتجع له</div>
              <div style="font-weight:900;font-size:0.9rem;color:#6d28d9;">${totalReturnOwed.toFixed(2)}</div>
            </div>
            <div style="background:#dcfce7;border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:0.62rem;color:#166534;margin-bottom:2px;">رُجع له</div>
              <div style="font-weight:900;font-size:0.9rem;color:#166534;">${totalReturnPaid.toFixed(2)}</div>
            </div>
            <div style="background:${returnBalance>0?'#fef3c7':'#dcfce7'};border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:0.62rem;color:${returnBalance>0?'#92400e':'#166534'};margin-bottom:2px;">${returnBalance>0?'ضايل':'مسوّى ✓'}</div>
              <div style="font-weight:900;font-size:0.9rem;color:${returnBalance>0?'#92400e':'#166534'};">${Math.abs(returnBalance).toFixed(2)}</div>
            </div>
          </div>
        </div>`:''}`;
    }
    let html='';
    // Payment list — scrollable box
    const payRows=payments.map(p=>`<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:9px;padding:10px 13px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:0.88rem;font-weight:800;color:#166534;">${(p.amount||0).toFixed(2)} د.أ</div>
        ${p.notes?`<div style="font-size:0.76rem;color:#6b7280;">${p.notes}</div>`:''}
        <div style="font-size:0.72rem;color:#9ca3af;">${p.date||''} • ${p.addedBy||'أدمن'}</div>
      </div>
      <button onclick="deleteRepPayment('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:7px;padding:5px 10px;font-family:'Tajawal',sans-serif;font-size:0.76rem;cursor:pointer;font-weight:600;">حذف</button>
    </div>`).join('');
    html+=`<div style="background:var(--card-bg);border:1.5px solid #86efac;border-radius:12px;overflow:hidden;margin-bottom:14px;">
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.tog').textContent=this.nextElementSibling.style.display==='none'?'▼':'▲';" style="background:#f0fdf4;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
        <span style="font-size:0.85rem;font-weight:700;color:#166534;">💰 دفعات المندوب</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:10px;font-size:0.78rem;font-weight:700;">${payments.length} دفعة</span>
          <span class="tog" style="color:#166534;font-size:0.8rem;">▼</span>
        </div>
      </div>
      <div style="display:none;max-height:240px;overflow-y:auto;padding:10px 12px;border-top:1px solid #86efac;">
        ${payRows||'<div style="color:#9ca3af;font-size:0.8rem;text-align:center;padding:14px 0;">لا يوجد دفعات</div>'}
      </div>
    </div>`;

    // Returns refund section
    if(totalReturnOwed>0){
      html+=`<div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:14px;margin-bottom:14px;margin-top:4px;">
        <div style="font-size:0.85rem;font-weight:700;color:#6d28d9;margin-bottom:10px;">↩️ تسجيل مبلغ رُجع للمندوب</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <input type="number" id="repRefundAmt" placeholder="المبلغ (د.أ)" min="0.5" step="0.5"
            style="flex:1;padding:9px 11px;border:1.5px solid #c4b5fd;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:#fff;"
            onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#c4b5fd'">
          <input type="text" id="repRefundNotes" placeholder="ملاحظات (اختياري)"
            style="flex:2;padding:9px 11px;border:1.5px solid #c4b5fd;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.88rem;outline:none;background:#fff;"
            onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#c4b5fd'">
          <button onclick="addRepRefund()" style="padding:9px 16px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-family:'Tajawal',sans-serif;font-weight:700;font-size:0.85rem;cursor:pointer;flex-shrink:0;">💾 حفظ</button>
        </div>
        <div style="max-height:200px;overflow-y:auto;margin-top:8px;">
          ${repRefunds.length?repRefunds.map(r=>`<div style="background:#ede9fe;border-radius:8px;padding:9px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:0.85rem;font-weight:800;color:#6d28d9;">${(r.amount||0).toFixed(2)} د.أ</div>
              ${r.notes?`<div style="font-size:0.74rem;color:#7c3aed;">${r.notes}</div>`:''}
              <div style="font-size:0.7rem;color:#9ca3af;">${r.date||''} • ${r.addedBy||'أدمن'}</div>
            </div>
            <button onclick="deleteRepRefund('${r.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:7px;padding:5px 10px;font-family:'Tajawal',sans-serif;font-size:0.76rem;cursor:pointer;">حذف</button>
          </div>`).join(''):'<div style="font-size:0.78rem;color:#9ca3af;text-align:center;padding:10px 0;">لا يوجد مبالغ مرجعة مسجلة</div>'}
        </div>
      </div>`;

      html+=`<div style="background:var(--card-bg);border:1.5px solid #c4b5fd;border-radius:12px;overflow:hidden;margin-bottom:14px;">
        <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.tog').textContent=this.nextElementSibling.style.display==='none'?'▼':'▲';" style="background:#f5f3ff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
          <span style="font-size:0.85rem;font-weight:700;color:#6d28d9;">↩️ طلبات مرتجعة / ملغاة</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:#ede9fe;color:#6d28d9;padding:2px 10px;border-radius:10px;font-size:0.78rem;font-weight:700;">${returnedOrders.length} طلب</span>
            <span class="tog" style="color:#6d28d9;font-size:0.8rem;">▼</span>
          </div>
        </div>
        <div style="display:none;max-height:240px;overflow-y:auto;padding:10px 12px;border-top:1px solid #c4b5fd;">
          ${returnedOrders.map(o=>{
            const collect=_collectAmt(o);
            const lbl=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
            const statusLabel=o.status==='cancelled'?'ملغي':'مرتجع';
            return `<div style="background:#fff;border:1px solid #c4b5fd;border-radius:9px;padding:10px 13px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:0.84rem;font-weight:700;color:#6d28d9;">${lbl}</span>
                  <span style="background:#fee2e2;color:#991b1b;padding:1px 7px;border-radius:8px;font-size:0.68rem;font-weight:700;">${statusLabel}</span>
                </div>
                <div style="font-size:0.74rem;color:#6b7280;">${o.customerPhone||''}${o.address?' · '+o.address:''}</div>
              </div>
              <div style="font-weight:900;color:#6d28d9;font-size:0.92rem;">${collect.toFixed(2)} <span style="font-size:0.7rem;font-weight:600;">د.أ</span></div>
            </div>`;
          }).join('')||'<div style="color:#9ca3af;font-size:0.8rem;text-align:center;padding:14px 0;">لا يوجد طلبات مرتجعة</div>'}
        </div>
      </div>`;
    }

    const orderRows=orders.map(o=>{
      const collect=_collectAmt(o);
      const lbl=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-6).toUpperCase();
      const dt=o.deliveredDate||o.date||'';
      return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:9px;padding:10px 13px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:0.84rem;font-weight:700;color:#1a3a2a;">${lbl}</div>
          <div style="font-size:0.75rem;color:#6b7280;">${o.customerPhone||''}${dt?' · '+dt:''}</div>
          ${o.address?`<div style="font-size:0.74rem;color:#9ca3af;">📍 ${o.address}</div>`:''}
        </div>
        <div style="font-weight:900;color:#dc2626;font-size:0.92rem;direction:ltr;">${collect.toFixed(2)} <span style="font-size:0.7rem;font-weight:600;">د.أ</span></div>
      </div>`;
    }).join('');
    html+=`<div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:14px;">
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.tog').textContent=this.nextElementSibling.style.display==='none'?'▼':'▲';" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
        <span style="font-size:0.85rem;font-weight:700;color:#374151;">📦 الطلبات المُسلَّمة</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="background:#f3f4f6;color:#374151;padding:2px 10px;border-radius:10px;font-size:0.78rem;font-weight:700;">${orders.length} طلب</span>
          <span class="tog" style="color:#6b7280;font-size:0.8rem;">▼</span>
        </div>
      </div>
      <div style="display:none;max-height:320px;overflow-y:auto;padding:10px 12px;border-top:1px solid var(--border);">
        ${orderRows||'<div style="color:#9ca3af;font-size:0.8rem;text-align:center;padding:14px 0;">لا يوجد طلبات مُسلَّمة</div>'}
      </div>
    </div>`;
    if(detailEl)detailEl.innerHTML=html;
  }catch(e){if(detailEl)detailEl.innerHTML='<div style="color:#dc2626;padding:10px;font-size:0.82rem;">❌ '+e.message+'</div>';}
}

function repAcctBackToList(){
  document.getElementById('repAcctListView').style.display='block';
  document.getElementById('repAcctDetailView').style.display='none';
  _repAcctRep=null;
}

// ====== POINTS SYSTEM ======
let _pointValue=0;

async function loadPointValueSetting(){
  try{
    const snap=await db.collection('operator_config').doc('points_config').get();
    _pointValue=snap.exists?(snap.data()?.pointValue||0):0;
  }catch(e){_pointValue=0;}
  const inp=document.getElementById('pointValueInput');
  if(inp&&_pointValue>0)inp.value=_pointValue.toFixed(2);
  const st=document.getElementById('pointValueStatus');
  if(st&&_pointValue>0)st.textContent=`الحالي: ${_pointValue.toFixed(2)} د.أ / نقطة`;
}

async function savePointValue(){
  const inp=document.getElementById('pointValueInput');
  const val=parseFloat(inp?.value||'0');
  if(!val||val<=0){toast('⚠️ أدخل قيمة صحيحة للنقطة');return;}
  try{
    await db.collection('operator_config').doc('points_config').set({pointValue:val},{merge:true});
    _pointValue=val;
    const st=document.getElementById('pointValueStatus');
    if(st)st.textContent=`محفوظ ✓ — ${val.toFixed(2)} د.أ / نقطة`;
    toast('✅ تم حفظ قيمة النقطة');
  }catch(e){toast('❌ '+e.message);}
}

async function _renderRepPoints(phone,name,deliveredCount){
  const el=document.getElementById('repAcctPointsSection');
  if(!el)return;
  if(!_pointValue){el.innerHTML='';return;}
  try{
    const snap=await db.collection('rep_points_payments').where('repPhone','==',phone).get();
    const ppays=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const paidPoints=ppays.reduce((s,p)=>s+(p.points||0),0);
    const pendingPoints=Math.max(0,deliveredCount-paidPoints);
    const pendingAmt=pendingPoints*_pointValue;
    const totalAmt=deliveredCount*_pointValue;
    const paidAmt=paidPoints*_pointValue;
    el.innerHTML=`
      <div style="background:#fefce8;border:1.5px solid #fde047;border-radius:12px;padding:14px;">
        <div style="font-size:0.82rem;font-weight:800;color:#92400e;margin-bottom:10px;">⭐ نقاط التوصيل</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
          <div style="background:#fff9c4;border-radius:8px;padding:9px;text-align:center;">
            <div style="font-size:0.65rem;color:#92400e;margin-bottom:2px;">إجمالي النقاط</div>
            <div style="font-weight:900;font-size:1.1rem;color:#92400e;">${deliveredCount}</div>
            <div style="font-size:0.6rem;color:#a16207;">${totalAmt.toFixed(2)} د.أ</div>
          </div>
          <div style="background:#dcfce7;border-radius:8px;padding:9px;text-align:center;">
            <div style="font-size:0.65rem;color:#166534;margin-bottom:2px;">مصروف</div>
            <div style="font-weight:900;font-size:1.1rem;color:#166534;">${paidPoints}</div>
            <div style="font-size:0.6rem;color:#166534;">${paidAmt.toFixed(2)} د.أ</div>
          </div>
          <div style="background:${pendingPoints>0?'#fef3c7':'#dcfce7'};border-radius:8px;padding:9px;text-align:center;">
            <div style="font-size:0.65rem;color:${pendingPoints>0?'#92400e':'#166534'};margin-bottom:2px;">${pendingPoints>0?'رصيد النقاط':'مسوّى ✓'}</div>
            <div style="font-weight:900;font-size:1.1rem;color:${pendingPoints>0?'#b45309':'#166534'};">${pendingPoints}</div>
            <div style="font-size:0.6rem;color:${pendingPoints>0?'#b45309':'#166534'};">${pendingAmt.toFixed(2)} د.أ</div>
          </div>
        </div>
        ${pendingPoints>0?`
        <button onclick="payRepPoints(${pendingPoints},${pendingAmt.toFixed(2)})" style="width:100%;padding:10px;background:#ca8a04;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:800;cursor:pointer;margin-bottom:10px;">
          💳 صرف ${pendingPoints} نقطة (${pendingAmt.toFixed(2)} د.أ)
        </button>`:''}
        ${ppays.length?`
        <div style="background:#fff;border:1px solid #fde047;border-radius:8px;overflow:hidden;">
          <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.ptog').textContent=this.nextElementSibling.style.display==='none'?'▼':'▲';" style="background:#fef9c3;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
            <span style="font-size:0.78rem;font-weight:700;color:#92400e;">سجل صرف النقاط (${ppays.length})</span>
            <span class="ptog" style="color:#92400e;font-size:0.75rem;">▼</span>
          </div>
          <div style="display:none;max-height:200px;overflow-y:auto;padding:8px 10px;">
            ${ppays.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #fef9c3;">
              <div>
                <span style="font-size:0.82rem;font-weight:700;color:#92400e;">⭐ ${p.points} نقطة = ${(p.amount||0).toFixed(2)} د.أ</span>
                <div style="font-size:0.7rem;color:#9ca3af;">${p.date||''} • ${p.addedBy||'أدمن'}</div>
              </div>
              <button onclick="deleteRepPointsPayment('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 9px;font-family:'Tajawal',sans-serif;font-size:0.72rem;cursor:pointer;font-weight:600;">حذف</button>
            </div>`).join('')}
          </div>
        </div>`:''}
      </div>`;
  }catch(e){el.innerHTML='';}
}

async function payRepPoints(points,amount){
  if(!_repAcctRep)return;
  if(!confirm(`صرف ${points} نقطة بقيمة ${parseFloat(amount).toFixed(2)} د.أ للمندوب ${_repAcctRep.name}؟`))return;
  try{
    await db.collection('rep_points_payments').add({
      repPhone:_repAcctRep.phone,repName:_repAcctRep.name,
      points,amount:parseFloat(amount),
      date:jordanDateStr(),addedBy:'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم تسجيل صرف النقاط');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}

async function deleteRepPointsPayment(id){
  if(!confirm('حذف هذا السجل؟'))return;
  try{
    await db.collection('rep_points_payments').doc(id).delete();
    toast('🗑 تم الحذف');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}
// ============================

async function settleRepBalance(balance){
  if(!_repAcctRep)return;
  const abs=Math.abs(balance).toFixed(2);
  if(balance>0){
    // Rep owes — pre-fill the payment form and scroll to it
    const amtEl=document.getElementById('repAcctPayAmt');
    const notesEl=document.getElementById('repAcctPayNotes');
    if(amtEl){amtEl.value=abs;amtEl.focus();}
    if(notesEl)notesEl.value='تسوية حساب';
    amtEl?.scrollIntoView({behavior:'smooth',block:'center'});
    toast('💡 اضغط "تسجيل" لإتمام التسوية');
  } else {
    // Rep overpaid — record a negative adjustment to zero the balance
    if(!confirm(`استرداد الزائد ${abs} د.أ من حساب ${_repAcctRep.name}؟ سيتم تصفير الحساب.`))return;
    try{
      await db.collection('rep_payments').add({
        repPhone:_repAcctRep.phone, repName:_repAcctRep.name,
        amount:balance, // negative value reduces totalPaid
        notes:'تسوية — استرداد دفع زائد',
        date:jordanDateStr(),
        addedBy:_currentAdminUser||'أدمن',
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('✅ تم تصفير الحساب');
      showRepStatement(_repAcctRep.phone,_repAcctRep.name);
    }catch(e){toast('❌ '+e.message);}
  }
}

async function addRepPayment(){
  if(!_repAcctRep){toast('لم يتم تحديد المندوب');return;}
  const amtEl=document.getElementById('repAcctPayAmt');
  const notesEl=document.getElementById('repAcctPayNotes');
  const amount=parseFloat(amtEl?.value||'0');
  if(!amount||amount<=0){toast('أدخل مبلغاً صحيحاً');return;}
  const notes=(notesEl?.value||'').trim();
  try{
    await db.collection('rep_payments').add({
      repPhone:_repAcctRep.phone,repName:_repAcctRep.name,
      amount,notes,date:jordanDateStr(),
      addedBy:_currentAdminUser||'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    if(amtEl)amtEl.value='';
    if(notesEl)notesEl.value='';
    toast('✅ تم تسجيل الدفعة');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}

async function deleteRepPayment(id){
  if(!confirm('حذف هذه الدفعة؟'))return;
  try{
    await db.collection('rep_payments').doc(id).delete();
    toast('تم الحذف');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}

async function addRepRefund(){
  if(!_repAcctRep)return;
  const amt=parseFloat(document.getElementById('repRefundAmt')?.value||'0');
  const notes=(document.getElementById('repRefundNotes')?.value||'').trim();
  if(!amt||amt<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    await db.collection('rep_refunds').add({
      repPhone:_repAcctRep.phone,repName:_repAcctRep.name,
      amount:amt,notes,date:jordanDateStr(),addedBy:'أدمن',
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ تم تسجيل المبلغ المرجع');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}

async function deleteRepRefund(id){
  if(!confirm('حذف هذا السجل؟'))return;
  try{
    await db.collection('rep_refunds').doc(id).delete();
    toast('تم الحذف');
    showRepStatement(_repAcctRep.phone,_repAcctRep.name);
  }catch(e){toast('❌ '+e.message);}
}

window.loadRepAccounting=loadRepAccounting; window.showRepStatement=showRepStatement;
window.repAcctBackToList=repAcctBackToList; window.addRepPayment=addRepPayment; window.settleRepBalance=settleRepBalance;
window.deleteRepPayment=deleteRepPayment; window.addRepRefund=addRepRefund;
window.deleteRepRefund=deleteRepRefund;
window.savePointValue=savePointValue; window.payRepPoints=payRepPoints;
window.deleteRepPointsPayment=deleteRepPointsPayment;
window.loadPointValueSetting=loadPointValueSetting;

window.openRepMap=openRepMap; window.closeRepMap=closeRepMap;
window._empToggleLocationShare=_empToggleLocationShare;

window.openTVMode=openTVMode; window.closeTVMode=closeTVMode;
window.copyOrderTrackingLink=copyOrderTrackingLink;
window.openQRScanner=openQRScanner; window.closeQRScanner=closeQRScanner;
window.closeQRRepAssignModal=closeQRRepAssignModal;
window.qrAssignToRep=qrAssignToRep; window.qrAssignManualSend=qrAssignManualSend;
window._showRepPickerInModal=_showRepPickerInModal; window._openQRRepAssignForWaiting=_openQRRepAssignForWaiting;
window.sendQueuedRepOrders=sendQueuedRepOrders; window.markOrderDelivered=markOrderDelivered;
window.toggleDelivSelectMode=toggleDelivSelectMode; window.delivToggle=delivToggle; window.delivSelectRep=delivSelectRep; window.bulkDeliverSelected=bulkDeliverSelected;
window.openBatchDistributeModal=openBatchDistributeModal;
window.toggleEmpReady=toggleEmpReady;

// ===== BATCH DISTRIBUTE MODAL =====
let _batchDistSelected=new Set();

function openBatchDistributeModal(){
  const orders=(_opOrdersAllData||[]).filter(o=>o.status==='prepared');
  if(!orders.length){toast('⚠️ لا توجد طلبات جاهزة للتوصيل');return;}
  let modal=document.getElementById('batchDistModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='batchDistModal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
    document.body.appendChild(modal);
  }
  _batchDistSelected=new Set(orders.map(o=>o.id));
  _renderBatchDistModal(orders);
  modal.style.display='flex';
}

function _renderBatchDistModal(orders){
  const modal=document.getElementById('batchDistModal');
  if(!modal)return;
  const total=orders.filter(o=>_batchDistSelected.has(o.id)).reduce((s,o)=>s+(o.netPrice!=null?o.netPrice:(o.totalPrice||0)),0);
  modal.innerHTML=`
  <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 18px 10px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-weight:800;font-size:1rem;color:#1a3a2a;">🚚 توزيع الطلبات الجاهزة</div>
        <div style="font-size:0.76rem;color:#6b7280;margin-top:2px;">${_batchDistSelected.size} طلب محدد · ${total.toFixed(2)} د.أ</div>
      </div>
      <button onclick="document.getElementById('batchDistModal').style.display='none'" style="background:#f3f4f6;border:none;border-radius:50%;width:32px;height:32px;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <div style="overflow-y:auto;flex:1;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:0.78rem;font-weight:700;color:#374151;">الطلبات الجاهزة</span>
        <div style="display:flex;gap:6px;">
          <button onclick="_batchDistToggleAll(true)" style="padding:4px 10px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.72rem;font-weight:700;cursor:pointer;">تحديد الكل</button>
          <button onclick="_batchDistToggleAll(false)" style="padding:4px 10px;background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.72rem;cursor:pointer;">إلغاء الكل</button>
        </div>
      </div>
      ${orders.map(o=>{
        const checked=_batchDistSelected.has(o.id);
        const net=(o.netPrice!=null?o.netPrice:(o.totalPrice||0)).toFixed(2);
        const label=o.orderNum?`#${o.orderNum}`:'#'+o.id.slice(-5).toUpperCase();
        const prods=(o.products||[]).map(p=>p.name+(p.qty>1?` ×${p.qty}`:'')).join('، ')||'—';
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;border:1.5px solid ${checked?'#1a3a2a':'#e5e7eb'};background:${checked?'#f0fdf4':'#fff'};margin-bottom:6px;cursor:pointer;" onclick="event.preventDefault();_batchDistToggle('${o.id}')">
          <input type="checkbox" ${checked?'checked':''} style="width:18px;height:18px;accent-color:#1a3a2a;cursor:pointer;flex-shrink:0;" onclick="event.stopPropagation();_batchDistToggle('${o.id}')">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:#1a3a2a;font-size:0.82rem;">${label} · ${o.pageName||''}</div>
            <div style="font-size:0.72rem;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${prods}</div>
            ${(o.address||o.customerPhone)?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;">
              ${o.address?`<span style="font-size:0.7rem;color:#374151;">📍 ${o.address}</span>`:''}
              ${o.customerPhone?`<span style="font-size:0.7rem;color:#374151;direction:ltr;">📞 ${o.customerPhone}</span>`:''}
            </div>`:''}
          </div>
          <span style="font-weight:800;color:#166534;font-size:0.85rem;flex-shrink:0;">${net} د.أ</span>
        </label>`;
      }).join('')}
    </div>
    <div style="padding:12px 14px;border-top:1px solid #e5e7eb;" id="batchDistRepSection">
      <div style="font-size:0.78rem;font-weight:700;color:#374151;margin-bottom:8px;">اختر المندوب:</div>
      <div id="batchDistRepList" style="display:flex;flex-wrap:wrap;gap:7px;"><div style="color:#9ca3af;font-size:0.8rem;">⏳ تحميل...</div></div>
    </div>
  </div>`;
  _loadBatchDistReps();
}

function _batchDistToggle(id){
  if(_batchDistSelected.has(id))_batchDistSelected.delete(id);
  else _batchDistSelected.add(id);
  const orders=(_opOrdersAllData||[]).filter(o=>o.status==='prepared');
  _renderBatchDistModal(orders);
}
function _batchDistToggleAll(v){
  const orders=(_opOrdersAllData||[]).filter(o=>o.status==='prepared');
  _batchDistSelected=v?new Set(orders.map(o=>o.id)):new Set();
  _renderBatchDistModal(orders);
}
window._batchDistToggle=_batchDistToggle;
window._batchDistToggleAll=_batchDistToggleAll;

async function _loadBatchDistReps(){
  const repListEl=document.getElementById('batchDistRepList');
  if(!repListEl)return;
  try{
    const snap=await db.collection('operator_config').doc('delivery_reps').get();
    const reps=(snap.exists?snap.data()?.reps:[])||[];
    if(!reps.length){repListEl.innerHTML='<div style="color:#9ca3af;font-size:0.8rem;">لا يوجد مناديب مضافين</div>';return;}
    repListEl.innerHTML=reps.map(r=>`
      <button onclick="_batchDistAssign('${r.name.replace(/'/g,"\\'")}','${(r.phone||'').replace(/'/g,"\\'")}')
      " style="padding:9px 16px;background:#f5f3ff;color:#5b21b6;border:1.5px solid #ddd6fe;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">🚚 ${r.name}</button>
    `).join('');
  }catch(e){repListEl.innerHTML='<div style="color:#dc2626;font-size:0.78rem;">❌ '+e.message+'</div>';}
}

async function _batchDistAssign(repName,repPhone){
  const ids=[..._batchDistSelected];
  if(!ids.length){toast('⚠️ لم تحدد أي طلب');return;}
  const count=ids.length;
  document.getElementById('batchDistModal').style.display='none';
  toast(`⏳ جاري تعيين ${count} طلب لـ ${repName}...`);
  let done=0;
  for(const id of ids){
    try{
      const docRef=db.collection('employee_orders').doc(id);
      const snap=await docRef.get();
      const data=snap.data();
      if(!data||['delivered','cancelled','returned','refused'].includes(data.status))continue;
      const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:`${_empSt(data.status).label} ← قيد التوصيل (${repName})`};
      await docRef.update({status:'delivering',deliveryRepName:repName,deliveryRepPhone:repPhone||'',assignedAt:firebase.firestore.Timestamp.now(),editHistory:[...(data.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      done++;
    }catch(e){}
  }
  // Patch local cache
  const assigned=new Set(ids);
  [typeof _opOrdersAllData!=='undefined'?_opOrdersAllData:null,
   typeof _empOrdersAllData!=='undefined'?_empOrdersAllData:null].forEach(arr=>{
    if(!arr)return;
    arr.forEach(o=>{if(assigned.has(o.id)){o.status='delivering';o.deliveryRepName=repName;o.deliveryRepPhone=repPhone||'';}});
  });
  if(typeof _renderOpOrdersView==='function')_renderOpOrdersView();
  toast(`✅ تم تعيين ${done} طلب لـ ${repName}`);
}
window._batchDistAssign=_batchDistAssign;

window.openDeliveryModal=openDeliveryModal; window.closeDeliveryModal=closeDeliveryModal;
window.addDeliveryRep=addDeliveryRep; window.removeDeliveryRep=removeDeliveryRep;
window.sendDeliveryToCustomPhone=sendDeliveryToCustomPhone; window.sendAndMarkDelivering=sendAndMarkDelivering;
window.sendAndMarkDelivering_withRep=sendAndMarkDelivering_withRep;
window.confirmBatchOrder=confirmBatchOrder;
window.toggleRepsPanel=toggleRepsPanel; window.addRepFromPanel=addRepFromPanel;
window.removeRepFromPanel=removeRepFromPanel; window.renderOpRepsPanelList=renderOpRepsPanelList;
window.toggleRepExcludeBalance=toggleRepExcludeBalance; window.toggleRepSupervisor=toggleRepSupervisor; window.toggleRepBalanceByName=toggleRepBalanceByName;
window.openInternalNote=openInternalNote;

// ===== ORDER SEARCH (Feature 2) =====
let _empOrdersSearch='', _opOrdersSearch='';

function _matchesSearch(o, q){
  if(!q)return true;
  const s=q.toLowerCase();
  return (o.customerPhone||'').includes(s)
    ||(o.pageName||'').toLowerCase().includes(s)
    ||(o.address||'').toLowerCase().includes(s)
    ||(o.workerName||'').toLowerCase().includes(s)
    ||String(o.orderNum||'').includes(s)
    ||(o.products||[]).some(p=>(p.name||'').toLowerCase().includes(s));
}

function setEmpSearch(val){
  _empOrdersSearch=val.trim();
  const clr=document.getElementById('empSearchClear');
  if(clr)clr.style.display=_empOrdersSearch?'block':'none';
  _renderEmpOrdersView();
}
function clearEmpSearch(){
  _empOrdersSearch='';
  const inp=document.getElementById('empOrderSearch');
  if(inp)inp.value='';
  const clr=document.getElementById('empSearchClear');
  if(clr)clr.style.display='none';
  _renderEmpOrdersView();
}
function setOpSearch(val){
  _opOrdersSearch=val.trim();
  const clr=document.getElementById('opSearchClear');
  if(clr)clr.style.display=_opOrdersSearch?'block':'none';
  _renderOpOrdersView();
}
function clearOpSearch(){
  _opOrdersSearch='';
  const inp=document.getElementById('opOrderSearch');
  if(inp)inp.value='';
  const clr=document.getElementById('opSearchClear');
  if(clr)clr.style.display='none';
  _renderOpOrdersView();
}

// ===== WHATSAPP STORE SUMMARY (Feature 4) =====
function whatsappStoreSummary(){
  const totalOwed=_acctCurrentSales.reduce((s,it)=>s+(_acctItemCost(it)*(it.qty||1)),0);
  const totalPaid=_acctCurrentPayments.reduce((s,p)=>s+(p.amount||0),0);
  const totalRefund=(_acctCurrentRefunds||[]).reduce((s,r)=>s+(r.totalCost||0),0);
  const balance=totalOwed-totalPaid-totalRefund;
  const storeName=_acctCurrentStore?.name||'المتجر';
  let msg=`🏪 كشف حساب — ${storeName}\n📅 ${jordanDisplayDate()}\n${'─'.repeat(18)}\n`;
  msg+=`💰 إجمالي المستحق: ${totalOwed.toFixed(2)} د.أ\n`;
  msg+=`✅ إجمالي المدفوع: ${totalPaid.toFixed(2)} د.أ\n`;
  if(totalRefund>0)msg+=`↩️ رصيد مرتجع: ${totalRefund.toFixed(2)} د.أ\n`;
  msg+=`${'─'.repeat(18)}\n📊 الرصيد المتبقي: ${balance.toFixed(2)} د.أ`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

window.setEmpSearch=setEmpSearch; window.clearEmpSearch=clearEmpSearch;
window.setOpSearch=setOpSearch; window.clearOpSearch=clearOpSearch;
window.whatsappStoreSummary=whatsappStoreSummary;
window.toggleEmpGroupArea=toggleEmpGroupArea; window.toggleOpGroupArea=toggleOpGroupArea;
window.toggleEmpKanban=toggleEmpKanban; window.toggleOpKanban=toggleOpKanban;
window.viewCustomerHistory=viewCustomerHistory; window.closeCustomerHistory=closeCustomerHistory;
window.saveAcctThreshold=saveAcctThreshold;
window.updateBatchBar=updateBatchBar; window.selectAreaOrders=selectAreaOrders; window.openBatchDeliveryModal=openBatchDeliveryModal;
window.renderEmpEditCart=renderEmpEditCart; window.changeEmpEditQty=changeEmpEditQty; window.removeEmpEditItem=removeEmpEditItem;
window.setEmpEditDelivery=setEmpEditDelivery; window.updateEmpEditNet=updateEmpEditNet;
window.addProduct=addProduct; window.delProduct=delProduct;
window.editProduct=editProduct; window.cancelEdit=cancelEdit;
window.openProductPage=openProductPage; window.closeProductPage=closeProductPage;
window.goToSlide=goToSlide; window.slideImg=slideImg;
window.selectColor=selectColor; window.selectSize=selectSize; window.switchPPTab=switchPPTab; window.addToCartFromPage=addToCartFromPage;
window.showAddSizeUI=showAddSizeUI; window.confirmAddSize=confirmAddSize; window.removeSizeItem=removeSizeItem;
window.openRatingFromPage=openRatingFromPage;
window.handleColorsInput=function(){}; window.removeColorTag=removeColorTag;
window.prevImgs=prevImgs; window.prevVideo=prevVideo;
window.openRatingModal=openRatingModal; window.closeRatingModal=closeRatingModal;
window.selectStar=selectStar; window.submitRating=submitRating;
window.openOrderStatus=openOrderStatus; window.closeOrderStatus=closeOrderStatus;
window.trackOrder=trackOrder; window.updateOrderStatus=updateOrderStatus;
window.openAbout=openAbout; window.closeAbout=closeAbout;
window.startOrderListener=startOrderListener; window.stopOrderListener=stopOrderListener;
window.switchVideoTab=switchVideoTab; window.prevVideo=prevVideo; window.clearExistingVideo=clearExistingVideo;
window.copyReferral=copyReferral; window.shareReferral=shareReferral;
window.toggleDarkMode=toggleDarkMode;
window.toggleWishlist=toggleWishlist; window.openWishlist=openWishlist; window.closeWishlist=closeWishlist; window.renderWishlist=renderWishlist; window.closeEditCart=closeEditCart; window.saveCartEdit=saveCartEdit; window.selectEditColor=selectEditColor;
window.switchOrderTab=switchOrderTab; window.renderOrdersByStatus=renderOrdersByStatus;
window.transferNewOrders=transferNewOrders;
window.searchAdminProducts=searchAdminProducts;
window.editDiscount=editDiscount; window.cancelDcEdit=cancelDcEdit; window.toggleDcProducts=toggleDcProducts;
window.openPhotoModal=openPhotoModal; window.closePhotoModal=closePhotoModal;
window.prevPhotoUpload=prevPhotoUpload; window.submitCustomerPhoto=submitCustomerPhoto;
window.approvePhoto=approvePhoto; window.deletePhoto=deletePhoto;
window.showAddColorUI=showAddColorUI;
window.showAddPotUI=showAddPotUI;
window.confirmAddPot=confirmAddPot;
window.previewNewPotImg=previewNewPotImg;
window.changePotImg=changePotImg;
window.removePotTag=removePotTag;
window.selectPot=selectPot;
window.saveEidSettings=saveEidSettings;
window.toggleOutOfStock=toggleOutOfStock;
window.saveCategory=saveCategory;
window.editCategory=editCategory;
window.cancelCatEdit=cancelCatEdit;
window.prevCatImg=prevCatImg;
window.clearCatImg=clearCatImg;
window.deleteCategory=deleteCategory;
window.selectCatColor=selectCatColor;
window.shareProduct=shareProduct;
window.sendDailyReport=sendDailyReport;
window.updateEidPositions=updateEidPositions;
window.confirmAddColor=confirmAddColor;
window.previewNewColorImg=previewNewColorImg;
window.changeColorImg=changeColorImg;
window.removeColorTag=removeColorTag;
window.removeExistingImage=removeExistingImage;
// ===== CUSTOMER CANCEL ORDER =====
let _custCancelDocId=null;
function openCustomerCancelDialog(docId){
  _custCancelDocId=docId;
  document.getElementById('custCancelReasonInput').value='';
  document.querySelectorAll('.cust-cancel-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  document.getElementById('customerCancelOverlay').style.display='flex';
}
function closeCustomerCancelDialog(){
  document.getElementById('customerCancelOverlay').style.display='none';
  _custCancelDocId=null;
}
function selectCustomerCancelReason(btn,reason){
  document.querySelectorAll('.cust-cancel-btn').forEach(b=>{
    b.style.borderColor='#e5e7eb';b.style.background='#fff';b.style.color='';
  });
  btn.style.borderColor='#dc2626';btn.style.background='#fee2e2';btn.style.color='#991b1b';
  document.getElementById('custCancelReasonInput').value=reason;
}
async function confirmCustomerCancel(){
  const reason=document.getElementById('custCancelReasonInput').value.trim();
  if(!reason){toast('⚠️ يرجى اختيار أو كتابة سبب الإلغاء');return;}
  if(!_custCancelDocId){return;}
  const docId=_custCancelDocId;
  closeCustomerCancelDialog();
  try{
    await db.collection('orders').doc(docId).update({status:'ملغي',cancelReason:reason});
    toast('✅ تم إلغاء طلبك');
  }catch(e){ toast('❌ حدث خطأ، حاول مجدداً'); }
}

// ===== ABOUT SETTINGS =====
async function loadAboutSettings(){
  try{
    let d;
    try{
      const raw=sessionStorage.getItem('_cache_about');
      if(raw){const c=JSON.parse(raw);if(Date.now()-c.ts<5*60*1000)d=c.data;}
    }catch(e){}
    if(!d){
      const snap=await db.collection('settings').doc('about').get();
      if(!snap.exists) return;
      d=snap.data();
      try{sessionStorage.setItem('_cache_about',JSON.stringify({data:d,ts:Date.now()}));}catch(e){}
    }
    const set=(id,val)=>{const el=document.getElementById(id);if(el&&val)el.textContent=val;};
    if(d.story) set('about_story',d.story);
    if(d.c1e) set('about_c1e',d.c1e);
    if(d.c1t) set('about_c1t',d.c1t);
    if(d.c1d) set('about_c1d',d.c1d);
    if(d.c2e) set('about_c2e',d.c2e);
    if(d.c2t) set('about_c2t',d.c2t);
    if(d.c2d) set('about_c2d',d.c2d);
    if(d.c3e) set('about_c3e',d.c3e);
    if(d.c3t) set('about_c3t',d.c3t);
    if(d.c3d) set('about_c3d',d.c3d);
    if(d.c4e) set('about_c4e',d.c4e);
    if(d.c4t) set('about_c4t',d.c4t);
    if(d.c4d) set('about_c4d',d.c4d);
    if(d.phone){
      const link=document.getElementById('about_wa_link');
      if(link) link.href='https://wa.me/'+d.phone;
      set('about_wa_num','0'+d.phone.slice(-9));
    }
    if(d.location) set('about_location',d.location);
    if(d.copy) set('about_copy',d.copy);
  }catch(e){}
}

function loadAboutSettingsForm(){
  db.collection('settings').doc('about').get().then(snap=>{
    if(!snap.exists) return;
    const d=snap.data();
    const fill=(id,val)=>{const el=document.getElementById(id);if(el&&val!=null)el.value=val;};
    fill('ab_story',d.story||'');
    fill('ab_c1e',d.c1e||''); fill('ab_c1t',d.c1t||''); fill('ab_c1d',d.c1d||'');
    fill('ab_c2e',d.c2e||''); fill('ab_c2t',d.c2t||''); fill('ab_c2d',d.c2d||'');
    fill('ab_c3e',d.c3e||''); fill('ab_c3t',d.c3t||''); fill('ab_c3d',d.c3d||'');
    fill('ab_c4e',d.c4e||''); fill('ab_c4t',d.c4t||''); fill('ab_c4d',d.c4d||'');
    fill('ab_phone',d.phone||'');
    fill('ab_location',d.location||'');
    fill('ab_copy',d.copy||'');
  }).catch(e=>{});
}

async function saveAboutSettings(){
  const g=id=>document.getElementById(id).value.trim();
  const data={
    story:g('ab_story'),
    c1e:g('ab_c1e'),c1t:g('ab_c1t'),c1d:g('ab_c1d'),
    c2e:g('ab_c2e'),c2t:g('ab_c2t'),c2d:g('ab_c2d'),
    c3e:g('ab_c3e'),c3t:g('ab_c3t'),c3d:g('ab_c3d'),
    c4e:g('ab_c4e'),c4t:g('ab_c4t'),c4d:g('ab_c4d'),
    phone:g('ab_phone'),
    location:g('ab_location'),
    copy:g('ab_copy')
  };
  try{
    await db.collection('settings').doc('about').set(data);
    try{sessionStorage.removeItem('_cache_about');}catch(e){}
    await loadAboutSettings();
    toast('✅ تم حفظ صفحة "من نحن"');
  }catch(e){ toast('❌ خطأ في الحفظ'); }
}

// ===== BALANCE TAB (الرصيد) =====
let _opBalSettings={capitalBase:0};
let _opBalPurchases=[];
let _opBalPayments=[];
let _opBalSalesRaw=0;

async function loadBalanceTab(){
  // Load settings
  try{
    const doc=await db.collection('operator_balance').doc('settings').get();
    _opBalSettings=doc.exists?doc.data():{capitalBase:0};
  }catch(e){_opBalSettings={capitalBase:0};}
  // Load purchases
  try{
    const snap=await db.collection('operator_purchases').orderBy('date','desc').get();
    _opBalPurchases=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_opBalPurchases=[];}
  // Load payments to Malik
  try{
    const snap=await db.collection('operator_malik_payments').orderBy('date','desc').get();
    _opBalPayments=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){
    try{
      const snap=await db.collection('operator_malik_payments').get();
      _opBalPayments=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e2){_opBalPayments=[];}
  }
  // Load total raw material + tree costs from all sales (كلاهما مستحقات على المواد)
  try{
    const snap=await db.collection('operator_sales').get();
    _opBalSalesRaw=snap.docs.filter(d=>d.data().delivered!==false).reduce((sum,d)=>{
      const s=d.data();
      const rawTree=(s.rawMaterialCost||0)+(s.treeCost||0);
      return sum+((rawTree>0?rawTree:(s.sellPrice||0))*(s.qty||1));
    },0);
  }catch(e){_opBalSalesRaw=0;}
  // Set today's date in forms
  ['opbal_buy_date','opbal_pay_date','opstore_bal_date'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&!el.value) el.value=jordanDateStr();
  });
  renderBalanceSummary();
  renderBalancePurchases();
  renderBalancePayments();
  loadStoreTx();
  if(!_opStoresList.length) await loadOpStores();
  loadAlkiswaniSection();
  loadRosemaryWallet();
}

function toggleBalSection(id,btn){
  const el=document.getElementById(id);
  if(!el) return;
  const isOpen=el.style.display!=='none';
  el.style.display=isOpen?'none':'block';
  const arrow=btn.querySelector('span:last-child');
  if(arrow) arrow.textContent=isOpen?'▼':'▲';
}

function renderBalanceSummary(){
  const wrap=document.getElementById('opbal_summary');
  if(!wrap) return;
  const totalPurchases=_opBalPurchases.reduce((s,p)=>s+(p.amount||0),0);
  const totalPayments=_opBalPayments.reduce((s,p)=>s+(p.amount||0),0);
  const capitalBase=_opBalSettings.capitalBase||0;
  const totalCapital=capitalBase+totalPurchases-totalPayments;
  const malikDutiesAdj=_opBalSettings.malikDutiesAdj||0;
  const totalDuties=_opBalSalesRaw+malikDutiesAdj;
  const milkDebt=totalDuties-totalPayments;       // مستحقات − مدفوعات
  const milkCash=totalPayments-totalPurchases;    // رصيد كاش معها = مدفوعات − مشتريات
  wrap.innerHTML=`
    <!-- رأس المال الرئيسي — big editable card -->
    <div style="background:linear-gradient(135deg,#1a3a2a,#2d6a4f);border-radius:14px;padding:16px;margin-bottom:10px;color:#fff;position:relative;">
      <div style="font-size:0.82rem;opacity:0.85;margin-bottom:6px;">💼 رأس المال الرئيسي</div>
      <div style="font-size:1.9rem;font-weight:900;margin-bottom:6px;">${totalCapital.toFixed(2)} <span style="font-size:0.9rem;">د.أ</span></div>
      <div style="font-size:0.72rem;opacity:0.75;">رصيد أولي ${capitalBase.toFixed(2)} + مشتريات ${totalPurchases.toFixed(2)} − مدفوعات لابو يحيى ${totalPayments.toFixed(2)}</div>
      <button onclick="document.getElementById('opbal_base_form').style.display='block';document.getElementById('opbal_base_inp').value='${capitalBase}'"
        style="position:absolute;top:12px;left:12px;background:rgba(255,255,255,0.2);color:#fff;border:none;padding:5px 10px;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.75rem;cursor:pointer;">✏️ تعديل</button>
    </div>
    <!-- ملك card -->
    <div style="background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:0.88rem;font-weight:700;color:var(--green-dark);">👤 ابو يحيى</div>
        <button onclick="document.getElementById('opbal_duties_form').style.display='block';document.getElementById('opbal_duties_inp').value='${totalDuties.toFixed(2)}'"
          style="background:var(--border);border:none;padding:4px 10px;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.72rem;cursor:pointer;color:var(--text-mid);">✏️ تعديل المستحقات</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="background:${milkDebt>0?'#fef3c7':milkDebt<0?'#eff6ff':'#f0fdf4'};border:1.5px solid ${milkDebt>0?'#fcd34d':milkDebt<0?'#93c5fd':'#86efac'};border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:${milkDebt>0?'#92400e':milkDebt<0?'#1e40af':'#166534'};margin-bottom:4px;">${milkDebt>0?'🔴 مستحقات عليك':milkDebt<0?'💰 رصيد لك عند ابو يحيى':'✅ مسوي'}</div>
          <div style="font-size:1.2rem;font-weight:900;color:${milkDebt>0?'#92400e':milkDebt<0?'#1e40af':'#166534'};">${Math.abs(milkDebt).toFixed(2)}</div>
          <div style="font-size:0.65rem;color:#9ca3af;margin-top:2px;">د.أ</div>
        </div>
        <div style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:#1e40af;margin-bottom:4px;">💵 رصيد معه</div>
          <div style="font-size:1.2rem;font-weight:900;color:#1e40af;">${milkCash.toFixed(2)}</div>
          <div style="font-size:0.65rem;color:#9ca3af;margin-top:2px;">د.أ</div>
        </div>
      </div>
    </div>`;
}

async function saveMalikDuties(){
  const v=parseFloat(document.getElementById('opbal_duties_inp').value);
  if(isNaN(v)||v<0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  const adj=v-_opBalSalesRaw;
  try{
    await db.collection('operator_balance').doc('settings').set(
      {malikDutiesAdj:adj},
      {merge:true}
    );
    _opBalSettings.malikDutiesAdj=adj;
    document.getElementById('opbal_duties_form').style.display='none';
    toast('✅ تم تعديل مستحقات ابو يحيى');
    renderBalanceSummary();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function saveBalanceBase(){
  const v=parseFloat(document.getElementById('opbal_base_inp').value);
  if(isNaN(v)||v<0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    await db.collection('operator_balance').doc('settings').set({capitalBase:v,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    _opBalSettings.capitalBase=v;
    document.getElementById('opbal_base_form').style.display='none';
    toast('✅ تم حفظ رأس المال');
    renderBalanceSummary();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function addBalancePurchase(){
  const amount=parseFloat(document.getElementById('opbal_buy_amount').value);
  const date=document.getElementById('opbal_buy_date').value;
  const notes=document.getElementById('opbal_buy_notes').value.trim();
  if(isNaN(amount)||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  if(!date){toast('⚠️ اختر التاريخ');return;}
  try{
    await db.collection('operator_purchases').add({
      amount,date,notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('opbal_buy_amount').value='';
    document.getElementById('opbal_buy_notes').value='';
    toast('✅ تم تسجيل الشراء');
    loadBalanceTab();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteBalancePurchase(id){
  if(!confirm('حذف هذا الشراء؟')) return;
  try{
    await db.collection('operator_purchases').doc(id).delete();
    toast('✅ تم الحذف');
    loadBalanceTab();
  }catch(e){toast('❌ خطأ في الحذف');}
}

async function addMalikPayment(){
  const amount=parseFloat(document.getElementById('opbal_pay_amount').value);
  const date=document.getElementById('opbal_pay_date').value;
  const notes=document.getElementById('opbal_pay_notes').value.trim();
  if(isNaN(amount)||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  if(!date){toast('⚠️ اختر التاريخ');return;}
  try{
    await db.collection('operator_malik_payments').add({
      amount,date,notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('opbal_pay_amount').value='';
    document.getElementById('opbal_pay_notes').value='';
    toast('✅ تم تسجيل الدفع لابو يحيى');
    loadBalanceTab();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteMalikPayment(id){
  if(!confirm('حذف هذا الدفع؟')) return;
  try{
    await db.collection('operator_malik_payments').doc(id).delete();
    toast('✅ تم الحذف');
    loadBalanceTab();
  }catch(e){toast('❌ خطأ في الحذف');}
}

function renderBalancePayments(){
  const wrap=document.getElementById('opbal_payments_list');
  if(!wrap) return;
  if(!_opBalPayments.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">لا يوجد مدفوعات لابو يحيى بعد</div>';
    return;
  }
  wrap.innerHTML=_opBalPayments.map(p=>`
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;color:#92400e;font-size:0.9rem;">💸 ${(p.amount||0).toFixed(2)} د.أ</div>
        <div style="font-size:0.75rem;color:var(--text-mid);">📅 ${p.date||''}${p.notes?' — '+p.notes:''}</div>
      </div>
      <button onclick="deleteMalikPayment('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.82rem;">✕</button>
    </div>`).join('');
}

function renderBalancePurchases(){
  const wrap=document.getElementById('opbal_purchases_list');
  if(!wrap) return;
  if(!_opBalPurchases.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">لا يوجد مشتريات مسجلة بعد</div>';
    return;
  }
  wrap.innerHTML=_opBalPurchases.map(p=>`
    <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;color:#1e40af;font-size:0.9rem;">${(p.amount||0).toFixed(2)} د.أ</div>
        <div style="font-size:0.75rem;color:var(--text-mid);">📅 ${p.date||''}${p.notes?' — '+p.notes:''}</div>
      </div>
      <button onclick="deleteBalancePurchase('${p.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.82rem;">✕</button>
    </div>`).join('');
}

// ===== الكسواني ACCOUNT =====
let _alkiswaniSales=[];
let _alkiswaniPayments=[];

async function loadAlkiswaniSection(){
  try{
    const snap=await db.collection('operator_sales').get();
    _alkiswaniSales=snap.docs.filter(d=>d.data().delivered!==false).map(d=>({id:d.id,...d.data()}));
  }catch(e){_alkiswaniSales=[];}
  // Read payments from operator_store_payments (same source as كشف tab)
  try{
    const snap=await db.collection('operator_store_payments').get();
    _alkiswaniPayments=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){_alkiswaniPayments=[];}
  renderAlkiswaniSection();
}

function renderAlkiswaniSection(){
  const storeSales={};
  _alkiswaniSales.forEach(s=>{
    const k=s.storeId||'';
    if(!k) return;
    if(!storeSales[k]) storeSales[k]={storeName:s.storeName||k,sales:0};
    storeSales[k].sales+=(s.sellPrice||0)*(s.qty||1);
  });
  const storePaid={};
  _alkiswaniPayments.forEach(p=>{
    const k=p.storeId||'';
    if(!k) return;
    storePaid[k]=(storePaid[k]||0)+(p.amount||0);
  });
  const totalSales=Object.values(storeSales).reduce((s,v)=>s+v.sales,0);
  const totalPaid=_alkiswaniPayments.reduce((s,p)=>s+(p.amount||0),0);
  const totalMalik=_opBalPayments.reduce((s,p)=>s+(p.amount||0),0);
  const netBalance=totalSales-totalPaid;

  const sumWrap=document.getElementById('alkiswani_summary');
  if(sumWrap){
    sumWrap.innerHTML=`
      <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);border-radius:14px;padding:16px;color:#fff;">
        <div style="font-size:0.82rem;opacity:0.85;margin-bottom:4px;">👤 ما يستحقه الكسواني من المتاجر</div>
        <div style="font-size:1.9rem;font-weight:900;margin-bottom:6px;">${netBalance.toFixed(2)} <span style="font-size:0.9rem;">د.أ</span></div>
        <div style="font-size:0.7rem;opacity:0.75;margin-bottom:8px;">مبيعات المتاجر ${totalSales.toFixed(2)} − مدفوع للكسواني ${totalPaid.toFixed(2)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
            <div style="font-size:0.65rem;opacity:0.85;">📈 مبيعات المتاجر</div>
            <div style="font-weight:800;font-size:0.88rem;">${totalSales.toFixed(2)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
            <div style="font-size:0.65rem;opacity:0.85;">💵 مدفوع للكسواني</div>
            <div style="font-weight:800;font-size:0.88rem;">${totalPaid.toFixed(2)}</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:8px;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:0.68rem;opacity:0.85;">💸 دفعات ملك (معلومة — لا تُطرح من رصيد المتاجر)</div>
          <div style="font-weight:800;font-size:0.88rem;">${totalMalik.toFixed(2)}</div>
        </div>
      </div>`;
  }

  const brkWrap=document.getElementById('alkiswani_stores_breakdown');
  if(brkWrap){
    const storeIds=Object.keys(storeSales);
    if(!storeIds.length){
      brkWrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:12px;">لا يوجد مبيعات مسجلة بعد</div>';
    } else {
      const rows=storeIds.map(sid=>{
        const sv=storeSales[sid];
        const paid=storePaid[sid]||0;
        const bal=sv.sales-paid;
        return `<div style="display:flex;align-items:center;gap:6px;padding:9px 10px;background:var(--card-bg);border:1px solid #c4b5fd;border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;font-weight:700;color:#4c1d95;font-size:0.85rem;">${sv.storeName}</div>
          <div style="text-align:center;min-width:58px;">
            <div style="font-size:0.63rem;color:#9ca3af;">المبيعات</div>
            <div style="font-weight:700;color:#1a3a2a;font-size:0.82rem;">${sv.sales.toFixed(2)}</div>
          </div>
          <div style="text-align:center;min-width:58px;">
            <div style="font-size:0.63rem;color:#9ca3af;">مدفوع</div>
            <div style="font-weight:700;color:#166534;font-size:0.82rem;">${paid.toFixed(2)}</div>
          </div>
          <div style="text-align:center;min-width:58px;">
            <div style="font-size:0.63rem;color:#9ca3af;">الرصيد</div>
            <div style="font-weight:700;color:${bal>0?'#dc2626':'#166534'};font-size:0.82rem;">${bal.toFixed(2)}</div>
          </div>
        </div>`;
      }).join('');
      brkWrap.innerHTML=`<div style="font-size:0.8rem;font-weight:700;color:#7c3aed;margin-bottom:8px;">📊 تفاصيل المتاجر</div>${rows}`;
    }
  }

}

// ===== STORE BALANCE (رصيد المحل) =====
let _opStoreTxList=[];
let _opStoreTxType='deposit';

function setStoreBalType(type){
  _opStoreTxType=type;
  const dep=document.getElementById('opstore_type_deposit');
  const wth=document.getElementById('opstore_type_withdraw');
  if(dep&&wth){
    dep.style.background=type==='deposit'?'var(--green-dark)':'var(--card-bg)';
    dep.style.color=type==='deposit'?'#fff':'var(--text-mid)';
    dep.style.fontWeight=type==='deposit'?'700':'400';
    wth.style.background=type==='withdraw'?'#dc2626':'var(--card-bg)';
    wth.style.color=type==='withdraw'?'#fff':'var(--text-mid)';
    wth.style.fontWeight=type==='withdraw'?'700':'400';
  }
}

async function loadStoreTx(){
  try{
    const snap=await db.collection('operator_store_balance').orderBy('date','desc').get();
    _opStoreTxList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){
    try{
      const snap=await db.collection('operator_store_balance').get();
      _opStoreTxList=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e2){_opStoreTxList=[];}
  }
  // رصيد المحل يدوي فقط — نستثني الحركات التلقائية القادمة من مسحوبات الكشف
  _opStoreTxList=_opStoreTxList.filter(t=>!t.sourceWithdrawalId);
  renderStoreTx();
}

function renderStoreTx(){
  const totalIn=_opStoreTxList.filter(t=>t.type==='deposit').reduce((s,t)=>s+(t.amount||0),0);
  const totalOut=_opStoreTxList.filter(t=>t.type==='withdraw').reduce((s,t)=>s+(t.amount||0),0);
  const bal=totalIn-totalOut;
  const card=document.getElementById('opstore_bal_card');
  if(card) card.innerHTML=`
    <div style="background:linear-gradient(135deg,#1e3a5f,#1e40af);border-radius:14px;padding:16px;color:#fff;">
      <div style="font-size:0.82rem;opacity:0.85;margin-bottom:6px;">💰 الرصيد الحالي للمحل</div>
      <div style="font-size:1.9rem;font-weight:900;margin-bottom:6px;">${bal.toFixed(2)} <span style="font-size:0.9rem;">د.أ</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.68rem;opacity:0.85;">💚 إجمالي الإيداعات</div>
          <div style="font-weight:800;font-size:0.95rem;">${totalIn.toFixed(2)} د.أ</div>
        </div>
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.68rem;opacity:0.85;">🔴 إجمالي السحبيات</div>
          <div style="font-weight:800;font-size:0.95rem;">${totalOut.toFixed(2)} د.أ</div>
        </div>
      </div>
    </div>`;
  const wrap=document.getElementById('opstore_tx_list');
  if(!wrap) return;
  if(!_opStoreTxList.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">لا يوجد حركات بعد</div>';
    return;
  }
  wrap.innerHTML=_opStoreTxList.map(t=>{
    const isD=t.type==='deposit';
    return `<div style="background:var(--card-bg);border:1px solid ${isD?'#86efac':'#fca5a5'};border-right:4px solid ${isD?'#16a34a':'#dc2626'};border-radius:10px;padding:10px 12px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;color:${isD?'#166534':'#dc2626'};font-size:0.9rem;">${isD?'💚':'🔴'} ${isD?'إيداع':'سحب'} — ${(t.amount||0).toFixed(2)} د.أ</div>
        <div style="font-size:0.75rem;color:var(--text-mid);">📅 ${t.date||''}${t.notes?' — '+t.notes:''}</div>
      </div>
      <button onclick="deleteStoreTx('${t.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.82rem;">✕</button>
    </div>`;
  }).join('');
}

async function addStoreTx(){
  const amount=parseFloat(document.getElementById('opstore_bal_amount').value);
  const date=document.getElementById('opstore_bal_date').value;
  const notes=document.getElementById('opstore_bal_notes').value.trim();
  if(isNaN(amount)||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  if(!date){toast('⚠️ اختر التاريخ');return;}
  try{
    await db.collection('operator_store_balance').add({
      type:_opStoreTxType,amount,date,notes,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('opstore_bal_amount').value='';
    document.getElementById('opstore_bal_notes').value='';
    toast('✅ تم الحفظ');
    loadStoreTx();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteStoreTx(id){
  if(!confirm('حذف هذه الحركة؟')) return;
  try{
    await db.collection('operator_store_balance').doc(id).delete();
    toast('✅ تم الحذف');
    loadStoreTx();
  }catch(e){toast('❌ خطأ في الحذف');}
}

async function migrateOldSales(){
  if(!confirm('هذا سيحدّث كل السجلات القديمة التي ليس لديها حقل تسليم وسيعتبرها مسلّمة. هل تريد المتابعة؟')) return;
  const btn=document.getElementById('migrate_sales_btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري التحديث...';}
  try{
    const snap=await db.collection('operator_sales').get();
    const old=snap.docs.filter(d=>d.data().delivered===undefined);
    if(!old.length){toast('✅ لا يوجد سجلات قديمة للتحديث');if(btn){btn.disabled=false;btn.textContent='🔧 تصحيح السجلات القديمة';}return;}
    const BATCH_SIZE=400;
    for(let i=0;i<old.length;i+=BATCH_SIZE){
      const batch=db.batch();
      old.slice(i,i+BATCH_SIZE).forEach(d=>batch.update(d.ref,{delivered:true}));
      await batch.commit();
    }
    toast(`✅ تم تحديث ${old.length} سجل قديم`);
    loadBalanceTab();
  }catch(e){toast('❌ خطأ: '+e.message);}
  if(btn){btn.disabled=false;btn.textContent='🔧 تصحيح السجلات القديمة';}
}

async function migrateRawMaterialCosts(){
  if(!confirm('سيتم تحديث أسعار كل سجلات المبيعات بناءً على أسعار المتاجر الحالية في قائمة المنتجات. متابعة؟')) return;
  const btn=document.getElementById('migrate_costs_btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري التحديث...';}
  try{
    if(!_opProductsList.length) await loadOpProducts();
    if(!_opStoresList.length) await loadOpStores();
    const snap=await db.collection('operator_sales').get();
    const docs=snap.docs.filter(d=>d.data().productId);
    if(!docs.length){toast('✅ لا يوجد سجلات');if(btn){btn.disabled=false;btn.textContent='🔄 تحديث تكاليف المواد';}return;}
    let updated=0;
    const BATCH_SIZE=400;
    for(let i=0;i<docs.length;i+=BATCH_SIZE){
      const batch=db.batch();
      docs.slice(i,i+BATCH_SIZE).forEach(doc=>{
        const s=doc.data();
        // بحث بالـ ID أولاً، فإذا ما لاقى يبحث بالاسم
        const prod=_opProductsList.find(p=>p.id===s.productId)||_opProductsList.find(p=>p.name===s.productName);
        if(!prod) return;
        const storePrice=s.storeId&&prod.storePrices?.[s.storeId]||0;
        const totalCost=(prod.rawMaterialCost||0)+(prod.treeCost||0)+(prod.machineWorkerWage||0)+(prod.assemblyWorkerWage||0);
        const update={
          rawMaterialCost:prod.rawMaterialCost||0,
          treeCost:prod.treeCost||0,
          machineWorkerWage:prod.machineWorkerWage||0,
          assemblyWorkerWage:prod.assemblyWorkerWage||0
        };
        if(s.fromOrderId){
          // سجل صفحة — سعر المتجر الصحيح (لا نستخدم سعر الزبون)
          update.sellPrice=storePrice||totalCost||0;
        }
        batch.update(doc.ref,update);
        updated++;
      });
      await batch.commit();
    }
    toast(`✅ تم تحديث ${updated} سجل`);
    loadBalanceTab();
  }catch(e){toast('❌ خطأ: '+e.message);}
  if(btn){btn.disabled=false;btn.textContent='🔄 تحديث تكاليف المواد';}
}

// ===== رصيد روزميري =====
let _rwSettings={initialBalance:0};
let _rwTxList=[];
let _rwExpenses=[];
let _rwRepOrders=[];
let _rwTxType='deposit';
let _rwWithdrawSubtype='operator_expense';
let _rwRepOrdersUnsub=null;

async function loadRosemaryWallet(){
  try{
    const doc=await db.collection('rosemary_wallet').doc('settings').get();
    _rwSettings=doc.exists?doc.data():{initialBalance:0};
  }catch(e){_rwSettings={initialBalance:0};}
  try{
    const snap=await db.collection('rosemary_transactions').orderBy('date','desc').get();
    _rwTxList=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){
    try{
      const snap=await db.collection('rosemary_transactions').get();
      _rwTxList=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    }catch(e2){_rwTxList=[];}
  }
  try{
    const sessionId=_opCurrentSession?.id||null;
    let expSnap;
    if(sessionId){
      expSnap=await db.collection('operator_expenses').where('sessionId','==',sessionId).get();
    }else{
      expSnap={docs:[]};
    }
    _rwExpenses=expSnap.docs.map(d=>({id:d.id,...d.data(),_fromExpenses:true}));
  }catch(e){_rwExpenses=[];}
  // Ensure delivery reps exclusion list is loaded before the snapshot fires
  try{await _loadDeliveryReps();}catch(e){}
  if(_rwRepOrdersUnsub){_rwRepOrdersUnsub();_rwRepOrdersUnsub=null;}
  const sessionId2=_opCurrentSession?.id||null;
  if(sessionId2){
    const from=_opCurrentSession.openedDate||jordanDateStr();
    const to=_opCurrentSession.closedDate||jordanDateStr();
    _rwRepOrdersUnsub=db.collection('employee_orders')
      .where('deliveredDate','>=',from)
      .where('deliveredDate','<=',to)
      .onSnapshot(snap=>{
        const excludedRwReps=new Set((_deliveryRepsCache||[]).filter(r=>r.excludeFromBalance).map(r=>r.name));
        _rwRepOrders=snap.docs
          .map(d=>({id:d.id,...d.data()}))
          .filter(o=>o.status==='delivered'&&o.deliveryRepName&&!excludedRwReps.has(o.deliveryRepName));
        renderRosemaryWallet();
      },()=>{_rwRepOrders=[];renderRosemaryWallet();});
  }else{
    _rwRepOrders=[];
  }
  const dateEl=document.getElementById('rw_date');
  if(dateEl&&!dateEl.value) dateEl.value=jordanDateStr();
  if(!_opStoresList.length) await loadOpStores();
  renderRosemaryWallet();
}


function renderRosemaryWallet(){
  const totalManualDeposits=_rwTxList.filter(t=>t.type==='deposit').reduce((s,t)=>s+(t.amount||0),0);
  const totalWithdrawals=_rwTxList.filter(t=>t.type==='withdraw').reduce((s,t)=>s+(t.amount||0),0);
  const totalExpenses=_rwExpenses.reduce((s,e)=>s+(e.amount||0),0);
  const rwStoreWds=(_opWithdrawals||[]).filter(w=>w.withdrawalType!=='payment');
  const totalStoreWithdrawals=rwStoreWds.reduce((s,w)=>s+(w.amount||0),0);
  const totalRepDeposits=_rwRepOrders.reduce((s,o)=>{
    const amt=Math.max(0,(o.netPrice!=null?o.netPrice:(o.totalPrice||0))-(o.deliveryFee||0));
    return s+amt;
  },0);
  const initialBalance=_rwSettings.initialBalance||0;
  const totalDeposits=totalManualDeposits+totalRepDeposits;
  const currentBalance=initialBalance+totalDeposits-totalWithdrawals-totalExpenses-totalStoreWithdrawals;
  const totalOut=totalWithdrawals+totalExpenses+totalStoreWithdrawals;
  const card=document.getElementById('rw_balance_card');
  if(card) card.innerHTML=`
    <div style="background:linear-gradient(135deg,#be185d,#9d174d);border-radius:14px;padding:16px;color:#fff;position:relative;">
      <div style="font-size:0.82rem;opacity:0.85;margin-bottom:6px;">🌿 رصيد روزميري الحالي</div>
      <div style="font-size:1.9rem;font-weight:900;margin-bottom:6px;">${currentBalance.toFixed(2)} <span style="font-size:0.9rem;">د.أ</span></div>
      <div style="font-size:0.72rem;opacity:0.75;">رصيد أولي ${initialBalance.toFixed(2)} + إيداعات ${totalDeposits.toFixed(2)} − سحوبات ${totalOut.toFixed(2)}</div>
      <button onclick="document.getElementById('rw_initial_form').style.display='block';document.getElementById('rw_initial_inp').value='${initialBalance}'"
        style="position:absolute;top:12px;left:12px;background:rgba(255,255,255,0.2);color:#fff;border:none;padding:5px 10px;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.75rem;cursor:pointer;">✏️ رصيد أولي</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.68rem;opacity:0.85;">💚 إجمالي الإيداعات</div>
          <div style="font-weight:800;font-size:0.95rem;">${totalDeposits.toFixed(2)} د.أ</div>
        </div>
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.68rem;opacity:0.85;">🔴 إجمالي السحوبات</div>
          <div style="font-weight:800;font-size:0.95rem;">${totalOut.toFixed(2)} د.أ</div>
        </div>
      </div>
    </div>`;
  const storeOpts=(_opStoresList||[]).filter(s=>!s.archived)
    .map(s=>`<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
  const depSel=document.getElementById('rw_store_deposit');
  if(depSel) depSel.innerHTML=`<option value="">-- اختر متجر --</option>`+storeOpts;
  renderRwTxList();
}

function renderRwTxList(){
  const wrap=document.getElementById('rw_tx_list');
  if(!wrap) return;
  const subtypeLabel={store:'دفعة متجر',operator_expense:'مصاريف مشغل',personal:'مصاريف شخصية',salary:'رواتب',other:'أخرى',rep:'طلب مندوب',store_withdrawal:'مسحوب متجر'};
  const subtypeColor={store:'#dc2626',operator_expense:'#7c3aed',personal:'#ea580c',salary:'#0891b2',other:'#6b7280',store_withdrawal:'#b45309'};
  // Merge rosemary_transactions + operator_expenses + rep orders from كشف
  const expenseRows=_rwExpenses.map(e=>({
    _fromExpenses:true, id:e.id,
    type:'withdraw', subType:'operator_expense',
    amount:e.amount, date:e.date,
    notes:(e.category&&e.category!=='أخرى'?e.category:'')+(e.notes?' — '+e.notes:e.category==='أخرى'&&e.notes?e.notes:'')
  }));
  const repOrderRows=_rwRepOrders.map(o=>({
    _fromRepOrder:true, id:o.id,
    type:'deposit', subType:'rep',
    amount:Math.max(0,(o.netPrice!=null?o.netPrice:(o.totalPrice||0))-(o.deliveryFee||0)),
    date:o.deliveredDate||'',
    storeName:o.storeName||o.pageId||'',
    notes:o.deliveryRepName||''
  }));
  const storeWdRows=(_opWithdrawals||[]).filter(w=>w.withdrawalType!=='payment').map(w=>({
    _fromStoreWithdrawal:true, id:w.id,
    type:'withdraw', subType:'store_withdrawal',
    amount:w.amount||0,
    date:w.date||'',
    storeName:w.storeName||'',
    notes:w.notes||''
  }));
  const combined=[..._rwTxList,...expenseRows,...repOrderRows,...storeWdRows].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!combined.length){
    wrap.innerHTML='<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:16px;">لا يوجد حركات بعد</div>';
    return;
  }
  wrap.innerHTML=combined.map(t=>{
    const isD=t.type==='deposit';
    const label=isD?'إيداع':(t.subType==='other'&&t.customLabel?t.customLabel:subtypeLabel[t.subType]||'سحب');
    const borderColor=isD?'#16a34a':(subtypeColor[t.subType]||'#dc2626');
    const storeText=t.storeName?` — ${t.storeName}`:'';
    const notesText=t.notes?` — ${t.notes}`:'';
    const deleteBtn=(t._fromExpenses||t._fromRepOrder||t._fromStoreWithdrawal)
      ?`<span style="font-size:0.68rem;color:#9ca3af;">📋 الكشف</span>`
      :`<button onclick="deleteRwTx('${t.id}')" style="background:#fee2e2;color:#dc2626;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.82rem;">✕</button>`;
    return `<div style="background:var(--card-bg);border:1px solid ${isD?'#86efac':'#fca5a5'};border-right:4px solid ${borderColor};border-radius:10px;padding:10px 12px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;color:${isD?'#166534':'#991b1b'};font-size:0.9rem;">${isD?'💚':'🔴'} ${label}${storeText} — ${(t.amount||0).toFixed(2)} د.أ</div>
        <div style="font-size:0.75rem;color:var(--text-mid);">📅 ${t.date||''}${notesText}</div>
      </div>
      ${deleteBtn}
    </div>`;
  }).join('');
}

function setRwType(type){
  _rwTxType=type;
  const dep=document.getElementById('rw_btn_deposit');
  const wth=document.getElementById('rw_btn_withdraw');
  if(dep){dep.style.background=type==='deposit'?'var(--green-dark)':'var(--card-bg)';dep.style.color=type==='deposit'?'#fff':'var(--text-mid)';dep.style.fontWeight=type==='deposit'?'700':'400';}
  if(wth){wth.style.background=type==='withdraw'?'#dc2626':'var(--card-bg)';wth.style.color=type==='withdraw'?'#fff':'var(--text-mid)';wth.style.fontWeight=type==='withdraw'?'700':'400';}
  const depRow=document.getElementById('rw_store_row_deposit');
  const wthOpts=document.getElementById('rw_withdraw_options');
  if(depRow) depRow.style.display=type==='deposit'?'block':'none';
  if(wthOpts) wthOpts.style.display=type==='withdraw'?'block':'none';
  if(type==='withdraw') setRwWithdrawSubtype(_rwWithdrawSubtype);
}

function setRwWithdrawSubtype(subtype){
  _rwWithdrawSubtype=subtype;
  const subtypeColors={operator_expense:'#7c3aed',personal:'#ea580c',salary:'#0891b2',other:'#6b7280'};
  ['operator_expense','personal','salary','other'].forEach(st=>{
    const btn=document.getElementById(`rw_sub_${st}`);
    if(btn){
      const active=st===subtype;
      const c=subtypeColors[st]||'#374151';
      btn.style.background=active?c:'var(--card-bg)';
      btn.style.color=active?'#fff':'var(--text-mid)';
      btn.style.border=active?`2px solid ${c}`:'2px solid var(--border)';
      btn.style.fontWeight=active?'700':'400';
    }
  });
  const otherRow=document.getElementById('rw_other_label_row');
  if(otherRow) otherRow.style.display=subtype==='other'?'block':'none';
}

async function addRwTx(){
  const amount=parseFloat(document.getElementById('rw_amount').value);
  const date=document.getElementById('rw_date').value;
  const notes=document.getElementById('rw_notes').value.trim();
  if(isNaN(amount)||amount<=0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  if(!date){toast('⚠️ اختر التاريخ');return;}
  const txData={
    type:_rwTxType,amount,date,notes,
    sessionId:(_opCurrentSession&&_opCurrentSession.id)||null,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  };
  if(_rwTxType==='deposit'){
    const sel=document.getElementById('rw_store_deposit');
    const storeId=sel?sel.value:'';
    const storeName=sel&&sel.selectedIndex>=0?sel.options[sel.selectedIndex].dataset.name||'':'';
    if(!storeId){toast('⚠️ اختر المتجر');return;}
    txData.subType='store';
    txData.storeId=storeId;
    txData.storeName=storeName;
  }else{
    txData.subType=_rwWithdrawSubtype;
    if(_rwWithdrawSubtype==='other'){
      const customLabel=(document.getElementById('rw_other_label')?.value||'').trim();
      if(!customLabel){toast('⚠️ اكتب اسم البند');return;}
      txData.customLabel=customLabel;
    }
  }
  try{
    await db.collection('rosemary_transactions').add(txData);
    document.getElementById('rw_amount').value='';
    document.getElementById('rw_notes').value='';
    if(_rwWithdrawSubtype==='other'){const el=document.getElementById('rw_other_label');if(el)el.value='';}
    toast('✅ تم الحفظ');
    loadRosemaryWallet();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

async function deleteRwTx(id){
  if(!confirm('حذف هذه الحركة؟')) return;
  try{
    await db.collection('rosemary_transactions').doc(id).delete();
    toast('✅ تم الحذف');
    loadRosemaryWallet();
  }catch(e){toast('❌ خطأ في الحذف');}
}

async function saveRwInitialBalance(){
  const v=parseFloat(document.getElementById('rw_initial_inp').value);
  if(isNaN(v)||v<0){toast('⚠️ أدخل مبلغاً صحيحاً');return;}
  try{
    await db.collection('rosemary_wallet').doc('settings').set({initialBalance:v,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    _rwSettings.initialBalance=v;
    document.getElementById('rw_initial_form').style.display='none';
    toast('✅ تم حفظ الرصيد الأولي');
    renderRosemaryWallet();
  }catch(e){toast('❌ خطأ في الحفظ');}
}

window.loadBalanceTab=loadBalanceTab; window.saveBalanceBase=saveBalanceBase;
window.saveMalikDuties=saveMalikDuties;
window.migrateOldSales=migrateOldSales;
window.migrateRawMaterialCosts=migrateRawMaterialCosts;
window.addBalancePurchase=addBalancePurchase; window.deleteBalancePurchase=deleteBalancePurchase;
window.addMalikPayment=addMalikPayment; window.deleteMalikPayment=deleteMalikPayment;
window.setStoreBalType=setStoreBalType; window.addStoreTx=addStoreTx; window.deleteStoreTx=deleteStoreTx;
window.loadRosemaryWallet=loadRosemaryWallet; window.saveRwInitialBalance=saveRwInitialBalance;
window.setRwType=setRwType; window.setRwWithdrawSubtype=setRwWithdrawSubtype;
window.addRwTx=addRwTx; window.deleteRwTx=deleteRwTx;
window.loadAlkiswaniSection=loadAlkiswaniSection;
window.toggleBalSection=toggleBalSection;
window.openAdvisor=openAdvisor; window.closeAdvisor=closeAdvisor;
window.advisorSelectCat=advisorSelectCat; window.advisorSelectPrice=advisorSelectPrice; window.advisorGoBack=advisorGoBack;
window.addAdvisorProduct=addAdvisorProduct;
window.openCancelDialog=openCancelDialog;
window.confirmCancelOrder=confirmCancelOrder;
window.openCustomerCancelDialog=openCustomerCancelDialog;
window.closeCustomerCancelDialog=closeCustomerCancelDialog;
window.selectCustomerCancelReason=selectCustomerCancelReason;
window.confirmCustomerCancel=confirmCustomerCancel;
window.closeWANotifModal=closeWANotifModal;
window.saveAboutSettings=saveAboutSettings; window.loadAboutSettings=loadAboutSettings;
window.toggleVisitorPublic=toggleVisitorPublic;
window.loadOperatorLedger=loadOperatorLedger;
window.addOpChannel=addOpChannel; window.removeOpChannel=removeOpChannel;
window.addOpItem=addOpItem; window.removeOpItem=removeOpItem;
window.calcOpSummary=calcOpSummary;
window.saveOperatorLedger=saveOperatorLedger;
window.shareOperatorReport=shareOperatorReport;
// New operator accounting system
window.switchOpTab=switchOpTab; window.loadExpenses=loadExpenses; window.addExpense=addExpense; window.deleteExpense=deleteExpense; window.addExpenseFromSession=addExpenseFromSession;
window.onDlvStoreChange=onDlvStoreChange; window.onDlvProdChange=onDlvProdChange;
window.addDlvItem=addDlvItem; window.removeDlvItem=removeDlvItem; window.changeDlvQty=changeDlvQty; window.clearDlvStore=clearDlvStore;
window.addPendingOrder=addPendingOrder; window.deliverOrder=deliverOrder; window.deliverAllOrders=deliverAllOrders; window.deletePendingOrder=deletePendingOrder;
window.onDlvImageChange=onDlvImageChange; window.clearDlvImage=clearDlvImage; window.openDlvImage=openDlvImage;
// Sales tab
window.saveSaleEntry=saveSaleEntry; window.deleteSaleEntry=deleteSaleEntry; window.confirmSaleDelivery=confirmSaleDelivery;
window.onSaleProdChange=onSaleProdChange; window.pickSalePrice=pickSalePrice;
window.initSalesTab=initSalesTab; window.loadTodaySales=loadTodaySales;
// Account statement tab
window.loadAcctStoreList=loadAcctStoreList; window.openAcctDetail=openAcctDetail; window.openGroupAcctDetail=openGroupAcctDetail;
window.backToAcctList=backToAcctList;
window.printAcctStatement=printAcctStatement; window.whatsappAcctStatement=whatsappAcctStatement;
window.addStorePayment=addStorePayment; window.deleteStorePayment=deleteStorePayment; window.deleteStoreSale=deleteStoreSale; window.editStoreSalePrice=editStoreSalePrice; window.deletePageRefund=deletePageRefund;
// Operator daily account
window.openOperatorDailyAccount=openOperatorDailyAccount;
window.checkOperatorDayStatus=checkOperatorDayStatus;
window.closeOperatorDay=closeOperatorDay;
window.loadOpSessionStatus=loadOpSessionStatus; window.openNewSession=openNewSession; window.closeOperatorSession=closeOperatorSession; window.loadSessionArchive=loadSessionArchive; window.fetchRepDeliveries=fetchRepDeliveries; window.deleteCurrentSession=deleteCurrentSession;
window.showAddWithdrawalModal=showAddWithdrawalModal; window.saveOperatorWithdrawal=saveOperatorWithdrawal; window.deleteOperatorWithdrawal=deleteOperatorWithdrawal;
window.showAddWithdrawalModalForStore=showAddWithdrawalModalForStore; window.saveOperatorWithdrawalFixed=saveOperatorWithdrawalFixed;
window.showAddWithdrawalModalForGroup=showAddWithdrawalModalForGroup; window.saveGroupWithdrawal=saveGroupWithdrawal;
window.prevOpDay=prevOpDay; window.nextOpDay=nextOpDay; window.goOpToday=goOpToday; window.jumpOpDate=jumpOpDate;
window.printOperatorDay=printOperatorDay;
window.whatsappOperatorDay=whatsappOperatorDay;
window.saveOpProduct=saveOpProduct; window.deleteOpProduct=deleteOpProduct;
window.editOpProduct=editOpProduct; window.cancelEditProduct=cancelEditProduct;
window.onOppImageChange=onOppImageChange; window.clearOppImage=clearOppImage;
window.loadOpProducts=loadOpProducts;
window.addOpStore=addOpStore; window.deleteOpStore=deleteOpStore; window.archiveOpStore=archiveOpStore; window.unarchiveOpStore=unarchiveOpStore; window.setStoreGroup=setStoreGroup;
window.loadOpStores=loadOpStores;

async function migrateDeliveryFees(){
  if(!confirm('سيتم تحديث رسوم التوصيل لـ 2 د.أ على جميع الطلبات. تأكيد؟'))return;
  toast('⏳ جاري التحديث...');
  try{
    const snap=await db.collection('employee_orders').get();
    const BATCH_SIZE=400;
    let batch=db.batch();let count=0;
    for(const doc of snap.docs){
      const d=doc.data();
      const newDlv=d.deliveryFee??2;
      // Only update if deliveryFee is missing or 0 (not a custom admin override)
      if(!d.deliveryFee&&d.deliveryFee!==2){
        const prods=d.products||[];
        const prodsTotal=prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0)||(d.totalPrice||0);
        batch.update(doc.ref,{deliveryFee:2,netPrice:prodsTotal+2,totalPrice:prodsTotal+2});
        count++;
        if(count%BATCH_SIZE===0){await batch.commit();batch=db.batch();}
      }
    }
    if(count%BATCH_SIZE!==0)await batch.commit();
    toast('✅ تم تحديث '+count+' طلب برسوم توصيل 2 د.أ');
  }catch(e){toast('❌ '+e.message);}
}
window.migrateDeliveryFees=migrateDeliveryFees;

async function clearRepFromWaitingOrders(){
  if(!confirm('سيتم مسح اسم ورقم المندوب من جميع طلبات "انتظار مندوب". تأكيد؟'))return;
  toast('⏳ جاري التحديث...');
  try{
    const snap=await db.collection('employee_orders').where('status','==','waiting_rep').get();
    const BATCH_SIZE=400;let batch=db.batch();let count=0;
    for(const doc of snap.docs){
      const d=doc.data();
      if(d.deliveryRepName||d.deliveryRepPhone||d.assignedAt){
        batch.update(doc.ref,{
          deliveryRepName:firebase.firestore.FieldValue.delete(),
          deliveryRepPhone:firebase.firestore.FieldValue.delete(),
          assignedAt:firebase.firestore.FieldValue.delete()
        });
        count++;
        if(count%BATCH_SIZE===0){await batch.commit();batch=db.batch();}
      }
    }
    if(count%BATCH_SIZE!==0)await batch.commit();
    toast('✅ تم تحديث '+count+' طلب');
  }catch(e){toast('❌ '+e.message);}
}
window.clearRepFromWaitingOrders=clearRepFromWaitingOrders;
window.promptLinkStore=promptLinkStore; window.saveLinkStore=saveLinkStore;
window.openStoreAccount=openStoreAccount; window.backToStoreList=backToStoreList;
window.addItemToStoreOrder=addItemToStoreOrder; window.removeItemFromStoreOrder=removeItemFromStoreOrder;
window.calcStoreOrderSummary=calcStoreOrderSummary;
window.setDeliveryFee=setDeliveryFee;
window.saveStoreOrder=saveStoreOrder; window.closeStoreOrder=closeStoreOrder;
window.printStoreOrder=printStoreOrder; window.refreshStoreOrderCosts=refreshStoreOrderCosts;

function addAdvisorProduct(docId){
  const p=products.find(x=>(x._docId||x.id)===docId);
  if(!p){toast('⚠️ ما قدرنا نضيف المنتج');return;}
  addToCartDirect(p,'');
}

// ===== PRODUCT ADVISOR =====
const PRICE_RANGES=[
  {label:'أقل من 20 دينار',sub:'للميزانية المحدودة',icon:'💚',min:0,max:19.99},
  {label:'20 — 50 دينار',sub:'الأكثر شيوعاً',icon:'⭐',min:20,max:50},
  {label:'أكثر من 50 دينار',sub:'منتجات مميزة وفاخرة',icon:'👑',min:50.01,max:Infinity},
  {label:'ما عندي حدود',sub:'أعرضلي كل شيء',icon:'🎯',min:0,max:Infinity}
];

let _advisorCat=null, _advisorPrice=null;

function openAdvisor(){
  _advisorCat=null; _advisorPrice=null;
  const ov=document.getElementById('advisorOverlay');
  ov.classList.add('open');
  renderAdvisorStep(0);
}

function closeAdvisor(){
  document.getElementById('advisorOverlay').classList.remove('open');
}

function renderAdvisorStep(step){
  const dots=document.getElementById('advisorDots');
  const label=document.getElementById('advisorStepLabel');
  const body=document.getElementById('advisorBody');
  dots.innerHTML=`
    <div class="advisor-step-dot ${step===0?'active':'done'}"></div>
    <div class="advisor-step-dot ${step===1?'active':step>1?'done':''}"></div>`;
  if(step===0){
    label.textContent='خطوة 1 من 2';
    const cats=(storeCategories&&storeCategories.length)
      ? storeCategories.map(c=>({name:c.name,emoji:c.emoji||'🌿'}))
      : [...new Set(products.map(p=>p.cat))].filter(Boolean).map(c=>({name:c,emoji:'🌿'}));
    cats.unshift({name:'الكل',emoji:'✨'});
    body.innerHTML=`
      <p class="advisor-q">شو بتدور؟</p>
      <p class="advisor-sub">اختر نوع المنتج اللي يناسبك</p>
      <div class="advisor-options" style="grid-template-columns:${cats.length<=4?'1fr 1fr':'1fr 1fr 1fr'};">
        ${cats.map(c=>`
          <div class="advisor-opt" onclick="advisorSelectCat('${c.name}',this)">
            <span class="advisor-opt-icon">${c.emoji}</span>
            <span class="advisor-opt-label">${c.name}</span>
          </div>`).join('')}
      </div>`;
  } else if(step===1){
    label.textContent='خطوة 2 من 2';
    body.innerHTML=`
      <p class="advisor-q">ميزانيتك؟</p>
      <p class="advisor-sub">اختر النطاق السعري المناسب</p>
      <div class="advisor-price-opts">
        ${PRICE_RANGES.map((r,i)=>`
          <div class="advisor-price-opt" onclick="advisorSelectPrice(${i},this)">
            <span class="advisor-price-opt-icon">${r.icon}</span>
            <div class="advisor-price-opt-text">
              <div class="advisor-price-opt-label">${r.label}</div>
              <div class="advisor-price-opt-range">${r.sub}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="advisor-nav">
        <button onclick="advisorGoBack()" style="padding:11px 18px;border:1.5px solid #e5e7eb;border-radius:10px;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.88rem;cursor:pointer;color:#6b7280;">← رجوع</button>
      </div>`;
  } else {
    showAdvisorResults();
  }
}

function advisorSelectCat(cat, el){
  _advisorCat=cat==='الكل'?null:cat;
  document.querySelectorAll('.advisor-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  setTimeout(()=>renderAdvisorStep(1),300);
}

function advisorSelectPrice(idx, el){
  _advisorPrice=PRICE_RANGES[idx];
  document.querySelectorAll('.advisor-price-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  setTimeout(()=>renderAdvisorStep(2),300);
}

function advisorGoBack(){ renderAdvisorStep(0); }

function showAdvisorResults(){
  const label=document.getElementById('advisorStepLabel');
  const dots=document.getElementById('advisorDots');
  const body=document.getElementById('advisorBody');
  label.textContent='النتائج';
  dots.innerHTML=`<div class="advisor-step-dot done"></div><div class="advisor-step-dot done"></div>`;
  const range=_advisorPrice||PRICE_RANGES[3];
  let filtered=products.filter(p=>{
    if(p.outOfStock) return false;
    const catOk=!_advisorCat||p.cat===_advisorCat;
    const price=getPriceNum(p);
    const priceOk=price>=range.min&&price<=range.max;
    return catOk&&priceOk;
  });
  if(!filtered.length){
    body.innerHTML=`
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:3rem;margin-bottom:12px;">🔍</div>
        <div style="font-weight:700;color:#111827;margin-bottom:8px;">ما لقينا منتجات بهذه المواصفات</div>
        <div style="font-size:0.85rem;color:#9ca3af;margin-bottom:20px;">جرب تغير الفلتر أو تصفح كل المنتجات</div>
        <button onclick="advisorGoBack()" style="padding:11px 20px;background:#1a3a2a;color:#fff;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.9rem;cursor:pointer;margin-left:8px;">← حاول مجدداً</button>
        <button onclick="closeAdvisor()" style="padding:11px 20px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.9rem;cursor:pointer;">تصفح الكل</button>
      </div>`;
    return;
  }
  body.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <p class="advisor-q" style="margin-bottom:2px;">وجدنا لك ${filtered.length} منتج 🎉</p>
        <p class="advisor-sub" style="margin-bottom:0;">${_advisorCat||'كل المنتجات'} · ${range.label}</p>
      </div>
      <button onclick="advisorGoBack()" style="padding:7px 12px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;font-family:'Tajawal',sans-serif;font-size:0.8rem;cursor:pointer;color:#6b7280;white-space:nowrap;">← تعديل</button>
    </div>
    <div class="advisor-results-grid">
      ${filtered.slice(0,8).map(p=>{
        const img=p.images?.[0]||p.img;
        const price=getPriceNum(p);
        const old=p.oldPrice?getPriceNum({price:p.oldPrice}):null;
        return `<div style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
          <div style="height:120px;overflow:hidden;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:2.5rem;">
            ${img?`<img src="${img}" style="width:100%;height:100%;object-fit:cover;">`:(p.emoji||'🌿')}
          </div>
          <div style="padding:10px;">
            <div style="font-size:0.82rem;font-weight:700;color:#111827;margin-bottom:4px;line-height:1.3;">${p.name}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:6px;">
              <div>
                ${old?`<span style="font-size:0.7rem;color:#d1d5db;text-decoration:line-through;">${old} د.أ</span><br>`:''}
                <span style="font-size:0.9rem;font-weight:700;color:#1a3a2a;">${price.toFixed(2)} د.أ</span>
              </div>
              <button onclick="addAdvisorProduct('${p._docId||p.id}');closeAdvisor();" style="background:#1a3a2a;color:#fff;border:none;padding:6px 10px;border-radius:8px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;white-space:nowrap;">+ سلة</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${filtered.length>8?`<div style="text-align:center;margin-top:14px;"><button onclick="closeAdvisor();document.getElementById('products').scrollIntoView({behavior:'smooth'})" style="padding:10px 20px;background:#f3f4f6;color:#1a3a2a;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">عرض كل النتائج (${filtered.length})</button></div>`:''}`;
}

init();

// ===== QR SCANNER =====
let _qrScanActive=false, _qrScanStream=null, _qrScanRaf=null;
let _qrAssignOrderId=null, _qrAssignOrder=null;
let _qrBarcodeDetector=null, _qrLoopRunning=false;

async function openQRScanner(){
  const overlay=document.getElementById('qrScannerOverlay');
  if(!overlay)return;
  closeQRScanner();
  _qrAssignOrderId=null; _qrAssignOrder=null;
  overlay.style.display='block';
  document.getElementById('qrScanStatus').textContent='وجّه الكاميرا نحو QR Code على الفاتورة';
  _qrScanActive=true; _qrLoopRunning=false;
  // Init native BarcodeDetector (hardware-accelerated on Android/iOS)
  _qrBarcodeDetector=null;
  if('BarcodeDetector' in window){
    try{_qrBarcodeDetector=new BarcodeDetector({formats:['qr_code']});}catch(e){}
  }
  // Lazy-load jsQR only when BarcodeDetector is unavailable
  if(!_qrBarcodeDetector && typeof jsQR==='undefined'){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    }).catch(()=>{});
  }
  try{
    const c={video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}};
    try{_qrScanStream=await navigator.mediaDevices.getUserMedia(c);}
    catch(e){_qrScanStream=await navigator.mediaDevices.getUserMedia({video:true});}
    const video=document.getElementById('qrVideo');
    video.srcObject=_qrScanStream;
    video.onloadedmetadata=()=>{video.play().catch(()=>{});if(_qrScanActive&&!_qrLoopRunning)_qrRunLoop();};
    await video.play().catch(()=>{});
    if(video.readyState>=2&&!_qrLoopRunning)_qrRunLoop();
  }catch(e){
    document.getElementById('qrScanStatus').textContent='❌ تعذّر الوصول للكاميرا: '+e.message;
  }
}

async function _qrRunLoop(){
  _qrLoopRunning=true;
  const video=document.getElementById('qrVideo');
  const canvas=document.getElementById('qrCanvas');
  let ctx=null;
  while(_qrScanActive){
    if(video&&video.readyState>=2&&video.videoWidth){
      try{
        let raw=null;
        if(_qrBarcodeDetector){
          // Native hardware API — much faster & more reliable than jsQR
          const codes=await _qrBarcodeDetector.detect(video);
          if(codes.length)raw=codes[0].rawValue;
        }else{
          // jsQR fallback — use higher res (960px) for reliable decode
          const MAX=960;
          const sc=Math.min(1,MAX/Math.max(video.videoWidth,video.videoHeight));
          canvas.width=Math.round(video.videoWidth*sc);
          canvas.height=Math.round(video.videoHeight*sc);
          if(!ctx)ctx=canvas.getContext('2d',{willReadFrequently:true});
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const id=ctx.getImageData(0,0,canvas.width,canvas.height);
          const code=jsQR(id.data,id.width,id.height,{inversionAttempts:'attemptBoth'});
          if(code&&code.data)raw=code.data.trim();
        }
        if(raw&&_qrScanActive){_qrOnDetected(raw);return;}
      }catch(e){}
    }
    // BarcodeDetector: 40ms loop (25fps) | jsQR at 960px: 100ms loop (10fps, decode takes ~80ms)
    await new Promise(r=>setTimeout(r,_qrBarcodeDetector?40:100));
  }
  _qrLoopRunning=false;
}

function closeQRScanner(){
  _qrScanActive=false; _qrLoopRunning=false;
  if(_qrScanRaf){cancelAnimationFrame(_qrScanRaf);_qrScanRaf=null;}
  if(_qrScanStream){_qrScanStream.getTracks().forEach(t=>t.stop());_qrScanStream=null;}
  const overlay=document.getElementById('qrScannerOverlay');
  if(overlay)overlay.style.display='none';
}

let _qrLastDecode=0;
function _qrScanLoop(){
  if(!_qrScanActive)return;
  _qrScanRaf=requestAnimationFrame(_qrScanLoop);
  const now=Date.now();
  if(now-_qrLastDecode<50)return;
  _qrLastDecode=now;
  const video=document.getElementById('qrVideo');
  const canvas=document.getElementById('qrCanvas');
  if(!video||!canvas||video.readyState<2||!video.videoWidth)return;
  const MAX=640;
  const sc=Math.min(1,MAX/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.round(video.videoWidth*sc);
  canvas.height=Math.round(video.videoHeight*sc);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
  const code=jsQR(imageData.data,imageData.width,imageData.height,{inversionAttempts:'dontInvert'});
  if(code&&code.data){
    _qrOnDetected(code.data.trim());
  }
}

function _qrOnDetected(raw){
  _qrScanActive=false;
  if(_qrScanRaf){cancelAnimationFrame(_qrScanRaf);_qrScanRaf=null;}
  // Haptic feedback
  try{navigator.vibrate&&navigator.vibrate([60,30,60]);}catch(e){}
  // Green flash
  const flash=document.getElementById('qrDetectFlash');
  if(flash){flash.style.transition='none';flash.style.opacity='0.55';setTimeout(()=>{flash.style.transition='opacity 0.35s';flash.style.opacity='0';},80);}
  // Beep
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ac.createOscillator();const gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);
    osc.frequency.value=1480;gain.gain.setValueAtTime(0.25,ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.18);
    osc.start();osc.stop(ac.currentTime+0.18);
  }catch(e){}
  // Small delay so flash is visible, then close and handle
  setTimeout(()=>{
    closeQRScanner();
    if(_qrScanCallback){const cb=_qrScanCallback;_qrScanCallback=null;cb(raw);}
    else{_handleQRResult(raw);}
  },150);
}

function _showQRViewerResult(o){
  const wrap=document.getElementById('qrViewerResult');
  if(!wrap)return;
  const st=_empSt(o.status);
  const prods=o.products||[{name:o.productName||'?',price:o.price||0,qty:1}];
  const total=o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0);
  const dlv=o.deliveryFee||0;
  const net=o.netPrice!=null?o.netPrice:total+dlv;
  const label=o.orderNum?`#${o.orderNum}`:'#'+(o.id||'').slice(-5).toUpperCase();
  const imgs=o.imageDataUrls&&o.imageDataUrls.length?o.imageDataUrls:(o.imageDataUrl?[o.imageDataUrl]:[]);

  const prodsHtml=prods.map(p=>`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f5f5f5;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;font-size:0.88rem;color:#111;">${p.name}</div>
        ${p.priceLabel?`<div style="font-size:0.72rem;color:#854d0e;background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:2px 8px;margin-top:3px;display:inline-block;font-weight:700;">🏷 ${p.priceLabel}</div>`:''}
        ${p.color?`<div style="font-size:0.72rem;color:#555;margin-top:2px;">اللون: ${p.color}</div>`:''}
        ${p.writing?`<div style="font-size:0.72rem;color:#555;background:#fafafa;border-right:2.5px solid #111;border-radius:6px;padding:3px 8px;margin-top:4px;display:inline-block;">✎ ${p.writing}</div>`:''}
      </div>
      <div style="text-align:left;flex-shrink:0;">
        <div style="font-size:0.72rem;color:#999;">${p.qty||1} × ${(p.price||0).toFixed(2)}</div>
        <div style="font-weight:900;color:#111;font-size:0.9rem;">${((p.price||0)*(p.qty||1)).toFixed(2)} <span style="font-size:0.6rem;color:#999;">د.أ</span></div>
      </div>
    </div>`).join('');

  wrap.style.display='block';
  wrap.innerHTML=`
    <div style="background:#111;padding:16px 18px 14px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;">
      <div style="text-align:center;flex:1;">
        <div style="color:#fff;font-weight:900;font-size:1rem;">${label}</div>
        <div style="color:rgba(255,255,255,0.45);font-size:0.68rem;margin-top:2px;">${o.pageName||''}</div>
      </div>
      <span style="background:rgba(255,255,255,0.1);color:#fff;border-radius:20px;padding:4px 12px;font-size:0.72rem;font-weight:800;border:1px solid rgba(255,255,255,0.15);">${st.label}</span>
    </div>
    ${o.urgent?`<div style="background:#dc2626;color:#fff;padding:9px 16px;font-weight:800;text-align:center;font-size:0.88rem;">🔥 طلب مستعجل</div>`:''}
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:#fafafa;">
      <div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:10px;letter-spacing:1px;">معلومات الزبون</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.82rem;">
          <div><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">الاسم</div><div style="font-weight:700;color:#111;">${o.customerName||o.workerName||'—'}</div></div>
          <div><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">الهاتف</div><div style="font-weight:700;color:#111;direction:ltr;">${o.customerPhone||'—'}</div></div>
          <div style="grid-column:1/-1;"><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">العنوان</div><div style="font-weight:700;color:#111;">${o.address||'—'}${o.area?' · '+o.area:''}</div></div>
          ${o.notes?`<div style="grid-column:1/-1;"><div style="color:#999;font-size:0.68rem;font-weight:700;margin-bottom:2px;">ملاحظات</div><div style="font-weight:600;color:#555;">${o.notes}</div></div>`:''}
        </div>
      </div>
      <div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:10px;letter-spacing:1px;">المنتجات</div>
        ${prodsHtml}
        <div style="margin-top:10px;padding-top:10px;border-top:1.5px solid #111;display:flex;justify-content:space-between;align-items:center;">
          ${dlv>0?`<div style="font-size:0.74rem;color:#999;">منتجات: ${total.toFixed(2)} + توصيل: ${dlv.toFixed(2)}</div>`:'<div></div>'}
          <div style="font-weight:900;font-size:1.1rem;color:#111;">${net.toFixed(2)} <span style="font-size:0.6rem;color:#999;font-weight:500;">د.أ</span></div>
        </div>
      </div>
      ${o.deliveryRepName?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;">
        <div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:8px;letter-spacing:1px;">المندوب</div>
        <div style="font-weight:800;color:#111;font-size:0.88rem;">${o.deliveryRepName}${o.deliveryRepPhone?` — <span style="color:#555;direction:ltr;display:inline-block;">${o.deliveryRepPhone}</span>`:''}</div>
      </div>`:''}
      ${o.internalNote?`<div style="background:#fff;border-radius:14px;padding:15px;border:1px solid #ebebeb;border-right:3px solid #111;"><div style="font-size:0.7rem;font-weight:800;color:#999;margin-bottom:4px;letter-spacing:1px;">ملاحظة داخلية</div><div style="font-size:0.85rem;color:#555;">${o.internalNote}</div></div>`:''}
      ${imgs.length?`<div style="display:grid;grid-template-columns:repeat(${Math.min(imgs.length,3)},1fr);gap:6px;">${imgs.map(src=>`<img src="${src}" onclick="openEmpOrderImage('${src}')" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;cursor:zoom-in;">`).join('')}</div>`:''}
      ${['pending','preparing'].includes(o.status)?`<button onclick="updateEmpOrderStatus('${o.id}','prepared').then(()=>{document.getElementById('qrViewerResult').style.display='none';openQRScanner();})" style="width:100%;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:800;cursor:pointer;margin-top:4px;">✅ تم التجهيز</button>`:''}
      <button onclick="openQRScanner()" style="width:100%;padding:14px;background:#111;color:#fff;border:none;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:800;cursor:pointer;margin-top:4px;">📷 مسح طلب آخر</button>
    </div>`;
}

async function _handleQRResult(raw){
  let orderId=raw.trim();
  // Extract ?order= param if full URL was scanned
  try{const u=new URL(orderId);const p=u.searchParams.get('order');if(p)orderId=p;}catch(e){}
  try{
    closeQRScanner();
    // Helper: find order by docId or fallback search by orderNum / last-6 chars
    const _findOrder=async(id)=>{
      const direct=await db.collection('employee_orders').doc(id).get();
      if(direct.exists)return{id:direct.id,...direct.data()};
      // Fallback: search by orderNum field or last-6 chars of doc ID
      const cleaned=id.replace(/^#/,'');
      const byNum=await db.collection('employee_orders').where('orderNum','==',cleaned).limit(1).get()
        .catch(()=>({empty:true}));
      if(!byNum.empty)return{id:byNum.docs[0].id,...byNum.docs[0].data()};
      const byNumHash=await db.collection('employee_orders').where('orderNum','==','#'+cleaned).limit(1).get()
        .catch(()=>({empty:true}));
      if(!byNumHash.empty)return{id:byNumHash.docs[0].id,...byNumHash.docs[0].data()};
      return null;
    };
    if(_repQRMode){
      _repQRMode=false;
      const o=await _findOrder(orderId);
      if(o)_showRepOrderDetail(o);
      else toast('❌ الطلب غير موجود: '+orderId.slice(0,12));
      return;
    }
    // QR viewer employee: show read-only result card
    if(_empCurrentUser?.permissions?.isQRViewer){
      const o=await _findOrder(orderId);
      if(o)_showQRViewerResult(o);
      else toast('❌ الطلب غير موجود: '+orderId.slice(0,12));
      return;
    }
    const o=await _findOrder(orderId);
    if(!o){toast('❌ الطلب غير موجود: '+orderId.slice(0,12));return;}
    if(o.status==='waiting_rep'){
      _openRepPickerFromDetail(o.id);
    } else {
      openOpOrderDetail(o.id);
    }
  }catch(e){toast('❌ '+e.message);}
}

// ====== HARDWARE SCANNER (USB/Bluetooth keyboard-mode) ======
// Uses e.code (physical key) not e.key to handle Arabic/non-Latin OS keyboard layouts
(function(){
  // Map physical key codes → US-QWERTY characters (scanner always sends US layout HID codes)
  const _K={'KeyA':'a','KeyB':'b','KeyC':'c','KeyD':'d','KeyE':'e','KeyF':'f','KeyG':'g','KeyH':'h','KeyI':'i','KeyJ':'j','KeyK':'k','KeyL':'l','KeyM':'m','KeyN':'n','KeyO':'o','KeyP':'p','KeyQ':'q','KeyR':'r','KeyS':'s','KeyT':'t','KeyU':'u','KeyV':'v','KeyW':'w','KeyX':'x','KeyY':'y','KeyZ':'z','Digit0':'0','Digit1':'1','Digit2':'2','Digit3':'3','Digit4':'4','Digit5':'5','Digit6':'6','Digit7':'7','Digit8':'8','Digit9':'9','Minus':'-','Equal':'=','BracketLeft':'[','BracketRight':']','Backslash':'\\','Semicolon':';','Quote':"'",'Comma':',','Period':'.','Slash':'/','Backquote':'`','Space':' '};
  const _KS={'KeyA':'A','KeyB':'B','KeyC':'C','KeyD':'D','KeyE':'E','KeyF':'F','KeyG':'G','KeyH':'H','KeyI':'I','KeyJ':'J','KeyK':'K','KeyL':'L','KeyM':'M','KeyN':'N','KeyO':'O','KeyP':'P','KeyQ':'Q','KeyR':'R','KeyS':'S','KeyT':'T','KeyU':'U','KeyV':'V','KeyW':'W','KeyX':'X','KeyY':'Y','KeyZ':'Z','Digit0':')','Digit1':'!','Digit2':'@','Digit3':'#','Digit4':'$','Digit5':'%','Digit6':'^','Digit7':'&','Digit8':'*','Digit9':'(','Minus':'_','Equal':'+','BracketLeft':'{','BracketRight':'}','Backslash':'|','Semicolon':':','Quote':'"','Comma':'<','Period':'>','Slash':'?','Backquote':'~'};
  let _buf='',_bufStart=0,_timer=null;
  document.addEventListener('keydown',function(e){
    const now=Date.now();
    if(e.code==='Enter'||e.code==='NumpadEnter'){
      const raw=_buf.trim();
      const elapsed=now-_bufStart;
      _buf='';_bufStart=0;clearTimeout(_timer);
      // 1200ms threshold — covers USB and slow Bluetooth scanners
      if(raw.length>2&&elapsed<1200){
        e.preventDefault();e.stopPropagation();
        closeQRScanner();_handleQRResult(raw);
      }
      return;
    }
    // Use physical key code mapped to US-QWERTY, ignoring OS keyboard language
    const ch=e.shiftKey?(_KS[e.code]||_K[e.code]):_K[e.code];
    if(ch){
      if(!_buf)_bufStart=now;
      _buf+=ch;
      clearTimeout(_timer);
      _timer=setTimeout(()=>{_buf='';_bufStart=0;},1500);
    }
  });
})();
// ====================================================

async function _openQRRepAssignModal(o){
  const modal=document.getElementById('qrRepAssignModal');
  if(!modal)return;
  modal.style.display='flex';
  const st=_empSt(o.status);
  const prods=(o.products||[{name:o.productName||'?',price:o.price||0,qty:1}]);
  const total=(o.netPrice!=null?o.netPrice:(o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0)+(o.deliveryFee||0)));
  document.getElementById('qrAssignOrderInfo').textContent=`${o.orderNum||('#'+o.id.slice(-6).toUpperCase())} · ${o.customerName||o.pageName} · ${total.toFixed(2)} د.أ`;
  document.getElementById('qrAssignStatusBadge').innerHTML=`<div style="display:inline-block;padding:5px 14px;background:${st.bg};color:${st.color};border:1.5px solid ${st.border};border-radius:20px;font-size:0.82rem;font-weight:700;">${st.label}</div>`;
  const repSection=document.getElementById('qrAssignRepSection');
  const actionBtns=document.getElementById('qrAssignActionBtns');
  repSection.style.display='none';
  actionBtns.innerHTML='';
  if(o.status==='pending'){
    actionBtns.innerHTML=`
      <button onclick="updateEmpOrderStatus('${o.id}','preparing');closeQRRepAssignModal();" style="width:100%;padding:11px;background:#f97316;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">← قيد التجهيز</button>`;
  } else if(o.status==='preparing'){
    actionBtns.innerHTML=`
      <button onclick="updateEmpOrderStatus('${o.id}','prepared');closeQRRepAssignModal();" style="width:100%;padding:11px;background:#3b82f6;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">← تم التجهيز</button>
      <div style="display:flex;gap:8px;">
        <button onclick="_showRepPickerInModal('${o.id}')" style="flex:1;padding:11px;background:#0ea5e9;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">← قيد التوصيل</button>
        <button onclick="updateEmpOrderStatus('${o.id}','cancelled');closeQRRepAssignModal();" style="flex:1;padding:11px;background:#ef4444;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">🚫 ملغي</button>
      </div>`;
  } else if(o.status==='prepared'){
    repSection.style.display='block';
    const reps=await _loadDeliveryReps();
    const repList=document.getElementById('qrAssignRepList');
    repList.innerHTML=reps.length
      ?reps.map((r,i)=>`<button onclick="qrAssignToRep('${r.name.replace(/'/g,"\\'")}','${(r.phone||'').replace(/'/g,"\\'")}')" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.85rem;cursor:pointer;text-align:right;width:100%;box-sizing:border-box;">
        <div><div style="font-weight:700;color:#0369a1;">${r.name}</div><div style="font-size:0.72rem;color:#6b7280;">${r.phone||''}</div></div>
        <span style="background:#0ea5e9;color:#fff;border-radius:8px;padding:4px 10px;font-size:0.78rem;font-weight:700;">اختيار ←</span>
      </button>`).join('')
      :'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد مناديب — أضفهم من الإعدادات</div>';
  } else if(o.status==='waiting_rep'){
    repSection.style.display='block';
    const reps2=await _loadDeliveryReps();
    const repList2=document.getElementById('qrAssignRepList');
    repList2.innerHTML=(reps2.length
      ?reps2.map(r=>`<button onclick="qrAssignToRep('${r.name.replace(/'/g,"\\'")}','${(r.phone||'').replace(/'/g,"\\'")}')" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.85rem;cursor:pointer;text-align:right;width:100%;box-sizing:border-box;">
        <div><div style="font-weight:700;color:#0369a1;">${r.name}</div><div style="font-size:0.72rem;color:#6b7280;">${r.phone||''}</div></div>
        <span style="background:#0ea5e9;color:#fff;border-radius:8px;padding:4px 10px;font-size:0.78rem;font-weight:700;">اختيار ←</span>
      </button>`).join('')
      :'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد مناديب</div>')
      +`<button onclick="updateEmpOrderStatus('${o.id}','cancelled');closeQRRepAssignModal();" style="width:100%;margin-top:8px;padding:9px;background:#fee2e2;color:#dc2626;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">🚫 ملغي</button>`;
  } else if(o.status==='queued'){
    actionBtns.innerHTML=`
      <div style="background:#e0f2fe;border-radius:10px;padding:10px 12px;font-size:0.82rem;color:#0369a1;margin-bottom:8px;">🧍 مُسنَد لـ: <strong>${o.deliveryRepName||'—'}</strong></div>
      <button onclick="updateEmpOrderStatus('${o.id}','delivering');closeQRRepAssignModal();" style="width:100%;padding:11px;background:#8b5cf6;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">← قيد التوصيل</button>`;
  } else if(o.status==='delivering'){
    actionBtns.innerHTML=`
      <div style="background:#f0fdf4;border-radius:10px;padding:10px 12px;font-size:0.82rem;color:#166534;margin-bottom:8px;">🚚 قيد التوصيل ${o.deliveryRepName?'مع '+o.deliveryRepName:''}</div>
      <button onclick="updateEmpOrderStatus('${o.id}','delivered');closeQRRepAssignModal();" style="width:100%;padding:11px;background:#22c55e;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">✅ تسليم الطلب</button>`;
  } else if(o.status==='delivered'){
    actionBtns.innerHTML=`<div style="text-align:center;background:#f0fdf4;border-radius:10px;padding:14px;color:#166534;font-size:0.88rem;font-weight:700;">✅ تم تسليم هذا الطلب</div>`;
  } else if(o.status==='cancelled'){
    actionBtns.innerHTML=`<div style="text-align:center;background:#fee2e2;border-radius:10px;padding:14px;color:#dc2626;font-size:0.88rem;font-weight:700;">🚫 هذا الطلب ملغي${o.cancelReason?' — '+o.cancelReason:''}</div>`;
  } else {
    actionBtns.innerHTML=`<div style="text-align:center;color:#6b7280;font-size:0.85rem;padding:10px;">الطلب في حالة: ${st.label}</div>`;
  }
}

function closeQRRepAssignModal(){
  const modal=document.getElementById('qrRepAssignModal');
  if(modal)modal.style.display='none';
  _qrAssignOrderId=null;_qrAssignOrder=null;
}

async function qrAssignToRep(repName,repPhone){
  if(!_qrAssignOrderId)return;
  try{
    const docRef=db.collection('employee_orders').doc(_qrAssignOrderId);
    const snap=await docRef.get();
    const data=snap.data();
    const fromLabel=_empSt(data?.status).label;
    // If already delivered, keep status — only update rep info
    const assignStatus=data.status==='delivered'?'delivered':'delivering';
    const noteLabel=data.status==='delivered'?`تعيين مندوب (${repName})`:`${fromLabel} ← قيد التوصيل (${repName})`;
    const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:noteLabel};
    await docRef.update({status:assignStatus,deliveryRepName:repName,deliveryRepPhone:repPhone||'',assignedAt:firebase.firestore.Timestamp.now(),editHistory:[...(data?.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    // Patch local cache immediately
    const _pL=(arr)=>{if(!arr)return;const idx=arr.findIndex(o=>o.id===_qrAssignOrderId);if(idx>=0)arr[idx]={...arr[idx],status:assignStatus,deliveryRepName:repName,deliveryRepPhone:repPhone||''};};
    _pL(typeof _opOrdersAllData!=='undefined'?_opOrdersAllData:null);
    _pL(typeof _empOrdersAllData!=='undefined'?_empOrdersAllData:null);
    toast(`✅ أُسند لـ ${repName}`);
    closeQRRepAssignModal();
    if(typeof _renderOpOrdersView==='function')_renderOpOrdersView();
    if(typeof _renderEmpOrdersView==='function')_renderEmpOrdersView();
  }catch(e){toast('❌ '+e.message);}
}

async function _showRepPickerInModal(orderId){
  _qrAssignOrderId=orderId;
  const repSection=document.getElementById('qrAssignRepSection');
  const actionBtns=document.getElementById('qrAssignActionBtns');
  actionBtns.innerHTML='';
  repSection.style.display='block';
  const reps=await _loadDeliveryReps();
  const repList=document.getElementById('qrAssignRepList');
  repList.innerHTML=(reps.length
    ?reps.map(r=>`<button onclick="qrAssignToRep('${r.name.replace(/'/g,"\\'")}','${(r.phone||'').replace(/'/g,"\\'")}')" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:0.85rem;cursor:pointer;text-align:right;width:100%;box-sizing:border-box;">
      <div><div style="font-weight:700;color:#0369a1;">${r.name}</div><div style="font-size:0.72rem;color:#6b7280;">${r.phone||''}</div></div>
      <span style="background:#0ea5e9;color:#fff;border-radius:8px;padding:4px 10px;font-size:0.78rem;font-weight:700;">اختيار ←</span>
    </button>`).join('')
    :'<div style="text-align:center;color:#9ca3af;font-size:0.82rem;padding:10px;">لا يوجد مناديب — أضفهم من الإعدادات</div>')
    +`<button onclick="updateEmpOrderStatus('${orderId}','waiting_rep').then(closeQRRepAssignModal)" style="width:100%;margin-top:8px;padding:9px;background:#fef3c7;color:#d97706;border:1.5px solid #fde68a;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;">⏳ انتظار مندوب</button>`;
}

async function _openQRRepAssignForWaiting(orderId){
  try{
    const snap=await db.collection('employee_orders').doc(orderId).get();
    if(!snap.exists)return;
    _qrAssignOrderId=orderId;
    _qrAssignOrder={id:orderId,...snap.data()};
    _openQRRepAssignModal(_qrAssignOrder);
  }catch(e){toast('❌ '+e.message);}
}

async function qrAssignManualSend(){
  if(!_qrAssignOrder)return;
  const o=_qrAssignOrder;
  const prods=(o.products||[{name:o.productName||'?',price:o.price||0,qty:1}]);
  const total=(o.netPrice!=null?o.netPrice:(o.totalPrice||prods.reduce((s,p)=>s+(p.price*(p.qty||1)),0)+(o.deliveryFee||0)));
  const msg=`طلب توصيل 🚚\nالاسم: ${o.customerName||o.pageName}\nالهاتف: ${o.customerPhone}\nالعنوان: ${o.address}\nالمبلغ: ${total.toFixed(2)} د.أ`;
  closeQRRepAssignModal();
  updateEmpOrderStatus(o.id,'delivering');
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,'_blank');
}

// ===== DELIVERY QUEUE (queued orders grouped by rep) =====
function _orderNet(o){const pr=o.products||[{price:o.price||0,qty:1}];const t=pr.reduce((a,p)=>a+(p.price*(p.qty||1)),0);return o.netPrice!=null?o.netPrice:t+(o.deliveryFee||0);}
function _orderProdsStr(o){return(o.products||[{name:o.productName||'?',qty:1}]).map(p=>`${p.name}${(p.qty||1)>1?' ×'+p.qty:''}`).join('، ');}

function _renderDeliveryQueue(orders){
  const waitingRep=orders.filter(o=>o.status==='waiting_rep');
  const queued=orders.filter(o=>o.status==='queued');
  const delivering=orders.filter(o=>o.status==='delivering');
  let html='';

  // ── 0. انتظار مندوب ──
  if(waitingRep.length){
    html+=`<div style="background:#fef3c7;border:1.5px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;">
      <div style="font-weight:800;color:#d97706;font-size:0.92rem;margin-bottom:12px;">⏳ انتظار مندوب (${waitingRep.length} طلب)</div>
      ${waitingRep.map(o=>`<div style="background:#fff;border:1.5px solid #fde68a;border-radius:10px;padding:9px 12px;margin-bottom:7px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:#92400e;font-size:0.85rem;">${o.orderNum||('#'+o.id.slice(-6).toUpperCase())} · ${o.pageName||o.customerName||'—'}</div>
          <div style="font-size:0.75rem;color:#6b7280;">📞 ${o.customerPhone||'—'} · ${_orderNet(o).toFixed(2)} د.أ</div>
          <div style="font-size:0.75rem;color:#6b7280;">📦 ${_orderProdsStr(o)}</div>
        </div>
        <button onclick="_openQRRepAssignForWaiting('${o.id}')" style="padding:7px 13px;background:#d97706;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.79rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">🧍 تعيين</button>
      </div>`).join('')}
    </div>`;
  }

  // ── 1. قائمة انتظار (مُسند لكن لم يخرج بعد) ──
  if(queued.length){
    const byRep={};
    queued.forEach(o=>{const k=o.deliveryRepName||'—';if(!byRep[k])byRep[k]={name:k,phone:o.deliveryRepPhone||'',orders:[]};byRep[k].orders.push(o);});
    html+=`<div style="background:#e0f2fe;border:1.5px solid #bae6fd;border-radius:12px;padding:12px 14px;margin-bottom:16px;">
      <div style="font-weight:800;color:#0369a1;font-size:0.92rem;margin-bottom:12px;">🧍 قائمة الانتظار (${queued.length} طلب)</div>
      ${Object.values(byRep).map(rep=>{
        const total=rep.orders.reduce((s,o)=>s+_orderNet(o),0);
        const encoded=encodeURIComponent(_buildBatchRepMsg(rep.orders,rep.name));
        const phone=(rep.phone||'').replace(/[^\d+]/g,'');
        const waUrl=phone?`https://wa.me/${phone}?text=${encoded}`:`https://wa.me/?text=${encoded}`;
        return `<div style="background:#fff;border:1.5px solid #bae6fd;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
            <div><div style="font-weight:700;color:#0369a1;font-size:0.88rem;">🧍 ${rep.name}</div>
            <div style="font-size:0.73rem;color:#6b7280;">${rep.orders.length} طلب · ${total.toFixed(2)} د.أ</div></div>
            <button onclick="sendQueuedRepOrders('${rep.name.replace(/'/g,"\\'")}','${waUrl.replace(/'/g,"\\'")}','${phone}')" style="padding:7px 13px;background:#25D366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.79rem;font-weight:700;cursor:pointer;flex-shrink:0;">📱 إرسال</button>
          </div>
          ${rep.orders.map(o=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid #e0f2fe;font-size:0.79rem;gap:6px;">
            <span style="flex:1;min-width:0;">${o.orderNum||('#'+o.id.slice(-6).toUpperCase())} · ${o.pageName||o.customerName||''}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <span style="font-weight:700;color:#0369a1;">${_orderNet(o).toFixed(2)} د.أ</span>
              <button onclick="_openRepPickerFromDetail('${o.id}')" style="padding:3px 8px;background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:6px;font-family:'Tajawal',sans-serif;font-size:0.72rem;font-weight:700;cursor:pointer;">🔄</button>
            </div>
          </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── 2. قيد التوصيل — مجمّع بالمندوب ──
  if(delivering.length){
    const byRep={};
    delivering.forEach(o=>{const k=o.deliveryRepName||'بدون مندوب';if(!byRep[k])byRep[k]={name:k,phone:o.deliveryRepPhone||'',orders:[]};byRep[k].orders.push(o);});
    const selBtn=`<button onclick="toggleDelivSelectMode()" style="padding:5px 12px;background:${_delivSelectMode?'#7c3aed':'#fff'};color:${_delivSelectMode?'#fff':'#7c3aed'};border:1.5px solid #7c3aed;border-radius:8px;font-family:'Tajawal',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;">${_delivSelectMode?'✕ إلغاء التحديد':'☑ تحديد'}</button>`;
    html+=`<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:12px 14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;">
        <div style="font-weight:800;color:#7c3aed;font-size:0.92rem;">🚚 قيد التوصيل — المناديب (${delivering.length} طلب)</div>
        ${selBtn}
      </div>
      ${Object.values(byRep).map(rep=>{
        const total=rep.orders.reduce((s,o)=>s+_orderNet(o),0);
        const encoded=encodeURIComponent(_buildRepCurrentDeliveryMsg(rep.orders,rep.name));
        const phone=(rep.phone||'').replace(/[^\d+]/g,'');
        const waUrl=phone?`https://wa.me/${phone}?text=${encoded}`:`https://wa.me/?text=${encoded}`;
        const repIds=rep.orders.map(o=>o.id);
        const repIdsAttr=repIds.join(',');
        return `<div style="background:#fff;border:1.5px solid #ddd6fe;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
            <div><div style="font-weight:700;color:#7c3aed;font-size:0.88rem;">🚚 ${rep.name}</div>
            <div style="font-size:0.73rem;color:#6b7280;">${rep.orders.length} طلب · ${total.toFixed(2)} د.أ</div></div>
            ${_delivSelectMode
              ?`<button onclick="delivSelectRep('${repIdsAttr}')" style="padding:7px 12px;background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.79rem;font-weight:700;cursor:pointer;flex-shrink:0;">☑ اختر الكل</button>`
              :`<a href="${waUrl}" target="_blank" style="padding:7px 12px;background:#25D366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.79rem;font-weight:700;cursor:pointer;text-decoration:none;flex-shrink:0;">📱 واتساب</a>`}
          </div>
          ${rep.orders.map(o=>`
            <div style="background:#faf5ff;border-radius:8px;padding:7px 10px;margin-top:6px;border:1px solid #ede9fe;font-size:0.79rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;gap:6px;">
                <div style="display:flex;align-items:center;gap:6px;min-width:0;">
                  ${_delivSelectMode?`<input type="checkbox" id="delivchk_${o.id}" ${_delivSelectedIds.has(o.id)?'checked':''} onchange="delivToggle('${o.id}')" style="width:18px;height:18px;accent-color:#7c3aed;flex-shrink:0;cursor:pointer;">`:''}
                  <span style="font-weight:700;color:#5b21b6;">${o.orderNum||('#'+o.id.slice(-6).toUpperCase())} — ${o.pageName||'—'}</span>
                </div>
                <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                  <span style="font-weight:800;color:#166534;">${_orderNet(o).toFixed(2)} د.أ</span>
                  ${_delivSelectMode?'':`<button onclick="_openRepPickerFromDetail('${o.id}')" style="padding:4px 8px;background:#fef3c7;color:#d97706;border:1px solid #fde68a;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;">🔄</button>
                  <button onclick="markOrderDelivered('${o.id}')" style="padding:4px 10px;background:#22c55e;color:#fff;border:none;border-radius:7px;font-family:'Tajawal',sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;">✅ تسليم</button>`}
                </div>
              </div>
              <div style="color:#374151;">📞 ${o.customerPhone||'—'}</div>
              <div style="color:#374151;">📍 ${o.address||'—'}${o.area?' ('+o.area+')':''}</div>
              <div style="color:#6b7280;margin-top:2px;">📦 ${_orderProdsStr(o)}</div>
            </div>`).join('')}
        </div>`;
      }).join('')}
      ${_delivSelectMode?`<div id="delivBulkBar" style="position:sticky;bottom:8px;margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1a1a2e;border-radius:10px;padding:10px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.25);">
        <span style="color:#fff;font-size:0.82rem;font-weight:700;">محدد: <span id="delivSelCount">${_delivSelectedIds.size}</span> طلب</span>
        <button onclick="bulkDeliverSelected()" style="padding:8px 16px;background:#22c55e;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.82rem;font-weight:800;cursor:pointer;">✅ تسليم المحدد</button>
      </div>`:''}
    </div>`;

    // ── 3. قيد التوصيل — مجمّع بالمتجر/الصفحة ──
    const byStore={};
    delivering.forEach(o=>{const k=o.pageName||'—';if(!byStore[k])byStore[k]={name:k,orders:[]};byStore[k].orders.push(o);});
    html+=`<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:12px 14px;margin-bottom:16px;">
      <div style="font-weight:800;color:#c2410c;font-size:0.92rem;margin-bottom:12px;">🏪 قيد التوصيل — المتاجر/الصفحات (${delivering.length} طلب)</div>
      ${Object.values(byStore).map(store=>{
        const total=store.orders.reduce((s,o)=>s+_orderNet(o),0);
        const storePhone=(_opStoresList||[]).find(s=>s.name===store.name)?.phone||'';
        const encoded=encodeURIComponent(_buildStoreDeliveryMsg(store.orders,store.name));
        const waUrl=storePhone?`https://wa.me/${storePhone.replace(/[^\d+]/g,'')}?text=${encoded}`:`https://wa.me/?text=${encoded}`;
        return `<div style="background:#fff;border:1.5px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
            <div><div style="font-weight:700;color:#c2410c;font-size:0.88rem;">🏪 ${store.name}</div>
            <div style="font-size:0.73rem;color:#6b7280;">${store.orders.length} طلب · ${total.toFixed(2)} د.أ</div></div>
            <a href="${waUrl}" target="_blank" style="padding:7px 12px;background:#25D366;color:#fff;border:none;border-radius:9px;font-family:'Tajawal',sans-serif;font-size:0.79rem;font-weight:700;cursor:pointer;text-decoration:none;flex-shrink:0;">📱 إبعت للمتجر</a>
          </div>
          ${store.orders.map(o=>`
            <div style="background:#fff7ed;border-radius:8px;padding:7px 10px;margin-top:6px;border:1px solid #fed7aa;font-size:0.79rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                <span style="font-weight:700;color:#9a3412;">${o.orderNum||('#'+o.id.slice(-6).toUpperCase())}</span>
                <span style="font-weight:800;color:#166534;">${_orderNet(o).toFixed(2)} د.أ</span>
              </div>
              ${o.deliveryRepName?`<div style="color:#7c3aed;font-size:0.76rem;margin-bottom:2px;">🚚 المندوب: ${o.deliveryRepName}</div>`:''}
              <div style="color:#374151;">📞 ${o.customerPhone||'—'}</div>
              <div style="color:#374151;">📍 ${o.address||'—'}${o.area?' ('+o.area+')':''}</div>
              <div style="color:#6b7280;margin-top:2px;">📦 ${_orderProdsStr(o)}</div>
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  }

  if(!queued.length&&!delivering.length){
    html='<div style="text-align:center;color:#9ca3af;font-size:0.85rem;padding:30px;">لا يوجد طلبات في التوصيل</div>';
  }
  return html;
}

function _buildBatchRepMsg(orders,repName){
  const lines=orders.map((o,i)=>{
    const net=_orderNet(o);
    return `${i+1}. ${o.customerName||o.pageName} · ${o.customerPhone}\n   ${o.address||''}${o.area?' ('+o.area+')':''}\n   📦 ${_orderProdsStr(o)}\n   المبلغ: ${net.toFixed(2)} د.أ`;
  });
  return `طلبات توصيل 🚚\nالمندوب: ${repName}\nعدد الطلبات: ${orders.length}\n──────────────\n${lines.join('\n\n')}`;
}

function _buildRepCurrentDeliveryMsg(orders,repName){
  const lines=orders.map((o,i)=>{
    const net=_orderNet(o);
    return `${i+1}. ${o.pageName||o.customerName||'—'} | ${o.customerPhone}\n   📍 ${o.address||'—'}${o.area?' ('+o.area+')':''}\n   📦 ${_orderProdsStr(o)}\n   💰 ${net.toFixed(2)} د.أ`;
  });
  const total=orders.reduce((s,o)=>s+_orderNet(o),0);
  return `🚚 طلباتك الحالية\nالمندوب: ${repName}\nالعدد: ${orders.length} | الإجمالي: ${total.toFixed(2)} د.أ\n──────────────\n${lines.join('\n\n')}`;
}

function _buildStoreDeliveryMsg(orders,storeName){
  const lines=orders.map((o,i)=>{
    const net=_orderNet(o);
    return `${i+1}. طلب ${o.orderNum||('#'+o.id.slice(-6).toUpperCase())}\n   📞 ${o.customerPhone||'—'}\n   📍 ${o.address||'—'}${o.area?' ('+o.area+')':''}\n   📦 ${_orderProdsStr(o)}\n   🚚 المندوب: ${o.deliveryRepName||'—'}\n   💰 ${net.toFixed(2)} د.أ`;
  });
  const total=orders.reduce((s,o)=>s+_orderNet(o),0);
  return `🏪 طلبات ${storeName}\nقيد التوصيل الآن: ${orders.length} طلب\nالإجمالي: ${total.toFixed(2)} د.أ\n──────────────\n${lines.join('\n\n')}`;
}

async function markOrderDelivered(id){
  await updateEmpOrderStatus(id,'delivered');
}

// ===== تحديد متعدد + تسليم جماعي لقسم قيد التوصيل =====
function toggleDelivSelectMode(){
  _delivSelectMode=!_delivSelectMode;
  if(!_delivSelectMode)_delivSelectedIds.clear();
  _renderOpOrdersView();
}
function delivToggle(id){
  if(_delivSelectedIds.has(id))_delivSelectedIds.delete(id);else _delivSelectedIds.add(id);
  const cnt=document.getElementById('delivSelCount');
  if(cnt)cnt.textContent=_delivSelectedIds.size;
}
function delivSelectRep(idsStr){
  (idsStr||'').split(',').filter(Boolean).forEach(id=>_delivSelectedIds.add(id));
  _renderOpOrdersView();
}
async function bulkDeliverSelected(){
  const ids=[..._delivSelectedIds];
  if(!ids.length){toast('⚠️ ما في طلبات محددة');return;}
  if(!confirm(`تسليم ${ids.length} طلب؟`))return;
  let done=0;
  for(const id of ids){
    try{await updateEmpOrderStatus(id,'delivered');done++;}catch(e){}
  }
  _delivSelectedIds.clear();
  _delivSelectMode=false;
  toast(`✅ تم تسليم ${done} طلب`);
  _renderOpOrdersView();
}

async function sendQueuedRepOrders(repName,waUrl,repPhone){
  const data=(_opOrdersAllData.length>=_empOrdersAllData.length)?_opOrdersAllData:_empOrdersAllData;
  const orders=data.filter(o=>o.status==='queued'&&o.deliveryRepName===repName);
  if(!orders.length){toast('⚠️ لا توجد طلبات لهذا المندوب');return;}
  let finalWaUrl=waUrl;
  try{
    const batchId=_genBatchId();
    await db.collection('delivery_batches').doc(batchId).set({
      orders:orders.map(o=>({
        id:o.id,orderNum:o.orderNum||'',pageName:o.pageName||'',
        customerPhone:o.customerPhone||'',address:o.address||'',area:o.area||'',
        products:o.products||[],netPrice:o.netPrice!=null?o.netPrice:(o.totalPrice||0),notes:o.notes||''
      })),
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const batchLink=`\n\n✅ رابط تأكيد التسليم:\n${location.origin+location.pathname}?deliverBatch=${batchId}`;
    const urlObj=new URL(waUrl);
    const text=urlObj.searchParams.get('text')||'';
    urlObj.searchParams.set('text',text+batchLink);
    finalWaUrl=urlObj.toString();
  }catch(e){}
  if(finalWaUrl)window.open(finalWaUrl,'_blank');
  for(const o of orders){
    try{
      const docRef=db.collection('employee_orders').doc(o.id);
      const snap=await docRef.get();
      const d=snap.data();
      const editEntry={by:_currentAdminUser||'admin',at:jordanDisplayDate(),note:`قائمة توصيل ← قيد التوصيل`};
      await docRef.update({status:'delivering',editHistory:[...(d?.editHistory||[]),editEntry],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }catch(e){}
  }
  // Patch local cache so UI reflects immediately without waiting for snapshot
  const sentIds=new Set(orders.map(o=>o.id));
  [typeof _opOrdersAllData!=='undefined'?_opOrdersAllData:null,
   typeof _empOrdersAllData!=='undefined'?_empOrdersAllData:null].forEach(arr=>{
    if(!arr)return;
    arr.forEach(o=>{if(sentIds.has(o.id))o.status='delivering';});
  });
  if(typeof _renderOpOrdersView==='function')_renderOpOrdersView();
  if(typeof _renderEmpOrdersView==='function')_renderEmpOrdersView();
  toast(`✅ تم إرسال ${orders.length} طلب لـ ${repName}`);
}

// ===== DXF GENERATOR =====
let _dxfFont = null;
let _dxfFontsMap = {};
let _dxfTraceMode = 'text';
let _dxfTraceImg = null;

function dxfSetMode(mode) {
  _dxfTraceMode = mode;
  const isImg = mode === 'image';
  const fs = document.getElementById('dxfFontSection');
  const is = document.getElementById('dxfImageSection');
  const tiw = document.getElementById('dxfTextInputsWrap');
  const iiw = document.getElementById('dxfImageInputsWrap');
  if (fs) fs.style.display = isImg ? 'none' : 'block';
  if (is) is.style.display = isImg ? 'block' : 'none';
  if (tiw) tiw.style.display = isImg ? 'none' : 'block';
  if (iiw) iiw.style.display = isImg ? 'block' : 'none';
  const tb = document.getElementById('dxfModeTextBtn');
  const ib = document.getElementById('dxfModeImageBtn');
  if (tb) { tb.style.background = isImg ? '#f3f4f6' : 'var(--green-dark)'; tb.style.color = isImg ? '#374151' : '#fff'; tb.style.border = isImg ? '1.5px solid #e5e7eb' : 'none'; }
  if (ib) { ib.style.background = isImg ? 'var(--green-dark)' : '#f3f4f6'; ib.style.color = isImg ? '#fff' : '#374151'; ib.style.border = isImg ? 'none' : '1.5px solid #e5e7eb'; }
}

function dxfLoadTraceImage(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('dxfTraceImageStatus');
  if (statusEl) statusEl.textContent = '⏳ جاري التحميل...';
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      _dxfTraceImg = img;
      if (statusEl) statusEl.textContent = `✅ ${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
      const wrap = document.getElementById('dxfThreshWrap');
      if (wrap) wrap.style.display = 'block';
      dxfApplyThreshold();
    };
    img.onerror = () => { if (statusEl) statusEl.textContent = '❌ فشل تحميل الصورة'; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function dxfApplyThreshold() {
  if (!_dxfTraceImg) return;
  const thresh = parseInt(document.getElementById('dxfThreshSlider')?.value || '128');
  const valSpan = document.getElementById('dxfThreshValSpan');
  if (valSpan) valSpan.textContent = thresh;
  const prevCanvas = document.getElementById('dxfThreshCanvas');
  if (!prevCanvas) return;
  const W = _dxfTraceImg.naturalWidth, H = _dxfTraceImg.naturalHeight;
  const maxDim = 420;
  const sc = Math.min(1, maxDim / Math.max(W, H));
  const pW = Math.round(W * sc), pH = Math.round(H * sc);
  prevCanvas.width = pW; prevCanvas.height = pH;
  const ctx = prevCanvas.getContext('2d');
  ctx.drawImage(_dxfTraceImg, 0, 0, pW, pH);
  const id = ctx.getImageData(0, 0, pW, pH);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) < thresh ? 0 : 255;
    d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

function _dxfLoadImageTracer() {
  return new Promise((resolve, reject) => {
    if (window.ImageTracer) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('فشل تحميل مكتبة التتبع'));
    document.head.appendChild(s);
  });
}

function _dxfSvgDToPolylines(d, scaleX, scaleY) {
  const polylines = [];
  const re = /([MmLlCcQqZzHhVvSsTtAa])|(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)/gi;
  const tokens = []; let m;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);
  let i = 0;
  const getNum = () => parseFloat(tokens[i++] || '0');
  let curPts = [], cx = 0, cy = 0, startX = 0, startY = 0;
  const DEV = 0.5;
  const pushPt = (x, y) => curPts.push([x * scaleX, y * scaleY]);
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!/^[MmLlCcQqZzHhVvSsTtAa]$/.test(tok)) { i++; continue; }
    i++;
    switch (tok) {
      case 'M': { if (curPts.length > 1) polylines.push({pts:curPts,closed:false,layer:'0'}); curPts=[]; cx=getNum();cy=getNum();startX=cx;startY=cy;pushPt(cx,cy); break; }
      case 'm': { if (curPts.length > 1) polylines.push({pts:curPts,closed:false,layer:'0'}); curPts=[]; cx+=getNum();cy+=getNum();startX=cx;startY=cy;pushPt(cx,cy); break; }
      case 'L': { cx=getNum();cy=getNum();pushPt(cx,cy); break; }
      case 'l': { cx+=getNum();cy+=getNum();pushPt(cx,cy); break; }
      case 'H': { cx=getNum();pushPt(cx,cy); break; }
      case 'h': { cx+=getNum();pushPt(cx,cy); break; }
      case 'V': { cy=getNum();pushPt(cx,cy); break; }
      case 'v': { cy+=getNum();pushPt(cx,cy); break; }
      case 'C': { const x1=getNum(),y1=getNum(),x2=getNum(),y2=getNum(),x3=getNum(),y3=getNum(); const ps=_dxfSubdivideCubic(cx,cy,x1,y1,x2,y2,x3,y3,DEV,0); for(const[px,py]of ps)pushPt(px,py); cx=x3;cy=y3; break; }
      case 'c': { const rx1=getNum(),ry1=getNum(),rx2=getNum(),ry2=getNum(),rx3=getNum(),ry3=getNum(); const x1=cx+rx1,y1=cy+ry1,x2=cx+rx2,y2=cy+ry2,x3=cx+rx3,y3=cy+ry3; const ps=_dxfSubdivideCubic(cx,cy,x1,y1,x2,y2,x3,y3,DEV,0); for(const[px,py]of ps)pushPt(px,py); cx=x3;cy=y3; break; }
      case 'Q': { const x1=getNum(),y1=getNum(),x2=getNum(),y2=getNum(); const qx1=cx+(x1-cx)*2/3,qy1=cy+(y1-cy)*2/3,qx2=x2+(x1-x2)*2/3,qy2=y2+(y1-y2)*2/3; const ps=_dxfSubdivideCubic(cx,cy,qx1,qy1,qx2,qy2,x2,y2,DEV,0); for(const[px,py]of ps)pushPt(px,py); cx=x2;cy=y2; break; }
      case 'q': { const rx1=getNum(),ry1=getNum(),rx2=getNum(),ry2=getNum(); const x1=cx+rx1,y1=cy+ry1,x2=cx+rx2,y2=cy+ry2; const qx1=cx+(x1-cx)*2/3,qy1=cy+(y1-cy)*2/3,qx2=x2+(x1-x2)*2/3,qy2=y2+(y1-y2)*2/3; const ps=_dxfSubdivideCubic(cx,cy,qx1,qy1,qx2,qy2,x2,y2,DEV,0); for(const[px,py]of ps)pushPt(px,py); cx=x2;cy=y2; break; }
      case 'Z': case 'z': { if (curPts.length > 2) polylines.push({pts:curPts,closed:true,layer:'0'}); curPts=[]; cx=startX;cy=startY; break; }
      case 'A': { getNum();getNum();getNum();getNum();getNum();cx=getNum();cy=getNum();pushPt(cx,cy); break; }
      case 'a': { getNum();getNum();getNum();getNum();getNum();cx+=getNum();cy+=getNum();pushPt(cx,cy); break; }
      case 'S': { const x2=getNum(),y2=getNum(),x3=getNum(),y3=getNum(); cx=x3;cy=y3;pushPt(cx,cy); break; }
      case 's': { getNum();getNum();cx+=getNum();cy+=getNum();pushPt(cx,cy); break; }
      case 'T': { cx=getNum();cy=getNum();pushPt(cx,cy); break; }
      case 't': { cx+=getNum();cy+=getNum();pushPt(cx,cy); break; }
    }
  }
  if (curPts.length > 1) polylines.push({pts:curPts,closed:false,layer:'0'});
  return polylines;
}

async function _dxfTraceGetPolylines() {
  if (!_dxfTraceImg) throw new Error('ارفع صورة أولاً');
  const thresh = parseInt(document.getElementById('dxfThreshSlider')?.value || '128');
  const widthMM = parseFloat(document.getElementById('dxfTraceWidth')?.value || '100');
  const minArea = parseInt(document.getElementById('dxfTraceMinArea')?.value || '20');
  const W = _dxfTraceImg.naturalWidth, H = _dxfTraceImg.naturalHeight;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = W; offCanvas.height = H;
  const octx = offCanvas.getContext('2d');
  octx.drawImage(_dxfTraceImg, 0, 0);
  const id = octx.getImageData(0, 0, W, H);
  const data = id.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114) < thresh ? 0 : 255;
    data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255;
  }
  octx.putImageData(id, 0, 0);
  if (!window.ImageTracer) await _dxfLoadImageTracer();
  const svgStr = ImageTracer.imagedataToSVG(
    octx.getImageData(0, 0, W, H),
    { numberofcolors: 2, colorsampling: 0, colorquantcycles: 1, ltres: 1, qtres: 1,
      pathomit: minArea, scale: 1, strokewidth: 0, linefilter: false, rightangleenhance: false }
  );
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgStr, 'image/svg+xml');
  const scaleX = widthMM / W, scaleY = scaleX;
  let polylines = [];
  for (const pathEl of doc.querySelectorAll('path')) {
    const fill = (pathEl.getAttribute('fill') || '').toLowerCase().replace(/\s/g, '');
    const mc = fill.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (mc) { if ((+mc[1] + +mc[2] + +mc[3]) / 3 > 200) continue; }
    else if (fill === '#ffffff' || fill === 'white') continue;
    const dAttr = pathEl.getAttribute('d') || '';
    if (dAttr) polylines.push(..._dxfSvgDToPolylines(dAttr, scaleX, scaleY));
  }
  return polylines;
}

async function _dxfImageModePreview() {
  const canvas = document.getElementById('dxfCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const infoEl = document.getElementById('dxfInfo');
  function drawBg() {
    ctx.fillStyle='#0d1117';ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;
    for(let x=0;x<W;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  }
  drawBg();
  if (!_dxfTraceImg) {
    ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font="15px 'Tajawal',sans-serif";
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('ارفع صورة لرؤية المعاينة',W/2,H/2);
    if(infoEl)infoEl.textContent=''; return;
  }
  if(infoEl)infoEl.textContent='⏳ جاري التتبع...';
  try {
    let polylines = await _dxfTraceGetPolylines();
    if (!window.ClipperLib) await dxfLoadClipper();
    polylines = _dxfApplyUnion(polylines, 0.1);
    const p = dxfGetParams();
    if (p.doBridge) { try { polylines = p.bridgeMode==='channel'?_dxfApplyChannel(polylines,p.bridgeWidth):_dxfApplyBridges(polylines,p.bridgeWidth); } catch(e){} }
    if (p.doFrame) { try { polylines = _dxfApplyFrame(polylines,p.frameWall); } catch(e){} }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const pl of polylines) for(const[x,y] of pl.pts){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
    if (!isFinite(minX)) {
      drawBg();
      ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font="15px 'Tajawal',sans-serif";
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('لا مسارات — جرّب تعديل إعدادات التتبع',W/2,H/2);
      if(infoEl)infoEl.textContent=''; return;
    }
    const pad=10, scX=(W-pad*2)/(maxX-minX||1), scY=(H-pad*2)/(maxY-minY||1), sc=Math.min(scX,scY);
    const offX=pad-minX*sc+(W-pad*2-(maxX-minX)*sc)/2;
    const offY=pad-minY*sc+(H-pad*2-(maxY-minY)*sc)/2;
    drawBg();
    ctx.save(); ctx.translate(offX,offY); ctx.scale(sc,sc);
    for (const pl of polylines) {
      if (pl.pts.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(pl.pts[0][0],pl.pts[0][1]);
      for(let j=1;j<pl.pts.length;j++) ctx.lineTo(pl.pts[j][0],pl.pts[j][1]);
      if(pl.closed) ctx.closePath();
      const isHole=pl.layer==='HOLES', isFrame=pl.layer==='FRAME';
      ctx.fillStyle=isFrame?'rgba(59,130,246,0.10)':isHole?'rgba(255,100,50,0.25)':'rgba(0,255,136,0.12)';
      ctx.fill('evenodd');
      ctx.strokeStyle=isFrame?'#3b82f6':isHole?'#ff6432':'#00ff88';
      ctx.lineWidth=1/sc; ctx.stroke();
    }
    ctx.restore();
    const wMM=(maxX-minX).toFixed(1), hMM=(maxY-minY).toFixed(1);
    const outerN=polylines.filter(pl=>pl.layer==='0').length;
    const holeN=polylines.filter(pl=>pl.layer==='HOLES').length;
    if(infoEl)infoEl.innerHTML=`أبعاد: ${wMM}×${hMM} مم &nbsp;|&nbsp; <span style="color:#00ff88">■ ${outerN} شكل</span>${holeN?` &nbsp;<span style="color:#ff6432">■ ${holeN} فراغ</span>`:''}`;
  } catch(e) {
    drawBg();
    ctx.fillStyle='#ef4444';ctx.font="13px 'Tajawal',sans-serif";
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('خطأ: '+e.message,W/2,H/2);
    if(infoEl)infoEl.textContent='';
  }
}

async function _dxfImageModeDownload() {
  const dlEl = document.getElementById('dxfDownloadInfo');
  if (dlEl) dlEl.textContent = '⏳ جاري التتبع...';
  try {
    let polylines = await _dxfTraceGetPolylines();
    if (!window.ClipperLib) { if(dlEl)dlEl.textContent='⏳ تحميل مكتبة الدمج...'; await dxfLoadClipper(); }
    polylines = _dxfApplyUnion(polylines, 0.1);
    const p = dxfGetParams();
    if (p.doBridge) { try { polylines = p.bridgeMode==='channel'?_dxfApplyChannel(polylines,p.bridgeWidth):_dxfApplyBridges(polylines,p.bridgeWidth); } catch(e){} }
    if (p.doFrame) { try { polylines = _dxfApplyFrame(polylines,p.frameWall); } catch(e){} }
    const svgStr = _svgBuildString(polylines);
    const blob = new Blob([svgStr], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ((document.getElementById('dxfFilenameImg')?.value||'').trim() || 'رسمة') + '.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const holeCount=polylines.filter(pl=>pl.layer==='HOLES').length;
    const outerCount=polylines.filter(pl=>pl.layer!=='HOLES').length;
    if(dlEl)dlEl.textContent=`✅ تم التحميل | ${outerCount} شكل | ${holeCount} فراغ`;
  } catch(e) {
    if(dlEl)dlEl.textContent='❌ '+e.message;
  }
}

// ── Font cloud storage ──────────────────────────────────────────────────────
async function _dxfUploadFontCloud(buffer, name, fileName) {
  try {
    const path = 'dxf_fonts/' + Date.now() + '_' + fileName;
    const ref = storage.ref(path);
    const snap = await ref.put(new Blob([buffer]));
    const url = await snap.ref.getDownloadURL();
    const small = buffer.byteLength < 900 * 1024; // store bytes in Firestore if < 900 KB
    const docRef = await db.collection('dxf_fonts').add({
      name, fileName, storagePath: path, downloadURL: url,
      fileSize: buffer.byteLength, hasBytes: small,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (small) {
      await db.collection('dxf_fonts').doc(docRef.id)
        .collection('data').doc('bytes')
        .set({ fontBytes: firebase.firestore.Blob.fromUint8Array(new Uint8Array(buffer)) });
    }
    _dxfRenderFontsList();
  } catch(e) {
    console.error('Font upload error:', e);
    toast('❌ فشل رفع الخط: ' + (e.message || e));
  }
}

async function _dxfRenderFontsList() {
  const el = document.getElementById('dxfFontsList');
  if (!el) return;
  el.innerHTML = '<div style="font-size:0.78rem;color:#9ca3af;padding:4px 0;">⏳ تحميل...</div>';
  try {
    const snap = await db.collection('dxf_fonts').orderBy('uploadedAt','desc').get();
    _dxfFontsMap = {};
    if (snap.empty) { el.innerHTML = '<div style="font-size:0.78rem;color:#9ca3af;padding:4px 2px;">لا توجد خطوط محفوظة</div>'; return; }
    snap.docs.forEach(d => { _dxfFontsMap[d.id] = {...d.data()}; });
    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;margin-top:6px;">' +
      snap.docs.map(d => {
        const data = d.data();
        const kb = data.fileSize ? Math.round(data.fileSize/1024) + ' KB' : '';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
          <span style="font-size:0.83rem;font-weight:700;color:#111;">${data.name}<span style="font-weight:400;color:#9ca3af;font-size:0.72rem;margin-right:6px;">${kb}</span></span>
          <span style="display:flex;gap:5px;">
            <button onclick="_dxfSelectFont('${d.id}')" style="padding:4px 12px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-family:'Tajawal',sans-serif;font-size:0.78rem;cursor:pointer;">تحميل</button>
            <button onclick="_dxfDeleteFont('${d.id}')" style="padding:4px 9px;background:#fee2e2;color:#dc2626;border:none;border-radius:6px;font-size:0.78rem;cursor:pointer;">🗑</button>
          </span>
        </div>`;
      }).join('') + '</div>';
  } catch(e) { el.innerHTML = '<div style="font-size:0.78rem;color:#dc2626;">❌ ' + e.message + '</div>'; }
}

async function _dxfSelectFont(docId) {
  const data = _dxfFontsMap[docId];
  const statusEl = document.getElementById('dxfFontStatus');
  if (!data) {
    if (statusEl) { statusEl.textContent = '❌ أعد فتح التبويب وحاول ثانية'; statusEl.style.color = '#dc2626'; }
    return;
  }
  if (statusEl) { statusEl.textContent = '⏳ جاري تحميل الخط...'; statusEl.style.color = '#6b7280'; }
  try {
    if (!window.opentype) await dxfLoadOpentype();
    let buf;
    // Primary: read bytes directly from Firestore (no CORS issue)
    if (data.hasBytes) {
      try {
        const snap = await db.collection('dxf_fonts').doc(docId).collection('data').doc('bytes').get();
        if (snap.exists && snap.data().fontBytes) {
          buf = snap.data().fontBytes.toUint8Array().buffer;
        }
      } catch(e2) { console.warn('Firestore bytes read failed:', e2); }
    }
    // Fallback: Firebase Storage (fresh URL to avoid expiry)
    if (!buf) {
      const freshUrl = await storage.ref(data.storagePath).getDownloadURL();
      const resp = await fetch(freshUrl);
      if (!resp.ok) throw new Error('تعذّر تنزيل الملف (HTTP ' + resp.status + ')');
      buf = await resp.arrayBuffer();
    }
    _dxfFont = opentype.parse(buf);
    if (statusEl) { statusEl.textContent = '✅ ' + data.name; statusEl.style.color = '#16a34a'; }
    const fnEl = document.getElementById('dxfFilename');
    if (fnEl && !fnEl.value) fnEl.value = data.name;
    dxfUpdatePreview();
  } catch(e) {
    console.error('Font load error:', e);
    if (statusEl) { statusEl.textContent = '❌ ' + (e.message || 'فشل تحميل الخط'); statusEl.style.color = '#dc2626'; }
  }
}

async function _dxfDeleteFont(docId) {
  if (!confirm('حذف هذا الخط؟')) return;
  try {
    const data = _dxfFontsMap[docId];
    try { await db.collection('dxf_fonts').doc(docId).collection('data').doc('bytes').delete(); } catch(e) {}
    await db.collection('dxf_fonts').doc(docId).delete();
    if (data?.storagePath) { try { await storage.ref(data.storagePath).delete(); } catch(e) {} }
    _dxfRenderFontsList();
  } catch(e) { alert('❌ فشل الحذف: ' + e.message); }
}

function dxfLoadOpentype() {
  return new Promise((resolve, reject) => {
    if (window.opentype) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('فشل تحميل مكتبة opentype.js'));
    document.head.appendChild(s);
  });
}

async function dxfTabActivated() {
  _dxfRenderFontsList();
  dxfUpdatePreview();
}

async function dxfLoadFont(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('dxfFontStatus');
  statusEl.textContent = '⏳ جاري تحميل الخط...';
  statusEl.style.color = '#6b7280';
  try {
    if (!window.opentype) await dxfLoadOpentype();
    const buffer = await file.arrayBuffer();
    _dxfFont = opentype.parse(buffer);
    const nameObj = _dxfFont.names.fullName;
    const name = (nameObj && (nameObj.ar || nameObj.en || Object.values(nameObj)[0])) || file.name.replace(/\.[^.]+$/, '');
    statusEl.textContent = '✅ ' + name;
    statusEl.style.color = '#16a34a';
    const fnEl = document.getElementById('dxfFilename');
    if (fnEl && !fnEl.value) fnEl.value = name;
    _dxfUploadFontCloud(buffer, name, file.name);
    dxfUpdatePreview();
  } catch(e) {
    statusEl.textContent = '❌ ' + (e.message || 'خطأ في تحميل الخط');
    statusEl.style.color = '#dc2626';
  }
}

function dxfGetParams() {
  return {
    text: (document.getElementById('dxfText')?.value || '').trim(),
    sizeMM: Math.max(1, parseFloat(document.getElementById('dxfSize')?.value) || 30),
    offX: parseFloat(document.getElementById('dxfOffX')?.value) || 0,
    offY: parseFloat(document.getElementById('dxfOffY')?.value) || 0,
    res: parseFloat(document.getElementById('dxfRes')?.value) || 0.5,
    filename: (document.getElementById('dxfFilename')?.value || '').trim(),
    doMerge: document.getElementById('dxfMerge')?.checked !== false,
    doBridge: document.getElementById('dxfBridge')?.checked !== false,
    bridgeWidth: parseFloat(document.getElementById('dxfBridgeWidthNum')?.value || document.getElementById('dxfBridgeWidth')?.value) || 0.8,
    bridgeMode: (document.querySelector('input[name="dxfBridgeMode"]:checked')?.value) || 'bridge',
    doFrame: document.getElementById('dxfFrame')?.checked === true,
    frameWall: parseFloat(document.getElementById('dxfFrameWallNum')?.value || document.getElementById('dxfFrameWall')?.value) || 3,
  };
}

// ── Bridge helpers ──────────────────────────────────────────────────────────
function _dxfClosestOnPoly(pts, target) {
  let best={dist:Infinity,segIdx:0,t:0,pt:null};
  const n=pts.length;
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    const [ax,ay]=pts[i],[bx,by]=pts[j],[tx,ty]=target;
    const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
    const t=len2===0?0:Math.max(0,Math.min(1,((tx-ax)*dx+(ty-ay)*dy)/len2));
    const px=ax+t*dx,py=ay+t*dy;
    const dist=Math.hypot(tx-px,ty-py);
    if(dist<best.dist)best={dist,segIdx:i,t,pt:[px,py]};
  }
  return best;
}

// Walk along the polygon perimeter by `dist` mm from (segIdx, t).
// Positive dist = forward (toward pts[segIdx+1]); negative = backward.
// Returns the new position on the polygon — always ON the boundary.
function _dxfWalkPoly(pts, segIdx, t, dist) {
  const n=pts.length;
  let cur=segIdx, curT=t, remain=Math.abs(dist);
  const fwd=dist>=0;
  for(let safety=0; safety<n*2 && remain>1e-9; safety++){
    const [ax,ay]=pts[cur],[bx,by]=pts[(cur+1)%n];
    const segLen=Math.hypot(bx-ax,by-ay);
    if(segLen<1e-9){
      if(fwd){cur=(cur+1)%n;curT=0;}else{cur=(cur-1+n)%n;curT=1;}
      continue;
    }
    if(fwd){
      const toEnd=segLen*(1-curT);
      if(remain<=toEnd){curT+=remain/segLen;remain=0;}
      else{remain-=toEnd;cur=(cur+1)%n;curT=0;}
    }else{
      const fromStart=segLen*curT;
      if(remain<=fromStart){curT-=remain/segLen;remain=0;}
      else{remain-=fromStart;cur=(cur-1+n)%n;curT=1;}
    }
  }
  const [ax,ay]=pts[cur],[bx,by]=pts[(cur+1)%n];
  return {pt:[ax+(bx-ax)*curT,ay+(by-ay)*curT], segIdx:cur, t:curT};
}

// Collect polygon vertices from (fromSegIdx, end of segment) up to AND including pts[toSegIdx].
// Walks FORWARD around the polygon, wrapping if needed.
function _dxfArcForward(pts, fromSegIdx, toSegIdx) {
  const n=pts.length, out=[];
  let i=(fromSegIdx+1)%n;
  for(let safety=0; safety<n+1; safety++){
    out.push(pts[i]);
    if(i===toSegIdx) break;
    i=(i+1)%n;
  }
  return out;
}
function _dxfArcBackward(pts, fromSegIdx, toSegIdx) {
  // Collect vertices going BACKWARD from fromSegIdx to (toSegIdx+1)%n.
  // Used for hole arc in bridge merge: backward on a CW-stored hole = CCW traversal
  // = opposite winding to the CW outer = proper hole in merged path.
  const n=pts.length, out=[];
  let i=fromSegIdx;
  for(let safety=0; safety<n+1; safety++){
    out.push(pts[i]);
    if(i===(toSegIdx+1)%n) break;
    i=(i-1+n)%n;
  }
  return out;
}

function _dxfBridgeGap(pts, segIdx, t, hw) {
  // Open the closed polygon: R → polygon arc → L (open path).
  // R and L are placed hw forward/backward ALONG THE PERIMETER from center (segIdx, t).
  const R=_dxfWalkPoly(pts,segIdx,t,hw);
  const L=_dxfWalkPoly(pts,segIdx,t,-hw);
  return [R.pt, ..._dxfArcForward(pts,R.segIdx,L.segIdx), L.pt];
}

function _dxfFindParentOuter(hole, outers) {
  // Use PolyTree hierarchy tag if available; otherwise fall back to closest point.
  if (hole._parentOid != null) {
    const oi = outers.findIndex(o => o._oid === hole._parentOid);
    if (oi >= 0) return oi;
  }
  // Fallback: find closest outer by sampling hole vertices
  let bestDist=Infinity, bestOi=-1;
  const hStep=Math.max(1,Math.floor(hole.pts.length/60));
  for(let vi=0;vi<hole.pts.length;vi+=hStep){
    for(let oi=0;oi<outers.length;oi++){
      const r=_dxfClosestOnPoly(outers[oi].pts, hole.pts[vi]);
      if(r.dist<bestDist){bestDist=r.dist;bestOi=oi;}
    }
  }
  return bestOi;
}

function _dxfFindBestBridge(hole, workOuters, oi) {
  let bHSeg=null,bOSeg=null,bDist=Infinity;
  // Sample all hole vertices (coarse pass) to find approximate closest pair
  const step=Math.max(1,Math.floor(hole.pts.length/120));
  for(let vi=0;vi<hole.pts.length;vi+=step){
    const r=_dxfClosestOnPoly(workOuters[oi].pts,hole.pts[vi]);
    if(r.dist<bDist){bDist=r.dist;bHSeg=_dxfClosestOnPoly(hole.pts,r.pt);bOSeg=r;}
  }
  // Refine: iterate a few times to converge on the true closest point pair
  for(let pass=0;pass<3;pass++){
    const o2=_dxfClosestOnPoly(workOuters[oi].pts,bHSeg.pt);
    const h2=_dxfClosestOnPoly(hole.pts,o2.pt);
    bOSeg=o2; bHSeg=h2;
  }
  // wallLen = actual distance between refined closest points (NOT the coarse bDist)
  const wallLen=Math.hypot(bHSeg.pt[0]-bOSeg.pt[0],bHSeg.pt[1]-bOSeg.pt[1]);
  return {holeSeg:bHSeg,outerSeg:bOSeg,wallLen};
}

function _dxfPolyPerimeter(pts){let s=0;for(let i=0;i<pts.length;i++){const[ax,ay]=pts[i],[bx,by]=pts[(i+1)%pts.length];s+=Math.hypot(bx-ax,by-ay);}return s;}

function _dxfApplyBridges(polylines, bridgeWidth) {
  const outers=polylines.filter(p=>p.layer==='0'&&p.closed);
  const holes=polylines.filter(p=>p.layer==='HOLES'&&p.closed);
  const others=polylines.filter(p=>!((p.layer==='0'||p.layer==='HOLES')&&p.closed));
  if(!holes.length) return polylines;
  const workOuters=outers.map(p=>({...p,pts:[...p.pts]}));
  const hw=bridgeWidth/2;
  for(const hole of holes){
    const oi=_dxfFindParentOuter(hole,workOuters);
    if(oi<0) continue;
    const {holeSeg,outerSeg,wallLen}=_dxfFindBestBridge(hole,workOuters,oi);
    // Cap: can't exceed 1/4 of hole perimeter (geometric limit) or user request
    const holePeri=_dxfPolyPerimeter(hole.pts);
    const ehw=Math.min(hw, holePeri/4);
    if(ehw<0.05) continue;
    const Ro=_dxfWalkPoly(workOuters[oi].pts,outerSeg.segIdx,outerSeg.t, ehw);
    const Lo=_dxfWalkPoly(workOuters[oi].pts,outerSeg.segIdx,outerSeg.t,-ehw);
    const Rh=_dxfWalkPoly(hole.pts,holeSeg.segIdx,holeSeg.t, ehw);
    const Lh=_dxfWalkPoly(hole.pts,holeSeg.segIdx,holeSeg.t,-ehw);
    const merged=[
      Ro.pt,
      ..._dxfArcForward(workOuters[oi].pts,Ro.segIdx,Lo.segIdx),
      Lo.pt,
      Lh.pt,
      ..._dxfArcBackward(hole.pts,Lh.segIdx,Rh.segIdx),
      Rh.pt,
    ];
    workOuters[oi]={...workOuters[oi],pts:merged,closed:true};
  }
  return [...workOuters,...others];
}

function _dxfLinePolyIntersect(polyPts, ox, oy, dx, dy) {
  // Returns sorted t-values where line (ox+t*dx, oy+t*dy) crosses polygon segments
  const n=polyPts.length, hits=[];
  for(let i=0;i<n;i++){
    const [ax,ay]=polyPts[i],[bx,by]=polyPts[(i+1)%n];
    const ex=bx-ax,ey=by-ay;
    const det=dx*ey-dy*ex;
    if(Math.abs(det)<1e-10) continue;
    const t=((ax-ox)*ey-(ay-oy)*ex)/det;
    const s=((ax-ox)*dy-(ay-oy)*dx)/det;
    if(s>=0&&s<=1) hits.push(t);
  }
  return hits.sort((a,b)=>a-b);
}

function _dxfChannelNotch(pts, segIdx, t, hw, wd, depth) {
  // Insert a rectangular U-notch of width 2*hw and given depth.
  // R and L are placed hw forward/backward ALONG THE PERIMETER from center (segIdx, t).
  // wd = unit vector INTO the wall. Returns a CLOSED path.
  const R=_dxfWalkPoly(pts,segIdx,t,hw);
  const L=_dxfWalkPoly(pts,segIdx,t,-hw);
  const BL=[L.pt[0]+wd[0]*depth, L.pt[1]+wd[1]*depth];
  const BR=[R.pt[0]+wd[0]*depth, R.pt[1]+wd[1]*depth];
  return [R.pt, ..._dxfArcForward(pts,R.segIdx,L.segIdx), L.pt, BL, BR];
}

function _dxfApplyChannel(polylines, channelWidth) {
  // شارع = دمج: يدمج كل تجويف داخلي مع محيطه الخارجي في مسار واحد مغلق متصل.
  // النتيجة: مسار واحد لكل حرف — الليزر يقطعه بدفقة واحدة، ما في قطع معلقة.
  // المسار يسير: على الخارجي → ينزل جانب الجسر → يدور على التجويف → يطلع الجانب الثاني → يرجع.
  const outers=polylines.filter(p=>p.layer==='0'&&p.closed);
  const holes=polylines.filter(p=>p.layer==='HOLES'&&p.closed);
  const others=polylines.filter(p=>!((p.layer==='0'||p.layer==='HOLES')&&p.closed));
  if(!holes.length) return polylines;
  const workOuters=outers.map(p=>({...p,pts:[...p.pts]}));
  const hw=channelWidth/2;
  for(const hole of holes){
    const oi=_dxfFindParentOuter(hole,workOuters);
    if(oi<0) continue;
    const {holeSeg,outerSeg,wallLen}=_dxfFindBestBridge(hole,workOuters,oi);
    const holePeri=_dxfPolyPerimeter(hole.pts);
    const ehw=Math.min(hw, holePeri/4);
    if(ehw<0.05) continue;
    const Ro=_dxfWalkPoly(workOuters[oi].pts,outerSeg.segIdx,outerSeg.t, ehw);
    const Lo=_dxfWalkPoly(workOuters[oi].pts,outerSeg.segIdx,outerSeg.t,-ehw);
    const Rh=_dxfWalkPoly(hole.pts,holeSeg.segIdx,holeSeg.t, ehw);
    const Lh=_dxfWalkPoly(hole.pts,holeSeg.segIdx,holeSeg.t,-ehw);
    // Single merged closed path: Ro → [outer CW] → Lo → Lh → [hole CCW backward] → Rh → close(Ro)
    const merged=[
      Ro.pt,
      ..._dxfArcForward(workOuters[oi].pts,Ro.segIdx,Lo.segIdx),
      Lo.pt,
      Lh.pt,
      ..._dxfArcBackward(hole.pts,Lh.segIdx,Rh.segIdx),
      Rh.pt,
    ];
    workOuters[oi]={...workOuters[oi],pts:merged,closed:true};
  }
  return [...workOuters,...others];
}

function _dxfApplyFrame(polylines, wallMM) {
  // For each outer shape (layer '0'), expand outward by wallMM using ClipperOffset.
  // Returns: expanded outer paths (layer 'FRAME') + original paths unchanged.
  // The laser cuts FRAME (outer edge) + '0' (inner edge) = hollow letter frame piece.
  const SCALE = 100000;
  const delta = Math.round(wallMM * SCALE);
  const outers = polylines.filter(p => p.layer === '0' && p.closed);
  const rest   = polylines.filter(p => !(p.layer === '0' && p.closed));
  if (!outers.length) return polylines;

  const co = new ClipperLib.ClipperOffset(2, 0.25);
  outers.forEach(pl => {
    const scaled = pl.pts.map(([x,y]) => ({X:Math.round(x*SCALE), Y:Math.round(y*SCALE)}));
    co.AddPath(scaled, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  });
  const sol = new ClipperLib.Paths();
  co.Execute(sol, delta);

  const framePaths = sol.map(path => ({
    pts: path.map(p => [p.X/SCALE, p.Y/SCALE]),
    closed: true,
    layer: 'FRAME'
  }));

  return [...framePaths, ...outers, ...rest];
}

async function dxfUpdatePreview() {
  if (_dxfTraceMode === 'image') { await _dxfImageModePreview(); return; }
  const canvas = document.getElementById('dxfCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const infoEl = document.getElementById('dxfInfo');
  function drawBg() {
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
    for(let x=0;x<W;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  }
  drawBg();
  if (!_dxfFont) {
    ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font="15px 'Tajawal',sans-serif";
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('ارفع ملف الخط لرؤية المعاينة',W/2,H/2);
    if(infoEl)infoEl.textContent=''; return;
  }
  const p = dxfGetParams();
  if (!p.text) {
    ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font="15px 'Tajawal',sans-serif";
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('أدخل النص لرؤية المعاينة',W/2,H/2);
    if(infoEl)infoEl.textContent=''; return;
  }
  const doMerge = document.getElementById('dxfMerge')?.checked;
  try {
    const SCALE=3;
    const fsPx=p.sizeMM*SCALE;
    const path=_dxfFont.getPath(p.text, W-20+p.offX*SCALE, H/2+fsPx*0.35+p.offY*SCALE, fsPx);
    const bb=path.getBoundingBox();
    const shiftX=bb.x1<5?5-bb.x1:(bb.x2>W-5?W-5-bb.x2:0);
    const wMM=((bb.x2-bb.x1)/SCALE).toFixed(1);
    const hMM=((bb.y2-bb.y1)/SCALE).toFixed(1);
    if (doMerge) {
      if(infoEl)infoEl.textContent='⏳ جاري الدمج...';
      if(!window.ClipperLib) await dxfLoadClipper();
      const rawPl=_dxfPathToPolylinesRaw(path, p.res);
      const eps=Math.min(1.0, Math.max(0.2, p.sizeMM*0.012));
      let merged=_dxfApplyUnion(rawPl, eps);
      if(p.doBridge){try{merged=p.bridgeMode==='channel'?_dxfApplyChannel(merged,p.bridgeWidth):_dxfApplyBridges(merged,p.bridgeWidth);}catch(e){}}
      if(p.doFrame){try{merged=_dxfApplyFrame(merged,p.frameWall);}catch(e){}}
      drawBg();
      ctx.save(); ctx.translate(shiftX,0);
      for(const pl of merged) {
        if(pl.pts.length<2)continue;
        ctx.beginPath();
        ctx.moveTo(pl.pts[0][0],pl.pts[0][1]);
        for(let i=1;i<pl.pts.length;i++) ctx.lineTo(pl.pts[i][0],pl.pts[i][1]);
        if(pl.closed) ctx.closePath();
        const isHole=pl.layer==='HOLES';
        const isFrame=pl.layer==='FRAME';
        ctx.fillStyle=isFrame?'rgba(59,130,246,0.10)':isHole?'rgba(255,100,50,0.25)':'rgba(0,255,136,0.12)';
        ctx.fill('evenodd');
        ctx.strokeStyle=isFrame?'#3b82f6':isHole?'#ff6432':'#00ff88';
        ctx.lineWidth=1.2; ctx.stroke();
      }
      ctx.strokeStyle='rgba(255,220,0,0.35)';ctx.lineWidth=1;
      ctx.setLineDash([4,4]);ctx.strokeRect(bb.x1,bb.y1,bb.x2-bb.x1,bb.y2-bb.y1);
      ctx.setLineDash([]);ctx.restore();
      const outerN=merged.filter(pl=>pl.layer==='0').length;
      const holeN=merged.filter(pl=>pl.layer==='HOLES').length;
      const bridgeNote=p.doBridge&&holeN===0?' (مع جسور)':'';
      if(infoEl)infoEl.innerHTML=`أبعاد: ${wMM}×${hMM} مم &nbsp;|&nbsp; <span style="color:#00ff88">■ ${outerN} شكل</span>${holeN?` &nbsp;<span style="color:#ff6432">■ ${holeN} فراغ منفصل</span>`:''}${bridgeNote?`<span style="color:#fb923c"> ${bridgeNote}</span>`:''}`;
    } else {
      ctx.save(); ctx.translate(shiftX,0);
      ctx.beginPath();
      for(const cmd of path.commands){
        switch(cmd.type){
          case 'M':ctx.moveTo(cmd.x,cmd.y);break;
          case 'L':ctx.lineTo(cmd.x,cmd.y);break;
          case 'C':ctx.bezierCurveTo(cmd.x1,cmd.y1,cmd.x2,cmd.y2,cmd.x,cmd.y);break;
          case 'Q':ctx.quadraticCurveTo(cmd.x1,cmd.y1,cmd.x,cmd.y);break;
          case 'Z':ctx.closePath();break;
        }
      }
      ctx.fillStyle='rgba(0,255,136,0.18)';ctx.fill('evenodd');
      ctx.strokeStyle='#00ff88';ctx.lineWidth=1.2;ctx.stroke();
      ctx.strokeStyle='rgba(255,220,0,0.35)';ctx.lineWidth=1;
      ctx.setLineDash([4,4]);ctx.strokeRect(bb.x1,bb.y1,bb.x2-bb.x1,bb.y2-bb.y1);
      ctx.setLineDash([]);ctx.restore();
      if(infoEl)infoEl.textContent=`أبعاد النص: ${wMM} × ${hMM} مم`;
    }
  } catch(e) {
    drawBg();
    ctx.fillStyle='#ef4444';ctx.font="13px 'Tajawal',sans-serif";
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('خطأ: '+e.message,W/2,H/2);
    if(infoEl)infoEl.textContent='';
  }
}

function _dxfSubdivideCubic(x0,y0,x1,y1,x2,y2,x3,y3,maxDev,depth) {
  if ((depth||0) > 12) return [[x3,y3]];
  const d1 = _dxfPtLineDist(x1,y1,x0,y0,x3,y3);
  const d2 = _dxfPtLineDist(x2,y2,x0,y0,x3,y3);
  if (d1 <= maxDev && d2 <= maxDev) return [[x3,y3]];
  const ax=(x0+x1)/2,ay=(y0+y1)/2, bx=(x1+x2)/2,by=(y1+y2)/2, cx=(x2+x3)/2,cy=(y2+y3)/2;
  const dx=(ax+bx)/2,dy=(ay+by)/2, ex=(bx+cx)/2,ey=(by+cy)/2;
  const mx=(dx+ex)/2,my=(dy+ey)/2;
  return [
    ..._dxfSubdivideCubic(x0,y0,ax,ay,dx,dy,mx,my,maxDev,(depth||0)+1),
    ..._dxfSubdivideCubic(mx,my,ex,ey,cx,cy,x3,y3,maxDev,(depth||0)+1)
  ];
}

function _dxfPtLineDist(px,py,ax,ay,bx,by) {
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  if (len2===0) return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-ax-t*dx, py-ay-t*dy);
}

function _dxfPathToPolylinesRaw(path, maxDev) {
  const polylines = [];
  let current = null, cx = 0, cy = 0;
  for (const cmd of path.commands) {
    switch(cmd.type) {
      case 'M':
        if (current && current.pts.length > 1) polylines.push(current);
        current = {pts:[[cmd.x, cmd.y]], closed:false};
        cx=cmd.x; cy=cmd.y; break;
      case 'L':
        if (!current) current={pts:[[cx,cy]],closed:false};
        current.pts.push([cmd.x,cmd.y]);
        cx=cmd.x; cy=cmd.y; break;
      case 'C': {
        if (!current) current={pts:[[cx,cy]],closed:false};
        const pts=_dxfSubdivideCubic(cx,cy,cmd.x1,cmd.y1,cmd.x2,cmd.y2,cmd.x,cmd.y,maxDev,0);
        pts.forEach(([x,y])=>current.pts.push([x,y]));
        cx=cmd.x; cy=cmd.y; break;
      }
      case 'Q': {
        if (!current) current={pts:[[cx,cy]],closed:false};
        const qx1=cx+2/3*(cmd.x1-cx),qy1=cy+2/3*(cmd.y1-cy);
        const qx2=cmd.x+2/3*(cmd.x1-cmd.x),qy2=cmd.y+2/3*(cmd.y1-cmd.y);
        const pts=_dxfSubdivideCubic(cx,cy,qx1,qy1,qx2,qy2,cmd.x,cmd.y,maxDev,0);
        pts.forEach(([x,y])=>current.pts.push([x,y]));
        cx=cmd.x; cy=cmd.y; break;
      }
      case 'Z':
        if (current && current.pts.length > 1) { current.closed=true; polylines.push(current); }
        current=null; break;
    }
  }
  if (current && current.pts.length > 1) polylines.push(current);
  return polylines;
}

function _dxfPathToPolylines(path, maxDev) {
  return _dxfPathToPolylinesRaw(path, maxDev).map(pl=>({...pl, pts:pl.pts.map(([x,y])=>[x,-y])}));
}

function _dxfFlipY(polylines) {
  return polylines.map(pl=>({...pl, pts:pl.pts.map(([x,y])=>[x,-y])}));
}

function _dxfBuildString(polylines) {
  let h = 100;
  const ents = polylines.map(pl => {
    const handle = (h++).toString(16).toUpperCase();
    const layer = pl.layer || '0';
    const verts = pl.pts.map(([x,y])=>`10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}`).join('\n');
    return ['0','LWPOLYLINE','5',handle,'100','AcDbEntity','8',layer,'100','AcDbPolyline',
      '90',pl.pts.length,'70',pl.closed?1:0,'43','0',verts].join('\n');
  }).join('\n');
  return ['0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1015',
    '9','$INSUNITS','70','4',
    '0','ENDSEC',
    '0','SECTION','2','ENTITIES',
    ents,
    '0','ENDSEC','0','EOF',''].join('\n');
}

function _svgBuildString(polylines) {
  if (!polylines.length) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const pl of polylines) {
    for (const [x, y] of pl.pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const pad = 2;
  const vx = (minX - pad).toFixed(3);
  const vy = (minY - pad).toFixed(3);
  const vw = (maxX - minX + pad * 2).toFixed(3);
  const vh = (maxY - minY + pad * 2).toFixed(3);
  const pathEls = polylines.map(pl => {
    const col = pl.layer === 'HOLES' ? '#FF0000' : '#000000';
    const d = 'M ' + pl.pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' L ') + (pl.closed ? ' Z' : '');
    return `  <path d="${d}" stroke="${col}" fill="none" stroke-width="0.1"/>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${(+vw).toFixed(1)}mm" height="${(+vh).toFixed(1)}mm">\n${pathEls}\n</svg>`;
}

function dxfLoadClipper() {
  return new Promise((resolve, reject) => {
    if (window.ClipperLib) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('فشل تحميل مكتبة Clipper'));
    document.head.appendChild(s);
  });
}

// Union in SCREEN coords (no Y flip) then returns layer-tagged polylines
// outer shapes → layer "0", inner holes/islands → layer "HOLES"
// epsilonMM: inflate amount to bridge touching-but-not-overlapping letter edges
function _dxfApplyUnion(rawPolylines, epsilonMM) {
  if (!window.ClipperLib) return rawPolylines.map(pl=>({...pl, layer:'0'}));
  const SCALE = 100000;
  const EPS = Math.round((epsilonMM || 0.3) * SCALE);
  const closed = rawPolylines.filter(p => p.closed);
  const open = rawPolylines.filter(p => !p.closed);
  if (!closed.length) return rawPolylines.map(pl=>({...pl, layer:'0'}));
  const clipPaths = closed.map(pl =>
    pl.pts.map(([x,y]) => ({X: Math.round(x*SCALE), Y: Math.round(y*SCALE)}))
  );
  // Inflate slightly so touching Arabic letter edges actually overlap → union merges them
  const co = new ClipperLib.ClipperOffset();
  co.AddPaths(clipPaths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const inflated = new ClipperLib.Paths();
  co.Execute(inflated, EPS);
  if (!inflated.length) return rawPolylines.map(pl=>({...pl, layer:'0'}));
  // Union with PolyTree to get outer/hole hierarchy
  const cpr = new ClipperLib.Clipper();
  cpr.AddPaths(inflated, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  cpr.Execute(ClipperLib.ClipType.ctUnion, tree,
    ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  // Deflate result back to original size
  const result = [];
  let _oidSeq = 0;
  function walk(node, parentOid) {
    let myOid = parentOid;
    if (node.m_polygon && node.m_polygon.length > 1) {
      const isHole = typeof node.IsHole === 'function' ? node.IsHole() : false;
      const co2 = new ClipperLib.ClipperOffset();
      co2.AddPath(node.m_polygon, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const deflated = new ClipperLib.Paths();
      co2.Execute(deflated, isHole ? EPS : -EPS);
      const newOid = isHole ? null : _oidSeq++;
      (deflated.length ? deflated : [node.m_polygon]).forEach(p => {
        if (p.length > 1) {
          const entry = {
            pts: p.map(pt => [pt.X/SCALE, pt.Y/SCALE]),
            closed: true,
            layer: isHole ? 'HOLES' : '0'
          };
          if (!isHole) entry._oid = newOid;
          if (isHole && parentOid != null) entry._parentOid = parentOid;
          result.push(entry);
        }
      });
      if (!isHole) myOid = newOid;
    }
    (node.m_Childs || []).forEach(child => walk(child, myOid));
  }
  walk(tree, null);
  return [...result, ...open.map(pl=>({...pl, layer:'0'}))];
}

async function dxfDownload() {
  if (_dxfTraceMode === 'image') { await _dxfImageModeDownload(); return; }
  if (!_dxfFont) { alert('الرجاء رفع ملف الخط أولاً'); return; }
  const p = dxfGetParams();
  if (!p.text) { alert('الرجاء إدخال النص'); return; }
  const dlEl = document.getElementById('dxfDownloadInfo');
  if (dlEl) dlEl.textContent = '⏳ جاري التوليد...';
  let path;
  try {
    path = _dxfFont.getPath(p.text, p.offX, p.offY, p.sizeMM);
  } catch(e) { alert('خطأ في توليد المسارات: ' + e.message); return; }
  let polylines = _dxfPathToPolylinesRaw(path, p.res);
  if (!polylines.length) { alert('لم يتم توليد أي مسارات. تأكد من أن الخط يدعم الأحرف المُدخلة.'); return; }
  if (p.doMerge) {
    try {
      if (!window.ClipperLib) { if(dlEl) dlEl.textContent='⏳ تحميل مكتبة الدمج...'; await dxfLoadClipper(); }
      const eps = Math.min(1.0, Math.max(0.2, p.sizeMM * 0.012));
      polylines = _dxfApplyUnion(polylines, eps);
    } catch(e) {
      console.warn('Union failed:', e);
      polylines = polylines.map(pl=>({...pl, layer:'0'}));
    }
  } else {
    polylines = polylines.map(pl=>({...pl, layer:'0'}));
  }
  // Apply bridges BEFORE Y flip (screen coords)
  if (p.doBridge && p.doMerge) {
    try { polylines = p.bridgeMode==='channel' ? _dxfApplyChannel(polylines,p.bridgeWidth) : _dxfApplyBridges(polylines,p.bridgeWidth); } catch(e) { console.warn('Bridge/channel failed:', e); }
  }
  // Apply frame (expand outward) — screen coords, before any flip
  if (p.doFrame && p.doMerge) {
    try { polylines = _dxfApplyFrame(polylines, p.frameWall); } catch(e) { console.warn('Frame failed:', e); }
  }
  // SVG uses Y-down (same as screen coords) — no flip needed
  const svgStr = _svgBuildString(polylines);
  const blob = new Blob([svgStr], {type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (p.filename || p.text.substring(0,20) || 'نقش') + '.svg';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
  const holeCount = polylines.filter(pl=>pl.layer==='HOLES').length;
  const outerCount = polylines.filter(pl=>pl.layer!=='HOLES').length;
  const totalPts = polylines.reduce((s,pl)=>s+pl.pts.length,0);
  if (dlEl) dlEl.textContent = `✅ تم التحميل | ${outerCount} شكل خارجي | ${holeCount} فراغ داخلي (أحمر) | ${totalPts} نقطة`;
}

window.dxfLoadFont=dxfLoadFont; window.dxfDownload=dxfDownload; window.dxfUpdatePreview=dxfUpdatePreview; window.dxfTabActivated=dxfTabActivated;
window.dxfSetMode=dxfSetMode; window.dxfLoadTraceImage=dxfLoadTraceImage; window.dxfApplyThreshold=dxfApplyThreshold;
