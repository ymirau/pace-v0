# pace-v0 — frontend

React 19 single-page app. Talks to the FastAPI backend, authenticates with
Azure/Entra via MSAL.

> Ships one example screen (**Items**). See [CLAUDE.md](CLAUDE.md) for the recipe
> to add your own pages.

## Stack

- React 19 + TypeScript, Vite
- Tailwind CSS v4
- React Router 7
- TanStack Query 5
- MSAL (`@azure/msal-browser` + `@azure/msal-react`)

## Layout

```
frontend/
├── vite.config.ts              # per-env base path + /api dev proxy
└── src/
    ├── main.tsx                # MSAL init, MsalProvider + Query + Router
    ├── authConfig.ts           # msalConfig: shared Entra IDs + redirectUri (/auth-callback/)
    ├── authBypass.ts           # skip MSAL on non-HTTPS (local dev)
    ├── msalInstance.ts         # shared PublicClientApplication
    ├── routes.tsx              # router (basename = BASE_URL)
    ├── components/             # AuthGate (login gate), Layout (sidebar)
    ├── pages/                  # Home, Samples (tabbed examples), Support, Admin
    └── api/                    # client.ts (token-injecting fetch) + items.ts hooks
```

The Samples page's tabs (components/samples/) are the worked examples, Items being the
full vertical slice: replace them with your domain, or add pages alongside them.

## Setup

```bash
cd frontend
npm ci          # no env file to copy: the frontend has none
```

The frontend needs **no env files**. Its only config is the shared Entra
registration (tenant ID, SPA client ID, API scope `https://apps.example.com/user_impersonation`),
which is public and identical in every app and env, so it lives as constants in
`src/authConfig.ts`. To point `npm run dev` at a backend other than
`http://127.0.0.1:8000`, export `VITE_API_UPSTREAM` (or put it in a git-ignored
`.env.development.local`).

The React Router `basename` and API base are **derived from the build's base path**
(`import.meta.env.BASE_URL`) — there are no separate API-base vars. The MSAL
`redirectUri` is **not** base-path-derived: every app logs in through the shared,
path-independent `/auth-callback/` (one Azure redirect URI for all apps).

## Develop

```bash
npm run dev        # http://localhost:5173
```

Run the [backend](../backend/README.md) on `:8000` first — Vite proxies `/api` to
it (no CORS in dev). Over HTTP the app **bypasses MSAL**, so you can work locally
without an Azure login.

## Build

The app is served under a per-environment **base path** behind the platform's
Caddy, baked in at build time:

```bash
npm run build:sbx    # base /pace-sbx/
npm run build:uat    # base /pace-uat/
npm run build:prod   # base /pace/
npm run build        # base / (local/preview)
```

`npm run lint` runs ESLint. See [../_deploy/README.md](../_deploy/README.md) for how
the base path maps to Caddy routing, and how MSAL login uses the shared
`/auth-callback/` redirect (one Azure URI for all apps).

### Version (build stamp)

Every build carries a **build stamp**, `yyyymmdd.hhmmss` in America/Denver time
(e.g. `20261030.142934`), shown with the env at the bottom of the settings menu (the
sidebar's ⋮, or the avatar on the collapsed rail) (`sbx · 20261030.142934`). It's computed in
[vite.config.ts](vite.config.ts) and read through `BUILD_STAMP` in
[src/env.ts](src/env.ts). There's no version number to bump: the stamp tells you
which build an environment is serving, e.g. whether a deploy actually landed. In
`npm run dev` it's the time the dev server started.

## Theming (light + dark)

The app ships **dark mode** out of the box, and it is the baseline every screen is
expected to support. It works entirely through design tokens — there is no per-page
dark logic to write:

- **Tokens live in one place**: the `@theme` block in [src/index.css](src/index.css)
  remaps Tailwind's `slate` ramp + accents to Synveon's warm-gray house style, and a
  `[data-theme="dark"]` block overrides those same `--color-*` vars with dark values.
  Tailwind v4 resolves `var(--color-*)` at use-time, so ordinary utilities
  (`bg-slate-50`, `text-slate-600`, `bg-blue-100`, …) flip automatically in dark.
- **Use `bg-surface`, not `bg-white`.** For any card / panel / table / input /
  button, use the semantic `bg-surface` token (and `text-surface` for text that
  sits on an inverting `bg-slate-900` button) instead of hardcoded `bg-white` /
  `text-white`. `bg-surface` is a soft warm grey in light (a
  step below the `bg-slate-50` page) and a raised charcoal in dark; a hardcoded
  `bg-white` would stay white and leak light in dark mode. Modals sit on
  `bg-slate-50` so their `bg-surface` fields stand out, and the sidebar keeps its
  own `bg-sidebar` (white in light; in dark, a step darker than the page).
- **Text contrast is tested.** Every text colour must meet WCAG AA (4.5:1) on the
  grounds it sits on, in both themes. [src/contrast.test.ts](src/contrast.test.ts)
  mirrors the palette by hand and scans the source for `text-*` colours, so a
  token change or a new text colour without a proof there fails `npm test`.
- **Resolution + persistence** live in [src/theme.ts](src/theme.ts): a pure
  `resolveTheme(stored, osPrefersDark)` (precedence: stored choice > OS
  `prefers-color-scheme` > light), plus persistence to `localStorage`, a live
  OS-follow `matchMedia` listener (only while no manual override is stored), and a
  `useTheme()` hook for the rare component that needs a concrete color in JS
  (e.g. the uPlot canvas — see the chart recipe in [CLAUDE.md](CLAUDE.md)).
- **No FOUC**: an inline pre-paint `<script>` in [index.html](index.html) sets
  `data-theme` on `<html>` before the bundle loads. `initTheme()` runs once from
  `main.tsx`.
- **The toggle** is the Dark mode / Light mode item in the sidebar's ⋮ settings menu
  ([SettingsMenu.tsx](src/components/SettingsMenu.tsx)).

When adding a new screen, build with the standard slate/accent utilities and
`bg-surface` for surfaces — it will be dark-aware for free.

## Modal forms

**All modal forms must be built with the `ModalForm` kit
([src/components/ModalForm.tsx](src/components/ModalForm.tsx)) — do not hand-roll a
`<Modal>` + banner + label/input rows + footer buttons.** This keeps every
add/edit dialog in a scaffolded app consistent and low-boilerplate.

The kit provides:

- **`ModalForm`** (default export) — the wrapper. Renders a `Modal` with a fixed
  header, a scrolling body, and a pinned footer holding Cancel + Submit (and an
  optional left-aligned Delete when `onDelete` is given). It owns busy/disabled
  states (`submitting`, `deleting`, `submitDisabled`) and the top error banner.
- **Field primitives** — `Field` (label + required marker + inline error),
  `TextInput`, `Textarea`, `SelectField`, and `FormBanner` (`error` | `warning`).
- **Style tokens** — `inputClass`, `btnClass`, `btnPrimaryClass`, `btnDangerClass`
  for controls outside a form (e.g. a page's "+ New" button).

This is intentionally a **lightweight kit, not a schema-driven form engine**: you
still write the fields and the submit handler by hand — the kit only removes the
repeated modal/footer/error skeleton and standardizes the field look.

See [src/components/samples/ItemsTab.tsx](src/components/samples/ItemsTab.tsx) for the worked example
(mount-on-open state, inline validation, Delete-in-modal).

## Popups and menus

**All popups and dropdown menus must be built with `Popover`
([src/components/Popover.tsx](src/components/Popover.tsx)) or `Menu`
([src/components/Menu.tsx](src/components/Menu.tsx)) — do not hand-roll absolute
positioning, outside-click or Esc listeners, and never hard-code which way a popup
opens.** Built on [Floating UI](https://floating-ui.com/), they:

- **place themselves**: open up or down and extend left or right from the room around
  the trigger, shift to stay on-screen, and cap their height (scrolling inside) when
  nothing fits;
- **render in a portal** under `<body>`, so no scrolling or `overflow` container can
  clip them;
- **close** on outside click, Esc, a route change, or the trigger scrolling out of view;
- **move focus** into the popup on open and back to the trigger on close;
- **nest**: a menu opened from inside another keeps its parent open, and picking an
  item closes both.

The kit:

- **`Menu`** (default export of `Menu.tsx`) — an action menu; takes a `trigger` render
  prop (spread its props onto a `<button>`) and the items as children.
- **`MenuItem`** (`onSelect`, `icon`, `tone="danger"`, `keepOpen`), **`MenuRadioItem`**
  (`checked`), **`MenuDivider`**, **`MenuLabel`**, and **`KebabIcon`** (the ⋮ glyph).
- **`Popover`** — the primitive underneath, for popups that aren't a list of actions
  (a filter panel); `usePopover()` gives `close()` / `closeAll()` inside it.

```tsx
<Menu trigger={(props) => <button type="button" {...props} aria-label="Actions"><KebabIcon /></button>}>
  <MenuItem onSelect={edit}>Edit</MenuItem>
  <MenuDivider />
  <MenuItem tone="danger" onSelect={remove}>Delete</MenuItem>
</Menu>
```

See the Items tab's row ⋮ menu
([src/components/samples/ItemsTab.tsx](src/components/samples/ItemsTab.tsx)) for the
worked example; `SettingsMenu.tsx` and `RoleBadge.tsx` (a menu nested in a menu) use it
too.
