import { z } from "zod";

const pairs = [["nameZh", "nameEn"], ["displayNameZh", "displayNameEn"], ["titleZh", "titleEn"]] as const;

// Validate original lengths before applying a display fallback. Do not translate,
// truncate, or overwrite explicitly supplied names (including partial PATCHes).
export function normalizeBilingualNames(input:unknown,partial=false):unknown {
  if(!input||typeof input!=="object"||Array.isArray(input))return input;
  const result:Record<string,unknown>={...input};
  for(const [zh,en] of pairs){
    if(partial&&(!(zh in result)||!(en in result)))continue;
    const chinese=typeof result[zh]==="string"?result[zh].trim():"";
    const english=typeof result[en]==="string"?result[en].trim():"";
    if(chinese||english){
      // Do not repair invalid non-string values; schema validation must reject them.
      if(result[zh]===undefined||typeof result[zh]==="string")result[zh]=chinese||english;
      if(result[en]===undefined||typeof result[en]==="string")result[en]=english||chinese;
    }
  }
  return result;
}

export function bilingualSchema<T extends z.ZodType>(schema:T,partial=false) {
  return schema.superRefine((value,context)=>{
    if(!value||typeof value!=="object")return;
    const record=value as Record<string,unknown>;
    for(const [zh,en] of pairs){
      if(!(zh in record)&&!(en in record))continue;
      if(![record[zh],record[en]].some(name=>typeof name==="string"&&name.trim())){
        context.addIssue({code:"custom",path:[zh in record?zh:en],message:"at_least_one_name_required"});
      }
    }
  }).transform(value=>normalizeBilingualNames(value,partial) as z.output<T>);
}
