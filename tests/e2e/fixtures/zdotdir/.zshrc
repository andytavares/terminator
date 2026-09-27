# Runs for interactive shells (a PTY counts as one even without -i, since
# node-pty gives zsh a real tty on stdin). Belt-and-braces re-prepend, in
# case something sources .zshrc without .zprofile having run first, and a
# minimal prompt so nothing here has to load the developer's real prompt
# framework (oh-my-zsh, starship, etc.) from the real HOME.
export PATH="${ZDOTDIR}/../bin:${PATH}"
export PS1='e2e$ '
unsetopt PROMPT_SP
# Never write a history file into this fixture directory.
unset HISTFILE
