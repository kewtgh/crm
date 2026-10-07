import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimelineItem} from '../components/customer-360-page.tsx';
import {I18nProvider,useI18n} from '../components/i18n-provider.tsx';
import {UserPreferencesProvider} from '../components/user-preferences-context.tsx';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';
import {en} from '../lib/i18n/locales/en.ts';

function TimelineProbe({summary,type='ACTIVITY'}) {
 const {locale,t}=useI18n();
 return React.createElement(TimelineItem,{locale,t,item:{occurredAt:'2026-10-07T00:00:00Z',type,entityId:'synthetic-activity',titleZh:'示例跟进',titleEn:'Example follow-up',summary,metadata:{}}});
}
test('timeline preserves contact context and owning status labels after safe translation fallback',()=>{
 for(const [locale,messages] of [['zh-CN',zhCN],['en',en]]){
  const render=(summary,type)=>renderToStaticMarkup(React.createElement(I18nProvider,{initialLocale:locale,initialMessages:messages},React.createElement(UserPreferencesProvider,{initialPreferences:{timezone:'UTC',dateFormat:'yyyy-MM-dd'}},React.createElement(TimelineProbe,{summary,type}))));
  const html=render('person@example.test','CONTACT');
  assert.ok(html.includes('person@example.test'));
  assert.doesNotMatch(html,/timeline\.summary\.|暂不可用|Unavailable/);
  for(const [type,value,key] of [['ACTIVITY','MEETING','activity.kind.MEETING'],['ORGANIZATION','HEALTHY','crm.status.HEALTHY'],['TASK','DONE','crm.status.DONE'],['OPPORTUNITY','EVALUATION','sales.stage.evaluation'],['CONTRACT','DRAFT','contracts.status.draft'],['PAYMENT','CONFIRMED','finance.status.confirmed'],['APPROVAL','PENDING','approval.status.pending']]){
   assert.ok(messages[key],key);assert.ok(render(value,type).includes(messages[key]),key);
  }
  assert.ok(render('SYNTHETIC_UNKNOWN','ACTIVITY').includes(locale==='zh-CN'?'未知状态':'Unknown status'));
  assert.doesNotMatch(render('SYNTHETIC_UNKNOWN','ACTIVITY'),/SYNTHETIC_UNKNOWN/);
 }
});
