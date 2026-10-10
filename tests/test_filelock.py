import pytest

from cpin.filelock import lock_exclusive


def test_second_lock_is_refused_until_the_first_file_is_closed(tmp_path):
    path = tmp_path / 'run.lock'
    with path.open('a') as first:
        lock_exclusive(first)
        with path.open('a') as second, pytest.raises(BlockingIOError):
            lock_exclusive(second)
    with path.open('a') as again:
        lock_exclusive(again)
