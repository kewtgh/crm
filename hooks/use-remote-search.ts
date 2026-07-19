"use client";

import { useCallback, useEffect, useRef } from "react";

export type LatestRequestResult<T>=
  |{current:true;value:T}
  |{current:true;error:unknown}
  |{current:false};

export function useRemoteSearch(){
  const active=useRef<{sequence:number;controller:AbortController}|null>(null);
  const sequence=useRef(0);

  useEffect(()=>()=>active.current?.controller.abort(),[]);

  return useCallback(async<T>(
    operation:(signal:AbortSignal)=>Promise<T>,
  ):Promise<LatestRequestResult<T>>=>{
    active.current?.controller.abort();
    const controller=new AbortController();
    const request={sequence:++sequence.current,controller};
    active.current=request;
    try{
      const value=await operation(controller.signal);
      return active.current?.sequence===request.sequence&&!controller.signal.aborted
        ?{current:true,value}
        :{current:false};
    }catch(error){
      return active.current?.sequence===request.sequence&&!controller.signal.aborted
        ?{current:true,error}
        :{current:false};
    }
  },[]);
}
