import {useMemo,useSyncExternalStore} from "react";
const subscribe=(notify:()=>void)=>{window.addEventListener("popstate",notify);return()=>window.removeEventListener("popstate",notify);};
export function qaNavigate(href:string){window.history.pushState({},"",href);window.dispatchEvent(new PopStateEvent("popstate"));}
const router={push:qaNavigate,replace:(href:string)=>{window.history.replaceState({},"",href);window.dispatchEvent(new PopStateEvent("popstate"));},refresh:()=>undefined};
export function usePathname(){return useSyncExternalStore(subscribe,()=>window.location.pathname);}
export function useSearchParams(){const search=useSyncExternalStore(subscribe,()=>window.location.search);return useMemo(()=>new URLSearchParams(search),[search]);}
export function useRouter(){return router;}
