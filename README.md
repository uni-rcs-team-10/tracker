# RCS Tracker — Group 10

Live progress dashboard for the Group 10 prompt-variant experiments on the Twin-2K-500 dataset (Universität Trier).

**Dashboard:** https://uni-rcs-team-10.github.io/tracker/

The experiment code lives in the private repo [`uni-rcs-team-10/rcs-group10-lm-psychometrics`](https://github.com/uni-rcs-team-10/rcs-group10-lm-psychometrics). This repo holds only the dashboard and the run reports that Kaggle notebooks send to it. Nothing here writes to the experiment repo.

---

## For team members: report your Kaggle runs

You do this setup once. You only need it if you run batches on Kaggle. Viewing the dashboard needs nothing.

### 1. Join the org
Accept the invite to **uni-rcs-team-10** (check your email or https://github.com/orgs/uni-rcs-team-10). Make sure you can open the experiment repo.

### 2. Create your own GitHub token
GitHub → profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

| Field | Value |
|---|---|
| Token name | `rcs-tracker-kaggle` |
| Expiration | after the project ends |
| Resource owner | **uni-rcs-team-10** |
| Repository access | **All repositories** (covers every repo in the org, including future ones) |
| Permissions → Contents | **Read and write** (leave everything else) |

Click **Generate token** and copy it (`github_pat_…`). GitHub shows it only once. Don't share your token with anyone.

### 3. Save it in Kaggle
In your notebook (edit mode): **Add-ons → Secrets → Add secret**
- Label: `RCS_GH_TOKEN` (exactly this)
- Value: your token
- Tick the checkbox so this notebook can use it. Do this for every notebook.
- In **Session options**, turn **Internet on**. This needs a phone-verified Kaggle account.

Never paste the token into a notebook cell.

### 4. Use the tracker in your notebook
```python
!wget -q https://raw.githubusercontent.com/uni-rcs-team-10/tracker/main/tracker/rcs_tracker.py
from rcs_tracker import BatchTracker

with BatchTracker("O1B-b03", member_id="yourid", model="gemma-4b",
                  chunks_total=40, prompts_total=10000,
                  start_chunk=1,   # set to the "resume from" chunk after a failure
                  kaggle_url="https://www.kaggle.com/code/<you>/<notebook>",
                  drive_folder_url="https://drive.google.com/drive/folders/<batch folder>") as t:
    for chunk in range(t.start_chunk, 41):
        run_chunk(chunk)                          # your existing code
        t.chunk_done(chunk, prompts_done=chunk * 250)
```
- `batch_id`, `member_id` and `model` must match the [batch plan](#batch-plan-bhuwan) and [`data/members.json`](data/members.json).
- Pass `drive_folder_url`: your Drive badge turns ✔ from it.
- A block that finishes marks the batch **done**. An error marks it **failed** and shows the message on the dashboard.
- If one chunk takes longer than about 30 minutes, call `t.heartbeat()` inside it, or the run shows as **stale**.
- Tracking never stops your experiment. If GitHub can't be reached, it prints a warning and carries on.

Start, done and failed show up within 1–2 minutes. Progress updates show up within about 15 minutes.

More details are in [`tracker/README.md`](tracker/README.md).

### Troubleshooting
| Message | Fix |
|---|---|
| `no RCS_GH_TOKEN found` | The secret isn't ticked for this notebook, or its label is wrong |
| `403` | Token isn't set to All repositories or is missing Contents: Read and write, or an org owner still has to approve it (org Settings → Personal access tokens → Pending requests) |
| `404` | Resource owner isn't `uni-rcs-team-10`, or you haven't joined the org yet |
| Batch doesn't appear | `batch_id` isn't in the batch plan (ask Bhuwan) |

---

## Batch plan (Bhuwan)

The batch plan lives in the **experiment repo**, as `batch_plan.json` at the repo root. Edit it there and push. The dashboard picks it up within 15 minutes, with no change needed in this repo.

```json
{
  "batches": [
    { "batch_id": "O1A-b01", "member_id": "bhuwan", "model": "gemma-4b", "chunks_total": 40, "prompts_total": 10000 }
  ]
}
```
- `member_id` must be an `id` from [`data/members.json`](data/members.json). The member's group decides the batch's group.
- Typos don't break the dashboard. A duplicate `batch_id` or an unknown `member_id` shows up as a warning in the **Actions** log.
- If the file can't be fetched, the dashboard keeps the last good copy, cached here as `data/batch_plan.json`.

## Onboarding (automatic)

The badges on each member are filled in by CI on every build:

| Badge | Becomes ✔ when |
|---|---|
| GitHub | The member has accepted their invite and can access the experiment repo. Shows "pending" while the org or repo invite is open. Needs their `github` handle in `members.json`. |
| Kaggle | The member's notebook has sent its first run |
| Drive | One of their runs reported a Drive folder (`drive_folder_url`) |

Kaggle and Drive are never switched back off automatically. You can still set them to `true` by hand in `members.json`.

---

## For maintainers

| File | Edit by hand? | Purpose |
|---|---|---|
| `data/members.json` | yes: names, `github` handles, groups | Team members. Onboarding is filled in automatically. |
| `batch_plan.json` (experiment repo) | yes (Bhuwan) | Planned batches |
| `data/setup_tasks.json` | yes | Setup checklist |
| `data/config.json` | yes | Subtitle, experiment repo, plan file path, Drive link, objectives |
| `data/batch_plan.json` | no | Cached copy of the plan |
| `data/runs/*.json` | no | Written by Kaggle notebooks |
| `data/batches.json` | no | Generated by `scripts/build_data.py` |

**Admin token (one-time, by an org owner):** the build needs a repo secret called `GH_ADMIN_TOKEN` to read the plan and the invite status.
1. Create a fine-grained token with Resource owner **uni-rcs-team-10** and Repository access **All repositories**.
   - Repository permissions: **Contents: Read-only**, **Administration: Read-only** (Metadata is added automatically)
   - Organization permissions: **Members: Read-only**
2. Save it in the tracker repo under **Settings → Secrets and variables → Actions → New repository secret**, with the name `GH_ADMIN_TOKEN`.

Without this secret the dashboard still works. It uses the cached plan, and GitHub invite status stays as written in `members.json`.

**Deploy:** every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which fetches the plan, builds `batches.json`, fills in onboarding and publishes to GitHub Pages. A scheduled run also deploys every 15 minutes. One-time setup: **Settings → Pages → Source = GitHub Actions**.

**Local preview:**
```sh
python3 scripts/build_data.py
python3 -m http.server 8000   # open http://localhost:8000/
```
