#!/bin/sh
# Runs Bun's built-in linter (configured under [lint] in bunfig.toml) with any arguments
# given, e.g. `--fix` or file paths from lint-staged.
#
# `bun lint` ships with Bun 1.4.6. On older Bun the command doesn't exist, and since
# package.json has a "lint" script, `bun lint` would run that script again and recurse
# until the argument list overflows. So check first, by reading `bun --help` (probing
# with `bun lint` itself would recurse too), and skip with a notice instead.
if bun --help 2>/dev/null | grep -qE '^[[:space:]]+lint[[:space:]]'; then
  # --no-script: always the linter, never this script again.
  exec bun lint --no-script "$@"
fi
echo "lint: skipped, bun lint needs Bun 1.4.6 or newer (this is Bun $(bun --version)). Run 'bun upgrade'." >&2
exit 0
