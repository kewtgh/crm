import type { Messages } from "../types";
const entries:Record<string,[string,string]>={
  "ux.workerFailed":["运行异常","Run failed"],
  "ux.sendLanguage":["邮件发送语言","Email language"],
  "customerOps.delivery.INVALID_TEMPLATE_CONTENT":["替换变量后主题或正文超长，请缩短模板后重新预览。","Personalized subject or body exceeds the limit. Shorten the template and preview again."],
  "ux.all":["全部","All"],"ux.recipientFilters":["筛选收件客户","Filter recipients"],"ux.region":["地区","Region"],"ux.tag":["客户标签","Customer tag"],"ux.customerType":["客户类型","Customer type"],
  "ux.regionHelp":["地区按客户所属学校或机构的城市筛选；未关联机构的客户不会匹配地区条件。可跨页选择，单批最多 50 人；无邮箱或禁止联系的客户不可选。营销授权在预览与入队时再次检查。","Region uses the city of the associated institution; unlinked contacts will not match a region filter. Select across pages, up to 50 per batch. Contacts without email or marked do-not-contact cannot be selected. Marketing consent is checked again during preview and queueing."],
  "ux.matching":["匹配 {count} 位客户","{count} matching customers"],"ux.selectPage":["选择本页可发客户","Select eligible on this page"],"ux.clearPage":["取消本页选择","Clear this page"],
  "ux.createTemplate":["新建自定义模板","Create custom template"],"ux.editTemplate":["编辑邮件模板","Edit email template"],"ux.templateName":["模板名称","Template name"],"ux.purpose":["发送用途","Message purpose"],"ux.service":["服务沟通","Service communication"],"ux.marketing":["营销推广（需授权）","Marketing (consent required)"],
  "ux.subject":["邮件主题","Subject"],"ux.body":["邮件正文","Body"],"ux.saveAsNew":["另存为新模板","Save as new template"],"ux.templateHelp":["支持 {{name}}（客户姓名）和 {{owner}}（负责对接人）自动替换。保存为当前工作区的个人模板，可保存多份；内容为纯文本。营销邮件请保留退订说明。","Use {{name}} for the customer's name and {{owner}} for their assigned contact. Save multiple personal templates in this workspace. Content is plain text. Include unsubscribe instructions for marketing."],
  "ux.languagePair":["* 至少填写一套完整的主题和正文（中文或英文）。只填写一种语言时，另一种语言发送将使用已有内容。","* Provide a complete subject and body in at least one language. If only one language is provided, it is used as the fallback."],
  "ux.templateInvalid":["请填写模板名称和至少一套完整的主题与正文；每种语言须成对填写。只支持 {{name}}、{{owner}} 变量，主题不可换行。","Enter a name and at least one complete subject/body pair. Each language must be complete. Only {{name}} and {{owner}} variables are supported; subjects cannot contain line breaks."],
  "ux.templateSaveFailed":["模板未保存，请重试。","Template could not be saved. Try again."],"ux.templateLoadFailed":["自定义模板加载失败；系统模板仍可使用。","Custom templates could not be loaded; system templates remain available."],
  "ux.systemTemplates":["系统双语模板","System bilingual templates"],"ux.savedTemplates":["我的自定义模板","My custom templates"],"ux.presetHelp":["三类各两套，中英双语；可复制为自定义模板后保存。发送语言跟随本次预览。","Two bilingual presets per category; copy to a custom template and save. Sending uses the preview language."],
  "customerOps.template.FOLLOW_UP_2":["服务跟进 · 进度确认","Follow-up · Progress"],"customerOps.template.MEETING_2":["预约沟通 · 议题安排","Meeting · Topics"],"customerOps.template.PROGRAM_2":["课程咨询 · 学习方案","Program · Learning plan"],
  "ux.import.blank":["完整空白模板","Full blank template"],"ux.import.example":["示例模板","Example template"],"ux.import.guide":["字段说明","Field guide"],
  "ux.importHelp":["先选择客户、学校和机构、家庭或学生，再下载对应模板。模板覆盖该类当前支持的全部导入字段。示例仅作参考，请替换数据后导入；学生必须关联现有客户 UUID，家庭关联使用现有家庭 UUID。字段说明不是导入数据文件。","Choose customers, institutions, households or students before downloading the matching template. Each includes all currently supported import fields. Replace example data before import; students require an existing contact UUID, and family links use household UUIDs. The field guide is not an import data file."],
};
export const zhUX20261002:Messages=Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,value[0]]));
export const enUX20261002:Messages=Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,value[1]]));
