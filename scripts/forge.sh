#!/usr/bin/env bash
# Forge installer / updater / uninstaller
# Usage:
#   ./forge.sh                   # interactive menu
#   ./forge.sh install <target>  # install into <target>
#   ./forge.sh update  <target>  # update existing install in <target>
#   ./forge.sh uninstall <target>
#   ./forge.sh status  <target>  # show what's installed and version
#   ./forge.sh --help

set -euo pipefail

VERSION="0.4.0"
ASSUME_YES="${FORGE_YES:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_NAME=".forge-manifest.json"

# ---------- terminal colors (skipped if not a tty) ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""; NC=""
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s%s%s\n' "$CYAN" "$*" "$NC"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$NC" "$*"; }
err()  { printf '%s✗%s %s\n' "$RED" "$NC" "$*" >&2; }
ask()  { printf '%s%s%s ' "$BOLD" "$*" "$NC"; }

# ---------- prerequisites ----------
need() {
  command -v "$1" >/dev/null 2>&1 || { err "missing required tool: $1"; return 1; }
}

check_prereqs() {
  local missing=0
  for t in bash git jq find; do
    command -v "$t" >/dev/null 2>&1 || { err "missing: $t"; missing=1; }
  done
  return $missing
}

# ---------- helpers ----------
read_yn() {
  # read_yn "Prompt" [default y|n]
  # Auto-accepts the DEFAULT (not always yes) when ASSUME_YES=1 or no tty available.
  local prompt="$1" def="${2:-n}" ans
  if [ "$ASSUME_YES" = "1" ]; then
    say "$prompt [auto: y]"
    return 0
  fi
  # Determine input source: /dev/tty if available, else stdin
  local input_src=""
  if [ -e /dev/tty ] && [ -r /dev/tty ]; then
    input_src="/dev/tty"
  fi
  while true; do
    if [ "$def" = "y" ]; then ask "$prompt [Y/n]:"; else ask "$prompt [y/N]:"; fi
    if [ -n "$input_src" ]; then
      read -r ans <"$input_src" || ans=""
    else
      read -r ans || ans=""
    fi
    ans="${ans:-$def}"
    case "$ans" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO)   return 1 ;;
      *)           say "  please answer y or n" ;;
    esac
  done
}

read_value() {
  # read_value "Prompt" — read a single line of free text
  local prompt="$1" ans=""
  local input_src=""
  if [ -e /dev/tty ] && [ -r /dev/tty ]; then input_src="/dev/tty"; fi
  ask "$prompt"
  if [ -n "$input_src" ]; then
    read -r ans <"$input_src" || true
  else
    read -r ans || true
  fi
  printf '%s' "$ans"
}

resolve_target() {
  # resolve_target <path>
  local t="${1:-}"
  if [ -z "$t" ]; then err "target path required"; return 1; fi
  if [ ! -d "$t" ]; then err "not a directory: $t"; return 1; fi
  (cd "$t" && pwd)
}

# Enumerate every file forge owns, as paths relative to SCRIPT_DIR.
# These are the only files forge ever creates, updates, or removes.
forge_source_files() {
  # Files inside shared directories (skills, commands, hooks, agents)
  # Use bash prefix-strip instead of sed to avoid metacharacter issues in SCRIPT_DIR.
  for dir in .claude/agents .claude/skills .claude/commands .claude/hooks; do
    if [ -d "$SCRIPT_DIR/$dir" ]; then
      while IFS= read -r f; do
        printf '%s\n' "${f#"$SCRIPT_DIR/"}"
      done < <(find "$SCRIPT_DIR/$dir" -type f | sort)
    fi
  done
  # Flat managed files
  printf '%s\n' \
    ".claude/settings.json" \
    ".claude-plugin/plugin.json" \
    ".mcp.json" \
    "scripts/detect-stack.sh" \
    "scripts/forge.sh"
}

# Copy every forge-owned file from SCRIPT_DIR into target, creating dirs as needed.
# Never deletes anything in the target. Pass additional relative paths to skip as args.
copy_forge_files() {
  local target="$1"; shift
  local -a skip_list=("$@")
  while IFS= read -r rel; do
    local src="$SCRIPT_DIR/$rel"
    local dst="$target/$rel"
    [ -f "$src" ] || continue
    # Skip explicitly excluded files
    local skip=0
    for ex in "${skip_list[@]+"${skip_list[@]}"}"; do
      [ "$rel" = "$ex" ] && { skip=1; break; }
    done
    [ "$skip" -eq 1 ] && continue
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  done < <(forge_source_files)
}

write_manifest() {
  # write_manifest <target> <action>
  local target="$1" action="$2"
  local sha="unknown"
  [ -d "$SCRIPT_DIR/.git" ] && sha="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local files_json
  files_json="$(forge_source_files | jq -R . | jq -s .)"
  jq -n \
    --arg v "$VERSION" \
    --arg sha "$sha" \
    --arg src "$SCRIPT_DIR" \
    --arg action "$action" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson files "$files_json" \
    '{
      forge_version: $v,
      installed_from_commit: $sha,
      source_path: $src,
      last_action: $action,
      installed_at: $ts,
      managed_files: $files
    }' > "$target/$MANIFEST_NAME"
}

# Files that should NEVER be overwritten on update (user customizations)
list_user_owned_paths() {
  cat <<'PATHS'
CLAUDE.md
.claude/doc-index.json
.claude/stack.json
.forge/constitution.md
PATHS
}

backup_dir() {
  printf '%s/.forge-backups/%s' "$1" "$(date +%Y%m%d-%H%M%S)"
}

# ---------- core commands ----------

cmd_install() {
  local target; target="$(resolve_target "${1:-}")" || return 1

  info "Installing Forge $VERSION into $target"
  say  ""

  # Guard against existing install
  if [ -f "$target/$MANIFEST_NAME" ]; then
    local cur; cur="$(jq -r .forge_version < "$target/$MANIFEST_NAME" 2>/dev/null || echo unknown)"
    warn "Forge already installed (version $cur)"
    if read_yn "Run update instead?" y; then
      cmd_update "$target"; return $?
    else
      err "aborting — manifest exists"
      return 1
    fi
  fi

  # Show what will happen
  say "${BOLD}Will install (forge-owned files only — your files in these dirs are untouched):${NC}"
  forge_source_files | while read -r f; do say "  + $f"; done
  say ""
  say "${BOLD}Will create only if missing (your customizations are safe):${NC}"
  while read -r p; do say "  ~ $p"; done < <(list_user_owned_paths)
  say ""

  read_yn "Proceed?" y || { err "cancelled"; return 1; }

  # Copy forge-owned files only — never deletes anything in target
  copy_forge_files "$target"
  chmod +x "$target/scripts/"*.sh "$target/.claude/hooks/"*.sh 2>/dev/null || true

  # Create user-owned files if missing
  [ -f "$target/CLAUDE.md" ]              || cp "$SCRIPT_DIR/CLAUDE.md" "$target/CLAUDE.md"
  [ -f "$target/.claude/doc-index.json" ] || echo '{"version":1,"entries":[]}' > "$target/.claude/doc-index.json"

  # Initial stack detection
  ( cd "$target" && ./scripts/detect-stack.sh >/dev/null 2>&1 ) && ok "detected stack written to .claude/stack.json"

  write_manifest "$target" install
  ok "installed"
  say ""
  say "${BOLD}Next steps:${NC}"
  say "  1. Edit ${target}/CLAUDE.md — replace {{REPO_NAME}} and {{LANGUAGES}}"
  say "  2. Review ${target}/.mcp.json — uncomment the MCP servers your team uses"
  say "  3. Run: cd ${target} && claude  →  try /forge-detect-stack, /forge-ask, /forge-tdd, /forge-review"
}

cmd_update() {
  local target; target="$(resolve_target "${1:-}")" || return 1

  if [ ! -f "$target/$MANIFEST_NAME" ]; then
    err "no manifest found; this isn't a managed install"
    if read_yn "Run install instead?" n; then cmd_install "$target"; return $?; fi
    return 1
  fi

  local cur; cur="$(jq -r .forge_version < "$target/$MANIFEST_NAME" 2>/dev/null || echo unknown)"
  info "Updating $target ($cur → $VERSION)"

  # Read the old manifest's file list before we overwrite it
  local old_files=()
  while IFS= read -r f; do
    [ -n "$f" ] && old_files+=("$f")
  done < <(jq -r '.managed_files[]' < "$target/$MANIFEST_NAME" 2>/dev/null || true)

  # Backup only forge-owned files (from old manifest)
  local bdir; bdir="$(backup_dir "$target")"
  mkdir -p "$bdir"
  for f in "${old_files[@]+"${old_files[@]}"}"; do
    if [ -f "$target/$f" ]; then
      mkdir -p "$bdir/$(dirname "$f")"
      cp "$target/$f" "$bdir/$f"
    fi
  done
  ok "backup → $bdir"

  # Diff preview: compare forge source files vs target
  if command -v diff >/dev/null 2>&1; then
    say ""
    say "${BOLD}Changes that will be applied to forge-owned files:${NC}"
    while IFS= read -r f; do
      local src="$SCRIPT_DIR/$f" dst="$target/$f"
      if [ -f "$src" ] && [ -f "$dst" ]; then
        if ! diff -q "$dst" "$src" >/dev/null 2>&1; then
          say "  ${YELLOW}~${NC} $f (modified)"
        fi
      elif [ -f "$src" ]; then
        say "  ${GREEN}+${NC} $f (new)"
      fi
    done < <(forge_source_files)
    # Show files forge is removing (in old manifest, absent from new source)
    local new_source; new_source="$(forge_source_files | sort)"
    for f in "${old_files[@]+"${old_files[@]}"}"; do
      if ! printf '%s\n' "$new_source" | grep -qxF "$f"; then
        say "  ${RED}-${NC} $f (removed from forge source)"
      fi
    done
    say ""
  fi

  read_yn "Proceed with update?" y || { err "cancelled"; return 1; }

  # .mcp.json is managed but might have been edited — handle before copy_forge_files
  # so we can skip it there and avoid silent overwrite of local edits.
  if [ -f "$target/.mcp.json" ]; then
    if ! diff -q "$SCRIPT_DIR/.mcp.json" "$target/.mcp.json" >/dev/null 2>&1; then
      cp "$SCRIPT_DIR/.mcp.json" "$target/.mcp.json.new"
      warn ".mcp.json differs — new version saved as .mcp.json.new (merge manually)"
    fi
  else
    cp "$SCRIPT_DIR/.mcp.json" "$target/.mcp.json"
  fi

  # Apply: copy all current forge files (add new, overwrite changed); skip .mcp.json (handled above)
  copy_forge_files "$target" ".mcp.json"
  chmod +x "$target/scripts/"*.sh "$target/.claude/hooks/"*.sh 2>/dev/null || true

  # Remove files that were forge-owned before but are no longer in the forge source
  # (intentionally deleted between versions). Never touches files not in old manifest.
  local new_source; new_source="$(forge_source_files | sort)"
  for f in "${old_files[@]+"${old_files[@]}"}"; do
    if ! printf '%s\n' "$new_source" | grep -qxF "$f"; then
      rm -f "$target/$f"
      ok "removed (no longer in forge source): $f"
    fi
  done

  write_manifest "$target" update
  ok "updated to $VERSION"
  say ""
  say "  Backup of previous version: $bdir"
  say "  Roll back with: ./scripts/forge.sh restore $target $bdir"
}

cmd_uninstall() {
  local target; target="$(resolve_target "${1:-}")" || return 1

  if [ ! -f "$target/$MANIFEST_NAME" ]; then
    err "no manifest at $target/$MANIFEST_NAME — not a managed install"
    return 1
  fi

  # Read the manifest file list
  local managed_files=()
  while IFS= read -r f; do
    [ -n "$f" ] && managed_files+=("$f")
  done < <(jq -r '.managed_files[]' < "$target/$MANIFEST_NAME" 2>/dev/null || true)

  warn "About to UNINSTALL Forge from $target"
  say ""
  say "${BOLD}Will remove (${#managed_files[@]} forge-owned files):${NC}"
  for f in "${managed_files[@]+"${managed_files[@]}"}"; do
    say "  - $f"
  done
  say "  - $MANIFEST_NAME"
  say ""
  say "${BOLD}Will NOT touch (yours to keep or delete manually):${NC}"
  while read -r p; do say "  ~ $p"; done < <(list_user_owned_paths)
  say "  ~ Any files you created in .claude/skills/, .claude/commands/, .claude/hooks/, .claude/agents/"
  say "  ~ .forge-backups/"
  say ""

  read_yn "Proceed?" n || { err "cancelled"; return 1; }

  # Final backup of forge-owned files before removal
  local bdir; bdir="$(backup_dir "$target")"
  mkdir -p "$bdir"
  for f in "${managed_files[@]+"${managed_files[@]}"}"; do
    if [ -f "$target/$f" ]; then
      mkdir -p "$bdir/$(dirname "$f")"
      cp "$target/$f" "$bdir/$f"
    fi
  done
  ok "final backup → $bdir"

  # Remove only forge-owned files — leaves user files intact
  for f in "${managed_files[@]+"${managed_files[@]}"}"; do
    rm -f "$target/$f"
  done

  # Clean up directories that are now empty (user files keep their dirs alive).
  # -depth ensures bottom-up traversal so subdirs are removed before parents.
  for d in .claude/agents .claude/skills .claude/commands .claude/hooks; do
    find "$target/$d" -depth -type d -empty -delete 2>/dev/null || true
  done
  rmdir "$target/.claude-plugin" 2>/dev/null || true
  rmdir "$target/.claude" 2>/dev/null || true

  rm -f "$target/$MANIFEST_NAME"
  ok "uninstalled"
  say ""
  say "  Your CLAUDE.md, doc-index.json, and any custom skills/commands/hooks were preserved."
  say "  Full backup at: $bdir"
}

cmd_status() {
  local target; target="$(resolve_target "${1:-}")" || return 1
  if [ ! -f "$target/$MANIFEST_NAME" ]; then
    warn "Forge not installed at $target"
    return 1
  fi
  info "Forge status at $target"
  jq 'del(.managed_files)' < "$target/$MANIFEST_NAME"
  say ""

  # Forge-owned files
  local managed_files=()
  while IFS= read -r f; do
    [ -n "$f" ] && managed_files+=("$f")
  done < <(jq -r '.managed_files[]' < "$target/$MANIFEST_NAME" 2>/dev/null || true)

  say "${BOLD}Forge-managed files (${#managed_files[@]}):${NC}"
  for f in "${managed_files[@]+"${managed_files[@]}"}"; do
    if [ -f "$target/$f" ]; then ok "$f"; else warn "$f (missing — run update to restore)"; fi
  done

  # User files in shared directories not in the manifest
  say ""
  say "${BOLD}Your files in shared directories (not managed by Forge):${NC}"
  local found_user=0
  for d in .claude/agents .claude/skills .claude/commands .claude/hooks; do
    if [ -d "$target/$d" ]; then
      while IFS= read -r f; do
        local rel="${f#"$target/"}"
        if ! printf '%s\n' "${managed_files[@]+"${managed_files[@]}"}" | grep -qF "$rel"; then
          say "  ${CYAN}~${NC} $rel"
          found_user=1
        fi
      done < <(find "$target/$d" -type f | sort)
    fi
  done
  [ "$found_user" -eq 0 ] && say "  (none)"
}

cmd_restore() {
  local target="${1:-}" bdir="${2:-}"
  [ -z "$target" ] || [ -z "$bdir" ] && { err "usage: forge.sh restore <target> <backup-dir>"; return 1; }
  target="$(resolve_target "$target")"
  [ -d "$bdir" ] || { err "backup dir not found: $bdir"; return 1; }

  warn "Restoring $target from $bdir — this will overwrite current forge-managed files"
  read_yn "Proceed?" n || { err "cancelled"; return 1; }

  # Restore all files present in the backup (these were forge-owned at backup time)
  while IFS= read -r -d '' f; do
    local rel="${f#$bdir/}"
    local dst="$target/$rel"
    mkdir -p "$(dirname "$dst")"
    cp "$f" "$dst"
    ok "restored $rel"
  done < <(find "$bdir" -type f -print0)
  ok "restore complete"
}

cmd_help() {
  cat <<HELP
${BOLD}Forge $VERSION${NC}

A cookiecutter Claude Code harness for large multi-language codebases.

${BOLD}USAGE${NC}
  $(basename "$0")                          interactive menu
  $(basename "$0") install   <target-repo>  install into <target-repo>
  $(basename "$0") update    <target-repo>  update existing install
  $(basename "$0") uninstall <target-repo>  remove Forge
  $(basename "$0") status    <target-repo>  show manifest + installed paths
  $(basename "$0") restore   <target-repo> <backup-dir>
  $(basename "$0") --help | -h               show this help

${BOLD}FLAGS${NC}
  -y, --yes                          auto-accept all prompts (CI mode)
                                      also via FORGE_YES=1 env var

${BOLD}WHAT FORGE MANAGES${NC}
  Forge tracks every file it installs in .forge-manifest.json.
  It only ever creates, updates, or removes the specific files it owns.
  Your files in .claude/skills/, .claude/commands/, .claude/hooks/, and
  .claude/agents/ are never touched — Forge co-exists with them safely.

  Forge-owned files:
    .claude/agents/**      .claude/skills/**
    .claude/commands/**    .claude/hooks/**
    .claude/settings.json  .claude-plugin/plugin.json
    .mcp.json              scripts/detect-stack.sh
    scripts/forge.sh

${BOLD}WHAT IS NEVER OVERWRITTEN${NC}
  CLAUDE.md (yours to customize), .claude/doc-index.json, .claude/stack.json,
  .forge/constitution.md, and any files you create in the shared directories
  (.claude/skills/, .claude/commands/, .claude/hooks/, .claude/agents/).

${BOLD}BACKUPS${NC}
  Every update and every uninstall snapshots forge-owned files to
  .forge-backups/<timestamp>/ inside the target repo.
  Roll back with: $(basename "$0") restore <target> <backup-dir>
HELP
}

# ---------- interactive menu ----------

interactive_menu() {
  say "${BOLD}Forge $VERSION${NC}"
  say ""
  say "  1) Install   into a repo"
  say "  2) Update    an existing install"
  say "  3) Uninstall from a repo"
  say "  4) Status    of a repo"
  say "  5) Restore   from a backup"
  say "  q) Quit"
  say ""
  local choice; choice="$(read_value 'Choose:')"
  case "$choice" in
    1) cmd_install   "$(read_value 'Target repo path:')" ;;
    2) cmd_update    "$(read_value 'Target repo path:')" ;;
    3) cmd_uninstall "$(read_value 'Target repo path:')" ;;
    4) cmd_status    "$(read_value 'Target repo path:')" ;;
    5) local t; t="$(read_value 'Target repo path:')"
       local b; b="$(read_value 'Backup dir:')"
       cmd_restore "$t" "$b" ;;
    q|Q|"") say "bye"; return 0 ;;
    *) err "invalid choice"; return 1 ;;
  esac
}

# ---------- entry ----------

main() {
  check_prereqs || { err "install missing tools and retry"; exit 1; }

  # Parse global flags
  local args=()
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes)        ASSUME_YES=1; shift ;;
      -h|--help|help)  cmd_help; return 0 ;;
      *)               args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]+"${args[@]}"}"

  case "${1:-}" in
    install)   shift; cmd_install   "$@" ;;
    update)    shift; cmd_update    "$@" ;;
    uninstall) shift; cmd_uninstall "$@" ;;
    status)    shift; cmd_status    "$@" ;;
    restore)   shift; cmd_restore   "$@" ;;
    "")        interactive_menu ;;
    *)         err "unknown command: $1"; say ""; cmd_help; exit 1 ;;
  esac
}

main "$@"
