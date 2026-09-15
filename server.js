import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{if(req.url.startsWith('/api/'))return handler(req,res);const file=staticFiles[new URL(req.url,'http://localhost').pathname];if(!file){res.statusCode=404;return res.end('Not found');}const ext=path.extname(file);res.statusCode=200;res.setHeader('content-type',mime[ext]||'application/octet-stream');res.end(await fs.readFile(path.join(root,file)));}catch(error){console.error(error);if(!res.headersSent){res.statusCode=500;res.setHeader('content-type','application/json; charset=utf-8');}res.end(JSON.stringify({error:error.message}));}});
function nextRun(){const kst=new Date(Date.now()+9*3600e3),y=kst.getUTCFullYear(),m=kst.getUTCMonth(),d=kst.getUTCDate(),h=kst.getUTCHours();const nextHour=h%3===0?h+3:h+(3-h%3);return new Date(Date.UTC(y,m,d,nextHour)-9*3600e3);}
function schedule(){const target=nextRun(),wait=Math.max(1000,target-Date.now());console.log(`Next 3-hour crawl: ${target.toISOString()} (KST ${target.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})})`);setTimeout(async()=>{try{const r=await fetch(`http://127.0.0.1:${port}/api/collect`,{headers:{authorization:`Bearer ${process.env.CRON_SECRET||''}`}});console.log('Scheduled crawl',r.status,await r.text());}catch(e){console.error('Scheduled crawl failed',e.message);}schedule();},wait);}
server.listen(port,()=>{console.log(`Product monitor listening on ${port}`);if(process.env.ENABLE_SCHEDULER!=='false')schedule();});
