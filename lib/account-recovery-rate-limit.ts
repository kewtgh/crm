import { supabaseAdminJson } from "./supabase-server";
import type { LoginThrottleIdentity } from "./login-rate-limit";

type RecoveryThrottleResult={allowed:boolean;retryAfterSeconds?:number};

export async function applyAccountRecoveryRateLimit(identity:LoginThrottleIdentity){
  const result=await supabaseAdminJson<RecoveryThrottleResult>("/rest/v1/rpc/apply_account_recovery_throttle",{
    method:"POST",
    body:JSON.stringify({account_hash:identity.accountHash,source_hash:identity.sourceHash}),
  });
  return{
    allowed:Boolean(result.allowed),
    retryAfter:Math.max(1,Number(result.retryAfterSeconds??1)),
  };
}
