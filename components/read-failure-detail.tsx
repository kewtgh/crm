"use client";
import type { ReadFailure } from "@/lib/read-failure";
import { useI18n } from "./i18n-provider";

const messages = {
  session:["会话已过期，请重新登录后重试。","Your session expired. Sign in again, then retry."],
  permission:["当前账号无权读取此范围，请确认工作区和权限。","Check your workspace and permission to read this scope."],
  scope:["筛选范围无效，请检查日期或清除筛选后重试。","Check the dates or clear the filters, then retry."],
  migration:["服务所需的数据结构尚未就绪，请联系管理员核对迁移状态。","The required database schema is unavailable. Ask an administrator to check migrations."],
  timeout:["查询超时。可缩小日期范围后重试。","The query timed out. Try a shorter date range."],
  network:["网络连接中断，请恢复连接后重试读取。","The connection was interrupted. Reconnect and retry the read."],
  response:["返回数据未通过校验，未显示不可靠的统计。请提供参考编号以便排查。","The response failed validation. Unreliable totals were not displayed. Share the reference below if available."],
  unavailable:["服务暂时不可用，请稍后重试；若持续发生，请提供参考编号。","The service is unavailable. Retry later; share the reference if the issue persists."],
} as const;
export function ReadFailureDetail({failure}:{failure?:ReadFailure}) {
  const {locale}=useI18n();if(!failure)return null;
  return <span className="read-failure-detail"><span>{messages[failure.kind][locale==="en"?1:0]}</span>{failure.requestId&&<span>{locale==="en"?"Support reference":"排查参考编号"}: <code>{failure.requestId}</code></span>}</span>;
}
