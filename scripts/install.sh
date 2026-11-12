#!/usr/bin/env bash
# ShipYard installer: sets up a fresh Debian/Ubuntu server (or updates an existing one).
#
#   curl -fsSL https://raw.githubusercontent.com/thakurdotdev/shipyard/main/scripts/install.sh | bash
#   ./scripts/install.sh [install|update|doctor] [options]
#
# Every step checks before it acts, so re-running is safe. Configuration is one `.env` at
# the repository root with four values (PUBLIC_URL, SECRET, DATABASE_URL, REDIS_URL);
# everything else is derived or set from the dashboard (Settings, and /setup on first run).
# Existing values are never replaced unless you pass a new one, and SECRET is never
# regenerated: keys derived from it encrypt every project's stored env vars.
#
# Run `install.sh --help` for options.

set -Eeuo pipefail
# Debian keeps nginx, visudo etc. in sbin, which a normal user's PATH leaves out.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# ---------------------------------------------------------------------------------------------
# Defaults (each can also be set via environment variable, shown in --help)
# ---------------------------------------------------------------------------------------------
REPO_URL="${SHIPYARD_REPO:-https://github.com/thakurdotdev/shipyard.git}"
BRANCH="${SHIPYARD_BRANCH:-main}"
INSTALL_DIR="${SHIPYARD_DIR:-}"
APPS_DIR="${SHIPYARD_APPS_DIR:-/var/lib/shipyard/apps}"
CERTBOT_WEBROOT_DIR="/var/www/certbot"
NODE_MAJOR=24

ASSUME_YES="${SHIPYARD_YES:-0}"
SKIP_NODE="${SHIPYARD_SKIP_NODE:-0}"
SKIP_TLS="${SHIPYARD_SKIP_TLS:-0}"
NO_PULL=0
COMMAND=install

# Answers. Empty means "not given": fall back to the existing .env, then prompt/default.
A_DOMAIN="${SHIPYARD_DOMAIN:-}"
A_BASE_DOMAIN="${SHIPYARD_BASE_DOMAIN:-}"
A_EMAIL="${SHIPYARD_EMAIL:-}"
A_SERVER_HOST="${SHIPYARD_SERVER_HOST:-}"
A_DATABASE_URL="${SHIPYARD_DATABASE_URL:-}"
A_REDIS_URL="${SHIPYARD_REDIS_URL:-}"

# Keys that are generated once and must never be replaced on an existing install.
PROTECTED_KEYS=" SECRET ENCRYPTION_KEY BETTER_AUTH_SECRET "

usage() {
  cat <<'EOF'
ShipYard installer

Usage: install.sh [install|update|doctor] [options]

Commands:
  install   (default) Install everything that is missing, configure, build, migrate, start.
  update    Pull, rebuild the packages that changed, migrate, restart only what changed.
  doctor    Check the setup and report problems. Changes nothing.

Options (environment variable in brackets):
  --dir PATH              Install location (default: this checkout, else /opt/shipyard) [SHIPYARD_DIR]
  --branch NAME           Git branch to install (default: main)                     [SHIPYARD_BRANCH]
  --domain HOST           Dashboard domain, e.g. deploy.example.com. Leave empty to
                          serve the dashboard over plain HTTP on the server IP.      [SHIPYARD_DOMAIN]
  --base-domain HOST      Apps get <name>.<base-domain> (default: the dashboard domain
                          without its first label, deploy.example.com -> example.com) [SHIPYARD_BASE_DOMAIN]
  --email ADDR            Let's Encrypt account email (optional)                     [SHIPYARD_EMAIL]
  --server-host IP        Public IP of this server (auto-detected)                   [SHIPYARD_SERVER_HOST]
  --database-url URL      Use an existing Postgres instead of installing one         [SHIPYARD_DATABASE_URL]
  --redis-url URL         Use an existing Redis instead of installing one            [SHIPYARD_REDIS_URL]

GitHub, Cloudflare and email alerts are set up in the dashboard afterwards: the installer
prints a one-time setup link that creates the GitHub App in a click.
  --skip-node             Don't install Node.js (Bun is always installed)            [SHIPYARD_SKIP_NODE=1]
  --skip-tls              Don't request a Let's Encrypt certificate for the dashboard [SHIPYARD_SKIP_TLS=1]
  --no-pull               Don't git pull an existing checkout
  -y, --yes               Never prompt; use flags, env vars, existing values, defaults [SHIPYARD_YES=1]
  -h, --help              Show this help
EOF
}

# ---------------------------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_DIM=$'\e[2m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi
STEP_NO=0
WARNINGS=()

step() { STEP_NO=$((STEP_NO + 1)); printf '\n%s==> [%d] %s%s\n' "$C_BOLD$C_BLUE" "$STEP_NO" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
skip() { printf '    %s- %s (already done)%s\n' "$C_DIM" "$*" "$C_RESET"; }
warn() { printf '    %s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; WARNINGS+=("$*"); }
die() { printf '\n%sError:%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }
trap 'die "command failed (line $LINENO): $BASH_COMMAND"' ERR

have() { command -v "$1" >/dev/null 2>&1; }

# Run as root: directly when we are root, otherwise through sudo.
SUDO=""
as_root() { if [[ -n "$SUDO" ]]; then sudo "$@"; else "$@"; fi; }

# ---------------------------------------------------------------------------------------------
# Prompts. Read from /dev/tty so `curl ... | bash` can still ask questions.
# ---------------------------------------------------------------------------------------------
CAN_PROMPT=0
init_prompt() {
  if [[ "$ASSUME_YES" == "1" ]]; then return; fi
  if { : </dev/tty; } 2>/dev/null; then CAN_PROMPT=1; fi
}

# ask VAR "Question" "default" [secret]
# Leaves VAR alone when it already has a value.
ask() {
  local __var="$1" question="$2" default="${3:-}" secret="${4:-}" reply=""
  if [[ -n "${!__var:-}" ]]; then return; fi
  if [[ "$CAN_PROMPT" != "1" ]]; then
    printf -v "$__var" '%s' "$default"
    return
  fi
  local hint=""
  if [[ -n "$default" ]]; then
    if [[ -n "$secret" ]]; then hint=" [keep current]"; else hint=" [$default]"; fi
  fi
  if [[ -n "$secret" ]]; then
    read -r -s -p "    $question$hint: " reply </dev/tty || true
    echo >&2
  else
    read -r -p "    $question$hint: " reply </dev/tty || true
  fi
  printf -v "$__var" '%s' "${reply:-$default}"
}

confirm() { # confirm "Question" default(y|n)
  local default="${2:-y}" reply=""
  if [[ "$CAN_PROMPT" != "1" ]]; then [[ "$default" == "y" ]]; return; fi
  read -r -p "    $1 [$([[ $default == y ]] && echo Y/n || echo y/N)]: " reply </dev/tty || true
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

# ---------------------------------------------------------------------------------------------
# .env helpers. Values are written single-quoted so Bun doesn't expand `$` inside them.
# ---------------------------------------------------------------------------------------------
env_get() { # env_get FILE KEY -> value (unquoted) or empty
  local file="$1" key="$2" line
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" =~ ^\'(.*)\'[[:space:]]*$ ]] || [[ "$line" =~ ^\"(.*)\"[[:space:]]*$ ]]; then
    line="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$line"
}

# env_put FILE KEY VALUE MODE
#   MODE=fill  : write only when the key is missing or empty
#   MODE=set   : write when different (never for protected keys that already have a value)
env_put() {
  local file="$1" key="$2" value="$3" mode="${4:-fill}" current
  [[ "$value" == *"'"* ]] && die "$key contains a single quote, which .env files here can't hold"
  current="$(env_get "$file" "$key")"
  if [[ -n "$current" ]]; then
    [[ "$mode" == "fill" || -z "$value" ]] && return 0
    [[ "$current" == "$value" ]] && return 0
    [[ "$PROTECTED_KEYS" == *" $key "* ]] && return 0
  fi
  [[ -z "$value" && -z "$current" ]] && grep -qE "^${key}=" "$file" 2>/dev/null && return 0
  local tmp
  tmp="$(mktemp)"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null; then
    K="$key" V="'$value'" awk '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" ENVIRON["K"] "=" { if (!done) { print ENVIRON["K"] "=" ENVIRON["V"]; done=1 }; next }
      { print }' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    [[ -s "$tmp" && "$(tail -c1 "$tmp")" != "" ]] && echo >>"$tmp"
    printf "%s='%s'\n" "$key" "$value" >>"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

rand_hex() { openssl rand -hex "$1"; }

# ---------------------------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------------------------
parse_args() {
  if [[ $# -gt 0 && "$1" != -* ]]; then COMMAND="$1"; shift; fi
  while [[ $# -gt 0 ]]; do
    local opt="$1" val="${2:-}"
    case "$opt" in
      --dir) INSTALL_DIR="$val"; shift ;;
      --branch) BRANCH="$val"; shift ;;
      --domain) A_DOMAIN="$val"; shift ;;
      --base-domain) A_BASE_DOMAIN="$val"; shift ;;
      --email) A_EMAIL="$val"; shift ;;
      --server-host) A_SERVER_HOST="$val"; shift ;;
      --database-url) A_DATABASE_URL="$val"; shift ;;
      --redis-url) A_REDIS_URL="$val"; shift ;;
      --skip-node) SKIP_NODE=1 ;;
      --skip-tls) SKIP_TLS=1 ;;
      --no-pull) NO_PULL=1 ;;
      -y | --yes) ASSUME_YES=1 ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $opt (see --help)" ;;
    esac
    shift
  done
  case "$COMMAND" in install | update | doctor) ;; *) die "unknown command: $COMMAND (see --help)" ;; esac
}

# Pick the install dir: explicit flag, else the checkout this script lives in, else /opt/shipyard.
resolve_dir() {
  if [[ -n "$INSTALL_DIR" ]]; then return; fi
  local here=""
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  if [[ -n "$here" && -d "$here/packages/control-api" && -f "$here/ecosystem.config.js" ]]; then
    INSTALL_DIR="$here"
  else
    INSTALL_DIR="/opt/shipyard"
  fi
}

set_paths() {
  ROOT_ENV="$INSTALL_DIR/.env"
  # Per-package files from installs before the single .env. Still read (and they still win
  # at runtime), never written.
  API_ENV="$INSTALL_DIR/packages/control-api/.env"
  ENGINE_ENV="$INSTALL_DIR/packages/deploy-engine/.env"
}

# cfg_get KEY: the root .env first, then the legacy per-package files.
cfg_get() {
  local key="$1" value file
  for file in "$ROOT_ENV" "$API_ENV" "$ENGINE_ENV"; do
    value="$(env_get "$file" "$key")"
    if [[ -n "$value" ]]; then printf '%s' "$value"; return; fi
  done
}

# The one-time code that unlocks /setup: HMAC-SHA256(SECRET, "shipyard:setup"), as the
# Control API derives it (packages/config).
setup_token() {
  local secret
  secret="$(cfg_get SECRET)"
  [[ -n "$secret" ]] || secret="$(cfg_get BETTER_AUTH_SECRET)"
  [[ -n "$secret" ]] || return 0
  printf 'shipyard:setup' | openssl dgst -sha256 -hmac "$secret" | awk '{print $NF}' | cut -c1-24
}

# ---------------------------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------------------------
preflight() {
  step "Checking this server"
  [[ "$(uname -s)" == "Linux" ]] || die "ShipYard installs on Linux only."
  # shellcheck disable=SC1091
  . /etc/os-release 2>/dev/null || die "can't read /etc/os-release"
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
    die "this installer supports Debian and Ubuntu (found: ${PRETTY_NAME:-unknown})."
  fi
  ok "${PRETTY_NAME:-$ID}"

  case "$(uname -m)" in
    x86_64 | amd64) ARCH=amd64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  ok "architecture $ARCH"

  RUN_USER="$(id -un)"
  RUN_GROUP="$(id -gn)"
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
    warn "running as root: ShipYard and every deployed app will run as root. A regular sudo user is safer."
  else
    SUDO=sudo
    have sudo || die "sudo is required. Install it as root first: apt-get install -y sudo"
    if ! sudo -n true 2>/dev/null; then
      info "Some steps need root; sudo will ask for your password."
      sudo -v || die "sudo access is required."
    fi
    ok "user $RUN_USER with sudo"
  fi

  local mem_mb
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if ((mem_mb < 1800)); then
    warn "only ${mem_mb} MB RAM: building the dashboard needs about 2 GB. Add swap if the build gets killed."
  else
    ok "${mem_mb} MB RAM"
  fi
}

apt_install() {
  local missing=() pkg
  for pkg in "$@"; do
    dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed" || missing+=("$pkg")
  done
  if ((${#missing[@]} == 0)); then
    skip "packages: $*"
    return
  fi
  info "installing: ${missing[*]}"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
  ok "installed ${missing[*]}"
}

install_system_packages() {
  step "System packages"
  local pkgs=(git curl ca-certificates unzip openssl nginx certbot iproute2 sudo)
  [[ -z "$A_DATABASE_URL" ]] && pkgs+=(postgresql)
  pkgs+=(postgresql-client)
  [[ -z "$A_REDIS_URL" ]] && pkgs+=(redis-server)
  pkgs+=(redis-tools)
  apt_install "${pkgs[@]}"
}

# Make sure a binary is reachable from /usr/local/bin. The pm0 boot unit starts the daemon with
# systemd's default PATH, so apps it restarts after a reboot only find tools linked there.
link_to_usr_local() {
  local name="$1" src
  src="$(command -v "$name" 2>/dev/null || true)"
  [[ -n "$src" ]] || return 0
  src="$(readlink -f "$src")"
  if [[ "$(readlink -f "/usr/local/bin/$name" 2>/dev/null)" == "$src" ]]; then return 0; fi
  if [[ -e "/usr/local/bin/$name" && ! -L "/usr/local/bin/$name" ]]; then return 0; fi
  as_root ln -sf "$src" "/usr/local/bin/$name"
  info "linked /usr/local/bin/$name -> $src"
}

install_runtimes() {
  step "Bun, Node.js and pm0"
  export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"

  if have bun; then
    skip "bun $(bun --version)"
  else
    info "installing Bun"
    curl -fsSL https://bun.sh/install | bash >/dev/null
    have bun || die "Bun install failed"
    ok "bun $(bun --version)"
  fi
  link_to_usr_local bun
  link_to_usr_local bunx
  [[ -e /usr/local/bin/bunx ]] || as_root ln -sf "$(readlink -f "$(command -v bun)")" /usr/local/bin/bunx

  if [[ "$SKIP_NODE" == "1" ]]; then
    info "skipping Node.js (--skip-node)"
  else
    local node_major=0
    have node && node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if ((node_major >= 20)); then
      skip "node $(node --version)"
    else
      info "installing Node.js $NODE_MAJOR (some deployed apps call node directly)"
      local ns
      ns="$(mktemp)"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "$ns"
      as_root bash "$ns" >/dev/null 2>&1
      rm -f "$ns"
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
      ok "node $(node --version)"
    fi
    link_to_usr_local node
  fi

  if have pm0; then
    skip "$(pm0 version 2>/dev/null | head -n1)"
    link_to_usr_local pm0
  else
    info "installing pm0"
    local tmp
    tmp="$(mktemp)"
    curl -fsSL "https://github.com/thakurdotdev/pm0/releases/latest/download/pm0-linux-$ARCH" -o "$tmp"
    as_root install -m 0755 "$tmp" /usr/local/bin/pm0
    rm -f "$tmp"
    have pm0 || die "pm0 install failed"
    ok "$(pm0 version | head -n1)"
  fi
}

fetch_code() {
  step "ShipYard code in $INSTALL_DIR"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    if [[ "$NO_PULL" == "1" ]]; then
      skip "checkout (--no-pull)"
    elif ! git -C "$INSTALL_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      warn "branch $(git -C "$INSTALL_DIR" branch --show-current) has no upstream; not pulling."
    elif [[ -n "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no)" ]]; then
      warn "$INSTALL_DIR has local changes; not pulling. Commit or stash them, then run update."
    else
      local before after
      before="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
      git -C "$INSTALL_DIR" pull --ff-only --quiet
      after="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
      if [[ "$before" == "$after" ]]; then skip "up to date at ${after:0:7}"; else ok "updated ${before:0:7} -> ${after:0:7}"; fi
    fi
  else
    if [[ -e "$INSTALL_DIR" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
      die "$INSTALL_DIR exists and is not a ShipYard checkout. Pick another --dir."
    fi
    as_root mkdir -p "$INSTALL_DIR"
    as_root chown "$RUN_USER:$RUN_GROUP" "$INSTALL_DIR"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "cloned $REPO_URL ($BRANCH)"
  fi
}

ensure_postgres() {
  step "PostgreSQL"
  local existing
  existing="$(cfg_get DATABASE_URL)"
  if [[ -n "$A_DATABASE_URL" ]]; then
    DATABASE_URL="$A_DATABASE_URL"
    info "using the database URL you provided"
  elif [[ -n "$existing" ]]; then
    DATABASE_URL="$existing"
    skip "DATABASE_URL already configured"
  else
    as_root systemctl enable --now postgresql >/dev/null 2>&1 || true
    local tries=0
    until pg_root -qtAc 'SELECT 1' >/dev/null 2>&1; do
      tries=$((tries + 1)); ((tries > 20)) && die "PostgreSQL is not accepting connections"; sleep 1
    done
    local db_pass role_exists db_exists
    db_pass="$(rand_hex 24)"
    role_exists="$(pg_root -tAc "SELECT 1 FROM pg_roles WHERE rolname='shipyard'")"
    if [[ "$role_exists" == "1" ]]; then
      # The role exists but we have no record of its password (no .env): give it a new one.
      pg_root -qc "ALTER ROLE shipyard WITH LOGIN PASSWORD '$db_pass'" >/dev/null
      info "reset the password of the existing shipyard role"
    else
      pg_root -qc "CREATE ROLE shipyard WITH LOGIN PASSWORD '$db_pass'" >/dev/null
      ok "created role shipyard"
    fi
    db_exists="$(pg_root -tAc "SELECT 1 FROM pg_database WHERE datname='shipyard'")"
    if [[ "$db_exists" == "1" ]]; then
      skip "database shipyard"
    else
      pg_root -qc "CREATE DATABASE shipyard OWNER shipyard" >/dev/null
      ok "created database shipyard"
    fi
    DATABASE_URL="postgres://shipyard:${db_pass}@127.0.0.1:5432/shipyard"
  fi
  psql "$DATABASE_URL" -qtAc 'SELECT 1' >/dev/null 2>&1 || die "can't connect with DATABASE_URL. Check the URL and that Postgres is running."
  ok "connected"
}

# psql as the postgres superuser (peer auth). cd / avoids "could not change directory" noise.
pg_root() { (cd / && sudo -u postgres psql "$@"); }

ensure_redis() {
  step "Redis"
  local existing
  existing="$(cfg_get REDIS_URL)"
  if [[ -n "$A_REDIS_URL" ]]; then
    REDIS_URL="$A_REDIS_URL"
  elif [[ -n "$existing" ]]; then
    REDIS_URL="$existing"
    skip "REDIS_URL already configured"
  else
    as_root systemctl enable --now redis-server >/dev/null 2>&1 || true
    REDIS_URL="redis://127.0.0.1:6379/0"
  fi
  local tries=0
  until [[ "$(redis-cli -u "$REDIS_URL" ping 2>/dev/null)" == "PONG" ]]; do
    tries=$((tries + 1)); ((tries > 20)) && die "Redis at $REDIS_URL does not answer PING"; sleep 1
  done
  ok "redis answers PING"
}

detect_ip() {
  local ip=""
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [[ "$ip" =~ ^[0-9.]+$ ]] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$ip"
}

configure_env() {
  step "Configuration (.env)"
  touch "$ROOT_ENV"
  chmod 600 "$ROOT_ENV"

  # Existing values become the defaults, so re-running only asks about what's missing.
  local cur_origin cur_domain=""
  cur_origin="$(cfg_get PUBLIC_URL)"
  [[ -n "$cur_origin" ]] || cur_origin="$(cfg_get CLIENT_URL)"
  if [[ "$cur_origin" =~ ^https://([^/:]+) ]]; then cur_domain="${BASH_REMATCH[1]}"; fi
  if [[ -n "$cur_origin" && -z "$cur_domain" ]]; then cur_domain="-"; fi # existing IP-only install

  local DOMAIN="$A_DOMAIN" BASE_DOMAIN="$A_BASE_DOMAIN" EMAIL="$A_EMAIL" SERVER_HOST="$A_SERVER_HOST"
  if [[ -z "$DOMAIN" && -n "$cur_domain" && "$cur_domain" != "-" ]]; then DOMAIN="$cur_domain"; fi
  if [[ -z "$DOMAIN" && "$cur_domain" != "-" ]]; then
    info "Dashboard address. Point its DNS A record at this server first."
    info "Leave empty to use plain HTTP on the server IP (fine for trying ShipYard out)."
    ask DOMAIN "Dashboard domain (e.g. deploy.example.com)" ""
  fi
  [[ "$DOMAIN" == "-" ]] && DOMAIN=""

  # Apps go under the dashboard's parent domain unless told otherwise; only an override is
  # stored, so changing PUBLIC_URL later moves both.
  local derived_base="${DOMAIN#*.}"
  if [[ -z "$DOMAIN" ]]; then derived_base=""; elif [[ "$derived_base" != *.* ]]; then derived_base="$DOMAIN"; fi
  [[ -z "$BASE_DOMAIN" ]] && BASE_DOMAIN="$(cfg_get BASE_DOMAIN)"
  if [[ -n "$DOMAIN" && -z "$BASE_DOMAIN" && "$CAN_PROMPT" == "1" ]]; then
    ask BASE_DOMAIN "Base domain for apps (apps get <name>.<base domain>)" "$derived_base"
  fi
  [[ "$BASE_DOMAIN" == "$derived_base" ]] && BASE_DOMAIN=""
  [[ -z "$DOMAIN" && -z "$BASE_DOMAIN" ]] && warn "no domain: apps are reachable only once you set one (re-run with --domain)."

  [[ -z "$EMAIL" ]] && EMAIL="$(cfg_get CERTBOT_EMAIL)"
  if [[ -n "$DOMAIN" && -z "$EMAIL" && "$CAN_PROMPT" == "1" ]]; then
    ask EMAIL "Email for the Let's Encrypt account (optional)" ""
  fi

  [[ -z "$SERVER_HOST" ]] && SERVER_HOST="$(cfg_get SERVER_HOST)"
  local ip="$SERVER_HOST"
  [[ -n "$ip" ]] || ip="$(detect_ip)"

  if [[ -n "$DOMAIN" ]]; then ORIGIN="https://$DOMAIN"; else ORIGIN="http://$ip"; fi
  DASHBOARD_DOMAIN="$DOMAIN"
  CERT_EMAIL="$EMAIL"
  SERVER_HOST_FOR_SUMMARY="$ip"

  local f="$ROOT_ENV"
  env_put "$f" NODE_ENV production set
  env_put "$f" PUBLIC_URL "$ORIGIN" set
  env_put "$f" DATABASE_URL "$DATABASE_URL" set
  env_put "$f" REDIS_URL "$REDIS_URL" set
  # One master secret; installs that predate it keep their BETTER_AUTH_SECRET and
  # ENCRYPTION_KEY (still in the legacy files), which take precedence over derived keys.
  env_put "$f" SECRET "$(rand_hex 32)" fill
  [[ -n "$BASE_DOMAIN" ]] && env_put "$f" BASE_DOMAIN "$BASE_DOMAIN" set
  [[ -n "$A_SERVER_HOST" ]] && env_put "$f" SERVER_HOST "$A_SERVER_HOST" set
  [[ -n "$A_EMAIL" ]] && env_put "$f" CERTBOT_EMAIL "$A_EMAIL" set

  if [[ -f "$API_ENV" || -f "$ENGINE_ENV" ]]; then
    ok "wrote .env (the older per-package .env files are still read and take precedence)"
  else
    ok "wrote .env (mode 600)"
  fi
  return 0
}

ensure_dirs_and_sudo() {
  step "Directories and permissions"
  if [[ -d "$APPS_DIR" && -w "$APPS_DIR" ]]; then
    skip "$APPS_DIR"
  else
    as_root mkdir -p "$APPS_DIR"
    as_root chown -R "$RUN_USER:$RUN_GROUP" "$APPS_DIR"
    ok "created $APPS_DIR"
  fi
  # Nginx serves static (Vite) builds straight from here, so it must be able to traverse it.
  as_root chmod 755 "$(dirname "$APPS_DIR")" "$APPS_DIR"
  if [[ -d "$CERTBOT_WEBROOT_DIR" ]]; then skip "$CERTBOT_WEBROOT_DIR"; else as_root mkdir -p "$CERTBOT_WEBROOT_DIR" && ok "created $CERTBOT_WEBROOT_DIR"; fi
  as_root chmod 755 "$CERTBOT_WEBROOT_DIR"

  # The deploy engine writes Nginx configs and requests certificates through `sudo` with no
  # terminal, so those commands must not ask for a password.
  [[ -z "$SUDO" ]] && { skip "running as root, no sudo rule needed"; return; }
  local rule=/etc/sudoers.d/shipyard
  if sudo -n -l nginx -t >/dev/null 2>&1 && sudo -n -l certbot --version >/dev/null 2>&1 \
    && sudo -n -l systemctl reload nginx >/dev/null 2>&1; then
    skip "passwordless sudo for the deploy engine"
    return
  fi
  local cmds=() c
  for c in nginx certbot openssl mkdir chmod chown mv ln rm; do
    local p
    p="$(command -v "$c" || true)"
    [[ -n "$p" ]] && cmds+=("$p")
  done
  cmds+=("$(command -v systemctl) reload nginx")
  local tmp
  tmp="$(mktemp)"
  {
    echo "# Written by the ShipYard installer: lets the deploy engine manage Nginx and certificates."
    printf '%s ALL=(root) NOPASSWD: ' "$RUN_USER"
    (IFS=,; printf '%s\n' "${cmds[*]}" | sed 's/,/, /g')
  } >"$tmp"
  sudo visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "generated sudoers rule failed validation"; }
  sudo install -m 0440 -o root -g root "$tmp" "$rule"
  rm -f "$tmp"
  ok "added $rule"
}

build_all() {
  step "Install dependencies and build"
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null
  ok "dependencies installed"
  build_package control-api
  build_package deploy-engine
  build_package ui
}

build_package() {
  local pkg="$1"
  info "building $pkg"
  (cd "$INSTALL_DIR/packages/$pkg" && NODE_ENV=production PLATFORM_ENV=production bun run build >"/tmp/shipyard-build-$pkg.log" 2>&1) \
    || { tail -n 40 "/tmp/shipyard-build-$pkg.log" >&2; die "build of $pkg failed (full log: /tmp/shipyard-build-$pkg.log)"; }
  ok "built $pkg"
}

migrate_db() {
  step "Database migrations"
  local out
  out="$(cd "$INSTALL_DIR/packages/control-api" && bun run migrate 2>&1)" || { echo "$out" >&2; die "migration failed"; }
  ok "database schema is up to date"
}

write_nginx_site() {
  step "Nginx site for the dashboard"
  local avail=/etc/nginx/sites-available/shipyard enabled=/etc/nginx/sites-enabled/shipyard
  local name="${DASHBOARD_DOMAIN:-_}"
  local cert_dir="/etc/letsencrypt/live/$DASHBOARD_DOMAIN"
  local have_cert=0
  [[ -n "$DASHBOARD_DOMAIN" ]] && as_root test -f "$cert_dir/fullchain.pem" && have_cert=1

  if [[ -f "$avail" ]] && ! grep -q "Managed by the ShipYard installer" "$avail"; then
    skip "$avail exists and was written by hand; leaving it alone"
    return
  fi

  # IP-only: the dashboard becomes the default site on port 80, replacing the stock
  # "Welcome to nginx" page (two default_server blocks would fail `nginx -t`).
  if [[ -z "$DASHBOARD_DOMAIN" && -L /etc/nginx/sites-enabled/default \
    && "$(readlink -f /etc/nginx/sites-enabled/default)" == /etc/nginx/sites-available/default ]]; then
    as_root rm -f /etc/nginx/sites-enabled/default
    info "disabled the stock default Nginx site"
  fi

  # Without a certificate yet, serve plain HTTP (with the ACME path) so certbot can verify.
  render_nginx "$name" "$have_cert" | as_root tee "$avail.new" >/dev/null
  install_nginx_conf "$avail" "$enabled"

  if [[ -z "$DASHBOARD_DOMAIN" ]]; then
    ok "dashboard served on http://$SERVER_HOST_FOR_SUMMARY"
    return
  fi

  if ((have_cert)); then
    ok "HTTPS with the existing certificate for $DASHBOARD_DOMAIN"
    return
  fi
  if [[ "$SKIP_TLS" == "1" ]]; then
    warn "skipped the certificate (--skip-tls); the dashboard is on plain HTTP for now"
    return
  fi
  info "requesting a Let's Encrypt certificate for $DASHBOARD_DOMAIN"
  local email_args=(--register-unsafely-without-email)
  [[ -n "$CERT_EMAIL" ]] && email_args=(--email "$CERT_EMAIL")
  if as_root certbot certonly --webroot -w "$CERTBOT_WEBROOT_DIR" -d "$DASHBOARD_DOMAIN" \
    --agree-tos --non-interactive --keep-until-expiring "${email_args[@]}" >/tmp/shipyard-certbot.log 2>&1; then
    render_nginx "$name" 1 | as_root tee "$avail.new" >/dev/null
    install_nginx_conf "$avail" "$enabled"
    ok "HTTPS enabled for $DASHBOARD_DOMAIN"
  else
    warn "certificate request failed (see /tmp/shipyard-certbot.log). Check that $DASHBOARD_DOMAIN points at this server, then re-run. The dashboard is on plain HTTP until then, and sign-in won't work over HTTP."
  fi
}

# Validate the new config; roll back to the previous one if Nginx rejects it.
install_nginx_conf() {
  local avail="$1" enabled="$2" backup=""
  if [[ -f "$avail" ]]; then backup="$(mktemp)"; as_root cat "$avail" >"$backup"; fi
  as_root mv "$avail.new" "$avail"
  as_root ln -sf "$avail" "$enabled"
  if ! as_root nginx -t >/tmp/shipyard-nginx.log 2>&1; then
    if [[ -n "$backup" ]]; then as_root tee "$avail" <"$backup" >/dev/null; else as_root rm -f "$avail" "$enabled"; fi
    cat /tmp/shipyard-nginx.log >&2
    die "Nginx rejected the dashboard config; restored the previous one"
  fi
  [[ -n "$backup" ]] && rm -f "$backup"
  as_root systemctl enable --now nginx >/dev/null 2>&1 || true
  as_root systemctl reload nginx
}

render_nginx() { # render_nginx SERVER_NAME TLS(0|1)
  local name="$1" tls="$2" listen80="listen 80;"
  [[ "$name" == "_" ]] && listen80="listen 80 default_server;"
  local proxy='
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;'
  local locations="
    client_max_body_size 50m;

    location /api/ {
        proxy_pass http://127.0.0.1:4010;$proxy
    }

    location / {
        proxy_pass http://127.0.0.1:4013;$proxy
    }"
  cat <<EOF
# Managed by the ShipYard installer. Edits are kept only if you remove this line.
server {
    $listen80
    server_name $name;

    location /.well-known/acme-challenge/ {
        root $CERTBOT_WEBROOT_DIR;
    }
EOF
  if [[ "$tls" == "1" ]]; then
    cat <<EOF

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name $name;

    ssl_certificate /etc/letsencrypt/live/$name/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$name/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
$locations
}
EOF
  else
    printf '%s\n}\n' "$locations"
  fi
}

start_services() {
  step "Start services with pm0"
  cd "$INSTALL_DIR"
  local running
  running="$(pm0 jlist 2>/dev/null || echo '[]')"
  local name
  for name in control-api deploy-engine ui; do
    if grep -q "\"name\":\"$name\"" <<<"${running// /}"; then
      pm0 restart "$name" >/dev/null
      ok "restarted $name"
    else
      pm0 start ecosystem.config.js --only "$name" >/dev/null
      ok "started $name"
    fi
  done
  pm0 save >/dev/null
  ok "saved the process list"

  if [[ ! -d /run/systemd/system ]]; then
    warn "no systemd here: add 'pm0 resurrect' to your boot scripts so apps come back after a reboot"
  elif [[ -f "/etc/systemd/system/pm0-$RUN_USER.service" ]]; then
    skip "pm0 starts on boot (pm0-$RUN_USER.service)"
  else
    pm0 startup --print | grep -v '^\[pm0\]' | as_root bash >/dev/null
    ok "pm0 starts on boot (pm0-$RUN_USER.service)"
  fi
}

wait_http() { # wait_http URL SECONDS [any]
  local url="$1" limit="${2:-60}" any="${3:-}" i=0 code
  while ((i < limit)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    if [[ "$code" =~ ^[234] ]] || [[ -n "$any" && "$code" != "000" ]]; then return 0; fi
    sleep 2
    i=$((i + 2))
  done
  return 1
}

health_check() {
  step "Health checks"
  local failed=0
  if wait_http "http://127.0.0.1:4010/api" 60; then ok "control-api answers on :4010"; else warn "control-api is not answering: pm0 logs control-api"; failed=1; fi
  if wait_http "http://127.0.0.1:4012/" 60 any; then ok "deploy-engine answers on :4012"; else warn "deploy-engine is not answering: pm0 logs deploy-engine"; failed=1; fi
  if wait_http "http://127.0.0.1:4013/login" 90; then ok "dashboard answers on :4013"; else warn "dashboard is not answering: pm0 logs ui"; failed=1; fi
  return "$failed"
}

summary() {
  local origin token status=""
  origin="$(cfg_get PUBLIC_URL)"
  [[ -n "$origin" ]] || origin="$(cfg_get CLIENT_URL)"
  token="$(setup_token)"
  status="$(curl -fsS --max-time 5 http://127.0.0.1:4010/setup/status 2>/dev/null || true)"
  printf '\n%s ShipYard is installed%s\n\n' "$C_BOLD$C_GREEN" "$C_RESET"
  printf '  Dashboard:        %s\n' "$origin"
  printf '  Install dir:      %s  (settings: %s)\n' "$INSTALL_DIR" "$ROOT_ENV"
  printf '  Deployed apps:    %s\n' "$APPS_DIR"
  printf '  Processes:        pm0 ls   |   logs: pm0 logs control-api\n'
  printf '  Update later:     %s/scripts/install.sh update\n' "$INSTALL_DIR"
  if [[ "$status" == *'"github_login_ready":false'* && -n "$token" ]]; then
    printf '\n%s  Next: connect GitHub (one click) at%s\n' "$C_BOLD" "$C_RESET"
    printf '    %s/setup?token=%s\n' "$origin" "$token"
    printf '  The first GitHub account to sign in becomes the owner.\n'
  fi
  if ((${#WARNINGS[@]})); then
    printf '\n%s  Needs attention:%s\n' "$C_YELLOW" "$C_RESET"
    local w
    for w in "${WARNINGS[@]}"; do printf '    - %s\n' "$w"; done
  fi
  echo
}

# ---------------------------------------------------------------------------------------------
# update: pull, rebuild what changed, migrate if needed, restart what changed
# ---------------------------------------------------------------------------------------------
# Older installs keep settings in packages/*/.env. Add the root .env next to them (without
# touching them) so every service sees the same PUBLIC_URL and SECRET. Never prompts.
ensure_root_env() {
  [[ -f "$API_ENV" || -f "$ENGINE_ENV" ]] || return 0
  local origin
  origin="$(cfg_get PUBLIC_URL)"
  [[ -n "$origin" ]] || origin="$(cfg_get CLIENT_URL)"
  [[ -n "$origin" ]] || origin="$(cfg_get BETTER_AUTH_URL)"
  touch "$ROOT_ENV"
  chmod 600 "$ROOT_ENV"
  [[ -n "$origin" ]] && env_put "$ROOT_ENV" PUBLIC_URL "${origin%/}" fill
  env_put "$ROOT_ENV" SECRET "$(rand_hex 32)" fill
  local k v
  for k in DATABASE_URL REDIS_URL; do
    v="$(cfg_get "$k")"
    [[ -n "$v" ]] && env_put "$ROOT_ENV" "$k" "$v" fill
  done
  return 0
}

cmd_update() {
  preflight
  export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"
  have bun || die "bun not found; run install first"
  [[ -d "$INSTALL_DIR/.git" ]] || die "$INSTALL_DIR is not a ShipYard checkout; run install first"
  step "Pull latest code"
  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no)" ]] || die "$INSTALL_DIR has local changes; commit or stash them first"
  local before after
  before="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  git -C "$INSTALL_DIR" pull --ff-only --quiet
  after="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  if [[ "$before" == "$after" ]]; then
    ok "already up to date at ${after:0:7}; nothing to do"
    return
  fi
  ok "${before:0:7} -> ${after:0:7}"
  ensure_root_env
  local changed
  changed="$(git -C "$INSTALL_DIR" diff --name-only "$before" "$after")"
  local deps_changed=0 config_changed=0 pkgs=() p
  grep -qE '(^|/)(package\.json|bun\.lock)$' <<<"$changed" && deps_changed=1
  # Shared config is loaded at runtime by both services, so it restarts both.
  grep -q '^packages/config/' <<<"$changed" && config_changed=1
  for p in control-api deploy-engine ui; do
    if ((deps_changed)) || grep -q "^packages/$p/" <<<"$changed" \
      || { ((config_changed)) && [[ "$p" != ui ]]; }; then
      pkgs+=("$p")
    fi
  done

  step "Rebuild changed packages"
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null
  if ((${#pkgs[@]} == 0)); then skip "no package changed"; fi
  for p in "${pkgs[@]}"; do build_package "$p"; done

  if grep -q '^packages/control-api/drizzle/' <<<"$changed"; then migrate_db; fi

  if ((${#pkgs[@]})); then
    step "Restart"
    for p in "${pkgs[@]}"; do pm0 restart "$p" >/dev/null && ok "restarted $p"; done
    pm0 save >/dev/null
    health_check || true
  fi
  printf '\n%sUpdated to %s%s\n' "$C_GREEN" "${after:0:7}" "$C_RESET"
}

# ---------------------------------------------------------------------------------------------
# doctor: read-only report
# ---------------------------------------------------------------------------------------------
cmd_doctor() {
  export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"
  local bad=0
  check() { # check "label" command...
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$label"; else printf '    %s✗%s %s\n' "$C_RED" "$C_RESET" "$label"; bad=$((bad + 1)); fi
  }
  step "Tools"
  check "bun" have bun
  check "bun in /usr/local/bin (needed after reboot)" test -x /usr/local/bin/bun
  check "pm0" have pm0
  check "node" have node
  check "git" have git
  check "nginx" have nginx
  check "certbot" have certbot
  step "Configuration"
  check "checkout at $INSTALL_DIR" test -d "$INSTALL_DIR/.git"
  check ".env at $ROOT_ENV" test -f "$ROOT_ENV"
  local k
  for k in PUBLIC_URL SECRET DATABASE_URL; do
    check "$k set" test -n "$(cfg_get "$k")"
  done
  local key
  key="$(cfg_get ENCRYPTION_KEY)"
  [[ -n "$key" ]] && check "legacy ENCRYPTION_KEY is 32 characters" test "${#key}" -eq 32
  local apps
  apps="$(cfg_get BASE_DIR)"
  check "apps dir ${apps:-$APPS_DIR} writable" test -w "${apps:-$APPS_DIR}"
  step "Services"
  check "Postgres reachable" psql "$(cfg_get DATABASE_URL)" -qtAc 'SELECT 1'
  local redis_url
  redis_url="$(cfg_get REDIS_URL)"
  check "Redis reachable" test "$(redis-cli -u "${redis_url:-redis://127.0.0.1:6379/0}" ping 2>/dev/null)" = PONG
  check "nginx config valid" sudo -n nginx -t
  check "passwordless sudo for nginx/certbot" sudo -n -l certbot --version
  check "pm0 boot unit" test -f "/etc/systemd/system/pm0-$(id -un).service"
  check "control-api on :4010" curl -fsS --max-time 3 http://127.0.0.1:4010/api
  check "deploy-engine on :4012" curl -s -o /dev/null --max-time 3 http://127.0.0.1:4012/
  check "dashboard on :4013" curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:4013/login
  local status
  status="$(curl -fsS --max-time 3 http://127.0.0.1:4010/setup/status 2>/dev/null || true)"
  check "GitHub App connected (Settings in the dashboard)" grep -q '"github_app_ready":true' <<<"$status"
  echo
  if ((bad)); then printf '%s%d problem(s) found.%s\n' "$C_YELLOW" "$bad" "$C_RESET"; return 1; fi
  printf '%sEverything looks good.%s\n' "$C_GREEN" "$C_RESET"
}

# ---------------------------------------------------------------------------------------------
main() {
  parse_args "$@"
  resolve_dir
  set_paths
  init_prompt
  case "$COMMAND" in
    doctor) trap - ERR; cmd_doctor; return ;;
    update) cmd_update; return ;;
  esac

  printf '%sShipYard installer%s  (dir: %s)\n' "$C_BOLD" "$C_RESET" "$INSTALL_DIR"
  preflight
  install_system_packages
  install_runtimes
  fetch_code
  set_paths
  ensure_postgres
  ensure_redis
  configure_env
  ensure_dirs_and_sudo
  build_all
  migrate_db
  write_nginx_site
  start_services
  health_check || true
  summary
}

main "$@"
