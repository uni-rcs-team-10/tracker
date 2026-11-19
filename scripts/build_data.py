#!/usr/bin/env python3
"""Build data/batches.json for the dashboard.

Inputs
  data/batch_plan.json   planned batches (hand-maintained): batch_id, member_id, model,
                         chunks_total, prompts_total, optional drive_folder_url
  data/runs/*.json       live run status, one file per batch, written from Kaggle by
                         tracker/rcs_tracker.py

Outputs
  data/batches.json      plan + latest run status merged (what the dashboard reads)
  data/config.json       generated_at set to now
  data/members.json      onboarding.github_invite synced from the GitHub API, only when
                         GH_ADMIN_TOKEN (needs admin read on the repo) and REPO are set

Standard library only. Usage: python3 scripts/build_data.py
"""
import glob
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = {"pending", "running", "done", "failed", "stale"}
RUN_FIELDS = ["model", "status", "last_completed_chunk", "prompts_done", "started_at", "updated_at",
              "kaggle_url", "drive_folder_url", "commit_sha", "gpu_minutes", "error"]
DEFAULTS = {"status": "pending", "chunks_total": 0, "last_completed_chunk": 0, "prompts_total": 0,
            "prompts_done": 0, "started_at": None, "updated_at": None, "kaggle_url": None,
            "drive_folder_url": None, "commit_sha": None, "gpu_minutes": 0, "error": None}


def path(*p):
    return os.path.join(ROOT, "data", *p)


def load(p, default=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        print(f"::warning file={os.path.relpath(p, ROOT)}::invalid JSON, skipped ({e})")
        return default


def save(p, obj):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def as_list(obj, key):
    if isinstance(obj, list):
        return obj
    return (obj or {}).get(key) or []


def build_batches():
    plan = as_list(load(path("batch_plan.json"), {}), "batches")
    runs = {}
    for f in sorted(glob.glob(path("runs", "*.json"))):
        r = load(f)
        if isinstance(r, dict):
            runs[r.get("batch_id") or os.path.splitext(os.path.basename(f))[0]] = r

    out = []
    for p in plan:
        b = {**DEFAULTS, **p}
        r = runs.pop(p["batch_id"], None)
        if r:
            b.update({k: r[k] for k in RUN_FIELDS if k in r and r[k] is not None})
        out.append(b)
    for bid, r in runs.items():  # runs without a plan entry still show up
        print(f"::warning::run {bid} has no entry in batch_plan.json")
        out.append({**DEFAULTS, **{k: v for k, v in r.items() if v is not None}, "batch_id": bid})

    for b in out:
        if b.get("status") not in STATUSES:
            b["status"] = "pending"
    return out


def gh_get(url, token):
    items, page = [], 1
    while True:
        req = urllib.request.Request(f"{url}{'&' if '?' in url else '?'}per_page=100&page={page}", headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rcs-tracker-build"})
        with urllib.request.urlopen(req, timeout=20) as r:
            chunk = json.load(r)
        items += chunk
        if len(chunk) < 100:
            return items
        page += 1


def sync_invites(members):
    token, repo = os.environ.get("GH_ADMIN_TOKEN"), os.environ.get("REPO")
    if not token or not repo:
        print("GitHub invite sync skipped (GH_ADMIN_TOKEN / REPO not set)")
        return False
    try:
        api = f"https://api.github.com/repos/{repo}"
        accepted = {c["login"].lower() for c in gh_get(f"{api}/collaborators?affiliation=all", token)}
        pending = {i["invitee"]["login"].lower() for i in gh_get(f"{api}/invitations", token) if i.get("invitee")}
    except Exception as e:  # never fail the deploy because of this
        print(f"::warning::GitHub invite sync failed: {e}")
        return False
    changed = False
    for m in members:
        gh = (m.get("github") or "").lower()
        if not gh:
            continue
        state = "accepted" if gh in accepted else "pending" if gh in pending else "not_sent"
        ob = m.setdefault("onboarding", {})
        if ob.get("github_invite") != state:
            ob["github_invite"], changed = state, True
    return changed


def main():
    batches = build_batches()
    save(path("batches.json"), {"batches": batches})

    cfg = load(path("config.json"), {}) or {}
    cfg["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    save(path("config.json"), cfg)

    members_doc = load(path("members.json"), {}) or {}
    if sync_invites(as_list(members_doc, "members")):
        save(path("members.json"), members_doc)

    counts = {}
    for b in batches:
        counts[b["status"]] = counts.get(b["status"], 0) + 1
    print(f"batches.json: {len(batches)} batches {counts}")


if __name__ == "__main__":
    sys.exit(main())
