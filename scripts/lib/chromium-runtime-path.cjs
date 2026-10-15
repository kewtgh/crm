/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

function chromium1248Path(environment = process.env, home = os.homedir(), exists = fs.existsSync) {
  if (environment.PLAYWRIGHT_CHROMIUM_1248_PATH) return environment.PLAYWRIGHT_CHROMIUM_1248_PATH;
  const cache = environment.PLAYWRIGHT_BROWSERS_PATH || path.join(environment.LOCALAPPDATA
    || path.join(environment.USERPROFILE || home, "AppData", "Local"), "ms-playwright");
  const chromium = path.join(cache, "chromium-1248", "chrome-win64", "chrome.exe");
  const shell = path.join(cache, "chromium_headless_shell-1248", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  // Both builds are pinned to 1248; never fall back to another installed revision.
  return exists(chromium) ? chromium : exists(shell) ? shell : chromium;
}

module.exports = { chromium1248Path };
