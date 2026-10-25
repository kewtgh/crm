"""Real controlling PTY hangup; only fictional Alpha CLI operations are allowed."""
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

node, cli, root, request = sys.argv[1:]
pid, master = pty.fork()
if pid == 0:
    for args in (["submit", "--root", root, "--request", request],
                 ["dispatch", "--root", root]):
        result = subprocess.run([node, cli, *args], capture_output=True, timeout=8)
        if result.returncode:
            os._exit(2)
    os.write(1, b"FIXTURE_DISPATCHED\n")
    time.sleep(30)
    os._exit(3)

deadline = time.monotonic() + 18
data = b""
try:
    while b"FIXTURE_DISPATCHED" not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            data += os.read(master, 1024)
    if b"FIXTURE_DISPATCHED" not in data:
        raise RuntimeError("PTY_DISPATCH_NOT_OBSERVED")
    os.close(master)  # Kernel-generated SIGHUP to the controlling terminal's session.
    master = None
    while time.monotonic() < deadline:
        found, status = os.waitpid(pid, os.WNOHANG)
        if found:
            if not os.WIFSIGNALED(status) or os.WTERMSIG(status) != signal.SIGHUP:
                raise RuntimeError("PTY_HANGUP_NOT_OBSERVED")
            print(json.dumps({"hangup": True}))
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("PTY_SESSION_DID_NOT_EXIT")
finally:
    if master is not None:
        os.close(master)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
