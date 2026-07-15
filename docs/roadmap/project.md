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

## Near-term 🟡 / Backlog ⚪

- ⚪ **Engine test suite** — unit tests for `@soccer-manager/engine` (`match`/`season`/`transfers`/
  `player`/`squad`), deterministic via seeded RNG. Guardrails beyond `simtest`.
- ⚪ **UI test suite** — component tests for the design-system primitives and app screens
  (render + interaction; e.g. lineup drag-and-drop, transfer negotiation).

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
