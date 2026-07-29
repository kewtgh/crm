#!/bin/sh
set -eu

unset DOCKER_CONTEXT
expected_docker_host="unix:///run/user/$(id -u)/docker.sock"
if [ "${DOCKER_HOST:-}" != "$expected_docker_host" ]; then
  echo "DOCKER_HOST must be the lumina-crm rootless socket: $expected_docker_host" >&2
  exit 1
fi
if ! docker info --format '{{json .SecurityOptions}}' | grep -qi rootless; then
  echo "Refusing to provision Lumina volumes through a rootful Docker daemon" >&2
  exit 1
fi
if [ "$(docker info --format '{{.CgroupDriver}}')" != "systemd" ]; then
  echo "Lumina rootless Docker requires the systemd cgroup driver" >&2
  exit 1
fi

if [ "${LUMINA_COMPOSE_PROJECT:-lumina-crm}" != "lumina-crm" ]; then
  echo "LUMINA_COMPOSE_PROJECT must be lumina-crm" >&2
  exit 1
fi

ensure_volume() {
  volume_name="$1"
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    managed="$(docker volume inspect --format '{{ index .Labels "com.lumina.crm.managed" }}' "$volume_name")"
    repository="$(docker volume inspect --format '{{ index .Labels "com.lumina.crm.repository" }}' "$volume_name")"
    if [ "$managed" != "true" ] || [ "$repository" != "kewtgh/crm" ]; then
      echo "Refusing to adopt existing unowned volume: $volume_name" >&2
      exit 1
    fi
    echo "verified existing Lumina volume: $volume_name"
    return
  fi
  docker volume create \
    --label com.lumina.crm.managed=true \
    --label com.lumina.crm.repository=kewtgh/crm \
    --label com.docker.compose.project=lumina-crm \
    "$volume_name" >/dev/null
  echo "created Lumina volume: $volume_name"
}

initialize_runtime_volume() {
  volume_name="$1"
  purpose="$2"
  helper_image="postgres:18.4-bookworm"
  if ! docker image inspect "$helper_image" >/dev/null 2>&1; then
    echo "Pinned helper image is not present: $helper_image (pull/build it before provisioning)" >&2
    exit 1
  fi
  docker run --rm \
    --name "lumina-crm-provision-$purpose" \
    --label com.lumina.crm.managed=true \
    --label com.lumina.crm.repository=kewtgh/crm \
    --label com.docker.compose.project=lumina-crm \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add CHOWN \
    --security-opt no-new-privileges:true \
    --mount "type=volume,src=$volume_name,dst=/data" \
    --entrypoint chown \
    "$helper_image" 10001:10001 /data
  echo "initialized Lumina $purpose volume ownership: $volume_name"
}

postgres_volume="${LUMINA_POSTGRES_VOLUME:-lumina-crm-postgres-data}"
objects_volume="${LUMINA_OBJECTS_VOLUME:-lumina-crm-objects}"
backups_volume="${LUMINA_BACKUPS_VOLUME:-lumina-crm-backups}"

ensure_volume "$postgres_volume"
ensure_volume "$objects_volume"
ensure_volume "$backups_volume"
initialize_runtime_volume "$objects_volume" objects
initialize_runtime_volume "$backups_volume" backups
