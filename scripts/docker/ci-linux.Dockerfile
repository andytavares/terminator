# The Linux side of .github/workflows/ci.yml, for scripts/ci-linux-local.mjs: Node from .nvmrc,
# zsh and the X test extension the E2E (Linux, X11) job installs, and Xvfb plus the libraries
# Electron needs that GitHub's ubuntu-latest image already has.
FROM node:24.21.0-bookworm

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      xvfb xauth zsh libxtst6 python3 git sudo \
      libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxkbcommon0 libatk-bridge2.0-0 \
      libdrm2 libxcomposite1 libxdamage1 libxrandr2 libcups2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
