"""Exercise real Git commits, remote races and recovery without CPIN changes."""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publish_sync", ROOT / "scripts/publish_sync.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def command(cwd, *args):
    return subprocess.check_output(["git", *args], cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()


def commit(repo, filename, value, message):
    path = repo / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)
    command(repo, "add", filename)
    command(repo, "commit", "-m", message)
    return command(repo, "rev-parse", "HEAD")


@pytest.fixture
def repos(tmp_path, monkeypatch):
    remote, local, other = (tmp_path / name for name in ["remote.git", "local", "other"])
    command(tmp_path, "init", "--bare", "--initial-branch=main", str(remote))
    command(tmp_path, "clone", str(remote), str(local))
    for name, value in [("user.name", "Fixture"), ("user.email", "fixture@example.invalid")]:
        command(local, "config", name, value)
    commit(local, "data/report.txt", "Original fixture\n", "base")
    command(local, "push", "origin", "main")
    command(tmp_path, "clone", str(remote), str(other))
    for name, value in [("user.name", "Fixture"), ("user.email", "fixture@example.invalid")]:
        command(other, "config", name, value)
    monkeypatch.chdir(local)
    return local, other, remote, tmp_path / "recovery"


def recover(local, recovery):
    manifest = json.loads((recovery / "manifest.json").read_text())
    command(local, "bundle", "verify", str(recovery / "sync.bundle"))
    command(local, "fetch", str(recovery / "sync.bundle"), "HEAD:refs/heads/recovered")
    assert command(local, "rev-parse", "recovered") == manifest["checkpoint_commit"]
    return manifest


def test_independent_main_push_retains_both_histories_and_publishes(repos):
    local, other, remote, recovery = repos
    sync = commit(local, "data/report.txt", "Fetched fixture\n", "sync")
    concurrent = commit(other, "README.md", "Concurrent documentation\n", "other")
    command(other, "push", "origin", "main")
    published = publisher.publish(recovery)
    assert command(remote, "rev-parse", "main") == published
    command(local, "merge-base", "--is-ancestor", sync, published)
    command(local, "merge-base", "--is-ancestor", concurrent, published)
    assert command(remote, "show", "main:data/report.txt") == "Fetched fixture"
    assert command(remote, "show", "main:README.md") == "Concurrent documentation"
    manifest = recover(local, recovery)
    assert manifest["status"] == "published"
    assert len(manifest["attempts"]) == 2


def test_conflict_stops_and_original_sync_can_be_recovered(repos):
    local, other, remote, recovery = repos
    sync = commit(local, "data/report.txt", "Fetched fixture\n", "sync")
    concurrent = commit(other, "data/report.txt", "Conflicting fixture\n", "other")
    command(other, "push", "origin", "main")
    with pytest.raises(RuntimeError, match="conflict"):
        publisher.publish(recovery)
    assert command(local, "rev-parse", "HEAD") == sync
    assert command(remote, "rev-parse", "main") == concurrent
    assert command(local, "status", "--porcelain") == ""
    manifest = recover(local, recovery)
    assert manifest["status"] == "failed"
    assert command(local, "show", "recovered:data/report.txt") == "Fetched fixture"


def test_failed_acknowledgement_of_successful_push_is_not_republished(repos, monkeypatch):
    local, _, remote, recovery = repos
    sync = commit(local, "data/report.txt", "Fetched fixture\n", "sync")
    original_git = publisher.git
    def uncertain(*args, **kwargs):
        result = original_git(*args, **kwargs)
        if args[0] == "push":
            result.returncode = 1
        return result
    monkeypatch.setattr(publisher, "git", uncertain)
    assert publisher.publish(recovery) == sync
    assert command(remote, "rev-parse", "main") == sync
    manifest = recover(local, recovery)
    assert manifest["status"] == "published"
    assert len(manifest["attempts"]) == 1


def test_non_race_push_failure_preserves_bundle_and_fails(repos, monkeypatch):
    local, _, remote, recovery = repos
    base = command(remote, "rev-parse", "main")
    commit(local, "data/report.txt", "Fetched fixture\n", "sync")
    original_git = publisher.git
    monkeypatch.setattr(publisher, "git", lambda *a, **kw: subprocess.CompletedProcess(a, 1, "", "")
                        if a[0] == "push" else original_git(*a, **kw))
    with pytest.raises(RuntimeError, match="without a concurrent"):
        publisher.publish(recovery)
    assert command(remote, "rev-parse", "main") == base
    assert recover(local, recovery)["status"] == "failed"


def test_publication_retry_budget_preserves_latest_merge(repos, monkeypatch):
    local, other, remote, recovery = repos
    sync = commit(local, "data/report.txt", "Fetched fixture\n", "sync")
    original_git = publisher.git
    count = 0
    def concurrent(*args, **kwargs):
        nonlocal count
        if args[0] == "push":
            count += 1
            commit(other, f"notes/{count}.txt", "Independent fixture\n", "concurrent")
            command(other, "push", "origin", "main")
        return original_git(*args, **kwargs)
    monkeypatch.setattr(publisher, "git", concurrent)
    with pytest.raises(RuntimeError, match="budget"):
        publisher.publish(recovery)
    assert count == 3
    manifest = recover(local, recovery)
    command(local, "merge-base", "--is-ancestor", sync, manifest["checkpoint_commit"])
    assert manifest["status"] == "failed"
