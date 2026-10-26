import {mkdir,rm} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {build} from "esbuild";

/** Executes the actual hook with controlled hook cells, requests and debounce time.
 * This is a unit scheduling adapter, not a React renderer or browser substitute. */
export async function globalSearchHookHarness(context){
 const output=path.resolve("work/v380-search-hook/hook.cjs");await mkdir(path.dirname(output),{recursive:true});
 const adapter=`let runtime;export const setRuntime=value=>{runtime=value;};export const useState=(...args)=>runtime.useState(...args);export const useRef=(...args)=>runtime.useRef(...args);export const useCallback=(...args)=>runtime.useCallback(...args);export const useEffect=(...args)=>runtime.useEffect(...args);export const apiFetch=(...args)=>runtime.fetch(...args);`;
 await build({stdin:{contents:`export {useGlobalSearch} from './hooks/use-global-search';export {setRuntime} from 'search-hook-adapter';`,resolveDir:process.cwd(),loader:"ts"},outfile:output,bundle:true,format:"cjs",platform:"node",packages:"external",logLevel:"silent",plugins:[{name:"controlled-search-runtime",setup(builder){
  builder.onResolve({filter:/^(react|search-hook-adapter|@\/lib\/api-client)$/},()=>({path:"adapter",namespace:"search-test"}));
  builder.onLoad({filter:/.*/,namespace:"search-test"},()=>({contents:adapter,loader:"js"}));
 }}]});
 const require=createRequire(import.meta.url);delete require.cache[output];const {useGlobalSearch,setRuntime}=require(output);
 const cells=[],effects=[],timers=new Map(),requests=[];let cursor=0,now=0,nextTimer=0,currentContext="ADMIN";
 const changed=(previous,next)=>!previous||previous.length!==next.length||previous.some((value,index)=>!Object.is(value,next[index]));
 const runtime={
  useState(initial){const index=cursor++;if(!cells[index])cells[index]={value:typeof initial==="function"?initial():initial};const cell=cells[index];return[cell.value,next=>{cell.value=typeof next==="function"?next(cell.value):next;}];},
  useRef(initial){const index=cursor++;return cells[index]??(cells[index]={current:initial});},
  useCallback(callback,deps){const index=cursor++;if(changed(cells[index]?.deps,deps))cells[index]={deps,value:callback};return cells[index].value;},
  useEffect(effect,deps){const index=cursor++,previous=cells[index];if(changed(previous?.deps,deps)){const cell={deps,cleanup:previous?.cleanup};cells[index]=cell;effects.push(()=>{cell.cleanup?.();cell.cleanup=effect();});}},
  fetch(url,{signal}){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({url,signal,resolve,reject});return promise;},
 };
 const hadWindow=Object.hasOwn(globalThis,"window"),originalWindow=globalThis.window;
 globalThis.window={setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{at:now+delay,callback});return id;},clearTimeout(id){timers.delete(id);}};
 function useSnapshot({commit=true,identity=currentContext}={}){currentContext=identity;cursor=0;setRuntime(runtime);const snapshot=useGlobalSearch(identity);if(commit)while(effects.length)effects.shift()();return snapshot;}
 async function settle(){for(let index=0;index<8;index++)await Promise.resolve();}
 async function tick(milliseconds=200){now+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);void timer.callback();}await settle();}
 context.after(async()=>{for(const cell of cells)cell?.cleanup?.();timers.clear();for(const request of requests)request.reject(new Error("FICTIONAL_TEST_DISPOSED"));await settle();if(hadWindow)globalThis.window=originalWindow;else delete globalThis.window;delete require.cache[output];await rm(output,{force:true});});
 return{render:useSnapshot,tick,settle,requests};
}
