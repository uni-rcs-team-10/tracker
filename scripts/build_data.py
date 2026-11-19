#!/usr/bin/env python3
"""Build data/batches.json for the dashboard.

Inputs
  batch plan             maintained by Bhuwan in the experiment repo (config.json `repo`,
                         file `batch_plan_path`, default batch_plan.json). Fetched with
                         GH_ADMIN_TOKEN and cached to data/batch_plan.json. Without the token,
                         or if the fetch fails, the cached data/batch_plan.json is used.
                         Entries: batch_id, member_id, model, chunks_total, prompts_total,
                         optional drive_folder_url
  data/runs/*.json       live run status, one file per batch, written from Kaggle by
                         tracker/rcs_tracker.py

Outputs
  data/batches.json      plan + latest run status merged (what the dashboard reads)
  data/config.json       generated_at set to now
  data/members.json      onboarding filled in automatically:
                           kaggle_linked  -> true once the member has sent a run
                           drive_access   -> true once one of their runs reports a Drive folder
                           github_invite  -> accepted / pending / not_sent for the experiment
                                             repo (only when GH_ADMIN_TOKEN is set and the
                                             member has a `github` handle)
                         Automation only ever sets kaggle/drive to true; it never unsets them.

GH_ADMIN_TOKEN: fine-grained token, owner = the org, repo = the experiment repo,
  Repository permissions: Contents (read), Administration (read), Metadata (read);
  Organization permissions: Members (read).

Standard library only. Usage: python3 scripts/build_data.py
"""
import glob
import json
import os
import sys
import urllib.parse
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


# ---- GitHub API -------------------------------------------------------------
def gh_request(url, token, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}", "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rcs-tracker-build"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def gh_get(url, token):
    items, page = [], 1
    while True:
        chunk = json.loads(gh_request(f"{url}{'&' if '?' in url else '?'}per_page=100&page={page}", token))
        items += chunk
        if len(chunk) < 100:
            return items
        page += 1


# ---- batch plan ---------------------------------------------------------------
def fetch_plan(cfg, token):
    """Pull the batch plan from the experiment repo into data/batch_plan.json."""
    repo, plan_path = cfg.get("repo"), cfg.get("batch_plan_path") or "batch_plan.json"
    if not token or not repo:
        print("Batch plan fetch skipped (GH_ADMIN_TOKEN or config repo not set); using data/batch_plan.json")
        return
    url = f"https://api.github.com/repos/{repo}/contents/{urllib.parse.quote(plan_path)}"
    try:
        doc = json.loads(gh_request(url, token, accept="application/vnd.github.raw+json"))
    except json.JSONDecodeError as e:
        print(f"::warning::{repo}/{plan_path} is not valid JSON ({e}); using cached data/batch_plan.json")
        return
    except Exception as e:  # never fail the deploy because of this
        print(f"::warning::could not fetch {repo}/{plan_path} ({e}); using cached data/batch_plan.json")
        return
    if not isinstance(doc, (list, dict)):
        print(f"::warning::{repo}/{plan_path} has an unexpected shape; using cached data/batch_plan.json")
        return
    save(path("batch_plan.json"), doc if isinstance(doc, dict) else {"batches": doc})
    print(f"Batch plan fetched from {repo}/{plan_path} ({len(as_list(doc, 'batches'))} batches)")


def valid_plan(plan, member_ids):
    out, seen = [], set()
    for i, p in enumerate(plan):
        bid = p.get("batch_id") if isinstance(p, dict) else None
        if not bid:
            print(f"::warning::batch plan entry #{i + 1} has no batch_id, skipped")
            continue
        if bid in seen:
            print(f"::warning::batch plan has duplicate batch_id {bid}, kept the first one")
            continue
        if member_ids and p.get("member_id") not in member_ids:
            print(f"::warning::batch {bid}: member_id {p.get('member_id')!r} is not in members.json")
        seen.add(bid)
        out.append(p)
    return out


# ---- runs + batches -------------------------------------------------------------
def load_runs():
    runs = {}
    for f in sorted(glob.glob(path("runs", "*.json"))):
        r = load(f)
        if isinstance(r, dict):
            runs[r.get("batch_id") or os.path.splitext(os.path.basename(f))[0]] = r
    return runs


def build_batches(plan, runs):
    runs = dict(runs)
    out = []
    for p in plan:
        b = {**DEFAULTS, **p}
        r = runs.pop(p["batch_id"], None)
        if r:
            b.update({k: r[k] for k in RUN_FIELDS if k in r and r[k] is not None})
        out.append(b)
    for bid, r in runs.items():  # runs without a plan entry still show up
        print(f"::warning::run {bid} has no entry in the batch plan")
        out.append({**DEFAULTS, **{k: v for k, v in r.items() if v is not None}, "batch_id": bid})

    for b in out:
        if b.get("status") not in STATUSES:
            b["status"] = "pending"
    return out


# ---- onboarding ---------------------------------------------------------------
def sync_from_runs(members, runs):
    """kaggle_linked / drive_access become true once a member's runs prove it. Never unset."""
    changed = False
    for m in members:
        mine = [r for r in runs.values() if r.get("member_id") == m.get("id")]
        ob = m.setdefault("onboarding", {})
        if mine and not ob.get("kaggle_linked"):
            ob["kaggle_linked"], changed = True, True
        if any(r.get("drive_folder_url") for r in mine) and not ob.get("drive_access"):
            ob["drive_access"], changed = True, True
    return changed


def sync_invites(members, cfg, token):
    """github_invite = access to the experiment repo: accepted / pending / not_sent."""
    repo = cfg.get("repo")
    if not token or not repo:
        print("GitHub invite sync skipped (GH_ADMIN_TOKEN or config repo not set)")
        return False
    api, org = f"https://api.github.com/repos/{repo}", repo.split("/")[0]
    try:
        accepted = {c["login"].lower() for c in gh_get(f"{api}/collaborators?affiliation=all", token)}
    except Exception as e:  # never fail the deploy because of this
        print(f"::warning::GitHub invite sync failed: {e}")
        return False
    pending = set()
    for url, pick in ((f"{api}/invitations", lambda i: (i.get("invitee") or {}).get("login")),
                      (f"https://api.github.com/orgs/{org}/invitations", lambda i: i.get("login"))):
        try:
            pending |= {login.lower() for login in map(pick, gh_get(url, token)) if login}
        except Exception as e:
            print(f"::warning::could not list pending invites ({url}): {e}")

    changed, missing = False, []
    for m in members:
        gh = (m.get("github") or "").lower()
        if not gh:
            missing.append(m.get("id"))
            continue
        state = "accepted" if gh in accepted else "pending" if gh in pending else "not_sent"
        ob = m.setdefault("onboarding", {})
        if ob.get("github_invite") != state:
            ob["github_invite"], changed = state, True
    if missing:
        print(f"::notice::no github handle in members.json for: {', '.join(missing)} (invite status kept as-is)")
    return changed


def main():
    token = os.environ.get("GH_ADMIN_TOKEN")
    cfg = load(path("config.json"), {}) or {}
    members_doc = load(path("members.json"), {}) or {}
    members = as_list(members_doc, "members")

    fetch_plan(cfg, token)
    plan = valid_plan(as_list(load(path("batch_plan.json"), {}), "batches"), {m.get("id") for m in members})
    runs = load_runs()
    batches = build_batches(plan, runs)
    save(path("batches.json"), {"batches": batches})

    cfg["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    save(path("config.json"), cfg)

    changed = sync_from_runs(members, runs)
    changed = sync_invites(members, cfg, token) or changed
    if changed:
        save(path("members.json"), members_doc)

    counts = {}
    for b in batches:
        counts[b["status"]] = counts.get(b["status"], 0) + 1
    print(f"batches.json: {len(batches)} batches {counts}")


if __name__ == "__main__":
    sys.exit(main())
