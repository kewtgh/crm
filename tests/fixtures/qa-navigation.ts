// Only isolated browser fixtures use this adapter, never production imports.
const router={push:(url:string)=>window.history.pushState({},"",url),replace:(url:string)=>window.history.replaceState({},"",url),refresh:()=>undefined};
export function useSearchParams(){return new URLSearchParams(window.location.search);}
export function usePathname(){return window.location.pathname;}
export function useRouter(){return router;}
