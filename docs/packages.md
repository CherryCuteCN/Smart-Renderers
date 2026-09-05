# Packages

| Package | Responsibility |
| --- | --- |
| `smart-renderers` | Unified entry (`createSmartRenderers`, `attachContents`, re-exports). |
| `@smart-renderers/core` | Idle detection, countdown, snapshots. |
| `@smart-renderers/manager` | Action ports, policy, operators. |

Only `smart-renderers` is published to npm. The scoped packages are `private` workspace packages and are bundled into `dist`.

## Scripts

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm pack
pnpm example:electron
```
