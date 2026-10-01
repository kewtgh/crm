// Only the isolated browser fixture uses this adapter, never production imports.
export function useSearchParams(){return new URLSearchParams(window.location.search);}
