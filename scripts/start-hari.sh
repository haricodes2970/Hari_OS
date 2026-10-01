#!/usr/bin/env bash
#
# Hari OS — one-click launcher.
#
# The only thing in this repository that starts the production server. `npm run start:hari`
# is the command it runs; this script decides whether that command needs running at all.
#
# What it does, in order:
#
#   1. Ask http://localhost:6377 whether Hari OS is already there. If it is, open the
#      browser and stop. Clicking this twice is harmless.
#   2. If something *else* owns port 6377, say so and stop. It never kills a process it
#      did not start.
#   3. Make sure a production build exists, refusing to start `next dev` as a substitute.
#   4. Start the server detached, so it outlives this script and this terminal window.
#   5. Poll until the server answers, then open the browser.
#   6. If it never answers, print what the server actually said and stop.
#
# Run it by double-clicking the launcher, or with `npm run launch:hari`.

set -uo pipefail

PORT=6377
URL="http://localhost:${PORT}"

# Resolve the project from this script's own location, so the launcher works from the
# Desktop, from the applications menu, or from a terminal in any directory.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "${HERE}/.." && pwd)"

# Logs and the pid file live outside the repository, under the XDG state directory. Runtime
# writes therefore never touch the working tree at all, tracked or untracked.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/hari-os"
LOG_FILE="${STATE_DIR}/server.log"
PID_FILE="${STATE_DIR}/server.pid"

mkdir -p "${STATE_DIR}"

say()  { printf '%s\n' "$*"; }
fail() { printf 'Hari OS: %s\n' "$*" >&2; exit 1; }

# True when something answers on the port at all, whatever it is.
port_answers() {
  (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && exec 3>&- && return 0
  return 1
}

# True only when the thing answering is Hari OS. The <title> is set in src/app/layout.tsx;
# an unrelated service on this port will not have it.
hari_os_answers() {
  curl --silent --fail --max-time 3 "${URL}/" 2>/dev/null | grep -q '<title>Hari OS</title>'
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 &
  else
    say "Could not find xdg-open. Open ${URL} in your browser."
  fi
}

who_owns_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" | head -1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -2 | tail -1
  fi
}

# --- 1. already running? just open it ---------------------------------------
if hari_os_answers; then
  say "Hari OS is already running at ${URL}"
  open_browser
  exit 0
fi

# --- 2. something else on the port ------------------------------------------
# The port is spoken for but Hari OS is not answering on it. Report and stop. Killing an
# unrelated process — a database, a dev server, another application — is not this script's
# decision to make.
if port_answers; then
  say ""
  say "Port ${PORT} is in use by another program, so Hari OS was not started."
  say ""
  who_owns_port | sed 's/^/  /'
  say ""
  say "Stop that program, then click Hari OS again. Nothing was killed."
  exit 1
fi

# --- 3. refuse to run without a production build ----------------------------
if [ ! -f "${PROJECT}/.next/BUILD_ID" ]; then
  fail "No production build found.
  Run this once, in a terminal:

      cd \"${PROJECT}\"
      npm run setup:hari

  It installs dependencies, builds for production, and creates the local database."
fi

# --- 4. start it, detached --------------------------------------------------
say "Starting Hari OS on ${URL} …"

cd "${PROJECT}" || fail "Could not enter ${PROJECT}"

: >"${LOG_FILE}"

# Detached from this shell on purpose: closing the terminal window must not stop Hari OS,
# and the server has to outlive the script that opened the browser.
setsid nohup npm run start:hari >>"${LOG_FILE}" 2>&1 < /dev/null &
SERVER_PID=$!
printf '%s\n' "${SERVER_PID}" >"${PID_FILE}"

# --- 5. wait for it to actually answer --------------------------------------
# Bounded. If it never answers, say so rather than hanging here forever.
READY=0
for _ in $(seq 1 60); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    break
  fi
  if hari_os_answers; then
    READY=1
    break
  fi
  sleep 1
done

# --- 6. report --------------------------------------------------------------
if [ "${READY}" -ne 1 ]; then
  say ""
  say "Hari OS did not start within 60 seconds. The server said:"
  say "----------------------------------------------------------------"
  tail -n 30 "${LOG_FILE}" 2>/dev/null | sed 's/^/  /'
  say "----------------------------------------------------------------"
  say "Full log: ${LOG_FILE}"
  exit 1
fi

say "Hari OS is running at ${URL}"
say "It keeps running after this window closes."
say "Stop it with:  npm run stop:hari"
open_browser