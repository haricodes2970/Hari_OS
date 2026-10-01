#!/usr/bin/env bash
#
# Hari OS — stop the production server.
#
# The counterpart to `start-hari.sh`. It stops only the process this launcher recorded,
# never whatever else might own port 6377.

set -uo pipefail

PORT=6377
URL="http://localhost:${PORT}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/hari-os"
PID_FILE="${STATE_DIR}/server.pid"

if [ ! -f "${PID_FILE}" ]; then
  echo "Hari OS: no pid file at ${PID_FILE}, so no server was started by the launcher."
  exit 1
fi

PID="$(cat "${PID_FILE}")"

if ! kill -0 "${PID}" 2>/dev/null; then
  echo "Hari OS is not running. Removing the stale pid file."
  rm -f "${PID_FILE}"
  exit 0
fi

echo "Stopping Hari OS (pid ${PID}) …"

# `setsid` made the server its own session leader, so the pid is the process group leader and
# this reaches Next's own children too. No signal is sent to any other pid.
kill -TERM -- "-${PID}" 2>/dev/null || kill -TERM "${PID}" 2>/dev/null

for _ in $(seq 1 10); do
  kill -0 "${PID}" 2>/dev/null || break
  sleep 1
done

rm -f "${PID_FILE}"

if kill -0 "${PID}" 2>/dev/null; then
  echo "It did not stop after 10 seconds. Its process is still ${PID}."
  exit 1
fi

echo "Hari OS stopped."