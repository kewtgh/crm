// Isolated browser fixture adapter; never used by product code.
export function useSearchParams(){return new URLSearchParams(window.location.search);}
export function usePathname(){return window.location.pathname;}
export function useRouter(){return{replace:(href:string)=>window.history.replaceState(null,"",href),push:(href:string)=>window.history.pushState(null,"",href),refresh:()=>{}};}
