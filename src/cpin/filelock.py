"""One exclusive, non-blocking lock on an open file, on macOS, Linux and Windows.

The lock is released when the file is closed. A second attempt, from this or
another process, raises BlockingIOError.
"""
import os

if os.name == 'nt':
    import msvcrt

    def lock_exclusive(handle):
        # Windows locks a byte range rather than the file; one byte at the start
        # is enough, and may lie beyond the end of an empty file.
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise BlockingIOError(error.errno, 'file is locked by another job') from error
else:
    import fcntl

    def lock_exclusive(handle):
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
