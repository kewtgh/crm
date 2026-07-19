import Link from "next/link";

export default function NotFound(){
  return <main className="boundary-page"><section className="surface data-state"><div><h1>404 · 页面不存在</h1><p>The requested Lumina CRM page could not be found.</p></div><Link className="primary-button" href="/dashboard">返回工作台</Link></section></main>;
}
