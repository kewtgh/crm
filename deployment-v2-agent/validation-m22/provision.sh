#!/usr/bin/env bash
# Only a fresh GitHub-hosted VM. No production installation or rootful daemon changes.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$(cat /proc/1/comm)" = systemd
test "$(uname -m)" = x86_64
case "${M22_PROFILE:-}" in 24.04|26.04) ;; *) exit 2 ;; esac
grep -qx "VERSION_ID=\"${M22_PROFILE}\"" /etc/os-release
test ! -e /opt/lumina-m22-fixture
if id lumina-m22-fixture >/dev/null 2>&1; then exit 2; fi
mkdir -p work/ci-private/m22-debs work/ci-private/m22-apt
node deployment-v2-agent/validation-m22/setup.mjs init
engine_before=$(dpkg-query -W -f='${Version}' docker-ce 2>/dev/null || true)
# Reproduce the first old preparation boundary, without installing its proposed extras.
legacy_update=0
sudo timeout 45s apt-get update -qq > work/ci-private/m22-legacy-update.log 2>&1 || legacy_update=$?
node deployment-v2-agent/validation-m22/setup.mjs legacy legacyUpdateExit "$legacy_update"
legacy_helpers=0
sudo timeout 30s apt-get --simulate install --no-install-recommends --no-upgrade --no-remove -y uidmap slirp4netns > work/ci-private/m22-legacy-helpers.log 2>&1 || legacy_helpers=$?
node deployment-v2-agent/validation-m22/setup.mjs legacy legacyHelpersExit "$legacy_helpers"
legacy_extras=0
sudo timeout 30s apt-get --simulate install --no-install-recommends --no-upgrade --no-remove -y "docker-ce-rootless-extras=${engine_before}" > work/ci-private/m22-legacy-extras.log 2>&1 || legacy_extras=$?
node deployment-v2-agent/validation-m22/setup.mjs legacy legacyExtrasExit "$legacy_extras"
# Scope apt to the existing official Ubuntu / Docker sources; ignore unrelated third-party
# repositories. Signature verification stays enabled; do not modify global sources or keys.
for source in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources; do
  if test -f "$source"; then cp "$source" work/ci-private/m22-apt/; fi
done
apt_scope=$(realpath work/ci-private/m22-apt)
apt_options=(-o Dir::Etc::sourcelist=- -o "Dir::Etc::sourceparts=${apt_scope}")
helpers=true
sudo timeout 75s apt-get "${apt_options[@]}" update -qq || helpers=false
if test "$helpers" = true; then
  sudo timeout 75s apt-get "${apt_options[@]}" install --no-install-recommends --no-upgrade --no-remove -y uidmap slirp4netns rootlesskit dbus-user-session || helpers=false
fi
sudo useradd --create-home --user-group --shell /bin/bash lumina-m22-fixture
fixture_uid=$(id -u lumina-m22-fixture)
sudo chmod 700 /home/lumina-m22-fixture
sudo install -d -m 755 /opt/lumina-m22-fixture
node deployment-v2-agent/tools/build.ts --output work/ci-private/m22-payload
sudo cp -R work/ci-private/m22-payload /opt/lumina-m22-fixture/payload
sudo cp -R deployment-v2-agent/validation deployment-v2-agent/validation-m22 /opt/lumina-m22-fixture/
sudo install -d -m 755 /opt/lumina-m22-fixture/engine
download_extract() {
  local name="$1" version="$2" deb
  (cd work/ci-private/m22-debs && timeout 60s apt-get "${apt_options[@]}" download "${name}=${version}") || return 1
  deb=$(find work/ci-private/m22-debs -maxdepth 1 -name "${name}_*.deb" -print -quit)
  test -n "$deb" || return 1
  node deployment-v2-agent/validation-m22/setup.mjs package "$deb" || return 1
  sudo dpkg-deb --extract "$deb" /opt/lumina-m22-fixture/engine || return 1
}
select_version() {
  apt-cache "${apt_options[@]}" madison "$1" | node --input-type=module -e 'import fs from "node:fs";import {selectPackage} from "./deployment-v2-agent/validation-m22/contract.mjs";const v=selectPackage(fs.readFileSync(0,"utf8"),process.argv[1]);if(!v)process.exit(1);process.stdout.write(v)' "$2"
}
if test "$M22_PROFILE" = 24.04; then
  if ! download_extract docker-ce-rootless-extras "$engine_before"; then
    # The runner can retain installed CE while no longer exposing that version in apt.
    # This immutable official package is matched to the runner's 28.0.4 Engine.
    if test "$engine_before" = '5:28.0.4-1~ubuntu.24.04~noble'; then
      deb=work/ci-private/m22-debs/docker-ce-rootless-extras_28.0.4-1~ubuntu.24.04~noble_amd64.deb
      if curl --fail --location --max-time 45 https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/docker-ce-rootless-extras_28.0.4-1~ubuntu.24.04~noble_amd64.deb --output "$deb"; then
        printf '%s  %s\n' 2abb177d60561ac77b50a42b60500ab194b70f40f4b225d837c1fdccaaab7a28 "$deb" | sha256sum --check
        node deployment-v2-agent/validation-m22/setup.mjs package "$deb"
        sudo dpkg-deb --extract "$deb" /opt/lumina-m22-fixture/engine
      fi
    fi
  fi
else
  for spec in docker.io:29.1.3 docker-compose-v2:2.40.3 docker-buildx:0.30.1; do
    name=${spec%%:*}; wanted=${spec#*:}
    selected=$(select_version "$name" "$wanted") || selected=
    if test -n "$selected"; then download_extract "$name" "$selected" || true; fi
  done
  # Ubuntu containerd/runc userspace accompanies the extracted Ubuntu Engine, never
  # starts a system service and never overwrites the runner's existing runtime.
  for name in containerd runc; do
    selected=$(apt-cache "${apt_options[@]}" policy "$name" | awk '/Candidate:/ {print $2}')
    if test -n "$selected" && test "$selected" != '(none)'; then download_extract "$name" "$selected" || true; fi
  done
fi
# A pinned upstream Compose supplements the 24.04 Rootless workload only. Ubuntu 26.04
# uses the Ubuntu package above; the fallback never certifies an Ubuntu target package.
if test "$M22_PROFILE" = 24.04; then
  sudo install -d -m 755 /opt/lumina-m22-fixture/engine/usr/libexec/docker/cli-plugins
  if curl --fail --location --max-time 45 https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-linux-x86_64 --output work/ci-private/m22-compose; then
    printf '%s  %s\n' dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372 work/ci-private/m22-compose | sha256sum --check
    sudo install -m 755 work/ci-private/m22-compose /opt/lumina-m22-fixture/engine/usr/libexec/docker/cli-plugins/docker-compose
  fi
fi
engine_after=$(dpkg-query -W -f='${Version}' docker-ce 2>/dev/null || true)
test "$engine_before" = "$engine_after"
node deployment-v2-agent/validation-m22/setup.mjs installed
# The launcher chooses docker-rootlesskit before rootlesskit through PATH; it has no
# DOCKERD_ROOTLESS_ROOTLESSKIT override. Select only the packaged /usr/bin helper,
# whose existing AppArmor profile permits user namespaces. No policy is weakened.
sudo install -d -m 755 /opt/lumina-m22-fixture/bin
if test -x /usr/bin/rootlesskit; then sudo ln -s /usr/bin/rootlesskit /opt/lumina-m22-fixture/bin/docker-rootlesskit; fi
for program in docker dockerd containerd runc containerd-shim-runc-v2 docker-proxy; do
  for folder in /opt/lumina-m22-fixture/engine/usr/bin /opt/lumina-m22-fixture/engine/usr/sbin /usr/bin /usr/sbin; do
    if test -x "${folder}/${program}"; then
      sudo ln -s "${folder}/${program}" "/opt/lumina-m22-fixture/bin/${program}"
      break
    fi
  done
done
sudo chown -R root:root /opt/lumina-m22-fixture
sudo find /opt/lumina-m22-fixture -type d -exec chmod 755 {} +
# Keep executability of binaries from their authenticated packages. Payload is readable by the fresh UID.
sudo chmod -R a+rX /opt/lumina-m22-fixture
sudo chmod 755 /opt/lumina-m22-fixture/payload/runtime/node
sudo install -d -m 700 -o lumina-m22-fixture -g lumina-m22-fixture /home/lumina-m22-fixture/lab
sudo cp work/ci-private/m22-report.json /home/lumina-m22-fixture/lab/report.json
sudo chown lumina-m22-fixture:lumina-m22-fixture /home/lumina-m22-fixture/lab/report.json
cleanup() {
  sudo cp /home/lumina-m22-fixture/lab/report.json work/ci-private/m22-report.json 2>/dev/null || true
  sudo cp /home/lumina-m22-fixture/lab/errors.json work/ci-private/m22-errors.json 2>/dev/null || true
  sudo chown "$(id -u):$(id -g)" work/ci-private/*.json 2>/dev/null || true
  if test -d /home/lumina-m22-fixture/lab/docker-data; then
    sudo du -s -B1 /home/lumina-m22-fixture/lab/docker-data > work/ci-private/m22-disk 2>/dev/null || true
  fi
  stopped=true; unlinger=true
  sudo systemctl stop "user@${fixture_uid}.service" || stopped=false
  sudo loginctl disable-linger lumina-m22-fixture || unlinger=false
  M22_STOPPED="$stopped" M22_UNLINGER="$unlinger" node --input-type=module -e 'import fs from "node:fs";const p="work/ci-private/m22-report.json",r=JSON.parse(fs.readFileSync(p));r.facts.managerStopped=process.env.M22_STOPPED==="true";r.facts.lingerDisabled=process.env.M22_UNLINGER==="true";if(fs.existsSync("work/ci-private/m22-disk")){const n=Number(fs.readFileSync("work/ci-private/m22-disk","utf8").split(/\s+/)[0]);if(Number.isSafeInteger(n)&&n>=0)r.metrics.daemonDiskBytes=n;}fs.writeFileSync(p,JSON.stringify(r));'
}
trap cleanup EXIT
sudo loginctl enable-linger lumina-m22-fixture
sudo systemctl start "user@${fixture_uid}.service"
sudo -u lumina-m22-fixture env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME=/home/lumina-m22-fixture \
  XDG_RUNTIME_DIR="/run/user/${fixture_uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${fixture_uid}/bus" \
  GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted M22_ACK=NONPRODUCTION_DISPOSABLE M22_PROFILE="$M22_PROFILE" \
  timeout --signal=TERM --kill-after=5s 240s /opt/lumina-m22-fixture/payload/runtime/node \
  /opt/lumina-m22-fixture/validation-m22/run.mjs
