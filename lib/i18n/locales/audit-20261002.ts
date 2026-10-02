import type { Messages } from "../types";
const entries:Record<string,[string,string]>={
  "audit.opportunityFocus":["从客户档案定位进入，初始列表仅显示关联商机（不可访问时为空）。搜索、分页或切换币种将恢复普通列表；阶段统计仍为所选币种的整体统计。","Opened from a customer record. The initial list shows only the linked opportunity (empty if inaccessible). Searching, paging or changing currency resumes the normal list; stage metrics remain currency-wide."],
  "audit.allOpportunities":["查看全部商机","View all opportunities"],
  "audit.saved":["已保存。","Saved."],
  "audit.savedRefreshFailed":["修改已保存，但列表刷新失败。请重新加载查看，不要重复提交。","Changes were saved, but refresh failed. Reload to view them; do not submit again."],
  "audit.remaining":["还需有效联系次数","Useful contacts remaining"],
  "audit.daysLeft":["剩余 {days} 天","{days} days remaining"],
  "audit.pastDue":["逾期 {days} 天","{days} days overdue"],
  "audit.deadlineUTC":["目标期限（按 UTC 日期）","Deadline (UTC calendar date)"],
  "audit.achieved":["已达成","Achieved"],"audit.inProgress":["进行中","In progress"],
  "audit.contactBusinessScope":["此处不推断个人客户拥有所属机构的全部商机。机构商机请进入所属学校或机构查看。","Institution opportunities are not treated as this person's opportunities. Open the associated institution to view its business."],
  "audit.recipients":["本批次收件客户","Batch recipients"],"audit.blocked":["预览不可发送","Blocked in preview"],"audit.queued":["已入队（非已投递）","Queued (not delivered)"],
  "audit.previewLanguage":["本批次仍按原预览语言（{language}）发送和重试。如需更换语言，请重新生成预览；已入队的批次请开始新批次。","This batch sends and retries in its preview language ({language}). Generate a new preview to change it; start a new batch if recipients have already been queued."],
  "audit.runEvent":["触发此类事件","Trigger this event"],
  "audit.runEventTitle":["确认触发自动化事件","Confirm automation event"],
  "audit.runEventConfirm":["这不是只运行当前规则。事件「{trigger}」将评估同类事件下的所有启用规则（当前页面已加载 {count} 条），满足条件时会创建真实任务或通知。是否继续？","This does not run only the selected rule. The {trigger} event evaluates all active rules for this trigger ({count} currently loaded on this page) and creates real tasks or notifications when conditions match. Continue?"],
};
export const zhAudit20261002:Messages=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,v[0]]));
export const enAudit20261002:Messages=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,v[1]]));
