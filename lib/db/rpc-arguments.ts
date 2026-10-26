import type {PoolClient} from "pg";

type Signature={input_names:string[];required_count:number;json_arguments:string[]};

/** node-postgres encodes JS arrays as SQL arrays. JSON/JSONB arguments need JSON text. */
export async function rpcArgumentValues(client:Pick<PoolClient,"query">,name:string,entries:[string,unknown][]):Promise<unknown[]>{
  const values=entries.map(([,value])=>value);
  if(!values.some(Array.isArray))return values;
  const result=await client.query<Signature>(`
    select p.proargnames[1:p.pronargs] as input_names,
           p.pronargs-p.pronargdefaults as required_count,
           array(select a.name
                 from unnest(p.proargnames[1:p.pronargs],p.proargtypes::oid[]) as a(name,type)
                 where a.type in ('json'::regtype,'jsonb'::regtype)) as json_arguments
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=$1 and p.prokind='f'
  `,[name]);
  const names=entries.map(([key])=>key);
  const candidates=result.rows.filter(row=>names.every(key=>row.input_names?.includes(key))&&row.input_names.slice(0,row.required_count).every(key=>names.includes(key)));
  // If overloads disagree, leave resolution/error handling to PostgreSQL instead
  // of coercing a possibly native SQL array into another argument type.
  return entries.map(([key,value])=>Array.isArray(value)&&candidates.length>0&&candidates.every(row=>row.json_arguments.includes(key))?JSON.stringify(value):value);
}
