"use client";

export default function GlobalError({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <html lang="zh-CN"><body><main className="boundary-page"><section className="surface data-state" role="alert"><div><h1>Lumina CRM 暂时无法显示</h1><p>页面发生未预期错误。请重试；如问题持续，请联系管理员并提供当前时间。</p></div><button className="secondary-button" type="button" onClick={reset}>重新载入</button></section></main></body></html>;
}
