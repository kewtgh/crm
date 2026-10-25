"""Real controlling PTY hangup; never name this file after the stdlib pty module."""
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
    signal.signal(signal.SIGHUP, signal.SIG_DFL)
    for args in (["submit", "--root", root, "--request", request],
                 ["dispatch", "--root", root]):
        result = subprocess.run([node, cli, *args], capture_output=True, timeout=8)
        if result.returncode:
            os.write(1, ("PTY_" + args[0].upper() + "_FAILED\n").encode())
            os._exit(2)
    os.write(1, b"FIXTURE_DISPATCHED\n")
    time.sleep(30)
    os._exit(3)

deadline = time.monotonic() + 18
data = b""
reaped = False
try:
    while b"FIXTURE_DISPATCHED" not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                data += os.read(master, 1024)
            except OSError:
                break
    if b"FIXTURE_DISPATCHED" not in data:
        reason = next((code for code in ("PTY_SUBMIT_FAILED", "PTY_DISPATCH_FAILED")
                       if code.encode() in data), "PTY_DISPATCH_NOT_OBSERVED")
        raise RuntimeError(reason)
    os.close(master)  # Kernel-generated SIGHUP to the controlling terminal's session.
    master = None
    while time.monotonic() < deadline:
        found, status = os.waitpid(pid, os.WNOHANG)
        if found:
            reaped = True
            if not os.WIFSIGNALED(status) or os.WTERMSIG(status) != signal.SIGHUP:
                raise RuntimeError("PTY_HANGUP_NOT_OBSERVED")
            print(json.dumps({"hangup": True}))
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("PTY_SESSION_DID_NOT_EXIT")
except (RuntimeError, OSError) as error:
    allowed = {"PTY_SUBMIT_FAILED", "PTY_DISPATCH_FAILED", "PTY_DISPATCH_NOT_OBSERVED",
               "PTY_HANGUP_NOT_OBSERVED", "PTY_SESSION_DID_NOT_EXIT"}
    print(json.dumps({"hangup": False, "reason": str(error) if str(error) in allowed else "PTY_READ_FAILED"}))
    sys.exit(1)
finally:
    if master is not None:
        os.close(master)
    if not reaped:
        try:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except ProcessLookupError:
            pass
