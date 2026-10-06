/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const os = require("node:os");

function chromium1243Path(environment = process.env, home = os.homedir()) {
  return environment.PLAYWRIGHT_CHROMIUM_1243_PATH
    || path.join(environment.LOCALAPPDATA
      || path.join(environment.USERPROFILE || home, "AppData", "Local"),
    "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe");
}

module.exports = { chromium1243Path };
