import { init, startRun, endRun, upsertProduct, markInactive, close } from './store.js';

export const ORIGIN = 'https://vibecodinguniv.cafe24.com';
// Category-card photographs are refreshed on every collection.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replace(/&#(\d+);/g, (_,n)=>String.fromCharCode(Number(n)));
const text = html => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
const attribute = (html, property) => new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i').exec(html)?.slice(1).find(Boolean);
const absolute = value => value ? new URL(decode(value), ORIGIN).href : null;

async function fetchPage(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'VibecodingProductMonitor/1.0 (public catalog monitor)' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}
function navigationCategories(home) {
  const found = [...home.matchAll(/<a\b[^>]*href=["'](\/category\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([,href,label])=>({ url:absolute(href), name:text(label) }))
    .filter(x=>x.name && x.name.length < 40 && !/고객센터|community/i.test(x.name));
  return [...new Map(found.map(x=>[x.url,x])).values()];
}
function productUrls(categoryHtml) {
  const hits=[...categoryHtml.matchAll(/href=["']([^"']*\/product\/[^"']+?\/(\d+)(?:\/[^"']*)?)["']/gi)];
  const products = hits.map(([,url,id])=>({id, url:absolute(url)}));
  return [...new Map(products.map(x=>[x.id,x])).values()];
}
function categoryPhotoMap(html) {
  const photos=[...html.matchAll(/<div class=["']thumbnail["']>\s*<a[^>]+href=["'][^"']*\/product\/[^"']+?\/(\d+)\/[^"']*["'][^>]*>\s*<img src=["']([^"']+)["']/gi)]
    .map(([,id,image])=>[id,absolute(image)])
    .filter(([,image])=>image&&/ecimg\.cafe24img\.com/i.test(image));
  return new Map(photos);
}
async function listedPhotoMap() {
  const categoryNumbers=Array.from({length:31},(_,index)=>index+50);
  const pages=await Promise.all(categoryNumbers.map(async number=>{try{return await fetchPage(`${ORIGIN}/product/list.html?cate_no=${number}`);}catch{return '';}));
  return new Map(pages.flatMap(page=>[...categoryPhotoMap(page)]));
}
function extractDetail(html, category, fallback) {
  const id = /\/product\/[^/]+\/(\d+)/.exec(fallback.url)?.[1] ?? fallback.id;
  const rawTitle=attribute(html,'og:title') ?? '';
  const name=decode(rawTitle.replace(/\s*-\s*바이브코딩대학\s*$/,'').trim()) || `상품 ${id}`;
  const price=Number((attribute(html,'product:price:amount') ?? '0').replace(/[^0-9]/g,'')) || null;
  const detailImage=absolute(attribute(html,'og:image') ?? html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1]);
  const image=fallback.image ?? (detailImage&&!/\/SkinImg\/img\/ico_/i.test(detailImage)?detailImage:null);
  const area=html.match(/<div\b[^>]*id=["']prdDetail["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? '';
  const description=text(area).slice(0,2000) || null;
  // Cafe24 keeps a hidden "품절" button in every template, so only trust its product-state variables.
  const soldOut=/(?:is_soldout_icon|is_soldout)\s*=\s*['\"]T['\"]/i.test(html);
  return {id,name,url:fallback.url,image,category,price,salePrice:null,soldOut,description};
}
export async function collect(onProgress=()=>{}) {
  await init(); const runId=await startRun(); let scanned=0,added=0,changed=0; const seen=[];
  try {
    const home=await fetchPage(`${ORIGIN}/`); const categories=navigationCategories(home);
    if (!categories.length) throw new Error('홈페이지에서 카테고리를 찾지 못했습니다.');
    // 홈에만 노출되는 추천 상품도 포함합니다. 이후 정식 카테고리 상품은 카테고리명이 덮어씁니다.
    const unique = new Map(productUrls(home).map(item => [item.id, { ...item, category: '기타 상품' }]));
    for (const category of categories) {
      onProgress({stage:'category',category:category.name});
      const list=await fetchPage(category.url); for (const item of productUrls(list)) unique.set(item.id,{...item,category:category.name}); await delay(250);
    }
    // 실제 상품 사진은 상세 페이지가 아니라 하위 카테고리 카드에 제공됩니다.
    const photos=await listedPhotoMap();
    for (const [id,image] of photos) { const existing=unique.get(id); if (existing) unique.set(id,{...existing,image}); }
    const items=[...unique.values()];
    // 서버리스 실행 제한 안에서 끝나도록 소규모 병렬 수집을 사용합니다.
    const concurrency=5; let cursor=0;
    async function worker() {
      while (true) {
        const index=cursor++; if (index>=items.length) return;
        const item=items[index]; scanned++; onProgress({stage:'product',scanned,total:items.length,name:item.id});
        try { const status=await upsertProduct(extractDetail(await fetchPage(item.url),item.category,item)); if(status==='added')added++; if(status==='changed')changed++; seen.push(item.id); }
        catch(error) { console.error('상품 수집 실패', item.url, error.message); }
        await delay(50);
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
    await markInactive(seen); const result={status:'success',scanned,added,changed}; await endRun(runId,result); return result;
  } catch(error) { const result={status:'failed',scanned,added,changed,error:error.message}; await endRun(runId,result); throw error; }
}












































































































































