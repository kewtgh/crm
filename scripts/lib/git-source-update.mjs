import { directRuntimeEnvironment } from "./direct-environment.mjs";

export function gitFetchEnvironment(baseEnvironment = {}, configuredProxy = "") {
  const environment = directRuntimeEnvironment(baseEnvironment);
  const proxy = String(configuredProxy).trim();
  if (proxy) {
    environment.HTTP_PROXY = proxy;
    environment.HTTPS_PROXY = proxy;
  }
  return environment;
}

export async function updateProductionSource({
  git,
  baseEnvironment,
  configuredProxy = "",
  expectedBranch = "main",
  allowedOrigins,
  onConfiguredProxy = () => {},
}) {
  const branch = (await git(
    "verify deployment branch",
    ["branch", "--show-current"],
    { quiet: true },
  )).stdout;
  if (branch !== expectedBranch) {
    throw new Error(`Expected branch ${expectedBranch}, found ${branch}`);
  }

  const origin = (await git(
    "verify deployment origin",
    ["remote", "get-url", "origin"],
    { quiet: true },
  )).stdout;
  if (!allowedOrigins.has(origin)) {
    throw new Error("Git origin does not exactly match kewtgh/crm");
  }

  if ((await git(
    "verify clean source",
    ["status", "--porcelain"],
    { quiet: true },
  )).stdout) {
    throw new Error("Deployment source worktree is not clean");
  }

  const proxy = String(configuredProxy).trim();
  const fetchEnvironment = gitFetchEnvironment(baseEnvironment, proxy);
  const fetchLabel = proxy
    ? "fetch origin main using configured Git proxy"
    : "fetch origin main directly";
  if (proxy) onConfiguredProxy();
  try {
    await git(fetchLabel, ["fetch", "--prune", "origin", expectedBranch], {
      environment: fetchEnvironment,
      quiet: true,
    });
  } catch {
    throw new Error(proxy
      ? "Git fetch using the configured Git proxy failed; source update stopped"
      : "Direct Git fetch failed; source update stopped");
  }

  await git(
    "fast-forward source",
    ["merge", "--ff-only", `origin/${expectedBranch}`],
    { quiet: true },
  );
  const commit = (await git(
    "resolve exact target commit",
    ["rev-parse", "HEAD"],
    { quiet: true },
  )).stdout;
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Git did not return a full commit");
  }
  if ((await git(
    "verify final clean source",
    ["status", "--porcelain"],
    { quiet: true },
  )).stdout) {
    throw new Error("Deployment source changed during fetch");
  }
  return commit;
}
