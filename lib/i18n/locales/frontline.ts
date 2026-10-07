import type { Messages } from "../types";
const entries: Record<string,[string,string]> = {
 "scope":["Queue scope","队列范围"], "readOnly":["No permitted next action","暂无可执行的下一步"], "more":["More actions for {name}","{name}的更多操作"],
 "queueHelp":["Find your next lead, review the recorded context, and take one permitted next step.","找到待处理线索，查看记录的业务上下文，再执行下一步。"],
 "daily":["Daily","日常工作"], "management":["Management","经营管理"], "mode":["Dashboard mode","工作台视角"],
 "today":["My Today","我的今日工作"], "attention":["Attention","值得关注"], "snapshot":["Business Snapshot","业务概况"], "quick":["Quick Navigation","快捷入口"],
 "attentionHelp":["Separate operational signals, not a combined task count.","各类运营提醒独立展示，不合计为任务总数。"],
 "noAttention":["No listed operational signals in this visible scope.","当前可见范围没有下列运营提醒。"],
 "manageHelp":["Current snapshot context. Open Executive Overview to investigate exceptions and period changes.","这里是当前业务概况；到经营总览调查异常与期间变化。"],
 "openExecutive":["Open Executive Overview","打开经营总览"], "taskCounts":["Today {today} · Overdue {overdue}","今日任务 {today} · 逾期任务 {overdue}"],
 "ageDays":["{count} days old","已创建 {count} 天"], "signal":["Qualification signal","资格评估信号"],
 "filterHelp":["Search, scope and status are primary. More filters are applied only after confirmation.","搜索、队列范围与状态为主要条件；高级条件确认后才会应用。"]
};
export const frontlineEn: Messages = Object.fromEntries(Object.entries(entries).map(([key,value])=>[`frontline.${key}`,value[0]]));
export const frontlineZh: Messages = Object.fromEntries(Object.entries(entries).map(([key,value])=>[`frontline.${key}`,value[1]]));
