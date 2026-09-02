#!/usr/bin/env bash
# Run the real atuin client against a fully isolated sandbox profile.
#
#   ./atuin-sandbox.sh alpha register -u dev -e dev@local -p hunter2
#   ./atuin-sandbox.sh alpha sync
#   ./atuin-sandbox.sh beta  history list
#
# Each profile gets its own config dir, data dir, history.db, records.db and
# host_id -- so alpha and beta behave as two distinct machines syncing to the
# same test server. Your real ~/.local/share/atuin is never touched.
set -euo pipefail

PROFILE="${1:?usage: $0 <profile> <atuin args...>}"
shift

# The profile is interpolated into a path, so restrict it to a single harmless
# path segment: "../../foo" would otherwise point the client's data directory
# anywhere on the filesystem — including the real one.
if ! printf '%s' "$PROFILE" | grep -Eq '^[A-Za-z0-9._-]+$' || [ "$PROFILE" = "." ] || [ "$PROFILE" = ".." ]; then
  echo "Invalid profile name: $PROFILE (letters, digits, dot, dash, underscore)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$ROOT/clients/$PROFILE"
mkdir -p "$PROFILE_DIR/config/atuin" "$PROFILE_DIR/data"

if [[ ! -f "$PROFILE_DIR/config/atuin/config.toml" ]]; then
  cat > "$PROFILE_DIR/config/atuin/config.toml" <<TOML
sync_address = "http://127.0.0.1:8889"
auto_sync = false
update_check = false
TOML
fi

# ATUIN_CONFIG_DIR and XDG_DATA_HOME are what atuin resolves paths from:
# see crates/atuin-common/src/utils.rs config_dir()/data_dir().
exec env \
  ATUIN_CONFIG_DIR="$PROFILE_DIR/config/atuin" \
  XDG_DATA_HOME="$PROFILE_DIR/data" \
  atuin "$@"
