const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, 'public');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const contentFile = path.join(dataDir, 'content.json');
const ordersFile = path.join(dataDir, 'orders.json');
const cartsFile = path.join(dataDir, 'carts.json');
const adminUsersFile = path.join(dataDir, 'admin-users.json');
const analyticsFile = path.join(dataDir, 'analytics.json');
const databaseUrl = process.env.DATABASE_URL || '';
const pool = databaseUrl ? new (require('pg').Pool)({ connectionString: databaseUrl, max: 5 }) : null;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const seeds = {
  settings: { brand: 'KasiGo', whatsapp: '', phone: '', email: '', address: '', headline: 'YOUR CITY. YOUR PEOPLE. YOUR DELIVERY.', subheadline: 'Order from local favourites, send a parcel or arrange a collection. Tell us where it needs to go.', about: 'KasiGo connects customers, local stores and delivery partners across South Africa.' },
  slides: [{ title: 'Order now', action: 'Order now', href: '/food', image: '' }, { title: 'Send a parcel', action: 'Send a parcel', href: '/send-parcel', image: '' }, { title: 'Collect a parcel', action: 'Collect a parcel', href: '/collect-parcel', image: '' }],
  background: '',
  categories: [
    { slug: 'food', name: 'Food', description: 'Order from restaurants', icon: '🍔', active: true },
    { slug: 'groceries', name: 'Groceries', description: 'Shop participating stores', icon: '🛒', active: true },
    { slug: 'buy-for-me', name: 'Buy For Me', description: 'Send us your shopping list', icon: '🧺', active: true },
    { slug: 'send-parcel', name: 'Send a parcel', description: 'Delivery from A to B', icon: '📦', active: true },
    { slug: 'collect-parcel', name: 'Collect a parcel', description: 'Bring something to you', icon: '📥', active: true },
    { slug: 'store-delivery', name: 'Store delivery', description: 'Delivery for your business', icon: '🏪', active: true, subcategories: [] },
    { slug: 'moving-relocation', name: 'Moving & Relocation', description: 'Plan a home or office move', icon: '🚚', active: true, subcategories: ['Home move', 'Office move', 'Furniture delivery'] }
  ],
  stores: []
};
const adminSessions = new Map();
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
const json = (res, status, value, headers) => send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
async function initDatabase() {
  if (process.env.RAILWAY_ENVIRONMENT && !pool) throw new Error('DATABASE_URL is required on Railway. Add a PostgreSQL service and reference its DATABASE_URL.');
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS kasigo_data (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
function dataKey(file) { return path.basename(file, '.json'); }
async function readStoredJSON(key, file, fallback) {
  if (pool) {
    const result = await pool.query('SELECT value FROM kasigo_data WHERE key = $1', [key]);
    return result.rowCount ? result.rows[0].value : fallback;
  }
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
}
async function writeStoredJSON(key, file, value) {
  if (pool) {
    await pool.query('INSERT INTO kasigo_data (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', [key, JSON.stringify(value)]);
    return;
  }
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(value, null, 2));
}
async function getContentRevision() {
  if (pool) {
    const result = await pool.query('SELECT EXTRACT(EPOCH FROM updated_at) * 1000 AS revision FROM kasigo_data WHERE key = $1', ['content']);
    return result.rowCount ? Number(result.rows[0].revision) : 0;
  }
  try { return (await fs.promises.stat(contentFile)).mtimeMs; } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
}
async function getContent() {
  try {
    const content = await readStoredJSON('content', contentFile, null);
    if (!content) throw Object.assign(new Error('Content not found.'), { code: 'ENOENT' });
    let changed = false;
    content.settings ||= {};
    for (const [key,value] of Object.entries(seeds.settings)) if (content.settings[key] === undefined) { content.settings[key] = value; changed = true; }
    content.categories ||= [];
    for (const category of seeds.categories) {
      const present = content.categories.find(x => x.slug === category.slug);
      if (!present) { content.categories.push(category); changed = true; }
      else if (!present.subcategories) { present.subcategories = category.subcategories || ({food:['Burgers','Pizza','Chicken','Cafe'],groceries:['Fresh produce','Pantry','Drinks']}[category.slug] || []); changed = true; }
    }
    content.stores ||= [];
    for (const store of content.stores) {
      store.products ||= [];
      for (const product of store.products) if (product.image === undefined) { product.image = ''; changed = true; }
      if (store.logo === undefined) { store.logo = ''; changed = true; }
      if (store.image === undefined) { store.image = ''; changed = true; }
    }
    content.slides ||= structuredClone(seeds.slides);
    if (content.background === undefined) content.background = '';
    if (changed) await writeStoredJSON('content', contentFile, content);
    return content;
  }
  catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await writeStoredJSON('content', contentFile, seeds);
    return structuredClone(seeds);
  }
}
async function readDataArray(file) {
  const value = await readStoredJSON(dataKey(file), file, []);
  return Array.isArray(value) ? value : [];
}
async function writeDataArray(file,value) { await writeStoredJSON(dataKey(file), file, value); }
function verifiedItems(requestItems, content) {
  if (!Array.isArray(requestItems) || requestItems.length > 200) throw new Error('The basket has too many different items.');
  const items=[];
  for(const requested of requestItems){
    const store=content.stores.find(s=>s.slug===requested.storeSlug);
    if(!store||!store.available)throw new Error(`${store?.name||'A store in your basket'} is unavailable. Please remove its items and try again.`);
    const product=(store.products||[]).find(p=>p.name===requested.name);
    if(!product)throw new Error(`${requested.name||'An item'} is no longer listed. Please refresh your basket.`);
    const quantity=Math.floor(Number(requested.quantity));
    if(quantity<1||quantity>99)throw new Error('Item quantity must be between 1 and 99.');
    items.push({storeSlug:store.slug,storeName:store.name,name:product.name,subcategory:product.subcategory||'',price:Number(product.price),quantity});
  }
  return items;
}
async function readBody(req, max = 60 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Request is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function sessionUser(req) { const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kasigo_admin='))?.slice('kasigo_admin='.length);if(!token)return null;const user=adminSessions.get(token);if(user&&Date.now()-user.createdAt>28800000){adminSessions.delete(token);return null;}return user||null; }
function authorized(req) { return Boolean(sessionUser(req)); }
function passwordRecord(password) { const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}).toString('hex')}; }
function passwordMatches(password,user) { try { const actual=crypto.scryptSync(String(password),user.salt,64,{N:16384,r:8,p:1});const expected=Buffer.from(user.hash,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected); } catch { return false; } }
async function getAdminUsers() {
  const value = await readStoredJSON('admin-users', adminUsersFile, []);
  const saved = Array.isArray(value) ? value : [];
  if(saved.length)return saved;
  let initial=[];
  if(process.env.ADMIN_USERS_JSON){try{initial=JSON.parse(process.env.ADMIN_USERS_JSON);}catch{throw new Error('ADMIN_USERS_JSON must be a JSON array of usernames and passwords.');}}
  else if(process.env.ADMIN_PASSWORD)initial=[{username:process.env.ADMIN_USERNAME||'Admin',password:process.env.ADMIN_PASSWORD}];
  if(!Array.isArray(initial))throw new Error('ADMIN_USERS_JSON must be a JSON array.');
  const users=initial.filter(x=>x?.username&&x?.password).map(x=>({username:String(x.username).trim(),...passwordRecord(x.password),active:true,createdAt:new Date().toISOString()}));
  if(users.length){await writeStoredJSON('admin-users',adminUsersFile,users);delete process.env.ADMIN_USERS_JSON;delete process.env.ADMIN_PASSWORD;}
  else if(!saved.length)await writeStoredJSON('admin-users',adminUsersFile,[]);
  return users;
}
async function saveAdminUsers(users){await writeStoredJSON('admin-users',adminUsersFile,users);}
function dateKey(date=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
let analyticsQueue=Promise.resolve();
function recordActivity(body) { const job=analyticsQueue.then(()=>recordActivityLocked(body));analyticsQueue=job.catch(()=>{});return job; }
async function recordActivityLocked(body) {
  const id=String(body.visitorId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(id))return;
  const allowed=new Set(['page_view','service_open','store_open','whatsapp_intent','basket_add','order_submitted']);
  const type=allowed.has(body.type)?body.type:'activity',page=String(body.page||'/').split('?')[0].slice(0,120),day=dateKey();
  let data=await readStoredJSON('analytics',analyticsFile,{days:{},events:[]});
  data.days ||= {};data.events ||= [];const record=data.days[day] ||= {visitors:[],pageViews:0};
  if(!record.visitors.includes(id))record.visitors.push(id);
  if(type==='page_view')record.pageViews++;
  data.events.unshift({at:new Date().toISOString(),type,page});if(data.events.length>5000)data.events.length=5000;
  const cutoff=shiftDateKey(day,-400);for(const key of Object.keys(data.days))if(key<cutoff)delete data.days[key];
  await writeStoredJSON('analytics',analyticsFile,data);
}
function dateFromKey(key){const [y,m,d]=key.split('-').map(Number);return new Date(Date.UTC(y,m-1,d));}
function keyFromDate(date){return date.toISOString().slice(0,10);}
function shiftDateKey(key,days){const date=dateFromKey(key);date.setUTCDate(date.getUTCDate()+days);return keyFromDate(date);}
function analyticsReport(period,data,orders){
  const today=dateKey(),weekStart=shiftDateKey(today,-6),monthStart=`${today.slice(0,7)}-01`,days=data.days||{};
  const uniqueBetween=(from,to)=>new Set(Object.keys(days).filter(k=>k>=from&&k<=to).flatMap(k=>days[k].visitors||[])).size;
  const ordersBetween=(from,to)=>orders.filter(o=>{const key=dateKey(new Date(o.createdAt));return key>=from&&key<=to;});
  let buckets=[];
  if(period==='week'){
    for(let i=11;i>=0;i--){const end=shiftDateKey(today,-(i*7)),start=shiftDateKey(end,-6),keys=[];for(let d=start;d<=end;d=shiftDateKey(d,1))keys.push(d);buckets.push({label:`${start.slice(5)}–${end.slice(5)}`,keys});}
  }else if(period==='month'){
    const [y,m]=today.slice(0,7).split('-').map(Number);for(let i=11;i>=0;i--){const dt=new Date(Date.UTC(y,m-1-i,1)),yy=dt.getUTCFullYear(),mm=String(dt.getUTCMonth()+1).padStart(2,'0'),prefix=`${yy}-${mm}`,keys=Object.keys(days).filter(k=>k.startsWith(prefix));const last=new Date(Date.UTC(yy,dt.getUTCMonth()+1,0)).getUTCDate();for(let n=1;n<=last;n++)keys.push(`${prefix}-${String(n).padStart(2,'0')}`);buckets.push({label:dt.toLocaleString('en',{month:'short',timeZone:'UTC'}),keys:[...new Set(keys)]});}
  }else{
    for(let i=13;i>=0;i--){const key=shiftDateKey(today,-i);buckets.push({label:key.slice(5),keys:[key]});}
  }
  const chart=buckets.map(b=>{const ids=new Set(b.keys.flatMap(k=>days[k]?.visitors||[])),orderRows=orders.filter(o=>b.keys.includes(dateKey(new Date(o.createdAt))));return {label:b.label,visitors:ids.size,pageViews:b.keys.reduce((n,k)=>n+(days[k]?.pageViews||0),0),orders:orderRows.length,whatsappOrders:orderRows.filter(o=>o.source==='WhatsApp checkout').length};});
  const weekOrders=ordersBetween(weekStart,today);
  return {summary:{today:uniqueBetween(today,today),week:uniqueBetween(weekStart,today),month:uniqueBetween(monthStart,today),pageViewsToday:days[today]?.pageViews||0,totalOrdersWeek:weekOrders.length,whatsappOrdersWeek:weekOrders.filter(o=>o.source==='WhatsApp checkout').length,requestsWeek:weekOrders.filter(o=>Boolean(o.requestDetails)).length},chart,activity:(data.events||[]).slice(0,30).map(e=>({at:e.at,type:e.type,page:e.page})),period};
}
function normalizeBusinessWhatsApp(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return digits;
}
function safeContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Website settings are invalid.');
  value.settings ||= {};
  value.settings.whatsapp = normalizeBusinessWhatsApp(value.settings.whatsapp);
  if (value.settings.whatsapp && !/^[1-9]\d{7,14}$/.test(value.settings.whatsapp)) throw new Error('Enter a valid WhatsApp number with its country code, up to 15 digits.');
  const str = JSON.stringify(value);
  if (str.length > 32 * 1024 * 1024) throw new Error('Website content is too large. Please reduce the size or number of uploaded videos.');
  if (value.slides?.length !== 3) throw new Error('Keep exactly three homepage slides.');
  const checkMedia = img => {
    if (!img) return;
    const match = /^data:(image\/(png|jpeg|webp)|video\/(mp4|webm));base64,([A-Za-z0-9+/=]+)$/.exec(img);
    if (!match || match[4].length > 7 * 1024 * 1024) throw new Error('Use a PNG, JPEG, WebP, MP4 or WebM file under 5 MB.');
  };
  checkMedia(value.background); value.slides.forEach(s => checkMedia(s.image));
  if (value.settings?.logo) {
    checkMedia(value.settings.logo);
    if (!value.settings.logo.startsWith('data:image/')) throw new Error('The website logo must be an image.');
  }
  if (!Array.isArray(value.categories) || !Array.isArray(value.stores)) throw new Error('Categories and stores are required.');
   for (const store of value.stores) { checkMedia(store.logo); checkMedia(store.image); if(store.image&&!store.image.startsWith('data:image/'))throw new Error('Store cover photos must be PNG, JPEG or WebP images.'); for (const product of store.products || []) { checkMedia(product.image); if (!product.name || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) throw new Error('Every product needs a name and a valid price.'); } }
  return value;
}
const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return send(res, 400, 'Bad request'); }
  if (pathname.startsWith('/api/')) {
    if (req.method === 'GET' && pathname === '/api/content') {
      const content = await getContent();
      content._revision = await getContentRevision();
      return json(res, 200, content);
    }
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      let body; try { body = await readBody(req, 3000); } catch { return json(res, 400, { error: 'Could not read login details.' }); }
      let users;try{users=await getAdminUsers();}catch(err){return json(res,503,{error:err.message});}
      if(!users.length)return json(res,503,{error:'No admin users are configured. Set ADMIN_USERS_JSON, or set ADMIN_PASSWORD for a first admin.'});
      const user=users.find(x=>x.active!==false&&String(x.username).toLowerCase()===String(body.username||'').trim().toLowerCase());
      if(!user||!passwordMatches(body.password||'',user))return json(res,401,{error:'Username or password did not match.'});
      const token=crypto.randomBytes(32).toString('hex');adminSessions.set(token,{username:user.username,createdAt:Date.now()});
      return json(res,200,{ok:true,username:user.username},{'Set-Cookie':`kasigo_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`});
    }
    if(pathname==='/api/analytics'&&req.method==='POST'){try{const body=await readBody(req,3000);await recordActivity(body);return json(res,202,{ok:true});}catch{return json(res,400,{error:'Could not record activity.'});}}
    if (pathname.startsWith('/api/admin/') && !authorized(req)) return json(res, 401, { error: 'Please sign in to the admin area.' });
    if (req.method === 'POST' && pathname === '/api/admin/logout') { const user=sessionUser(req);const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kasigo_admin='))?.slice('kasigo_admin='.length);if(token)adminSessions.delete(token);return json(res, 200, { ok: true, username:user?.username }, { 'Set-Cookie': 'kasigo_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
    if(req.method==='GET'&&pathname==='/api/admin/session')return json(res,200,{username:sessionUser(req)?.username||''});
    if(req.method==='GET'&&pathname==='/api/admin/users'){const users=await getAdminUsers();return json(res,200,{users:users.map(({username,active,createdAt})=>({username,active:active!==false,createdAt}))});}
    if(req.method==='POST'&&pathname==='/api/admin/users'){
      try{const body=await readBody(req,5000),username=String(body.username||'').trim(),password=String(body.password||'');if(!/^[A-Za-z0-9._-]{2,40}$/.test(username))throw new Error('Username must be 2–40 letters, numbers, dots, dashes or underscores.');if(password.length<10||password.length>128)throw new Error('Use a password between 10 and 128 characters.');const users=await getAdminUsers();if(users.some(u=>u.username.toLowerCase()===username.toLowerCase()))throw new Error('That username already exists.');const record=passwordRecord(password);users.push({username,...record,active:true,createdAt:new Date().toISOString()});await saveAdminUsers(users);return json(res,201,{ok:true});}catch(err){return json(res,400,{error:err.message||'Could not add the admin user.'});}
    }
    if(req.method==='PUT'&&pathname==='/api/admin/users'){
      try{const body=await readBody(req,5000),users=await getAdminUsers(),user=users.find(u=>u.username===body.username),signedInAs=sessionUser(req)?.username;if(!user)throw new Error('Admin user not found.');if(body.password!==undefined){const password=String(body.password);if(password.length<10||password.length>128)throw new Error('Use a password between 10 and 128 characters.');Object.assign(user,passwordRecord(password));for(const [token,session] of adminSessions)if(session.username===user.username)adminSessions.delete(token);}if(body.active!==undefined){if(body.active===false&&signedInAs===user.username)throw new Error('You cannot deactivate the account currently signed in.');if(body.active===false&&users.filter(u=>u.active!==false).length<2)throw new Error('Keep at least one active admin account.');user.active=Boolean(body.active);if(!user.active)for(const [token,session] of adminSessions)if(session.username===user.username)adminSessions.delete(token);}await saveAdminUsers(users);return json(res,200,{ok:true,reauthRequired:body.password!==undefined&&signedInAs===user.username});}catch(err){return json(res,400,{error:err.message||'Could not update this admin user.'});}
    }
    if (req.method === 'GET' && pathname === '/api/admin/content') return json(res, 200, await getContent());
    if (req.method === 'PUT' && pathname === '/api/admin/content') {
      try { const content = safeContent(await readBody(req)); await writeStoredJSON('content',contentFile,content); return json(res, 200, { ok: true }); }
      catch (err) { return json(res, 400, { error: err.message || 'Could not save site content.' }); }
    }
    if (req.method === 'POST' && pathname === '/api/carts') {
      try {
        const body = await readBody(req, 1500000);
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.clientId || '')) throw new Error('This cart needs a valid browser session. Refresh and try again.');
        const content = await getContent();
        const items = verifiedItems(body.items || [], content);
        const carts = await readDataArray(cartsFile);
        const idx = carts.findIndex(c => c.clientId === body.clientId);
        if (!items.length) { if (idx >= 0) carts.splice(idx, 1); }
        else {
          const cart = { clientId: body.clientId, phone: String(body.phone || '').slice(0,40), items, subtotal: items.reduce((n,x)=>n+x.price*x.quantity,0), updatedAt: new Date().toISOString() };
          if (idx >= 0) carts[idx] = cart; else carts.push(cart);
        }
        await writeDataArray(cartsFile, carts);
        return json(res, 200, { ok: true, items: items, subtotal: items.reduce((n,x)=>n+x.price*x.quantity,0) });
      } catch (err) { return json(res, 400, { error: err.message || 'Could not update the basket.' }); }
    }
    if (req.method === 'POST' && pathname === '/api/orders') {
      try {
        const body = await readBody(req, 1500000);
        const customer = body.customer || {};
        if (!String(customer.name || '').trim() || !String(customer.phone || '').trim()) throw new Error('Enter your name and WhatsApp number to continue.');
        const content = await getContent();
        const items = verifiedItems(body.items || [], content);
        const details = String(body.requestDetails || '').slice(0, 12000);
        if (!items.length && !details) throw new Error('Your request is empty. Add an item or delivery details.');
        const orders = await readDataArray(ordersFile);
        const day = new Date().toISOString().slice(0,10).replaceAll('-','');
        const seq = orders.filter(o => o.orderId.startsWith(`KG-${day}-`)).length + 1;
        const itemSubtotal = items.reduce((n,x)=>n+x.price*x.quantity,0);
        const order = { orderId:`KG-${day}-${String(seq).padStart(5,'0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, createdAt:new Date().toISOString(), clientId:String(body.clientId||'').slice(0,80), customer:{name:String(customer.name).trim().slice(0,100),phone:String(customer.phone).trim().slice(0,40),address:String(customer.address||'').trim().slice(0,500)}, items, itemSubtotal, deliveryFee:null, amountPaid:0, paymentStatus:'Not paid online', totalDue:null, status:'New', source:body.source==='whatsapp'?'WhatsApp checkout':'Website checkout', requestDetails:details };
        orders.unshift(order);
        await writeDataArray(ordersFile, orders);
        await recordActivity({visitorId:body.visitorId,type:'order_submitted',page:body.source==='whatsapp'?'/checkout/whatsapp':'/checkout/website'}).catch(()=>{});
        const carts = (await readDataArray(cartsFile)).filter(c => c.clientId !== body.clientId);
        await writeDataArray(cartsFile,carts);
        return json(res, 201, { ok:true, order });
      } catch (err) { return json(res, 400, { error: err.message || 'Could not submit this order.' }); }
    }
    if (req.method === 'GET' && pathname === '/api/admin/analytics') { const data=await readStoredJSON('analytics',analyticsFile,{days:{},events:[]});const period=new URL(req.url,'http://localhost').searchParams.get('period');return json(res,200,analyticsReport(['day','week','month'].includes(period)?period:'day',data,await readDataArray(ordersFile))); }
    if (req.method === 'GET' && pathname === '/api/admin/orders') return json(res, 200, { orders: await readDataArray(ordersFile), carts: await readDataArray(cartsFile) });
    if (req.method === 'PUT' && pathname === '/api/admin/orders') {
      try {
        const body=await readBody(req,10000), orders=await readDataArray(ordersFile), order=orders.find(o=>o.orderId===body.orderId);
        if(!order)throw new Error('Order not found.');
        if(body.status)order.status=String(body.status).slice(0,60);
        if(body.deliveryFee!==undefined){const fee=body.deliveryFee===''?null:Number(body.deliveryFee);if(fee!==null&&(!Number.isFinite(fee)||fee<0))throw new Error('Delivery fee must be a non-negative number.');order.deliveryFee=fee;order.totalDue=fee===null?null:order.itemSubtotal+fee;}
        if(body.amountPaid!==undefined){const paid=Number(body.amountPaid);if(!Number.isFinite(paid)||paid<0)throw new Error('Amount paid must be a non-negative number.');order.amountPaid=paid;order.paymentStatus=paid>0?'Payment recorded by admin':'Not paid online';}
        await writeDataArray(ordersFile,orders);return json(res,200,{ok:true,order});
      }catch(err){return json(res,400,{error:err.message||'Could not update order.'});}
    }
    return json(res, 404, { error: 'Not found.' });
  }
  const file = path.resolve(root, pathname === '/' || !path.extname(pathname) ? 'index.html' : `.${pathname}`);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(res, 200, data, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  });
});
initDatabase().then(() => server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`KasiGo is ready on port ${process.env.PORT || 3000}${pool ? ' (PostgreSQL)' : ' (local JSON storage)'}`))).catch(err => { console.error('KasiGo could not start:', err.message); process.exit(1); });
