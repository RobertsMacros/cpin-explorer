"""Publish a committed sync with bounded, lossless reconciliation and recovery.

Git is the merge engine. Conflicts are never automatically resolved. The bundle
and manifest are created before each push, so failed/uncertain publication can
be recovered without repeating retrieval. No source bytes are rewritten here.
"""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def git(*args, check=True):
    result = subprocess.run(["git", *args], text=True, capture_output=True)
    if check and result.returncode:
        # Do not echo remote URLs or credential-bearing Git diagnostics.
        raise RuntimeError(f"git {args[0]} failed; recovery artefact retained")
    return result


def publish(recovery, attempts=3):
    recovery = Path(recovery).resolve()
    recovery.mkdir(parents=True, exist_ok=True)
    original = git("rev-parse", "HEAD").stdout.strip()
    base = git("rev-parse", "HEAD^").stdout.strip()
    manifest = {"schema": 1, "original_commit": original, "prerequisite": base,
                "checked_at": datetime.now(timezone.utc).isoformat(), "attempts": [],
                "status": "prepared"}

    def save():
        (recovery / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    def checkpoint():
        temp = recovery / "checkpoint.bundle"
        git("bundle", "create", str(temp), "HEAD", "^" + base)
        git("bundle", "verify", str(temp))
        os.replace(temp, recovery / "sync.bundle")
        manifest["bundle_sha256"] = hashlib.sha256((recovery / "sync.bundle").read_bytes()).hexdigest()
        manifest["checkpoint_commit"] = git("rev-parse", "HEAD").stdout.strip()
        save()

    try:
        if git("diff", "--quiet", check=False).returncode or git("diff", "--cached", "--quiet", check=False).returncode:
            raise RuntimeError("Refusing publication with uncommitted changes")
        checkpoint()
        for attempt in range(1, attempts + 1):
            head = git("rev-parse", "HEAD").stdout.strip()
            result = git("push", "origin", "HEAD:refs/heads/main", check=False)
            manifest["attempts"].append({"number": attempt, "commit": head, "push_returncode": result.returncode})
            save()
            if result.returncode == 0:
                manifest["status"] = "published"
                save()
                return head
            git("fetch", "origin", "refs/heads/main")
            remote = git("rev-parse", "FETCH_HEAD").stdout.strip()
            manifest["observed_remote"] = remote
            if git("merge-base", "--is-ancestor", head, remote, check=False).returncode == 0:
                manifest["status"] = "published"  # Includes uncertain push acknowledgement.
                save()
                return head
            if git("merge-base", "--is-ancestor", remote, head, check=False).returncode == 0:
                raise RuntimeError("Push failed without a concurrent branch change")
            if attempt == attempts:
                raise RuntimeError("Concurrent publication retry budget exhausted")
            merged = git("merge", "--no-edit", remote, check=False)
            if merged.returncode:
                git("merge", "--abort", check=False)
                raise RuntimeError("Concurrent changes conflict; no automatic resolution")
            checkpoint()
        raise RuntimeError("Publication did not complete")
    except Exception as error:
        manifest["status"] = "failed"
        manifest["error"] = str(error)
        save()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recovery", required=True, type=Path)
    args = parser.parse_args()
    publish(args.recovery)
