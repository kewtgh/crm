import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../components/i18n-provider";
import { AccessibleDrawer, ConfirmDialog } from "../../components/ui";
import { AcademicYearInput, BilingualNameHint, CurrencySelect, DateInput, MoneyInput, OptionInput, TagsInput, YearInput } from "../../components/structured-inputs";
import { InstallmentsEditor } from "../../components/installments-editor";
import { ImportRepairField } from "../../components/import-repair-field";
import { zhV390 } from "../../lib/i18n/locales/v390";

// Isolated UI fixture, never a deployed application route. Uses the actual shared
// editing components, production stylesheet and pinned Chromium workflow.
function Fixture() {
  const [open,setOpen]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const [result,setResult]=useState("");
  return <I18nProvider initialLocale="zh-CN" initialMessages={{...zhV390,"common.close":"关闭","common.cancel":"取消","common.processing":"处理中"}}>
    <main><h1>编辑控件回归验证</h1><button id="open-editor" className="primary-button" onClick={()=>setOpen(true)}>编辑</button><output id="submitted" style={{display:"block",overflowWrap:"anywhere"}}>{result}</output>
      {open&&<AccessibleDrawer title="编辑记录" description="金额、日期、分期与单语言名称" onClose={()=>setOpen(false)}>
        <form id="editor-form" onSubmit={event=>{event.preventDefault();setResult(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));}}>
          <div className="form-grid two-column"><label className="field"><span>中文名</span><input name="nameZh"/></label><label className="field"><span>英文名</span><input name="nameEn"/></label><BilingualNameHint/></div>
          <div className="form-grid two-column"><label className="field"><span>金额</span><MoneyInput name="amount" defaultValue="1234.50" required/></label><label className="field"><span>折扣</span><MoneyInput name="discount" defaultValue="0" required/></label><label className="field"><span>币种</span><CurrencySelect name="currency" defaultValue="USD"/></label><label className="field"><span>日期</span><DateInput name="date" defaultValue="2026-10-01" required/></label><label className="field"><span>日期时间</span><DateInput name="datetime" type="datetime-local" defaultValue="2026-10-01T10:30"/></label><label className="field"><span>时间</span><DateInput name="time" type="time" defaultValue="10:30"/></label><label className="field"><span>学年</span><AcademicYearInput name="academicYear" defaultValue="2026-2027"/></label><label className="field"><span>成立年份</span><YearInput name="year" defaultValue="1890"/></label><label className="field"><span>语言</span><OptionInput name="language" options={["中文","English"]} defaultValue="legacy-language"/></label><label className="field"><span>标签</span><TagsInput name="tags" defaultValue="IB, AP"/></label></div>
          <div className="form-grid two-column"><label className="field"><span>导入出生日期</span><ImportRepairField field="birthDate" value="not-a-date"/></label><label className="field"><span>导入金额</span><ImportRepairField field="annualIncomeAmount" value="1,000.25"/></label></div>
          <InstallmentsEditor/>
          <div className="drawer-actions"><button type="button" id="confirm-editor" className="secondary-button" onClick={()=>setConfirm(true)}>确认操作</button><button type="reset" className="secondary-button">重置</button><button type="submit" id="submit-editor" className="primary-button">保存</button></div>
        </form>
      </AccessibleDrawer>}
      {confirm&&<ConfirmDialog title="确认" description="嵌套确认应保留编辑状态" confirmLabel="确认" onClose={()=>setConfirm(false)} onConfirm={()=>setConfirm(false)}/>}
    </main>
  </I18nProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture/>);
