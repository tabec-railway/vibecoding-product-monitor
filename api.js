import { json,isAdmin,body,cronAuthorized } from './http.js';
import { init,listProducts,summary,analytics,readProductCsv } from './store.js';
import { collect } from './collector.js';
let activeCollection;
async function runCollection(trigger){if(!activeCollection)activeCollection=collect({trigger}).finally(()=>{activeCollection=undefined;});return activeCollection;}
export default async function handler(request,response){const url=new URL(request.url,`https://${request.headers.host||'localhost'}`);const route=url.pathname;
 if(route==='/api/auth')return json(response,200,{required:Boolean(process.env.ADMIN_TOKEN),authorized:isAdmin(request)});
 if(route==='/api/login'){if(request.method!=='POST')return json(response,405,{error:'Method not allowed'});const {token}=await body(request);if(process.env.ADMIN_TOKEN&&token!==process.env.ADMIN_TOKEN)return json(response,401,{error:'비밀번호가 맞지 않습니다.'});return json(response,200,{ok:true},{'set-cookie':`monitor_token=${encodeURIComponent(token??'')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`});}
 if(route==='/api/logout')return json(response,200,{ok:true},{'set-cookie':'monitor_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
 const cron=route==='/api/collect'&&request.method==='GET';if(cron?!cronAuthorized(request):!isAdmin(request))return json(response,401,{error:'Unauthorized'});
 if(route==='/api/products'){await init();return json(response,200,await listProducts({q:url.searchParams.get('q')??'',category:url.searchParams.get('category')??'',state:url.searchParams.get('state')??'',page:url.searchParams.get('page')??1,pageSize:url.searchParams.get('pageSize')??50}));}
 if(route==='/api/summary'){await init();return json(response,200,{...(await summary()),collecting:Boolean(activeCollection)});}
 if(route==='/api/analytics'){await init();return json(response,200,await analytics(url.searchParams.get('productId')??undefined));}
 if(route==='/api/export/products.csv'){const content=await readProductCsv();response.statusCode=200;response.setHeader('content-type','text/csv; charset=utf-8');response.setHeader('content-disposition','attachment; filename="product.csv"');return response.end('\uFEFF'+content);}
 if(route==='/api/collect'){try{return json(response,200,{ok:true,...await runCollection(cron?'railway-cron':'manual')});}catch(error){return json(response,500,{error:error.message});}}
 return json(response,404,{error:'Not found'});
}
