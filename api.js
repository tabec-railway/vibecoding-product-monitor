import { json, isAdmin, body, cronAuthorized } from './http.js';
import { init, listProducts, summary, close } from './store.js';
import { collect } from './collector.js';

export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const path = url.pathname;
  if (path === '/api/auth') return json(response, 200, { required: Boolean(process.env.ADMIN_TOKEN), authorized: isAdmin(request) });
  if (path === '/api/login') {
    if (request.method !== 'POST') return json(response,405,{error:'Method not allowed'});
    const { token } = await body(request); if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) return json(response,401,{error:'비밀번호가 맞지 않습니다.'});
    return json(response,200,{ok:true},{'set-cookie':`monitor_token=${encodeURIComponent(token ?? '')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`});
  }
  if (path === '/api/logout') return json(response,200,{ok:true},{'set-cookie':'monitor_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
  if (!isAdmin(request) && path !== '/api/collect') return json(response,401,{error:'관리자 로그인이 필요합니다.'});
  if (path === '/api/products') { await init(); return json(response,200,await listProducts({q:url.searchParams.get('q')??'',category:url.searchParams.get('category')??'',state:url.searchParams.get('state')??''})); }
  if (path === '/api/summary') { await init(); return json(response,200,{...(await summary()),collecting:false,progress:null}); }
  if (path === '/api/collect') {
    const cron = request.method === 'GET'; if (cron ? !cronAuthorized(request) : !isAdmin(request)) return json(response,401,{error:'Unauthorized'});
    try { return json(response,200,{ok:true,...await collect()}); } catch (error) { return json(response,500,{error:error.message}); } finally { await close(); }
  }
  return json(response,404,{error:'Not found'});
}
