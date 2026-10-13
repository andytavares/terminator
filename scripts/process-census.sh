#!/bin/bash
# Prints this user's processes against the per-user limit, by command, with the
# zombies and orphans (parent 1) among them. CI runs it around the macOS E2E
# steps: their late `spawnSync git EAGAIN` and terminals that never open point
# at fork failing at that limit (runs 38344908607, 38371778238), and what one
# step leaves running is still there in the next, which only this listing shows.
# For the commonest commands it also prints their parents' commands and a few
# full command lines, which tell one `node` from another (run 38380127678: 594
# of them, the gh stub running itself).
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

# For one command: how many of this user's processes run it under each parent
# command (a parent can be any user's), and three of their full command lines.
by_parent() {
  awk -v command="$1" '
    FILENAME == ARGV[1] { pid = $1; $1 = ""; sub(/^ +/, ""); name[pid] = $0; next }
    FILENAME == ARGV[2] { pid = $1; $1 = ""; sub(/^ +/, ""); line[pid] = $0; next }
    { pid = $1; ppid = $2; $1 = ""; $2 = ""; sub(/^ +/, "") }
    $0 == command {
      under[(ppid in name) ? name[ppid] : "pid " ppid]++
      if (++shown <= 3) sample[shown] = pid " " substr(line[pid], 1, 200)
    }
    END {
      for (parent in under) printf "    %5d under %s\n", under[parent], parent | "sort -rn"
      close("sort -rn")
      for (i = 1; i <= 3 && i <= shown; i++) print "    e.g. " sample[i]
    }
  ' <(ps -A -o pid=,comm=) <(ps -U "$uid" -ww -o pid=,args=) <(ps -U "$uid" -o pid=,ppid=,comm=)
}
echo "the 5 commonest commands, by parent command, with 3 of their command lines:"
printf '%s\n' "$rows" | awk '{ $1 = ""; $2 = ""; sub(/^ +/, ""); print }' | sort | uniq -c | sort -rn | head -5 |
  sed -E 's/^ *[0-9]+ //' | while IFS= read -r command; do
    echo "  $command"
    by_parent "$command"
  done
