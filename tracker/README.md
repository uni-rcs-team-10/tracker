# Reporting runs to the RCS Tracker

The dashboard updates itself from what your Kaggle notebook reports. You only need to do this setup once.

## 1. One-time setup (each member)

**Who needs this:** every member who runs batches on Kaggle. Each person creates their **own** token; never share yours. If you only view the dashboard, you don't need a token.

1. On GitHub, go to **Settings → Developer settings → Fine-grained tokens → Generate new token**.
   - Resource owner: **uni-rcs-team-10** (the org — you must be a member)
   - Repository access: **Only select repositories** → `tracker` **and** `rcs-group10-lm-psychometrics`
     (the experiment repo only appears if you already have access to it in the org)
   - Permissions: **Contents → Read and write** (nothing else)
   - Copy the token (`github_pat_…`). GitHub shows it only once.
2. In your Kaggle notebook, go to **Add-ons → Secrets → Add secret**. Name it `RCS_GH_TOKEN` and paste in the token. Then tick it for the notebook, and turn **Internet on** in the notebook settings. Never paste the token into a notebook cell.
3. Make `rcs_tracker.py` importable in the notebook. Either copy the file in, or download it in a cell:
   `!wget -q https://raw.githubusercontent.com/uni-rcs-team-10/tracker/main/tracker/rcs_tracker.py`

Run status goes to the **tracker** repo (`uni-rcs-team-10/tracker`). Nothing is written to the experiment repo.
Dashboard: https://uni-rcs-team-10.github.io/tracker/

## 2. Wrap your batch loop

```python
from rcs_tracker import BatchTracker

with BatchTracker("O1B-b03", member_id="nishchal", model="gemma-4b",
                  chunks_total=40, prompts_total=10000,
                  start_chunk=1,                      # set to the "resume from" chunk after a failure
                  kaggle_url="https://www.kaggle.com/code/<you>/<notebook>",
                  drive_folder_url="https://drive.google.com/drive/folders/<batch folder>") as t:
    for chunk in range(t.start_chunk, 41):
        run_chunk(chunk)                              # your existing code
        t.chunk_done(chunk, prompts_done=chunk * 250)
```

- If the block finishes, the batch is marked **done**. If it raises an error, the batch is marked **failed** with the error message.
- If one chunk takes longer than about 30 minutes, call `t.heartbeat()` inside it. Otherwise the dashboard will mark the run **stale**.
- `batch_id`, `member_id` and `model` must match `data/batch_plan.json` and `data/members.json`.
- Tracking never stops your experiment. If GitHub is unreachable, it prints a warning and carries on.

## How long until it shows up

| What happened | When it appears |
|---|---|
| Start, done or failed | 1–2 min (each triggers a deploy) |
| Progress updates (sent at most every 10 min) | within about 15 min (scheduled deploy) |
