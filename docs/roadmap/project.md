# Project roadmap

Infra, deploy, repo structure, tooling, and quality — everything that isn't a
game feature. See the [status legend](./README.md#status-legend).

> **Seeded draft.** 🟢 rows reflect the current repo. Unbuilt rows are inferred
> candidates — **please confirm/correct.**

## Shipped 🟢

- 🟢 **Turborepo monorepo** — npm workspaces, `apps/web` + `packages/{engine,design-system}`.
- 🟢 **Engine extracted to a package** — plain-TS `@soccer-manager/engine`, no React.
- 🟢 **Design system package** — tokens + global CSS + presentational primitives, engine-agnostic.
- 🟢 **Build/lint/type-check** — `dev` / `build` / `lint` / `check-types` via Turbo.
- 🟢 **Headless balance test** — `npm run simtest` for engine tuning.
- 🟢 **Engine test suite** — vitest unit tests for `@soccer-manager/engine` (148 tests across
  `rng`/`calendar`/`tactics`/`player`/`squad`/`world`/`migrate`/`season`/`match`/`transfers`/`sim`),
  exact assertions on pure logic + invariant/determinism checks on stochastic simulation. Run via
  `npm test` (root) or `npm test --workspace @soccer-manager/engine`. Guardrails beyond `simtest`.

## Near-term 🟡 / Backlog ⚪
- ⚪ **UI test suite** — component tests for the design-system primitives and app screens
  (render + interaction; e.g. lineup drag-and-drop, transfer negotiation).
- ⚪ **Player update system** — formal policy for safely updating existing players when the
  player data model or engine logic changes, not just the state schema shape. `migrate.ts`
  already versions and migrates `GameState.players` on schema bumps (v1→v2 position detail);
  extend that same guarantee to cover other kinds of changes (new/renamed fields, changed
  defaults, recomputed derived attributes) so existing saves never end up with stale or
  invalid player records.

## Ideas / discussed 💭

Candidates to sort into 🟡/⚪/❌. **Confirm which we actually discussed:**

- 💭 **Deploy target** — where the static app is hosted (e.g. Vercel/Netlify/Pages) + a live URL.
- 💭 **CI** — run build + lint + type-check + `simtest` + test suites on every push/PR.
- 💭 **PWA / offline install** — installable app, service worker (fits the "open a tab, no backend" story).
- 💭 **Save management** — export/import save files, multiple save slots, versioned migrations policy.
- 💭 **Error handling / telemetry** — error boundary, optional client-only crash logging.
- 💭 **Performance budget** — bundle-size + long-season sim benchmarks tracked over time.
- 💭 **Docs upkeep** — keep `CLAUDE.md` engine paths current (engine moved to `packages/engine`).
- 💭 **In-repo task tracking** — adopt Backlog.md (or GitHub Projects) once goals get granular.
- 💭 **Contribution/dev workflow** — branch/PR conventions, changelog, release tagging.
