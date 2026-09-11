import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(root, 'data', 'products.json');
let pool;
let local;

async function getLocal() {
  if (local) return local;
  try { local = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { local = { products: [], history: [], runs: [] }; }
  return local;
}
async function saveLocal() {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(local, null, 2));
}
function same(a, b) {
  return ['name','price','salePrice','image','category','soldOut','description'].every(k => (a[k] ?? null) === (b[k] ?? null));
}
export async function init() {
  if (!process.env.DATABASE_URL) { await getLocal(); return; }
  const { Pool } = await import('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, image TEXT, category TEXT,
    price INTEGER, sale_price INTEGER, sold_out BOOLEAN DEFAULT FALSE, description TEXT,
    active BOOLEAN DEFAULT TRUE, first_seen_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS product_history (
    id BIGSERIAL PRIMARY KEY, product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, before_data JSONB, after_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS crawl_runs (
    id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ, status TEXT, scanned_count INTEGER DEFAULT 0, new_count INTEGER DEFAULT 0, changed_count INTEGER DEFAULT 0, error_message TEXT
  );`);
}
export async function startRun() {
  if (pool) return (await pool.query(`INSERT INTO crawl_runs(status) VALUES ('running') RETURNING id`)).rows[0].id;
  const db = await getLocal(); const run = { id: Date.now(), startedAt: new Date().toISOString(), status: 'running', scannedCount: 0, newCount: 0, changedCount: 0 }; db.runs.unshift(run); await saveLocal(); return run.id;
}
export async function endRun(id, result) {
  if (pool) { await pool.query(`UPDATE crawl_runs SET finished_at=NOW(), status=$2, scanned_count=$3, new_count=$4, changed_count=$5, error_message=$6 WHERE id=$1`, [id, result.status, result.scanned, result.added, result.changed, result.error ?? null]); return; }
  const db = await getLocal(); const run = db.runs.find(x=>x.id===id); Object.assign(run, { finishedAt:new Date().toISOString(), ...result, scannedCount:result.scanned, newCount:result.added, changedCount:result.changed }); await saveLocal();
}
export async function upsertProduct(input) {
  const now = new Date().toISOString();
  if (pool) {
    const previous = (await pool.query('SELECT * FROM products WHERE id=$1', [input.id])).rows[0];
    const changed = previous && !same({ ...previous, salePrice: previous.sale_price }, input);
    await pool.query(`INSERT INTO products (id,name,url,image,category,price,sale_price,sold_out,description,active,last_seen_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET name=$2,url=$3,image=$4,category=$5,price=$6,sale_price=$7,sold_out=$8,description=$9,active=true,last_seen_at=NOW(),updated_at=CASE WHEN products.name IS DISTINCT FROM $2 OR products.price IS DISTINCT FROM $6 OR products.sale_price IS DISTINCT FROM $7 OR products.sold_out IS DISTINCT FROM $8 THEN NOW() ELSE products.updated_at END`,
      [input.id,input.name,input.url,input.image,input.category,input.price,input.salePrice,input.soldOut,input.description]);
    if (!previous || changed) await pool.query(`INSERT INTO product_history(product_id,event_type,before_data,after_data) VALUES($1,$2,$3,$4)`, [input.id, previous ? 'updated' : 'created', previous ? JSON.stringify(previous) : null, JSON.stringify(input)]);
    return previous ? (changed ? 'changed' : 'unchanged') : 'added';
  }
  const db = await getLocal(); const index = db.products.findIndex(x=>x.id===input.id); const previous = db.products[index];
  const event = !previous ? 'added' : (same(previous,input) ? 'unchanged' : 'changed');
  const record = { ...previous, ...input, active:true, firstSeenAt:previous?.firstSeenAt ?? now, lastSeenAt:now, updatedAt:event==='changed'||event==='added'?now:previous.updatedAt };
  if (previous) db.products[index] = record; else db.products.push(record);
  if (event !== 'unchanged') db.history.unshift({ id:`${input.id}-${Date.now()}`, productId:input.id, eventType:event, before:previous ?? null, after:record, createdAt:now });
  await saveLocal(); return event;
}
export async function markInactive(seenIds) {
  if (pool) { await pool.query(`UPDATE products SET active=false WHERE active=true AND NOT (id = ANY($1))`, [seenIds]); return; }
  const db = await getLocal(); db.products.forEach(p=>{ if (!seenIds.includes(p.id)) p.active=false; }); await saveLocal();
}
export async function listProducts({ q='', category='', state='' }={}) {
  if (pool) {
    const args=[]; let where='WHERE 1=1'; if(q){args.push(`%${q}%`); where += ` AND name ILIKE $${args.length}`;} if(category){args.push(category);where += ` AND category=$${args.length}`;} if(state==='soldout')where+=' AND sold_out=true'; if(state==='available')where+=' AND sold_out=false AND active=true'; if(state==='inactive')where+=' AND active=false';
    const rows=(await pool.query(`SELECT id,name,url,image,category,price,sale_price AS "salePrice",sold_out AS "soldOut",description,active,first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",updated_at AS "updatedAt" FROM products ${where} ORDER BY updated_at DESC`,args)).rows; return rows;
  }
  const db=await getLocal(); const needle=q.toLowerCase(); return db.products.filter(p=>(!needle||p.name.toLowerCase().includes(needle))&&(!category||p.category===category)&&(!state||(state==='soldout'?p.soldOut:state==='available'?!p.soldOut&&p.active:!p.active))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function summary() {
  if(pool) { const s=(await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active AND NOT sold_out)::int AS available, COUNT(*) FILTER (WHERE sold_out)::int AS soldout, MAX(last_seen_at) AS last_seen FROM products`)).rows[0]; const r=(await pool.query(`SELECT id,started_at AS "startedAt",finished_at AS "finishedAt",status,scanned_count AS scanned,"new_count" AS added,changed_count AS changed,error_message AS error FROM crawl_runs ORDER BY id DESC LIMIT 1`)).rows[0]; return {...s, lastRun:r}; }
  const db=await getLocal(); const active=db.products.filter(p=>p.active); return {total:db.products.length,available:active.filter(p=>!p.soldOut).length,soldout:db.products.filter(p=>p.soldOut).length,last_seen:db.products.map(p=>p.lastSeenAt).sort().at(-1)??null,lastRun:db.runs[0]??null};
}
export async function close() { if(pool) await pool.end(); }
