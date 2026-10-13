#!/bin/bash
# Prints this user's processes against the per-user limit, by command, with the
# zombies and orphans (parent 1) among them. CI runs it around the macOS E2E
# steps: their late `spawnSync git EAGAIN` and terminals that never open point
# at fork failing at that limit (runs 38344908607, 38371778238), and what one
# step leaves running is still there in the next, which only this listing shows.
#   scripts/process-census.sh <label>
uid=$(id -u)
rows=$(ps -U "$uid" -o ppid=,stat=,comm=)
echo "== process census: $1 =="
echo "limits: processes (ulimit -u) $(ulimit -u), open files (ulimit -n) $(ulimit -n), kern.maxprocperuid $(sysctl -n kern.maxprocperuid 2>/dev/null || echo n/a)"
echo "processes of $(id -un): $(printf '%s\n' "$rows" | grep -c .)"
echo "zombies: $(printf '%s\n' "$rows" | awk '$2 ~ /^Z/' | grep -c .)"
echo "orphans (parent 1): $(printf '%s\n' "$rows" | awk '$1 == 1' | grep -c .)"
echo "by command:"
printf '%s\n' "$rows" | awk '{ $1 = ""; $2 = ""; sub(/^ +/, ""); print }' | sort | uniq -c | sort -rn | head -25
echo "orphans by command:"
printf '%s\n' "$rows" | awk '$1 == 1 { $1 = ""; $2 = ""; sub(/^ +/, ""); print }' | sort | uniq -c | sort -rn | head -25
