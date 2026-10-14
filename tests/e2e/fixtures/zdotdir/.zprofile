# Runs for every login shell, after /etc/zprofile has already run
# path_helper (which reorders PATH from /etc/paths and /etc/paths.d and would
# otherwise put the developer's real ~/.local/bin ahead of anything we set in
# e2eEnv()). A spec's own stub folders (E2E_PATH_FIRST, from stubsFirst) go
# first, then the claude stub. Prepending here — after path_helper, before the shell is handed
# back to the app — is what makes the claude stub win.
export PATH="${E2E_PATH_FIRST:+${E2E_PATH_FIRST}:}${ZDOTDIR}/../bin:${PATH}"
export PS1='e2e$ '
