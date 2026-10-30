## What

<!-- One paragraph: what changed and why. Describe the decision, not the diff. -->

## How to test

<!-- Steps a reviewer follows to verify the behavior. Name what to look for. -->

1.
2.

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run test` passes (coverage ≥ 80%)
- [ ] `npm run build:extensions` succeeds
- [ ] New IPC channels added to `extensions/foundry/IPC-CHANNELS.md` (Foundry) and `src/shared/electron-api/manifest.ts`
- [ ] README / docs updated if user-facing behavior changed
- [ ] No `console.log` left in production paths

## Notes for reviewer

<!-- Tricky parts, deliberate trade-offs, and context the diff does not show. Delete this section if you have nothing to add. -->
