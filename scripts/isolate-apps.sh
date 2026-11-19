#!/usr/bin/env bash
# Run deployed applications under their own unprivileged account.
#
# ShipYard's platform services (Control API, Deploy Engine) run as the platform user, which
# usually has full sudo. Without this, every deployed app, every `bun install` postinstall
# script and every build command ran as that user too, so one vulnerable app or malicious
# dependency meant root on the server. After this script:
#
#   * builds, pre-deploy commands and running apps use APP_USER (no sudo, no access to the
#     platform user's home, platform .env files or TLS keys);
#   * apps are supervised by a separate pm0 daemon owned by APP_USER (systemd unit
#     shipyard-apps-pm0), and the Deploy Engine drives it through `sudo -u APP_USER`;
#   * a firewall guard drops replies from APP_USER sockets on any interface but loopback,
#     so an app that binds 0.0.0.0 is still only reachable through Nginx, whatever UFW or
#     the cloud security list allow;
#   * the platform user's own pm0 HTTP API moves from TCP 127.0.0.1:9615 (reachable by
#     every local account, unauthenticated) to a 0600 Unix socket.
#
# Then set SHIPYARD_APP_USER=<APP_USER> (and the PM0_* URLs printed at the end) in the
# repository .env and restart the Deploy Engine and Control API. Existing apps move to the
# app user on their next activation (redeploy, or rollback to the current build): the
# engine hands the checkout over, starts the app in the new daemon and removes the old
# process from the platform daemon.
#
# Idempotent. Run as root:  sudo scripts/isolate-apps.sh
set -euo pipefail

PLATFORM_USER="${PLATFORM_USER:-${SUDO_USER:-ubuntu}}"
APP_USER="${APP_USER:-shipyard-apps}"
APP_HOME="/var/lib/${APP_USER}"
RUNTIME_DIR="${RUNTIME_DIR:-/usr/local/lib/shipyard-runtime}"
APP_PM0_SOCKET_DIR="/run/${APP_USER}"
APP_PM0_HTTP="unix:${APP_PM0_SOCKET_DIR}/pm0-http.sock"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0)"
id "$PLATFORM_USER" >/dev/null 2>&1 || die "platform user '$PLATFORM_USER' does not exist"
[ "$PLATFORM_USER" != "$APP_USER" ] || die "APP_USER must differ from the platform user"
PLATFORM_HOME="$(getent passwd "$PLATFORM_USER" | cut -d: -f6)"
PLATFORM_GROUP="$(id -gn "$PLATFORM_USER")"

# --- 1. Account ---------------------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  say "creating system user $APP_USER"
  useradd --system --user-group --home-dir "$APP_HOME" --create-home \
    --shell /usr/sbin/nologin --comment "ShipYard deployed applications" "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$APP_HOME/run" "$APP_HOME/.pm0"
if id -nG "$APP_USER" | tr ' ' '\n' | grep -qxE 'sudo|admin|wheel|docker|lxd'; then
  die "$APP_USER is in a privileged group; remove it before continuing"
fi

# --- 2. Runtimes the app user can execute ---------------------------------------------------
# Version managers install into the platform user's home, which other accounts cannot
# enter. Copy the active Node prefix (node, npm, bun, pnpm...) and pm0 to a root-owned
# location and link them from /usr/local/bin, which sudo's secure_path includes.
resolve_bin() { # name -> absolute path of the platform user's binary, or empty
  local name="$1" found
  found="$(sudo -u "$PLATFORM_USER" -H bash -lc "command -v $name" 2>/dev/null || true)"
  if [ -z "$found" ]; then
    found="$(ls -1d "$PLATFORM_HOME"/.nvm/versions/node/*/bin/"$name" 2>/dev/null | sort -V | tail -1 || true)"
  fi
  [ -z "$found" ] && [ -x "$PLATFORM_HOME/.local/bin/$name" ] && found="$PLATFORM_HOME/.local/bin/$name"
  [ -z "$found" ] && [ -x "$PLATFORM_HOME/.bun/bin/$name" ] && found="$PLATFORM_HOME/.bun/bin/$name"
  printf '%s' "$found"
}

NODE_BIN="${NODE_BIN:-$(resolve_bin node)}"
BUN_BIN="${BUN_BIN:-$(resolve_bin bun)}"
PM0_BIN="${PM0_BIN:-$(resolve_bin pm0)}"
[ -n "$NODE_BIN" ] || die "node not found for $PLATFORM_USER (set NODE_BIN=/path/to/node)"
[ -n "$BUN_BIN" ] || die "bun not found for $PLATFORM_USER (set BUN_BIN=/path/to/bun)"
[ -n "$PM0_BIN" ] || die "pm0 not found for $PLATFORM_USER (set PM0_BIN=/path/to/pm0)"

NODE_PREFIX="$(dirname "$(dirname "$(readlink -f "$NODE_BIN")")")"
say "installing runtimes into $RUNTIME_DIR (node prefix: $NODE_PREFIX)"
install -d -o root -g root -m 0755 "$RUNTIME_DIR" "$RUNTIME_DIR/bin"
rm -rf "$RUNTIME_DIR/node.new"
cp -a "$NODE_PREFIX" "$RUNTIME_DIR/node.new"
chown -R root:root "$RUNTIME_DIR/node.new"
chmod -R go-w "$RUNTIME_DIR/node.new"
rm -rf "$RUNTIME_DIR/node.old"
[ -d "$RUNTIME_DIR/node" ] && mv "$RUNTIME_DIR/node" "$RUNTIME_DIR/node.old"
mv "$RUNTIME_DIR/node.new" "$RUNTIME_DIR/node"
rm -rf "$RUNTIME_DIR/node.old"

# bun may live outside the node prefix (~/.bun); always install the resolved binary.
install -o root -g root -m 0755 "$(readlink -f "$BUN_BIN")" "$RUNTIME_DIR/bin/bun"
ln -sfn bun "$RUNTIME_DIR/bin/bunx"
install -o root -g root -m 0755 "$(readlink -f "$PM0_BIN")" "$RUNTIME_DIR/bin/pm0"
for tool in node npm npx corepack pnpm pnpx yarn; do
  [ -e "$RUNTIME_DIR/node/bin/$tool" ] && ln -sfn "$RUNTIME_DIR/node/bin/$tool" "$RUNTIME_DIR/bin/$tool"
done
for tool in "$RUNTIME_DIR"/bin/*; do
  name="$(basename "$tool")"
  target="/usr/local/bin/$name"
  # Replace only our own links or links into a private home; never clobber real binaries.
  if [ -L "$target" ] || [ ! -e "$target" ]; then
    ln -sfn "$tool" "$target"
  else
    say "keeping existing $target (not a symlink)"
  fi
done
sudo -u "$APP_USER" -H bash -c 'bun --version >/dev/null && node --version >/dev/null && pm0 version >/dev/null' \
  || die "runtimes are not executable by $APP_USER"

# --- 3. sudo: the platform user may run commands as the app user, nothing more ----------
SUDOERS=/etc/sudoers.d/shipyard-apps
say "writing $SUDOERS"
cat >"$SUDOERS.tmp" <<EOF
# ShipYard: the platform user runs builds and the app pm0 daemon as $APP_USER.
# SETENV lets the Deploy Engine pass a project's environment (sudo -E) without putting
# secrets on a command line, where every local account could read them.
$PLATFORM_USER ALL=($APP_USER) NOPASSWD:SETENV: ALL
EOF
chmod 0440 "$SUDOERS.tmp"
visudo -cf "$SUDOERS.tmp" >/dev/null || die "generated sudoers file is invalid"
mv "$SUDOERS.tmp" "$SUDOERS"

# --- 4. pm0 daemon for applications ------------------------------------------------------
cat >"$APP_HOME/.pm0/config" <<EOF
PM0_HTTP_ADDR=$APP_PM0_HTTP
EOF
chown "$APP_USER:$APP_USER" "$APP_HOME/.pm0/config"

UNIT=/etc/systemd/system/shipyard-apps-pm0.service
say "writing $UNIT"
cat >"$UNIT" <<EOF
[Unit]
Description=pm0 supervisor for ShipYard deployed applications ($APP_USER)
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
Delegate=yes
User=$APP_USER
Group=$APP_USER
Environment=HOME=$APP_HOME
Environment=PM0_HOME=$APP_HOME/.pm0
Environment=PM0_HTTP_ADDR=$APP_PM0_HTTP
Environment=PATH=/usr/local/bin:/usr/bin:/bin
RuntimeDirectory=$APP_USER
RuntimeDirectoryMode=0711
RuntimeDirectoryPreserve=yes
ExecStart=/usr/local/bin/pm0 resurrect
# The Control API (platform user) reads process status through this socket. pm0 creates
# it 0600; hand it to the platform user's primary group only.
ExecStartPost=/bin/sh -c 'for i in \$(seq 50); do [ -S $APP_PM0_SOCKET_DIR/pm0-http.sock ] && break; sleep 0.1; done; chgrp $PLATFORM_GROUP $APP_PM0_SOCKET_DIR/pm0-http.sock && chmod 0660 $APP_PM0_SOCKET_DIR/pm0-http.sock'
ExecStop=/usr/local/bin/pm0 kill
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
# chgrp to a group the service user is not in needs privilege; run that step as root.
sed -i "s|^ExecStartPost=/bin/sh|ExecStartPost=+/bin/sh|" "$UNIT"
systemctl daemon-reload
systemctl enable shipyard-apps-pm0.service >/dev/null
systemctl restart shipyard-apps-pm0.service
sudo -u "$APP_USER" -H /usr/local/bin/pm0 ping >/dev/null || die "app pm0 daemon is not answering"

# --- 5. Firewall guard: app sockets answer only over loopback -------------------------
GUARD=/usr/local/sbin/shipyard-apps-guard
say "installing $GUARD"
cat >"$GUARD" <<EOF
#!/bin/sh
# Drop packets that $APP_USER sockets send in reply to connections opened from outside
# the host. Apps stay reachable through Nginx (loopback) and can still open outbound
# connections; a listener on 0.0.0.0 can no longer serve the internet directly.
set -e
for ipt in iptables ip6tables; do
  command -v \$ipt >/dev/null 2>&1 || continue
  \$ipt -w -N SHIPYARD-APPS-GUARD 2>/dev/null || \$ipt -w -F SHIPYARD-APPS-GUARD
  \$ipt -w -A SHIPYARD-APPS-GUARD -o lo -j RETURN
  \$ipt -w -A SHIPYARD-APPS-GUARD -m conntrack --ctdir REPLY -j DROP
  \$ipt -w -C OUTPUT -m owner --uid-owner $APP_USER -j SHIPYARD-APPS-GUARD 2>/dev/null \\
    || \$ipt -w -I OUTPUT 1 -m owner --uid-owner $APP_USER -j SHIPYARD-APPS-GUARD
done
EOF
chmod 0755 "$GUARD"
cat >/etc/systemd/system/shipyard-apps-guard.service <<EOF
[Unit]
Description=Keep ShipYard app ports loopback-only (owner-match firewall guard)
After=network-pre.target ufw.service docker.service
Before=shipyard-apps-pm0.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$GUARD

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now shipyard-apps-guard.service >/dev/null
systemctl restart shipyard-apps-guard.service

# --- 6. Platform pm0 HTTP API: Unix socket instead of open TCP --------------------------
PLATFORM_PM0_CONFIG="$PLATFORM_HOME/.pm0/config"
PLATFORM_PM0_SOCKET="unix:$PLATFORM_HOME/.pm0/http.sock"
if [ -f "$PLATFORM_PM0_CONFIG" ] && grep -qE '^PM0_HTTP_ADDR=[0-9.]+:' "$PLATFORM_PM0_CONFIG"; then
  say "moving $PLATFORM_USER's pm0 HTTP API to $PLATFORM_PM0_SOCKET"
  sed -i "s|^PM0_HTTP_ADDR=.*|PM0_HTTP_ADDR=$PLATFORM_PM0_SOCKET|" "$PLATFORM_PM0_CONFIG"
  # Re-exec the daemon in place so it picks up the address; managed apps keep running.
  sudo -u "$PLATFORM_USER" -H env PM0_HOME="$PLATFORM_HOME/.pm0" PM0_HTTP_ADDR="$PLATFORM_PM0_SOCKET" \
    "$RUNTIME_DIR/bin/pm0" update >/dev/null || say "run 'pm0 update' as $PLATFORM_USER to apply"
fi

cat <<EOF

Done. Next:
  1. In the ShipYard repository .env set:
       SHIPYARD_APP_USER=$APP_USER
       PM0_API_URL=$PLATFORM_PM0_SOCKET
       PM0_APPS_API_URL=$APP_PM0_HTTP
  2. Restart the platform:  pm0 restart deploy-engine control-api
  3. Re-activate each app (dashboard: redeploy, or roll back to the current build).
EOF
