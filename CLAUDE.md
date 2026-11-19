# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static dashboard ("RCS Tracker") for a 9-person Universität Trier research team (Group 10, supervisor Nils Schwager) running prompt-variant experiments on the Twin-2K-500 dataset in Kaggle. It is a **separate utility**, hosted in its own public repo `uni-rcs-team-10/tracker` (a free GitHub org) and published on GitHub Pages at https://uni-rcs-team-10.github.io/tracker/. The team's experiment code lives in the org's **private** repo `uni-rcs-team-10/rcs-group10-lm-psychometrics`. The tracker never writes there. `config.json`'s `repo` points to that private repo only to build commit links, which work only for its collaborators.

Hard constraints (keep them):
- Static files only: `index.html` (markup), `css/styles.css`, `js/*.js`, `data/*.json`. No build step, no frameworks, no backend.
- JS files are **plain classic scripts, not ES modules**, loaded in order at the end of `index.html`: `config.js` → `utils.js` → `render.js` → `drawer.js` → `app.js` (startup code is at the bottom of `app.js`). They share the global scope, so a function in one file can be called from another. Keep that load order, and avoid new top-level names that could clash. `js/theme-init.js` is loaded in `<head>` to apply the saved theme before first paint.
- The only allowed external resource is Google Fonts (Inter, JetBrains Mono). No chart libraries: progress rings use CSS `conic-gradient`, and bars and heatmap cells are plain styled elements.
- No console errors. `localStorage` and clipboard access are always wrapped in try/catch.

## Running / testing

There is no build, lint or test tooling. To preview, serve the folder over HTTP so `fetch` works. Opening the file directly via `file://` makes the fetch fail, so the page shows a "No data" state:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

Check syntax with `for f in js/*.js; do node --check $f; done`. A jsdom smoke test (with `fetch` stubbed to reject, and `matchMedia`/`IntersectionObserver`/`scrollIntoView` stubbed) exercises the whole mock-data render path.

## Data flow

All content is in `data/*.json`. The code holds no data, only file paths and timing (`CONFIG` in `js/config.js`) plus UI labels. Each file holds one kind of data:

| File | Shape | Holds |
|---|---|---|
| `data/config.json` | object | `generated_at`, `subtitle`, `repo`, `drive_url`, `dataset` (footer credit), `objectives` (`{O1A: {name, desc}, …}`; drives the per-group progress cards) |
| `data/members.json` | `{members: [...]}` | **Source of truth for every member field**: `id`, `name`, `github`, `avatar_url`, `objective` (or `group`, any case: `"o1a"` → `O1A`), `onboarding.{github_invite: accepted\|pending\|not_sent, kaggle_linked, drive_access}` |
| `data/batches.json` | `{batches: [...]}` | **Generated, do not hand-edit:** built by `scripts/build_data.py` from `data/batch_plan.json` (planned batches: `batch_id`, `member_id`, `model`, `chunks_total`, `prompts_total`) plus `data/runs/<batch_id>.json` (live status). Fields: `batch_id`, `objective`, `member_id` (must match a member `id`), `model`, `status`, chunk/prompt counts, `started_at`/`updated_at`, `kaggle_url`, `drive_folder_url`, `commit_sha`, `gpu_minutes`, `error` |
| `data/setup_tasks.json` | `{setup_tasks: [...]}` | `task`, `owner` (member id or free text), `done` |

- `load()` fetches all four files in parallel (cache-busted) on load and every 60 s, skipping refreshes while the tab is hidden. Each file may also be a bare array.
- `members.json` is the only required file. If it fails, every section shows a "No data" state (`renderLoadError`). If any other file fails, an amber banner names it and the affected sections render empty. If a later refresh fails, the last good data is kept.
- `setup_tasks.json` and `members.json` are maintained by hand. `members.json`'s `onboarding.github_invite` is also overwritten at deploy time when the `GH_ADMIN_TOKEN` secret is set.

## Automation pipeline

1. Kaggle notebooks use `tracker/rcs_tracker.py` (`BatchTracker`, a context manager) to PUT `data/runs/<batch_id>.json` through the GitHub Contents API. The token is the Kaggle Secret `RCS_GH_TOKEN`. Start/done/failed commits trigger a deploy. Progress heartbeats (sent at most every 10 min) are committed with `[skip ci]` and picked up by the 15-minute cron. Setup notes for the team are in `tracker/README.md`.
2. `.github/workflows/deploy.yml` (Pages source must be "GitHub Actions") runs `scripts/build_data.py`, which merges plan and runs into `batches.json`, stamps `config.json` `generated_at`, and optionally syncs GitHub invites. It then deploys `index.html`, `css/`, `js/` and the four dashboard JSON files.
3. `CONFIG.staleMinutes` is 45 (10-minute heartbeat + 15-minute cron + slack). Lowering it will make healthy runs flash as stale.

Run `python3 scripts/build_data.py` locally after editing the plan or run files to refresh the local preview.
- Every count and percentage is computed client-side from `batches`. Nothing aggregated is read from the JSON.

## JS architecture (`js/`)

- `CONFIG` holds the data file paths, refresh intervals and the stale threshold (45 min). `OBJECTIVES` is a stub that gets filled from `config.json`. Repo, Drive, subtitle and footer values come from `config.json` via `S.data`, and the Drive and GitHub header buttons are hidden when their URL is missing.
- `S` is the single mutable state object: loaded data, objective filter, search, sort, status filter, activity limit, drawer state, plus `memberById`/`batchById` lookup maps rebuilt by `normalize()`.
- There is no objective filter or O0 tab: everyone runs the same experiment, so the page is one shared view. Groups (O1A/O1B/O1C) appear only as labels and in the per-group progress cards. A batch's group is always taken from its member in `normalize()`, so changing a member's group in `members.json` moves their batches too.
- **Team list** (`rankMembers`/`memberRow`): one ranked list rather than cards. Members are ordered by number of done batches (highest first), with ties broken by last name (the final word of `name`) and then full name. Each row shows the group as a chip. Search matches name, GitHub handle or group.
- **Effective status:** `effStatus(b)` turns `running` into `stale` when `updated_at` is more than `CONFIG.staleMinutes` old. `view()` applies the objective filter and caches the result on each batch as `b._st`. Always use `_st`/`effStatus` rather than raw `b.status` for display and counts.
- Rendering is string-template `innerHTML` per section (`renderKPIs`, `renderObjectives`, `renderTeam`, `renderBoard`, `renderActivity`, `renderFailures`, `renderSetup`, `renderFooter`), all called by `renderAll()`. All interpolated data goes through `esc()`. Re-rendering is a full section replace. The drawer re-renders in place, keeping its scroll position.
- **Events** are delegated through one document click handler keyed on data attributes: `data-obj`, `data-status`, `data-copy`, `data-close`, `data-batch`, `data-member`. New interactive elements should follow that pattern instead of binding listeners after each render.
- **Relative times** are `<time data-rel=… data-prefix=…>` elements that `tickRel()` updates every 30 s. Use `relEl()` to emit them.
- **Derived values:** the resume command is `run_batch(batch_id="…", start_chunk=last_completed_chunk+1)`. Commit links are `https://github.com/<repo>/commit/<sha>`. Per-batch Drive links fall back to the root `drive_url`. Estimated finish = remaining batches × average done-batch duration ÷ members with Kaggle linked in that objective.

## Styling conventions

- Colors are CSS variables on `:root`. Dark mode is defined twice: once under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and once under `:root[data-theme="dark"]`. Token changes must go in both places. The theme toggle writes `data-theme` on `<html>` and `localStorage['rcs-theme']`.
- Objective and status colors are applied through modifier classes (`.o-O1A`, `.s-failed`, …) that set `--oc` (base color) and `--oc-t` (darker in light mode, lighter in dark mode, for AA-contrast text). Chips use `color-mix(... 12%)` backgrounds. Status is always shown as a dot plus a text label, never color alone.
- Breakpoints: ≥1200 desktop, 768–1199 tablet (KPI 3+2, team list hides the onboarding and status columns, drawer 420px), <768 mobile (full-screen drawer, heatmap scrolls horizontally with a sticky member column). `prefers-reduced-motion` disables all animation and the KPI count-up.

## Deploying

Pages for `uni-rcs-team-10/tracker` is set to Source = "GitHub Actions" (`.github/workflows/deploy.yml`), so every push to `main` redeploys, and so does the 15-minute cron. Kaggle run reports (`REPO` in `tracker/rcs_tracker.py`) commit into this tracker repo. `onboarding.github_invite` means "invited to the private experiment repo", which this repo's CI can't see. Keep it manual in `members.json` and leave the `GH_ADMIN_TOKEN` secret unset (the sync is skipped when it is unset). Locally, run `python3 scripts/build_data.py`, then serve over HTTP; `file://` won't load the data.
