const base=(process.env.APP_URL??"http://127.0.0.1:3200").replace(/\/$/,"");
const pages=["/login","/privacy"];
const references=new Set();

for(const route of pages){
  const response=await fetch(`${base}${route}`,{signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`${route} returned ${response.status}`);
  const html=await response.text();
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
process.stdout.write(`Validated ${references.size} production CSS/JS assets with correct status and MIME.\n`);
