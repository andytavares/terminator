// Auto-discover all extension renderer entry points at build time via Vite glob.
// Each renderer.tsx runs as a side effect on import and self-registers into the
// extension registry — the core app never needs to know which extensions exist.

const _renderers = import.meta.glob('../../../extensions/*/src/renderer.tsx', { eager: true })

// Referenced to prevent tree-shaking; modules self-register on import.
void _renderers
