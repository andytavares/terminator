# The Linux ci:local runs CI's Ubuntu jobs in (scripts/ci-linux.mjs, ADR 123): the Ubuntu and the
# arm64 of CI's ubuntu-24.04-arm runner, the Node of .nvmrc, and its user: `runner`, uid 1001,
# with passwordless sudo, not root. Build tools are for native modules.
FROM ubuntu:24.04
ARG NODE_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git sudo xz-utils python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1
RUN useradd --uid 1001 --create-home runner \
  && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
