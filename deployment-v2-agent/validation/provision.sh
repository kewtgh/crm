#!/usr/bin/env bash
# Dedicated disposable GitHub VM only. Never a production installation procedure.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$(cat /proc/1/comm)" = systemd
test "$(uname -m)" = x86_64
test -f /etc/os-release
grep -qx 'VERSION_ID="24.04"' /etc/os-release
test ! -e /opt/lumina-m21-fixture
if id lumina-m21-fixture >/dev/null 2>&1; then exit 2; fi
mkdir -p work/ci-private
node --input-type=module -e 'import {sourceDigest} from "./deployment-v2-agent/validation/contract.mjs"; process.stdout.write(sourceDigest(process.cwd()))' > work/ci-private/m21-source-digest
digest=$(cat work/ci-private/m21-source-digest)
# Optional Rootless prerequisites must not prevent independent systemd validation.
# No Engine upgrade/reinstall/removal: extras, if available, match the installed Engine.
prepare_rootless_helpers() {
  sudo timeout 90s apt-get update -qq || return 1
  sudo timeout 90s apt-get install --no-install-recommends --no-upgrade --no-remove -y uidmap slirp4netns || return 1
  if ! test -x /usr/bin/dockerd-rootless.sh || ! test -x /usr/bin/rootlesskit; then
    engine_version=$(dpkg-query -W -f='${Version}' docker-ce) || return 1
    sudo timeout 90s apt-get install --no-install-recommends --no-upgrade --no-remove -y "docker-ce-rootless-extras=${engine_version}" || return 1
  fi
}
if ! test -x /usr/bin/newuidmap || ! test -x /usr/bin/newgidmap || ! test -x /usr/bin/dockerd-rootless.sh || ! test -x /usr/bin/rootlesskit; then
  prepare_rootless_helpers || printf '%s\n' ROOTLESS_HELPER_PREPARATION_UNAVAILABLE
fi
sudo useradd --create-home --user-group --shell /bin/bash lumina-m21-fixture
fixture_uid=$(id -u lumina-m21-fixture)
sudo chmod 700 /home/lumina-m21-fixture
sudo install -d -m 755 /opt/lumina-m21-fixture
node deployment-v2-agent/tools/build.ts --output work/ci-private/m21-payload
sudo cp -R work/ci-private/m21-payload /opt/lumina-m21-fixture/payload
sudo cp -R deployment-v2-agent/validation /opt/lumina-m21-fixture/validation
sudo chown -R root:root /opt/lumina-m21-fixture
sudo find /opt/lumina-m21-fixture -type d -exec chmod 755 {} +
sudo find /opt/lumina-m21-fixture -type f -exec chmod 644 {} +
sudo chmod 755 /opt/lumina-m21-fixture/payload/runtime/node
sudo install -d -m 700 -o lumina-m21-fixture -g lumina-m21-fixture /home/lumina-m21-fixture/lab
cleanup() {
  # No existing account/daemon is stopped. All names were freshly allocated above.
  sudo cp /home/lumina-m21-fixture/lab/report.json work/ci-private/deployment-v2-validation.json 2>/dev/null || true
  sudo cp /home/lumina-m21-fixture/lab/errors.json work/ci-private/deployment-v2-errors.json 2>/dev/null || true
  sudo chown "$(id -u):$(id -g)" work/ci-private/*.json 2>/dev/null || true
  if test -d /home/lumina-m21-fixture/lab/docker-data; then
    sudo du -s -B1 /home/lumina-m21-fixture/lab/docker-data > work/ci-private/m21-disk-size 2>/dev/null || true
    node --input-type=module -e 'import fs from "node:fs"; const p="work/ci-private/deployment-v2-validation.json"; if(fs.existsSync(p)){ const r=JSON.parse(fs.readFileSync(p)); const n=Number(fs.readFileSync("work/ci-private/m21-disk-size","utf8").split(/\s+/)[0]); if(Number.isSafeInteger(n)&&n>=0){r.metrics.rootlessDiskBytes=n;fs.writeFileSync(p,JSON.stringify(r,null,2));}}' || true
  fi
  sudo systemctl stop "user@${fixture_uid}.service" || true
  sudo loginctl disable-linger lumina-m21-fixture || true
}
trap cleanup EXIT
sudo loginctl enable-linger lumina-m21-fixture
sudo systemctl start "user@${fixture_uid}.service"
sudo -u lumina-m21-fixture env -i PATH=/usr/bin:/bin LANG=C.UTF-8 \
  HOME=/home/lumina-m21-fixture XDG_RUNTIME_DIR="/run/user/${fixture_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${fixture_uid}/bus" \
  GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted \
  GITHUB_SHA="$GITHUB_SHA" GITHUB_RUN_ID="$GITHUB_RUN_ID" GITHUB_RUN_ATTEMPT="$GITHUB_RUN_ATTEMPT" \
  M21_SOURCE_DIGEST="$digest" M21_DISPOSABLE_HOST=ACK_GITHUB_HOSTED_NONPRODUCTION \
  timeout --signal=TERM --kill-after=5s 300s /opt/lumina-m21-fixture/payload/runtime/node \
  /opt/lumina-m21-fixture/validation/run.mjs
