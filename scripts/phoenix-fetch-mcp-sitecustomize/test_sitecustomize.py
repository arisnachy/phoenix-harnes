"""Regression tests for Phoenix's scoped ReadabiliPy npm.cmd bridge."""

import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest import mock


def load_sitecustomize():
    path = Path(__file__).with_name("sitecustomize.py")
    spec = importlib.util.spec_from_file_location("phoenix_fetch_sitecustomize_test", path)
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(os.environ, {"PHOENIX_FETCH_MCP_NPM_SHIM": "0"}):
        spec.loader.exec_module(module)
    return module


class RecordingPopen:
    def __init__(self, args, *pargs, **kwargs):
        self.args = args
        self.kwargs = kwargs


class FetchNpmShimTests(unittest.TestCase):
    def test_npm_cmd_is_explicit_and_install_stdout_is_not_json_rpc(self):
        module = load_sitecustomize()
        with mock.patch.object(subprocess, "Popen", RecordingPopen):
            self.assertTrue(module.install_fetch_npm_shim(r"C:\Program Files\nodejs\npm.cmd"))
            install = subprocess.Popen(["npm", "install"])
            self.assertEqual(install.args, [r"C:\Program Files\nodejs\npm.cmd", "install"])
            self.assertEqual(install.kwargs.get("stdout"), subprocess.DEVNULL)
            version = subprocess.Popen(["npm", "version"], stdout=subprocess.PIPE)
            self.assertEqual(version.args[0], r"C:\Program Files\nodejs\npm.cmd")
            self.assertEqual(version.kwargs["stdout"], subprocess.PIPE)

    def test_does_not_rewrite_other_programs_or_shell_commands(self):
        module = load_sitecustomize()
        with mock.patch.object(subprocess, "Popen", RecordingPopen):
            module.install_fetch_npm_shim(r"C:\Program Files\nodejs\npm.cmd")
            node = subprocess.Popen(["node", "--version"])
            self.assertEqual(node.args, ["node", "--version"])
            shell = subprocess.Popen(["npm", "install"], shell=True)
            self.assertEqual(shell.args, ["npm", "install"])
            self.assertNotIn("stdout", shell.kwargs)

    def test_missing_npm_does_not_patch_subprocess(self):
        module = load_sitecustomize()
        with mock.patch.object(subprocess, "Popen", RecordingPopen):
            self.assertFalse(module.install_fetch_npm_shim(None))
            self.assertIs(subprocess.Popen, RecordingPopen)


if __name__ == "__main__":
    unittest.main()
