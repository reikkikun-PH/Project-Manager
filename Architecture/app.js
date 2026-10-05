/* ============================================================
   Server Project Manager - how it works
   Shared behaviour for every page in this folder.

   Progressive enhancement throughout: each page reads fine with
   this file removed. Nothing here is required to understand the
   app, only to explore it more comfortably.

   1. Page transition  - a slow cross-fade between pages
   2. Role lens        - pick a role; dim what it cannot do
   3. Guided tour      - walks across pages, not just down one
   4. Reading progress - hairline + back to top
   5. Reveal on scroll - one-way, so nothing flickers
   6. Theme            - auto / light / dark, remembered
   ============================================================ */
"use strict";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const root = document.documentElement;
const hint = $("#hint");
const still = typeof matchMedia === "function" &&
              matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Each page supplies its own resting message, so the status line says something
   useful rather than sitting blank. */
const IDLE = document.body.getAttribute("data-hint") || "";

/* The name of the page we are on, however it was opened. */
const PAGE = decodeURIComponent(location.pathname.split("/").pop() || "index.html");

function say(html) { if (hint) hint.innerHTML = html; }

/* ---------- 1. page transition ----------
   Fades the current page out, then navigates. Plain anchor clicks are
   left alone, so "open in new tab", middle-click and the back button all
   behave exactly as the browser intends. */
let leaving = false;

function dirOf(url) {
  return url.pathname.replace(/[^/]*$/, "");
}

function go(url) {
  if (leaving) return;
  leaving = true;
  try { sessionStorage.setItem("arch-nav", "1"); } catch (e) { /* private mode */ }
  root.classList.add("leaving");
  // Wait out --fade-out before moving, or the browser paints the new page
  // mid-fade and both look half-done.
  setTimeout(() => { location.href = url.href; }, still ? 0 : 380);
}

document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  if (a.target === "_blank" || a.hasAttribute("download")) return;
  if (a.dataset.external !== undefined) return;

  const url = new URL(a.getAttribute("href"), location.href);
  if (url.protocol !== location.protocol) return;
  if (url.protocol !== "file:" && url.origin !== location.origin) return;
  if (url.protocol === "file:" && dirOf(url) !== dirOf(location)) return;

  // A link to a spot on this very page is a scroll, not a navigation.
  if (url.pathname === location.pathname) {
    if (!url.hash) return;
    e.preventDefault();
    const t = document.getElementById(url.hash.slice(1));
    if (t) t.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    return;
  }
  e.preventDefault();
  go(url);
});

/* Reveal the page once it has painted in its hidden state, otherwise the
   browser coalesces the two frames and the transition never plays. */
requestAnimationFrame(() => requestAnimationFrame(() => {
  root.classList.add("entered");
  try { sessionStorage.removeItem("arch-nav"); } catch (e) { /* ignore */ }
}));

/* ---------- 2. role lens ---------- */
const ROLE_NOTE = {
  visitor: "A <b>visitor</b> can look and nothing more. Everything that changes something is out of reach.",
  user:    "A <b>user</b> can sign in and upload up to two projects. Each upload waits for an administrator before anyone else sees it.",
  admin:   "An <b>administrator</b> can do everything, including approving other people. An upload they make skips the queue and goes live immediately."
};
const COLUMN = { visitor: 1, user: 2, admin: 3 };

function setRole(role, quiet) {
  const on = role !== null;
  document.body.classList.toggle("lensed", on);
  $$(".role").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.role === role)));
  $$(".card[data-roles]").forEach(c => {
    const usable = !on || c.dataset.roles.split(" ").indexOf(role) !== -1;
    c.classList.toggle("off", !usable);
  });

  // Only the roles page has the permission table.
  const table = $("#permTable");
  if (table) {
    table.classList.remove("r1", "r2", "r3");
    if (on) table.classList.add("r" + COLUMN[role]);
  }

  $$(".layer").forEach(l => {
    const any = $$(".card[data-roles]", l).some(c => !c.classList.contains("off"));
    l.classList.toggle("off", on && !any);
  });

  try { localStorage.setItem("arch-role", role || ""); } catch (e) { /* ignore */ }
  if (!quiet) say(on ? ROLE_NOTE[role] : IDLE);
}

$$(".role").forEach(b => b.addEventListener("click", () => {
  const r = b.dataset.role;
  // Clicking the active role clears the lens, so it is a real toggle.
  setRole(b.getAttribute("aria-pressed") === "true" ? null : r);
}));

/* ---------- 3. guided tour, across pages ---------- */
const TOUR = [
  { page: "index.html",      sec: "layers",  label: "The four layers, top to bottom" },
  { page: "index.html",      sec: "open",    label: "Why one address covers three kinds of project" },
  { page: "upload.html",     sec: "request", label: "One upload, followed all the way through" },
  { page: "roles.html",      sec: "roles",   label: "What each role is allowed to do" },
  { page: "operations.html", sec: "outside", label: "The three things it needs from elsewhere" },
  { page: "operations.html", sec: "backup",  label: "What to copy to keep a backup" },
  { page: "operations.html", sec: "gotchas", label: "The surprising behaviours" }
];
let tstop = -1;
try {
  const saved = parseInt(sessionStorage.getItem("arch-tour"), 10);
  if (!isNaN(saved) && saved >= 0 && saved < TOUR.length) tstop = saved;
} catch (e) { /* ignore */ }
try { sessionStorage.setItem("arch-tour", String(tstop)); } catch (e) { /* ignore */ }

const tourBtn = $("#tourBtn");
const prevBtn = $("#prevBtn");
const nextBtn = $("#nextBtn");
const stopBtn = $("#tourStop");
const prog = $("#prog");

function clearTourMarks() {
  $$("section").forEach(s => s.classList.remove("touring"));
  $$(".card.lit").forEach(c => c.classList.remove("lit"));
}

function paintTour() {
  const live = tstop >= 0;
  // "$('#' + id)" and not "$(id)": the latter is querySelector("prevBtn"),
  // which looks for a <prevBtn> element and returns null.
  [prevBtn, nextBtn, stopBtn].forEach(b => { if (b) b.hidden = !live; });
  if (tourBtn) tourBtn.hidden = live;
  if (prog) {
    prog.hidden = !live;
    prog.textContent = live ? (tstop + 1) + " / " + TOUR.length : "";
  }

  clearTourMarks();
  if (!live) {
    if (nextBtn) nextBtn.textContent = "Next";
    return;
  }

  const stop = TOUR[tstop];
  if (nextBtn) nextBtn.textContent = tstop === TOUR.length - 1 ? "Restart" : "Next";

  // The tour stop lives on this page only if the file names match.
  if (stop.page !== PAGE) {
    say("<b>" + (tstop + 1) + " of " + TOUR.length + "</b> — next: " + stop.label);
    return;
  }
  const sec = document.getElementById(stop.sec);
  if (sec) {
    sec.classList.add("touring");
    sec.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }
  say("<b>" + (tstop + 1) + " of " + TOUR.length + "</b> — " + stop.label);
}

function goStop(n) {
  tstop = (n + TOUR.length) % TOUR.length;
  try { sessionStorage.setItem("arch-tour", String(tstop)); } catch (e) { /* ignore */ }
  const stop = TOUR[tstop];
  if (stop.page === PAGE) { paintTour(); return; }
  // Crossing to another page: go through the fade like any other link, so
  // the arrival looks deliberate rather than like a jump cut.
  go(new URL(stop.page + "#" + stop.sec, location.href));
}

if (tourBtn) tourBtn.addEventListener("click", () => { tstop = 0; goStop(0); });
if (prevBtn) prevBtn.addEventListener("click", () => goStop(tstop - 1));
if (nextBtn) nextBtn.addEventListener("click", () => goStop(tstop + 1));
if (stopBtn) stopBtn.addEventListener("click", () => {
  tstop = -1;
  try { sessionStorage.setItem("arch-tour", "-1"); } catch (e) { /* ignore */ }
  paintTour();
});

/* Escape leaves the tour, or clears the role lens - whichever is active.
   Left/right also step the tour, which is what people try first. */
addEventListener("keydown", e => {
  const live = tstop >= 0;
  if (live && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    goStop(tstop + (e.key === "ArrowRight" ? 1 : -1));
    return;
  }
  if (e.key !== "Escape") return;
  if (live) { stopBtn.click(); return; }
  if (document.body.classList.contains("lensed")) setRole(null);
});

/* ---------- arriving at a layer from a walkthrough jump ----------
   The jumps are ordinary links to index.html#L1..L4, so they already fade
   through the same transition as the rest of the navigation. All that is
   left is to light the layer once we get there.
   Deliberately runs AFTER boot: paintTour() clears every highlight, so doing
   this first would light the layer and immediately wipe it again. When a tour
   is running the tour's own stop wins. */
function lightJumpedLayer() {
  if (tstop >= 0 || !location.hash) return;
  const target = document.getElementById(location.hash.slice(1));
  if (!target || !target.classList.contains("layer")) return;
  clearTourMarks();
  target.classList.add("touring");
  $$(".card", target).forEach(c => c.classList.add("lit"));
  setTimeout(() => {
    target.classList.remove("touring");
    $$(".card.lit").forEach(c => c.classList.remove("lit"));
  }, 2600);
}

/* ---------- 4. reading progress + back to top ---------- */
const readbar = $("#readbar");
const topBtn = $("#topBtn");

function onScroll() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const done = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  if (readbar) readbar.style.width = (done * 100).toFixed(2) + "%";
  if (topBtn) topBtn.classList.toggle("show", window.scrollY > 600);
}
if (topBtn) {
  topBtn.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" }));
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* Highlight whichever entry of the on-this-page list you are reading. */
const tocLinks = $$(".toc a");
if (tocLinks.length && typeof IntersectionObserver === "function") {
  const mark = id => tocLinks.forEach(a =>
    a.setAttribute("aria-current", String(a.getAttribute("href").endsWith("#" + id))));
  const spy = new IntersectionObserver(entries => {
    const hit = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (hit) mark(hit.target.id);
  }, { rootMargin: "-120px 0px -70% 0px", threshold: 0 });
  $$("section[id]").forEach(s => spy.observe(s));
}

/* ---------- 5. reveal on scroll ----------
   The class is added here, never in the stylesheet's initial state, so if
   this script does not run the content is simply visible rather than stuck
   at opacity 0. Also feature-detected, because an observer-less environment
   should not throw on load. */
if (still || typeof IntersectionObserver === "undefined") {
  // Nothing to observe, so show everything at once.
  $$(".layer, .cards > .card, .steps > li, details, .note").forEach(el =>
    el.classList.add("in"));
} else {
  const targets = $$(".layer, .cards > .card, .steps > li, details, .note");
  // Stagger within each group so rows cascade rather than popping as one slab.
  $$(".cards, .steps").forEach(group => {
    Array.from(group.children).forEach((el, i) =>
      el.style.setProperty("--d", (i * 55) + "ms"));
  });
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      obs.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  targets.forEach(el => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

/* The page head is already on screen, so it gets a deliberate opening
   cascade rather than waiting for a scroll that will never come. */
$$(".phead > *").forEach((el, i) => {
  el.style.setProperty("--d", (i * 80) + "ms");
  el.classList.add("reveal");
  // One frame's gap so the transition has a starting state to move from.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
});

/* ---------- 6. theme ---------- */
const THEMES = ["auto", "light", "dark"];
const LABEL = { auto: "auto", light: "light", dark: "dark" };
let theme = "auto";
try { theme = localStorage.getItem("arch-theme") || "auto"; } catch (e) { /* ignore */ }
if (THEMES.indexOf(theme) === -1) theme = "auto";

const themeBtn = $("#themeBtn");
function paintTheme() {
  // The inline head script has already set the attribute to avoid a flash;
  // this keeps it in step with the stored choice and updates the button.
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  if (themeBtn) {
    themeBtn.textContent = "Theme: " + LABEL[theme];
    themeBtn.setAttribute("aria-pressed", String(theme !== "auto"));
  }
  try { localStorage.setItem("arch-theme", theme); } catch (e) { /* ignore */ }
}
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    paintTheme();
  });
}

/* ---------- boot ---------- */
paintTheme();

// Restore the lens the reader last chose, so it survives moving between pages.
// Called either way, so the status line always has something in it.
let savedRole = "";
try { savedRole = localStorage.getItem("arch-role") || ""; } catch (e) { /* ignore */ }
setRole(savedRole && ROLE_NOTE[savedRole] ? savedRole : null);

paintTour();
// Last, so it is not wiped by the tour's own highlight pass.
lightJumpedLayer();

// Marks that boot finished. Harmless in a browser, and it gives the tests
// something definite to wait for instead of guessing at a delay.
root.setAttribute("data-booted", "1");
