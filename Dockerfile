# syntax=docker/dockerfile:1

# ─── Build the dashboard ─────────────────────────────────────────────────────
FROM oven/bun:1.4-debian AS builder
WORKDIR /build

# Dependencies first, so source edits do not invalidate the install layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# Regenerates the embedded migration manifest, typechecks, then compiles.
# Migrations are imported as text, so they travel inside the binary.
RUN bun run build.ts --current

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# The atuin client is NOT baked in. It is fetched at runtime from GitHub
# Releases (sha256-verified) into /config, which means upgrading atuin is an
# ATUIN_VERSION change and a restart rather than a dashboard image rebuild.
# Egress to GitHub is therefore required on first boot; if it is unavailable,
# Doctor reports the failure rather than the container degrading silently.
#
# The alternative, for a host that already has atuin: bind-mount it and point
# ATUIN_BIN at the mount, e.g.
#   -v /path/to/atuin:/usr/local/bin/atuin:ro -e ATUIN_BIN=/usr/local/bin/atuin
# Discovery prefers ATUIN_BIN, then PATH, then the downloaded copy.
#
# That binary must be the MUSL build. atuin's official installer places a glibc
# build, which links against the host's libc: an Ubuntu 24.04 binary needs
# GLIBC 2.38+ and will not start on this bookworm base (2.36). The musl release
# is statically linked and runs anywhere -- it is what the runtime download
# fetches, so bind-mounting is only worth it to avoid the download entirely.
#
# ca-certificates: HTTPS to the sync server and to GitHub.
# tar: unpacks the release. curl: healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tar curl \
 && rm -rf /var/lib/apt/lists/*

# uid 1000 so bind-mounted host directories line up with a typical user.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin atuin \
 && mkdir -p /data /config \
 && chown -R atuin:atuin /data /config

COPY --from=builder /build/binaries/atuin-dashboard-linux-* /usr/local/bin/atuin-dashboard

# 0.0.0.0 inside the container, because loopback there is unreachable from the
# host. The API is unauthenticated, so docker-compose publishes the port on the
# host's loopback only -- exposing it beyond that needs auth in front.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    ALLOW_PUBLIC_BIND=1 \
    PORT=3001 \
    ATUIN_PROFILE=live \
    ATUIN_CLIENT_DATA_DIR=/data/atuin \
    ATUIN_CLIENT_CONFIG_DIR=/config/atuin \
    DASHBOARD_CONFIG_DIR=/config/dashboard \
    ATUIN_VERSION=18.20.1

# /data holds the atuin client's databases and key; /config holds the
# dashboard's own database and the binary it downloads. Both must persist:
# losing /data means a full re-sync, losing the key means unreadable records.
VOLUME ["/data", "/config"]

USER atuin
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null "http://localhost:${PORT}/api/setup/status" || exit 1

ENTRYPOINT ["/usr/local/bin/atuin-dashboard"]
