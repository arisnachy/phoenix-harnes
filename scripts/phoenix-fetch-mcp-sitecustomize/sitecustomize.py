"""Windows-only npm.cmd compatibility for PHOENIX's curated Python Fetch MCP.

ReadabiliPy runs subprocess(["npm", ...]); Windows may only provide npm.cmd,
which bare CreateProcess lookup cannot launch. This module is loaded by Python
as sitecustomize *only* in the Fetch child, via an opt-in PYTHONPATH and flag.
It does not change the machine PATH or affect unrelated MCPs.
"""

import os
import shutil
import subprocess
import sys


def install_fetch_npm_shim(npm_executable):
    """Fix bare npm subprocess calls without changing other child commands."""
    if not npm_executable:
        return False

    original_popen = subprocess.Popen

    class FetchNpmPopen(original_popen):
        def __init__(self, args, *pargs, **kwargs):
            if (
                not kwargs.get("shell", False)
                and isinstance(args, (list, tuple))
                and args
                and isinstance(args[0], str)
                and args[0].lower() == "npm"
            ):
                args = [npm_executable, *args[1:]]
                # ReadabiliPy may run npm install on its first fetch. npm's
                # stdout must never corrupt the MCP stdio JSON-RPC channel.
                if len(args) > 1 and args[1] == "install":
                    kwargs.setdefault("stdout", subprocess.DEVNULL)
            super().__init__(args, *pargs, **kwargs)

    subprocess.Popen = FetchNpmPopen
    return True


if sys.platform == "win32" and os.environ.get("PHOENIX_FETCH_MCP_NPM_SHIM") == "1":
    install_fetch_npm_shim(shutil.which("npm.cmd") or shutil.which("npm.exe"))
