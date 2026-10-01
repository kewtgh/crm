export function normalizeAmount(value: string): string {
  const compact=value.trim().replaceAll(",", "").replace(/[\s\u00a0]/g, "");
  return /^-?\d*(?:\.\d*)?$/.test(compact)?compact:value;
}

export function amountError(value:string,min?:number,max?:number,precision=2):boolean {
  if(!value)return false;
  return !/^-?\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))
    ||(value.split(".")[1]?.length??0)>precision
    ||(min!==undefined&&Number(value)<min)||(max!==undefined&&Number(value)>max);
}

export function formatAmount(value:string,locale:string):string {
  if(!value||amountError(value,undefined,undefined,20))return value;
  const [whole,fraction]=value.split(".");
  // Format the integer independently to avoid rounding monetary decimals.
  const grouped=new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(BigInt(whole));
  return fraction===undefined?grouped:`${grouped}.${fraction}`;
}

export const COMMON_CURRENCIES=["CNY","USD","HKD","TWD","EUR","GBP","JPY","SGD","AUD","CAD","CHF","NZD","KRW"];
export const LANGUAGE_OPTIONS=["中文","English","中文 / English","日本語","한국어","Français","Deutsch","Español"];
export const CURRICULUM_OPTIONS=["IB","A-Level","AP","IGCSE","DSE","国内课程","国际课程"];
export const GRADE_OPTIONS=["Nursery","Pre-K","Kindergarten",...Array.from({length:12},(_,i)=>`Grade ${i+1}`),"University","Graduate"];
export const CHANNEL_OPTIONS=["Teams","Zoom","Google Meet","电话","面谈","微信","WhatsApp","Email"];
export const SOURCE_OPTIONS=["官网","广告","活动","转介绍","社交媒体","合作伙伴","其他"];

export function academicYearOptions(value=""):string[] {
  const year=new Date().getUTCFullYear();
  return [...new Set([...(value?[value]:[]),...Array.from({length:31},(_,i)=>`${year-15+i}-${year-14+i}`)])].sort();
}

export function parseTokens(value:string,max=30):string[] {
  return [...new Set(value.split(/[,，\n]/).map(item=>item.trim()).filter(Boolean))].slice(0,max);
}
