# Backlog

> Master triage backlog for the product workflow. Maintained by the `/triage` skill.
> Status lifecycle: triaged → planning → prd → in-progress → shipped (or parked).
> Slugs here are the canonical `<feature>` names used by planning-<slug>.md and prd-<slug>.md.

**Initial contributor:** Inji Choe <injic05@gmail.com>
**Last contributor:** Inji Choe <injic05@gmail.com> (2026-11-16)

_Last triaged: 2026-11-16_

## Features

### pace-logo — `in-progress`
**Summary:** Give Pace its own mark, replacing the Synveon template branding everywhere it still shows.
**Absorbs:** #1
**Size:** S/M · **Order:** 1 · **Depends on:** — · **Requested on:** 2026-11-16 · **Last worked on:** 2026-11-16
**Artifacts:** — (built directly, no planning/PRD round)
**Contributors:** Inji Choe <injic05@gmail.com>
**Notes:** The app still wears the template's identity: `frontend/src/components/Layout.tsx`
(lines 118–119) renders Synveon's `logo.png` / `logo_dark.png` in the sidebar,
`frontend/public/favicon.svg` is Synveon's purple mark, and `frontend/index.html` still
titles the tab `pace-v0`. The chat header in `frontend/src/pages/ChatPage.tsx` renders
"Pace" as plain text.

Decided at triage (2026-11-16): the mark is **hand-written SVG in the repo**, not a
supplied asset — versionable, scales, and recolours for dark mode from the `@theme`
tokens in `frontend/src/index.css`, so it needs no second file the way the current PNG
pair does (the existing logo's navy lettering disappears on the dark sidebar, which is why
there are two today). Expect considered-but-simple, not a brand studio's work.

Scope is **all four places** — sidebar, favicon, tab title, chat header — so nothing in
the UI reads "Synveon" or "pace-v0" afterwards. Explicitly **out** of scope: Open Graph
tags for the shared-link preview. That was offered and not taken; if how the Vercel review
link looks in Slack or email starts to matter, it returns as its own feature, since it
needs a preview image that this one does not.

Built 2026-11-16 on `feature/pace-chat-ui` rather than its own branch, so the Vercel
review link stays one deployable thing. `frontend/src/components/PaceLogo.tsx` draws the
glyph (three motion lines running into a chevron) plus the word, in `currentColor` and
the app's font, so the light/dark PNG pair is gone — both template logos are deleted.
`public/favicon.svg` is the same chevron on a rounded tile, with an embedded
`prefers-color-scheme` query that inverts it so a dark tile does not vanish into dark
browser chrome. Tab title is now "Pace".

Not done: the sidebar still shows `pace-v0` on the small line under the wordmark. That is
the template's project-name chrome and it carries the version, so it was left rather than
quietly removed.

## Needs clarification

_Nothing outstanding._

## Raw request log
1. "a logo called pace"  → pace-logo
