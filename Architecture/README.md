# How it works — Server Project Manager

Plain-language documentation for the people who use this app. It describes what
the app **does**, deliberately not how it is written: no filenames, no functions,
no libraries. If you are looking for the code, this is the wrong folder.

## The pages

| File | Page | What it covers |
|---|---|---|
| `index.html` | **01 — Overview** | What the app is, the four layers it is built from, and the three kinds of project it can host |
| `upload.html` | **02 — Walkthrough** | One project upload followed from the drag-and-drop to the link going live, in ten steps |
| `roles.html` | **03 — Roles** | What a visitor, a user and an administrator can each do, and how the check actually works |
| `operations.html` | **04 — Running it** | The outside services it depends on, what a complete backup is, and the surprising behaviours |

`style.css` and `app.js` are shared by all four. Keeping them in one pair of
files is what stops the pages drifting apart as they are edited.

Open `index.html` in a browser. There is nothing to install and nothing to run.

## What you can click

Everything below is optional. With JavaScript turned off the pages still read
completely — every word of content is in the HTML, and the script never writes
anything except a single status line.

| Control | What it does |
|---|---|
| **Take the tour** | Walks all seven sections **across all four pages**, moving between them with the same fade as any other navigation. Back / Next / Stop, it wraps at the end, and `←` `→` work too. Stop on any page and it stops for good. |
| **View as** Visitor / User / Admin | Dims every part of the app that role cannot reach, labels each one *Not your role*, and narrows the permission table to that role's column. Click the active role again to clear it. Your choice is remembered, so it carries across pages. |
| **`layer n →`** on a walkthrough step | Jumps to that layer on the Overview page and lights up its cards, so you can see where in the stack the step happens. |
| **On this page** | The chips on the right of the sub-bar. The one you are reading is highlighted as you scroll. |
| **Theme: auto / light / dark** | Overrides your system setting. Remembered in this browser only, and applied before the page paints, so there is no white flash. |
| **Back to top** | Appears once you are a screen down. The hairline along the top of the header shows how far through the page you are. |
| **Escape** | Leaves the tour, or clears the role lens — whichever is active. |

Two things worth trying first: pick **Visitor** on the Overview, which answers
"what can someone who hasn't signed in actually do?" in about a second; then
press **Take the tour** and let it carry you to the Roles page on its own.

## Page transitions

Moving between pages fades the current one out over 340&nbsp;ms and brings the
next in over 440&nbsp;ms, with a slight blur and scale so it reads as one object
moving rather than two pages swapping.

This is done by hand rather than with the View Transitions API, because that
API needs a same-origin context and these pages are normally opened straight from
a folder as `file://` URLs, where it is unavailable. A hand-rolled fade also
means the timing is the same everywhere.

Ordinary browser behaviour is left alone: `Ctrl`/`Cmd`/middle-click, "open in a
new tab", and the back button all work exactly as you would expect, because only
a plain left-click on an internal link is intercepted.

Under `prefers-reduced-motion: reduce` the pages simply appear, with no fade and
no scroll animation. Nothing depends on the animation to become readable.

## Accessibility notes

- Real `<button>` and `<a>` elements throughout, so `Tab`, `Enter` and `Space`
  all work; visible focus rings on everything focusable.
- The status line under the header is an `aria-live="polite"` region, so lens
  and tour changes are announced rather than happening silently.
- Tables carry `<caption>` and `scope` attributes.
- The tour highlight is an outline, not a colour change alone, so it does not
  rely on colour perception.

## Keeping it accurate

The app's behaviour is the source of truth; these pages are a description of it.
If the app changes, the matching page needs changing with it.

Two conventions that keep it honest:

- **No implementation detail in the prose.** If a sentence would only make sense
  to someone who has read the source, it belongs in a comment, not here.
- **Content is static.** Prose lives in the HTML, not in the script. If a page
  reads as empty, that is a bug in the script — never a reason to move text into
  it.

`pagecheck.js` in the development scratch area enforces both, along with link
integrity: every internal link and anchor must resolve, every tour stop must
name a real page and section, and no page may name a source file or library.

## Not part of the app

This folder is documentation only.

- The app never serves it. Every route under `/Architecture/` returns `404`,
  including the pages, the stylesheet and the script.
- Nothing in the app reads these files, and they are not needed to run it.

The two are deliberately kept apart: the app must keep working with this folder
deleted, and this folder must keep describing the app accurately whether or not
anyone remembers to update it.
