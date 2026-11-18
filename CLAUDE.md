# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, single-file dashboard ("RCS Tracker") for a 9-person Universität Trier research team (Group 10, supervisor Nils Schwager) running prompt-variant experiments on the Twin-2K-500 dataset in Kaggle. It is hosted on GitHub Pages at https://bhuwanadhikari.github.io/rcs-group10-lm-psychometrics/ (repo: `bhuwanadhikari/rcs-group10-lm-psychometrics`).

Hard constraints (keep them):
- Everything lives in **one `index.html`** (inline CSS + vanilla JS in an IIFE). No build step, no frameworks, no backend.
- The only allowed external resource is Google Fonts (Inter, JetBrains Mono). No chart libraries: progress rings use CSS `conic-gradient`, and bars and heatmap cells are plain styled elements.
- No console errors. `localStorage` and clipboard access are always wrapped in try/catch.

## Running / testing

There is no build, lint or test tooling. To preview, serve the folder over HTTP so `fetch` works. Opening the file directly via `file://` makes the fetch fail, so the page shows a "No data" state:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

To quickly check the script's syntax, pull out the last `<script>` block and run `node --check` on it. A jsdom smoke test (with `fetch` stubbed to reject, and `matchMedia`/`IntersectionObserver`/`scrollIntoView` stubbed) exercises the whole mock-data render path.

## Data flow

All content is in `data/*.json`. `index.html` contains no data: it holds only file paths and timing (`CONFIG`) plus UI labels. Each file holds one kind of data:

| File | Shape | Holds |
|---|---|---|
| `data/config.json` | object | `generated_at`, `subtitle`, `repo`, `drive_url`, `dataset` (footer credit), `objectives` (`{O1A: {name, desc}, …}`; drives the per-group progress cards) |
| `data/members.json` | `{members: [...]}` | **Source of truth for every member field**: `id`, `name`, `github`, `avatar_url`, `objective` (or `group`, any case: `"o1a"` → `O1A`), `onboarding.{github_invite: accepted\|pending\|not_sent, kaggle_linked, drive_access}` |
| `data/batches.json` | `{batches: [...]}` | `batch_id`, `objective`, `member_id` (must match a member `id`), `model`, `status`, chunk/prompt counts, `started_at`/`updated_at`, `kaggle_url`, `drive_folder_url`, `commit_sha`, `gpu_minutes`, `error` |
| `data/setup_tasks.json` | `{setup_tasks: [...]}` | `task`, `owner` (member id or free text), `done` |

- `load()` fetches all four files in parallel (cache-busted) on load and every 60 s, skipping refreshes while the tab is hidden. Each file may also be a bare array.
- `members.json` is the only required file. If it fails, every section shows a "No data" state (`renderLoadError`). If any other file fails, an amber banner names it and the affected sections render empty. If a later refresh fails, the last good data is kept.
- There is no embedded demo data. The checked-in `batches.json` and `setup_tasks.json` currently contain generated placeholder data with fixed timestamps, so "running" batches will show as stale after 30 minutes until a real export (planned: GitHub Actions) overwrites them.
- Every count and percentage is computed client-side from `batches`. Nothing aggregated is read from the JSON.

## JS architecture (inside the IIFE in `index.html`)

- `CONFIG` holds the data file paths, refresh intervals and the 30-minute stale threshold. `OBJECTIVES` is a stub that gets filled from `config.json`. Repo, Drive, subtitle and footer values come from `config.json` via `S.data`, and the Drive and GitHub header buttons are hidden when their URL is missing.
- `S` is the single mutable state object: loaded data, objective filter, search, sort, status filter, activity limit, drawer state, plus `memberById`/`batchById` lookup maps rebuilt by `normalize()`.
- There is no objective filter or O0 tab: everyone runs the same experiment, so the page is one shared view. Groups (O1A/O1B/O1C) appear only as labels and in the per-group progress cards. A batch's group is always taken from its member in `normalize()`, so changing a member's group in `members.json` moves their batches too.
- **Team list** (`rankMembers`/`memberRow`): one ranked list rather than cards. Members are ordered by number of done batches (highest first), with ties broken by last name (the final word of `name`) and then full name. Each row shows the group as a chip. Search matches name, GitHub handle or group.
- **Effective status:** `effStatus(b)` turns `running` into `stale` when `updated_at` is more than 30 minutes old. `view()` applies the objective filter and caches the result on each batch as `b._st`. Always use `_st`/`effStatus` rather than raw `b.status` for display and counts.
- Rendering is string-template `innerHTML` per section (`renderKPIs`, `renderObjectives`, `renderTeam`, `renderBoard`, `renderActivity`, `renderFailures`, `renderSetup`, `renderFooter`), all called by `renderAll()`. All interpolated data goes through `esc()`. Re-rendering is a full section replace. The drawer re-renders in place, keeping its scroll position.
- **Events** are delegated through one document click handler keyed on data attributes: `data-obj`, `data-status`, `data-copy`, `data-close`, `data-batch`, `data-member`. New interactive elements should follow that pattern instead of binding listeners after each render.
- **Relative times** are `<time data-rel=… data-prefix=…>` elements that `tickRel()` updates every 30 s. Use `relEl()` to emit them.
- **Derived values:** the resume command is `run_batch(batch_id="…", start_chunk=last_completed_chunk+1)`. Commit links are `https://github.com/<repo>/commit/<sha>`. Per-batch Drive links fall back to the root `drive_url`. Estimated finish = remaining batches × average done-batch duration ÷ members with Kaggle linked in that objective.

## Styling conventions

- Colors are CSS variables on `:root`. Dark mode is defined twice: once under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and once under `:root[data-theme="dark"]`. Token changes must go in both places. The theme toggle writes `data-theme` on `<html>` and `localStorage['rcs-theme']`.
- Objective and status colors are applied through modifier classes (`.o-O1A`, `.s-failed`, …) that set `--oc` (base color) and `--oc-t` (darker in light mode, lighter in dark mode, for AA-contrast text). Chips use `color-mix(... 12%)` backgrounds. Status is always shown as a dot plus a text label, never color alone.
- Breakpoints: ≥1200 desktop, 768–1199 tablet (KPI 3+2, team list hides the onboarding and status columns, drawer 420px), <768 mobile (full-screen drawer, heatmap scrolls horizontally with a sticky member column). `prefers-reduced-motion` disables all animation and the KPI count-up.
