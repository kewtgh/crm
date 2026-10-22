export function classifyGitFailure(error, { operation, proxy = false } = {}) {
  const text = String(error?.stderr ?? error?.message ?? "");
  let code = "BOOTSTRAP_GIT_FETCH_FAILED";
  let transient = false;
  if (operation !== "fetch") code = operation === "fast-forward"
    ? "BOOTSTRAP_GIT_FAST_FORWARD_FAILED" : "BOOTSTRAP_SOURCE_INVALID";
  else if (/authentication failed|permission denied|could not read username|repository not found|401|403/i.test(text)) {
    code = "BOOTSTRAP_GIT_AUTH_FAILED";
  } else if (/certificate|SSL|TLS|handshake/i.test(text)) {
    code = "BOOTSTRAP_GIT_TLS_FAILED";
    transient = /EOF|reset|timed out/i.test(text) && !/certificate/i.test(text);
  } else if (/resolve proxy|proxy.*(?:connect|refused|unavailable)|Failed to connect|could not resolve|timed out|timeout|reset|network is unreachable|remote end hung up/i.test(text)) {
    code = proxy ? "BOOTSTRAP_GIT_PROXY_UNAVAILABLE" : "BOOTSTRAP_GIT_FETCH_FAILED";
    transient = true;
  }
  return Object.assign(new Error(code), { code, stage: operation === "fetch" ? "git-fetch" : operation,
    transient });
}

export async function fetchWithRetry(fetchAttempt, { attempts = 3, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  proxy = false, onAttempt = () => {}, timeoutMs = 20_000 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5
    || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("BOOTSTRAP_RETRY_CONFIGURATION_INVALID");
  }
  for (let index = 0; index < attempts; index++) {
    onAttempt(index + 1);
    try { return await fetchAttempt({ timeoutMs }); }
    catch (error) {
      const safe = classifyGitFailure(error, { operation: "fetch", proxy });
      if (!safe.transient || index + 1 === attempts) throw safe;
      await delay(Math.min(4_000, 500 * 2 ** index));
    }
  }
}
