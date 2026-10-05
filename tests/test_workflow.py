"""The scheduled sync (.github/workflows/sync.yml): what was fetched is committed before anything can fail the job.

Read as text (the project has no YAML parser, and needs none): the steps of the `sync` job, in order.
"""
import re

from cpin import config

WORKFLOW = config.ROOT / ".github" / "workflows" / "sync.yml"


def steps() -> list[dict]:
    """Each step of the sync job: its name (or what it runs or uses) and its text."""
    job = WORKFLOW.read_text("utf-8").split("\n  sync:\n", 1)[1].split("\n  deploy:\n", 1)[0]
    chunks = re.split(r"\n      - ", job.split("\n    steps:\n", 1)[1])
    out = []
    for chunk in chunks:
        text = "\n".join(line for line in chunk.splitlines() if not line.strip().startswith("#"))
        named = re.search(r"^(?:\s*- )?(?:name|run|uses): (.+)$", text, re.M)
        if named:
            out.append({"name": named.group(1).strip(), "text": text})
    return out


def test_what_was_fetched_is_committed_before_verification_can_fail_the_job():
    names = [s["name"] for s in steps()]
    commit, verify = names.index("Commit data changes"), names.index("Verify")
    assert names.index("Sync") < commit < verify, "a file that fails verification must not hold back the commit"
    assert "continue-on-error" not in steps()[verify]["text"], "and verification still fails the job"


def test_no_step_between_the_sync_and_the_commit_can_stop_the_commit():
    all_steps = steps()
    names = [s["name"] for s in all_steps]
    between = all_steps[names.index("Sync"):names.index("Commit data changes")]
    assert [s["name"] for s in between] == ["Sync", "Text of PDF-only editions", "Pictures only the PDF has", "Web version against PDF"]
    for step in between:
        assert "continue-on-error: true" in step["text"], step["name"]
    # Each of them still fails the job in the end, by its id.
    last = all_steps[-1]
    assert names.index("Commit data changes") < len(all_steps) - 1 and "exit 1" in last["text"]
    for step in between:
        step_id = re.search(r"\bid: (\S+)", step["text"]).group(1)
        assert f"steps.{step_id}.outcome == 'failure'" in last["text"], step["name"]


def test_a_quiet_day_makes_no_commit():
    commit = next(s for s in steps() if s["name"] == "Commit data changes")
    assert "grep -qv '^data/runs.jsonl$'" in commit["text"]


def test_a_failed_sync_or_verification_cannot_publish_retained_data():
    deploy = WORKFLOW.read_text().split("\n  deploy:\n", 1)[1]
    assert "needs.sync.result == 'success'" in deploy
    assert "needs.sync.outputs.changed == 'true'" in deploy
    publication = WORKFLOW.with_name('deploy.yml').read_text()
    assert 'python -m cpin images --all' in publication
    assert publication.index('npm test') < publication.index('npx wrangler deploy')
    assert publication.index('python -m cpin verify') < publication.index('npx wrangler deploy')


def test_push_checks_run_without_cloudflare_and_a_failed_test_cannot_deploy():
    publication = WORKFLOW.with_name('deploy.yml').read_text()
    tests = publication.split('\n  test:\n', 1)[1].split('\n  check:\n', 1)[0]
    assert 'if:' not in tests and 'secrets.' not in tests
    assert 'pytest -q' in tests and 'npm test' in tests and 'python -m cpin verify' in tests
    assert 'poppler-utils' in tests
    assert tests.index('python -m cpin export') < tests.index('npm test')
    deploy = publication.split('\n  deploy:\n', 1)[1]
    assert 'needs: [test, check]' in deploy
    assert 'if: needs.check.outputs.ready' in deploy and 'always()' not in deploy
