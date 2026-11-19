"""Report batch progress from a Kaggle notebook to the RCS Tracker dashboard.

Writes data/runs/<batch_id>.json in the GitHub repo via the Contents API.
Tracking never raises: if GitHub is unreachable the experiment keeps running.

    from rcs_tracker import BatchTracker

    with BatchTracker("O1B-b03", member_id="nishchal", model="gemma-4b",
                      chunks_total=40, prompts_total=10000, start_chunk=18) as t:
        for chunk in range(t.start_chunk, 41):
            run_chunk(chunk)                      # your code
            t.chunk_done(chunk, prompts_done=chunk * 250)
    # finishing the block marks the batch done; an exception marks it failed

Token: a fine-grained GitHub token with "Contents: read and write" on this repo only,
stored as a Kaggle Secret named RCS_GH_TOKEN (Add-ons -> Secrets), or env var RCS_GH_TOKEN.
"""
import base64
import json
import os
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO = "uni-rcs-team-10/tracker"  # the tracker repo (NOT the private experiment repo)
BRANCH = "main"


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _token(name="RCS_GH_TOKEN"):
    if os.environ.get(name):
        return os.environ[name]
    try:
        from kaggle_secrets import UserSecretsClient  # only exists on Kaggle
        return UserSecretsClient().get_secret(name)
    except Exception:
        return None


class BatchTracker:
    def __init__(self, batch_id, member_id, model, chunks_total, prompts_total,
                 start_chunk=1, kaggle_url=None, drive_folder_url=None, commit_sha=None,
                 heartbeat_minutes=10, token=None, repo=REPO, branch=BRANCH):
        self.batch_id, self.repo, self.branch = batch_id, repo, branch
        self.start_chunk = max(1, int(start_chunk))
        self.heartbeat_s = heartbeat_minutes * 60
        self.token = token or _token()
        self.file = f"data/runs/{batch_id}.json"
        self._sha, self._last_push, self._t0, self._gpu_base = None, 0.0, None, 0
        self.state = {
            "batch_id": batch_id, "member_id": member_id, "model": model,
            "status": "pending", "chunks_total": chunks_total, "prompts_total": prompts_total,
            "last_completed_chunk": self.start_chunk - 1, "prompts_done": 0,
            "started_at": None, "updated_at": None, "kaggle_url": kaggle_url,
            "drive_folder_url": drive_folder_url, "commit_sha": commit_sha,
            "gpu_minutes": 0, "error": None,
        }
        if not self.token:
            print("[rcs_tracker] no RCS_GH_TOKEN found - progress will not be reported")

    # ---- public API -------------------------------------------------------
    def start(self):
        prev = self._fetch()
        if prev and self.start_chunk > 1:  # resuming: keep history
            self.state["started_at"] = prev.get("started_at")
            self._gpu_base = prev.get("gpu_minutes") or 0
            self.state["prompts_done"] = prev.get("prompts_done") or 0
        self.state["started_at"] = self.state["started_at"] or _now()
        self.state.update(status="running", error=None)
        self._t0 = time.time()
        self._push(f"run: start {self.batch_id} at chunk {self.start_chunk}")
        return self

    def chunk_done(self, chunk, prompts_done=None):
        self.state["last_completed_chunk"] = int(chunk)
        if prompts_done is not None:
            self.state["prompts_done"] = int(prompts_done)
        if time.time() - self._last_push >= self.heartbeat_s:
            self._push(f"run: {self.batch_id} chunk {chunk} [skip ci]")

    def heartbeat(self):
        """Call inside long chunks so the dashboard doesn't mark the run stale."""
        if time.time() - self._last_push >= self.heartbeat_s:
            self._push(f"run: {self.batch_id} heartbeat [skip ci]")

    def finish(self):
        self.state.update(status="done", last_completed_chunk=self.state["chunks_total"],
                          prompts_done=self.state["prompts_total"], error=None)
        self._push(f"run: done {self.batch_id}")

    def fail(self, error):
        self.state.update(status="failed", error=str(error)[:500])
        self._push(f"run: failed {self.batch_id}")

    def __enter__(self):
        return self.start()

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.finish()
        elif issubclass(exc_type, KeyboardInterrupt):
            self.fail("Interrupted (KeyboardInterrupt)")
        else:
            last = traceback.format_exception_only(exc_type, exc)[-1].strip()
            self.fail(last)
        return False  # never swallow the exception

    # ---- GitHub Contents API ---------------------------------------------
    def _req(self, method, body=None):
        url = f"https://api.github.com/repos/{self.repo}/contents/{self.file}"
        if method == "GET":
            url += f"?ref={self.branch}"
        req = urllib.request.Request(url, method=method,
                                     data=json.dumps(body).encode() if body else None, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rcs-tracker"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def _fetch(self):
        if not self.token:
            return None
        try:
            d = self._req("GET")
            self._sha = d["sha"]
            return json.loads(base64.b64decode(d["content"]))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                print(f"[rcs_tracker] fetch failed: HTTP {e.code}")
        except Exception as e:
            print(f"[rcs_tracker] fetch failed: {e}")
        return None

    def _push(self, message):
        self._last_push = time.time()
        if self._t0:
            self.state["gpu_minutes"] = round(self._gpu_base + (time.time() - self._t0) / 60)
        self.state["updated_at"] = _now()
        if not self.token:
            return
        content = base64.b64encode((json.dumps(self.state, indent=2) + "\n").encode()).decode()
        for attempt in range(3):
            body = {"message": message, "content": content, "branch": self.branch}
            if self._sha:
                body["sha"] = self._sha
            try:
                self._sha = self._req("PUT", body)["content"]["sha"]
                return
            except urllib.error.HTTPError as e:
                if e.code in (409, 422) and attempt < 2:  # stale sha -> refetch and retry
                    self._sha = None
                    self._fetch()
                    continue
                print(f"[rcs_tracker] push failed: HTTP {e.code}")
                return
            except Exception as e:
                print(f"[rcs_tracker] push failed: {e}")
                time.sleep(2)
