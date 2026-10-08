/** A receipt binds exact bytes to one intention until its outcome is known. */
export function createReceiptAttempt(newKey:()=>string=()=>crypto.randomUUID()) {
  let body:string|undefined;
  return {
    prepare(payload:Record<string,unknown>) { return body??=(JSON.stringify({...payload,requestKey:newKey()})); },
    clear() {body=undefined;},
  };
}
