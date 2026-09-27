# Sourced for every zsh invocation (login, interactive, or not). Kept empty
# on purpose: e2eEnv() points ZDOTDIR here so the app's terminals never read
# the developer's real ~/.zshenv, which can itself mutate PATH before
# .zprofile/.zshrc get a chance to prepend the claude stub dir.
