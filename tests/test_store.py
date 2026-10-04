"""The store's run log (data/runs.jsonl): one damaged line must not stop the runs that come after it."""
from conftest import govuk

from cpin.sync import sync


def test_a_half_written_last_line_in_the_run_log_is_passed_over(site, client, store, capsys):
    govuk(site)
    first = sync(client, store)
    log = store.root / "runs.jsonl"
    whole = log.read_text("utf-8")
    log.write_text(whole + '{"kind": "sync", "mode": "quick", "started": "2026-10-03T06:17:0', "utf-8")     # the run was killed here
    runs = store.runs()
    assert [r["started"] for r in runs] == [first.started]
    assert "runs.jsonl line 2 is not JSON" in capsys.readouterr().err

    second = sync(client, store)                             # the next run still works, and is logged on a line of its own
    assert second.collection == "unchanged"
    lines = log.read_text("utf-8").splitlines()
    assert len(lines) == 3 and lines[1].endswith("06:17:0") and lines[2].startswith('{"kind": "sync"')
    assert [r["started"] for r in store.runs()] == [first.started, second.started]


def test_a_damaged_line_in_the_middle_of_the_run_log_is_passed_over_too(store, capsys):
    store.append_run({"kind": "sync", "started": "a"})
    with (store.root / "runs.jsonl").open("a", encoding="utf-8") as f:
        f.write("not json at all\n[1, 2]\n")
    store.append_run({"kind": "sync", "started": "b"})
    assert [r["started"] for r in store.runs()] == ["a", "b"]
    err = capsys.readouterr().err
    assert "line 2 is not JSON" in err and "line 3 is not a run record" in err
