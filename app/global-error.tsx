"use client";

export default function GlobalError({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <html lang="zh-CN"><body><main className="boundary-page"><section className="surface data-state" role="alert"><div><h1><span lang="zh-CN">Lumina CRM 暂时无法显示</span> / <span lang="en">Lumina CRM is temporarily unavailable</span></h1><p><span lang="zh-CN">页面发生未预期错误。请重试；如问题持续，请联系管理员并提供当前时间。</span> <span lang="en">An unexpected error occurred. Retry, or contact an administrator with the current time if it continues.</span></p></div><button className="secondary-button" type="button" onClick={reset}><span lang="zh-CN">重新载入</span> / <span lang="en">Reload</span></button></section></main></body></html>;
}
