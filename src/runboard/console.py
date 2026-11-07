"""Explicit, context-scoped training console capture."""

import sys
from contextlib import contextmanager


class ConsoleStream:
    def __init__(self, run, original, name):
        self.run, self.original, self.name = run, original, name
        self.pending = ""
        self.private_block = False

    def write(self, text):
        self.original.write(text)
        self.pending += text
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            self.emit(line)
        return len(text)

    def emit(self, line):
        if "-----BEGIN " in line and "PRIVATE KEY-----" in line:
            self.private_block = True
            self.run.text("[REDACTED PRIVATE KEY]", stream=self.name)
            return
        if self.private_block:
            if "-----END " in line and "PRIVATE KEY-----" in line:
                self.private_block = False
            return
        from .validation import redact_text

        safe = redact_text(line)
        for start in range(0, len(safe), 64000):
            self.run.text(safe[start : start + 64000], stream=self.name)

    def __getattr__(self, name):
        return getattr(self.original, name)

    def flush(self):
        self.original.flush()

    def isatty(self):
        return False


@contextmanager
def capture(run):
    stdout, stderr = sys.stdout, sys.stderr
    out, err = (
        ConsoleStream(run, stdout, "stdout"),
        ConsoleStream(run, stderr, "stderr"),
    )
    sys.stdout, sys.stderr = out, err
    try:
        yield
    finally:
        sys.stdout, sys.stderr = stdout, stderr
        for stream in (out, err):
            if stream.pending and not stream.private_block:
                stream.emit(stream.pending)
