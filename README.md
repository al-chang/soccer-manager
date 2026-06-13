# Soccer Manager

A fully browser-based football management simulator. The simulation engine and
UI run entirely client-side; saves live in IndexedDB. No backend, no accounts.

## Monorepo layout

This is a [Turborepo](https://turborepo.dev) monorepo using npm workspaces.

```
soccer-manager/
├── apps/
│   └── web/                  # @soccer-manager/web — the Vite + React app
│       ├── src/engine/       #   plain-TS simulation engine (no React)
│       ├── src/store/        #   zustand store + IndexedDB persistence
│       └── src/ui/           #   screens & app-specific components
└── packages/
    └── design-system/        # @soccer-manager/design-system
        └── src/
            ├── styles/        #   tokens.css (design tokens) + global.css
            ├── styles.css     #   stylesheet entry the app imports
            └── primitives/    #   engine-agnostic presentational components
```

The **design system** owns the visual layer — design tokens, global styles, and
pure presentational primitives (`OvrBadge`, `PosBadge`, `ConditionBar`,
`FormDots`). It must never import from the game engine or store. The web app
consumes it as a workspace dependency (`@soccer-manager/design-system`).

## Commands

Run from the repo root; Turborepo fans tasks out across workspaces.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app dev server (Vite) |
| `npm run build` | Type-check and build all packages |
| `npm run lint` | Lint all packages |
| `npm run check-types` | Type-check packages that expose the script |
| `npm run simtest` | Run the headless engine balance test |

## Notes

- The React Compiler is intentionally **not** enabled — game state is a single
  mutable object with a version counter driving re-renders, which the compiler's
  identity-based memoization serves stale. See the note in
  `apps/web/vite.config.ts`.
- Conventions live in `CLAUDE.md`; the design direction lives in
  `docs/design-brief.md`.
