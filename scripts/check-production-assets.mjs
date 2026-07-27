const base=(process.env.APP_URL??"http://127.0.0.1:3200").replace(/\/$/,"");
const pages=["/login","/privacy"];
const references=new Set();
const htmlByRoute=new Map();

for(const route of pages){
  const response=await fetch(`${base}${route}`,{signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`${route} returned ${response.status}`);
  const html=await response.text();
  htmlByRoute.set(route,html);
  for(const match of html.matchAll(/(?:src|href)=["']([^"'?#]+)(?:[?#][^"']*)?["']/gi)){
    const target=new URL(match[1],base);
    if(
      target.origin===new URL(base).origin
      && /^\/(?:assets\/|_next\/static\/)/.test(target.pathname)
      && /\.(?:css|js|mjs)$/.test(target.pathname)
    )references.add(target.toString());
  }
}

if(!references.size)throw new Error("Production HTML did not reference any local CSS/JS build resources");
const failures=[];
for(const url of references){
  const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(10_000)});
  const contentType=(response.headers.get("content-type")??"").toLowerCase();
  const expected=url.includes(".css")?"text/css":url.match(/\.(?:js|mjs)(?:$|\?)/)?"javascript":null;
  if(!response.ok||contentType.includes("text/html")||(expected&&!contentType.includes(expected))){
    failures.push({url:url.replace(base,""),status:response.status,contentType});
  }
}
if(failures.length)throw new Error(`Invalid production assets: ${JSON.stringify(failures)}`);

const expectedImages=[
  {path:"/brand/weiai-logo-800x240.png",width:800,height:240},
  {path:"/favicon-16x16.png",width:16,height:16},
  {path:"/favicon-32x32.png",width:32,height:32},
  {path:"/favicon-192x192.png",width:192,height:192},
  {path:"/og-v270.png",width:1728,height:910},
];
const combinedHtml=[...htmlByRoute.values()].join("\n");
for(const asset of expectedImages){
  const htmlReferences=[asset.path.slice(1),encodeURIComponent(asset.path)];
  if(!htmlReferences.some(reference=>combinedHtml.includes(reference))){
    throw new Error(`Production HTML does not reference ${asset.path}`);
  }
  const response=await fetch(`${base}${asset.path}`,{signal:AbortSignal.timeout(10_000)});
  const contentType=(response.headers.get("content-type")??"").toLowerCase();
  const buffer=Buffer.from(await response.arrayBuffer());
  const png=buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const width=png?buffer.readUInt32BE(16):0;
  const height=png?buffer.readUInt32BE(20):0;
  if(!response.ok||!contentType.includes("image/png")||!png||width!==asset.width||height!==asset.height){
    throw new Error(`Invalid brand asset ${asset.path}: status=${response.status} contentType=${contentType} png=${png} dimensions=${width}x${height}`);
  }
}
const legacy=await fetch(`${base}/favicon.ico`,{redirect:"manual",signal:AbortSignal.timeout(10_000)});
if(legacy.status!==308||new URL(legacy.headers.get("location")??"",base).pathname!=="/favicon-32x32.png"){
  throw new Error(`Legacy favicon redirect is invalid: status=${legacy.status} location=${legacy.headers.get("location")??""}`);
}
process.stdout.write(`Validated ${references.size} production CSS/JS assets, ${expectedImages.length} PNG brand assets, metadata references, and the legacy favicon redirect.\n`);
