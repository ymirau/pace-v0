# CLAUDE.md — frontend

React 19 SPA: Vite + TailwindCSS + React Router + TanStack Query + MSAL (Azure
auth). See [README.md](README.md) for setup; this file is how to extend the UI.

## Module map

```
src/main.tsx              entry: MSAL init → MsalProvider → QueryClientProvider → RouterProvider
src/routes.tsx            createBrowserRouter; routes nested under AuthGate + Layout; basename = BASE_URL
src/components/
  AuthGate.tsx            gates children behind an MSAL session (bypassed over HTTP); failed sign-in → recovery page
  AuthRecoveryPage.tsx    what a failed sign-in shows: one message + "Sign in again" (or Try again offline)
  Layout.tsx              the nav (the NAV array + ICONS map) + page outlet: full sidebar at lg+,
                          NavRail below lg or when collapsed from ⋮; the rail's » expands (navCollapse.ts)
  NavRail.tsx             the collapsed nav: 64px icon-only rail with tooltips + avatar account menu
  SettingsMenu.tsx        ⋮ menu (sidebar) / avatar menu (rail): Collapse sidebar (⋮ only),
                          theme toggle, Sign out, env + build stamp
  RoleBadge.tsx           admins only: the effective-role pill, which opens the "View as" role menu
  ViewAsBanner.tsx        the amber "Viewing as <role>" bar + Exit, flush above <main> while previewing
  admin/UsersSection.tsx  Admin page's Users tab: grant/change/revoke roles (Items-style table + modal);
                          Add picks the person with PeoplePicker (directory-only: under the local
                          auth bypass there's no Graph token, so add admins with SQL there)
  PeoplePicker.tsx        type-ahead over the Entra directory (api/graph.ts); yields { name, email }
  Popover.tsx             the one popup primitive (Floating UI): places itself, portals, dismisses,
                          moves focus, nests; usePopover() gives close()/closeAll() inside it
  Menu.tsx                action menus on Popover: Menu, MenuItem, MenuRadioItem, MenuDivider,
                          MenuLabel, KebabIcon (the ⋮ glyph)
  SignOutDialog.tsx       "Sign out?" confirmation in front of logoutRedirect()
  PageHeading.tsx         page title + its data source(s) in a small muted font
  TabBar.tsx              the one tab style: link-style tabs that wrap; caller owns the row + content
  UplotChart.tsx          reusable uPlot wrapper (create/destroy + ResizeObserver)
src/api/
  client.ts               apiFetch<T> (JSON) + apiUpload<T> (multipart) — inject the bearer token, throw ApiError;
                          acquireTokenSilently(scopes) for other resources (never redirects)
  graph.ts                Microsoft Graph /users search (User.Read.All, already consented on the
                          shared registration) + useDirectorySearch(); the one api/ module not
                          calling our backend
  <entity>.ts             TanStack Query hooks + TS types for one entity
src/pages/<Entity>Page.tsx  one screen per entity
src/pages/HomePage.tsx      landing page (index route): what's in the app + each optional data source's status
src/pages/SamplesPage.tsx   /samples: one TabBar tab per worked example, each a nested route (/samples/<tab>)
src/components/samples/ItemsTab.tsx     Postgres CRUD: table + category tabs + ModalForm add/edit/delete
src/components/samples/ReportsTab.tsx   SQL Server connectivity check (server info; 503/502 states)
src/pages/AdminPage.tsx     /admin (admins only): TabBar of admin sections, Users first; "Admins only" otherwise
src/api/me.ts               useMe() (GET /api/me) + useRole(): effective + real role, isAdmin, previewing, setViewAsRole
src/hooks/useDebounced.ts   settle a fast-changing value (the people picker's type-ahead debounce)
src/lib/role.ts             Role, ROLES + labels/pill colours, roleFlags (loading = user), previewableRoles,
                            effectiveRole, visibleNav (admin-only last)
src/lib/viewAs.ts           the admin's "View as" role (sessionStorage, per tab; null = not previewing)
src/pages/SupportPage.tsx   Contact support: form + up to 3 photos → POST /api/support, mailto: fallback
src/lib/supportMail.ts      support kinds, diagnostics lines, subject/body, the mailto: fallback
src/lib/supportPhotos.ts    photo limits + staging (resized on pick by lib/imageResize.ts)
src/authConfig.ts         MSAL config (shared Entra IDs as constants; redirectUri = shared /auth-callback/)
src/authBypass.ts         AUTH_BYPASS = not served over HTTPS
src/authRecovery.ts       sign-in failure kinds, "Sign in again" reset, retry counters, reportAuthFailure
src/env.ts                ENV_LABEL (loc/sbx/uat/null) from BASE_URL — drives the sidebar env badge;
                          BUILD_STAMP (yyyymmdd.hhmmss, America/Denver) baked in by vite.config.ts
```

## Recipe: add an entity page (frontend half of a slice)

1. **API module** — `src/api/<entity>.ts`. Export TS interfaces matching the
   backend `Read`/`Create` schemas (note: numeric DB types like `Numeric` arrive
   as **strings** over JSON — type them `string`). Define a query key and hooks:
   ```ts
   const KEY = ["<entity>"] as const;
   export function use<Entities>() {
     return useQuery({ queryKey: KEY, queryFn: () => apiFetch<Entity[]>("/<entity>") });
   }
   export function useCreate<Entity>() {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: (p: EntityCreate) =>
         apiFetch<Entity>("/<entity>", { method: "POST", body: JSON.stringify(p) }),
       onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
     });
   }
   ```
   Add `useUpdate<Entity>()` (`PATCH "/<entity>/{id}"`, arg `{ id, data }`) and
   `useDelete<Entity>()` (`apiFetch<void>("/<entity>/{id}", { method: "DELETE" })`),
   both invalidating `KEY` on success. See `api/items.ts`.
   **Pass paths WITHOUT the `/api` prefix** — `client.ts` prepends `<BASE_URL>/api`.
2. **Page** — `src/pages/<Entity>Page.tsx`, `export default`. Follow the Items page:
   a header with a **"+ New" button** that opens the create/edit form built with the
   **`ModalForm` kit** (see the modal-form recipe below — never hand-roll a `<Modal>`
   + footer). Each table row ends in a **⋮ row menu** built with `Menu` (see the
   popup recipe below) holding **Edit** (opens the same modal pre-filled) and
   **Delete** (`window.confirm` → the delete mutation; a failure goes to
   `window.alert`, since no modal is open). **Delete also stays inside the edit
   modal** (via `ModalForm`'s `onDelete`), where `onError` sets a `formError` shown
   in the modal's banner. Render loading / error / empty / table states. Tailwind
   utility classes, slate palette.
3. **Route** — add `{ path: "<entity>", element: <EntityPage /> }` to the children
   in `src/routes.tsx`, and an entry to the `NAV` array in `Layout.tsx` (add a matching
   key to the `ICONS` map there). Both the sidebar and the icon rail render from them;
   the rail shows the icon alone, so pick one that reads without its label.

## Recipe: build a modal form (mandatory for all add/edit dialogs)

**Every modal form MUST be built with the `ModalForm` kit
([components/ModalForm.tsx](src/components/ModalForm.tsx)).** Do not hand-roll a
`<Modal>` + banner + label/input rows + footer buttons — the kit exists so every
add/edit dialog across scaffolded apps looks and behaves the same.

What the kit gives you:

- **`ModalForm`** (default export) — the wrapper. Renders `Modal` with a fixed
  header, a scrolling body, and a pinned footer holding Cancel + Submit, plus an
  optional left-aligned Delete when `onDelete` is provided. Props cover the busy
  states (`submitting`, `deleting`, `submitDisabled`), the top error banner
  (`error`), and an extra `banner` slot.
- **Field primitives** — `Field` (label + required marker + inline error),
  `TextInput`, `Textarea`, `SelectField`, and `FormBanner` (`error` | `warning`).
  `TextInput`/`Textarea`/`SelectField` pass props straight through to the native
  control (so `onChange` gives you the DOM event — read `e.target.value`) and
  render their own label/required/inline-error; **don't wrap them in another
  `Field`**.
- **Style tokens** — `inputClass`, `btnClass`, `btnPrimaryClass`, `btnDangerClass`
  for controls *outside* a form (e.g. the page's "+ New" button).

This is a **lightweight kit, not a schema-driven form engine** — you still write
the fields and the submit handler by hand; the kit only removes the repeated
modal/footer/error skeleton and standardizes the field look.

Patterns the worked example ([components/samples/ItemsTab.tsx](src/components/samples/ItemsTab.tsx)) uses:

1. **Mount-on-open** — keep only `open`/`editing` state on the page and render
   `{open && <XxxFormModal editing={editing} … />}`. The subcomponent seeds its
   form via `useState(() => editing ? {…} : EMPTY_FORM)` — no reset `useEffect`,
   since remounting reinitializes. Pass mutation hooks down typed as
   `ReturnType<typeof useCreateXxx>`.
2. **Delete-in-modal** — pass the delete hook down and wire
   `onDelete={editing ? handleDelete : undefined}` (absent in add mode) +
   `deleting={deleteItem.isPending}`; `handleDelete` `window.confirm`s, then
   mutates with `onSuccess=onClose` / `onError=setFormError` (modal stays open on
   failure). Delete errors land in the same top banner as submit errors.
3. **Inline validation** — compute `errors = validate(form)` live (a pure fn, no
   state) so corrections clear errors for free; gate display on a per-field
   `touched` map (set on `onBlur`, set-all on a failed submit); pass
   `error={touched.x ? errors.x : undefined}` to each field. Block submit BOTH via
   an early return in the handler AND `submitDisabled` on `ModalForm`. Keep the top
   `FormBanner` for API/submit errors only.

## Recipe: build a popup or menu (mandatory for all popups)

**Every popup and dropdown menu MUST be built with `Popover`
([components/Popover.tsx](src/components/Popover.tsx)) or, for a list of actions,
`Menu` ([components/Menu.tsx](src/components/Menu.tsx)).** Never hand-roll a popup:
no `absolute` + `top-full` / `bottom-full` / `left-0` / `right-0` positioning, and no
`mousedown` / `keydown` listeners for outside-click or Esc. Don't hard-code a
direction either: `placement` is only a preference.

What you get for free (Floating UI underneath):

- **Placement** — opens up or down and extends left or right from the room around its
  trigger, shifts to stay on-screen, caps its height and scrolls inside when nothing
  fits, and follows the trigger on scroll and resize.
- **A portal** — rendered under `<body>` with fixed positioning, so a scroll or
  `overflow` container can't clip it. Stacks above the page (`z-50`), below modals.
- **Dismissal** — outside click, Esc, a route change, or the trigger scrolling out of
  view closes it.
- **Focus** — moves into the popup on open (a `Menu`'s first item) and back to the
  trigger on close; the trigger gets `aria-haspopup` / `aria-expanded`.
- **Nesting** — a popover opened from inside another (RoleBadge inside the rail's
  account menu) keeps its parent open; Esc closes the innermost first; picking a
  `MenuItem` closes the whole chain.

```tsx
<Menu
  trigger={(props) => (
    <button type="button" {...props} aria-label={`Actions for ${row.name}`}>
      <KebabIcon />
    </button>
  )}
>
  <MenuItem onSelect={() => openEdit(row)}>Edit</MenuItem>
  <MenuDivider />
  <MenuItem tone="danger" onSelect={() => deleteRow(row)}>Delete</MenuItem>
</Menu>
```

- Spread the trigger's `props` (ref included) onto a `<button>`.
- A `MenuItem` closes the menu, then runs `onSelect`; pass `keepOpen` for a toggle
  that changes in place (the theme row in `SettingsMenu`). `MenuRadioItem` is one
  choice of a set (RoleBadge's roles); `MenuLabel` heads a group; any other JSX
  (a header row) is fine as a child.
- For something that isn't a list of actions (a filter panel), use `Popover`
  directly; `usePopover().close()` closes it from inside.

Worked examples: the Items tab's row ⋮ menu
([components/samples/ItemsTab.tsx](src/components/samples/ItemsTab.tsx)),
`SettingsMenu.tsx` and `RoleBadge.tsx`.

## Recipe: add a chart (uPlot)

Charts use [uPlot](https://github.com/leeoniya/uPlot) directly via the reusable
`<UplotChart>` ([components/UplotChart.tsx](src/components/UplotChart.tsx)) — no
wrapper lib. For a new chart:

1. Fetch with a TanStack Query hook (`api/<x>.ts`), as usual.
2. Build `data` as uPlot's `AlignedData`: `[xs, ...series]` where every array is the
   same length. **x is in unix *seconds*** for a time axis (`Date.parse(iso) / 1000`).
3. Build the `options` object (`scales`/`axes`/`series`) and **wrap it in `useMemo`**
   — `<UplotChart>` rebuilds the chart when `data`/`options` change, so an unmemoized
   options object would tear it down every render.
4. Render `<UplotChart data={data} options={options} height={280} />`. It owns sizing
   (ResizeObserver) and cleanup. Import of `uplot/dist/uPlot.min.css` lives in the
   component, not globally.

## Roles: admin-only UI

The backend decides (`require_role("admin")`, see backend/CLAUDE.md); the SPA only hides.
`useRole()` (api/me.ts) gives the **effective** role: `"user"` while `/api/me` loads or
fails, and the previewed role while an admin uses "View as" (picked from the role badge,
kept per tab in lib/viewAs.ts, with a banner and Exit above every page).

- **A nav entry:** add `adminOnly: true` to its `NAV` line in `Layout.tsx`. It shows only to
  admins and always comes **last**, so add ordinary pages anywhere above Admin.
- **A control or section:** `const { isAdmin } = useRole();` and render it only when true.
- **A whole page:** render an "Admins only" notice when `!isAdmin` (see `AdminPage.tsx`),
  and guard its API with `require_role("admin")` — hiding is never the protection.
- **A new admin section:** add a tab to `AdminPage.tsx`'s `TABS` and a component under
  `components/admin/`.

## Conventions that matter

- **Never hardcode `/api` or an env host in fetch calls.** `apiFetch` derives the
  base from `import.meta.env.BASE_URL` (which is `/` locally, `/pace-<env>/`
  in deployed builds). (MSAL's `redirectUri` is the exception — it's the shared,
  path-independent `/auth-callback/`, not BASE_URL-derived; see authConfig.ts.)
- **Server state goes through TanStack Query**, not `useState`/`useEffect`. One
  query key per resource; invalidate it on mutation success.
- **Auth is transparent**: `client.ts` adds the bearer token unless `AUTH_BYPASS`
  (non-HTTPS) is set. Components don't deal with tokens. A token failure that needs
  more than a redirect is handed to `authRecovery.ts` (`reportAuthFailure`), and
  `AuthGate` swaps in the recovery page — don't catch it yourself.
- **API errors are `ApiError`** (from `api/client.ts`) with the HTTP `status` as data.
  Branch on `error.status` (e.g. 404 → not-found state), never by parsing `message`.
  Queries don't retry 4xx responses (`main.tsx`); other failures retry up to 3 times.
- **Build targets**: `npm run build:sbx|uat|prod` bake the per-env base path
  (`vite.config.ts`). Plain `npm run dev`/`build` use base `/`.
- **Styling / design tokens**: the Synveon apps-UI palette/font/radius live in one place —
  the `@theme` block in [src/index.css](src/index.css), which remaps Tailwind's
  `slate` ramp + accent colors to Synveon's warm-gray house style. Build pages with the
  standard utility classes (`bg-slate-50`, `text-slate-600`, `bg-blue-100`, etc.);
  they already render the house look. **Don't introduce new raw colors** — extend
  the `@theme` tokens instead. Reusable styled building blocks live in `components/`
  (`Modal`, `Avatar`, `MetricTile`, `ScrollToTopButton`, and `TabBar` for any
  tabbed view — don't hand-roll tabs; see the category tabs on the Items page); the
  app shell + sidebar nav (logo, icon-per-page `ICONS` map) is in `components/Layout.tsx`.
- **Dark mode is the baseline** — every screen must support it, but you get it for
  free by using tokens. A `[data-theme="dark"]` block in `src/index.css` overrides
  the same `--color-*` vars, so the slate/accent utilities flip automatically. Two
  rules when building a page: (1) use **`bg-surface`** (and `text-surface` on
  inverting `bg-slate-900` buttons) for cards/panels/tables/inputs/buttons — **never
  hardcode `bg-white`/`text-white`** on a surface, it would stay white and leak light
  in dark (modals use `bg-slate-50`, the sidebar `bg-sidebar`); (2) `<canvas>` (uPlot) can't read CSS tokens, so pass concrete per-theme
  colors and include `theme` (from `useTheme()`) in the options `useMemo` deps — see
  the chart recipe above. Resolution/persistence/toggle live in `src/theme.ts` +
  the pre-paint script in `index.html` + the toggle in the sidebar's ⋮ menu
  (`SettingsMenu.tsx`).
- **Text contrast is tested** (`src/contrast.test.ts`): every `text-*` colour needs
  a WCAG AA proof on the grounds it sits on, and the test mirrors the `index.css`
  palette by hand. Changing a colour token or painting a new text colour means
  updating that file, or `npm test` fails.

## Commands

```bash
npm ci          # install
npm run dev     # dev server on :5173 (proxies /api to the backend on :8000)
npm run lint    # eslint
npm run build   # tsc -b && vite build (run before declaring a change done)
npm test        # vitest run (unit + component tests)
```

## Tests

Vitest runs `src/**/*.{test,spec}.{ts,tsx}`. The default environment is `node`
(fine for pure logic like `theme.test.ts`). Component tests that need a DOM opt
into jsdom **per file** with a `// @vitest-environment jsdom` pragma on line 1,
then use `@testing-library/react` (`render`/`screen`/`fireEvent`) — see
`components/ModalForm.test.tsx`. Import test globals explicitly from `"vitest"`
(`describe`/`it`/`expect`/`vi`/`afterEach`); they're not ambient here, and test
files under `src/` are typechecked by `tsc -b`.
