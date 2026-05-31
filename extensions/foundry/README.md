# Foundry

**Extension ID**: `terminator.foundry`  
**Status**: In development — not yet feature-complete  
**Spec**: [`specs/007-foundry-agent-harness/`](../../specs/007-foundry-agent-harness/)

Agentic harness extension — spec-to-code loops, multi-agent orchestration, and co-pilot mode with provider-agnostic AI backends.

## Overview

Foundry adds a persistent global tab and run console to Terminator for orchestrating AI agent workflows directly from the terminal environment. It communicates with AI backends through the `api.ipc` and `api.window` APIs without modifying any core application files.

## Development

```bash
# Build the extension after TypeScript changes
npm run build:extensions

# Run the app in development mode (Foundry loads automatically)
npm run dev
```

Extension source lives in `extensions/foundry/src/`. The compiled `src/index.js` is a build artifact — edit the TypeScript source, not the compiled output.

See [docs/EXTENSION-DEVELOPMENT.md](../../docs/EXTENSION-DEVELOPMENT.md) for the full Extension API reference.
