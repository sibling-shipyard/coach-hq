"""Tests for agent-kit --init scaffold stamping."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CARVE_KIT = REPO_ROOT / "platform" / "agent-kit" / "carve-kit.mjs"
KIT_ROOT = REPO_ROOT.parent / "agent-kit"
AGENT_KIT_SRC = REPO_ROOT / "platform" / "agent-kit"

# Harnesses may set GIT_DIR to the worktree; isolate temp-repo git commands from that.
GIT_ENV = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE")}


class TestAgentKitInit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="agent-kit-init-")
        subprocess.run(["git", "init", "-q"], cwd=self.tmp, env=GIT_ENV, check=True)
        subprocess.run(
            ["git", "config", "user.email", "agent-kit-test@example.com"],
            cwd=self.tmp,
            env=GIT_ENV,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "agent-kit test"],
            cwd=self.tmp,
            env=GIT_ENV,
            check=True,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_carve(self):
        r = subprocess.run(["node", str(CARVE_KIT)], cwd=REPO_ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)

    def run_init(self, force=False):
        cmd = ["node", str(CARVE_KIT), "--init", self.tmp]
        if force:
            cmd.append("--force")
        r = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)

    def link_agent_kit(self):
        dest = Path(self.tmp) / ".agent-kit"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(KIT_ROOT, dest)
        shutil.copy2(AGENT_KIT_SRC / "VERSION", dest / "VERSION")
        shutil.copytree(AGENT_KIT_SRC / "bootstrap", dest / "bootstrap")

    def test_init_idempotent_and_validate_kdb(self):
        self.run_carve()
        self.run_init()
        agents = Path(self.tmp) / "AGENTS.md"
        self.assertTrue(agents.exists())
        mtime = agents.stat().st_mtime

        self.run_init()
        self.assertEqual(agents.stat().st_mtime, mtime, "second init should skip existing files")

        self.link_agent_kit()
        subprocess.run(["git", "add", "-A"], cwd=self.tmp, env=GIT_ENV, check=True)
        subprocess.run(
            ["git", "commit", "-q", "-m", "init scaffold", "--no-verify"],
            cwd=self.tmp,
            env=GIT_ENV,
            check=True,
        )
        update = subprocess.run(
            [str(Path(self.tmp) / ".agent-kit" / "bootstrap" / "update.sh")],
            cwd=self.tmp,
            capture_output=True,
            text=True,
        )
        self.assertEqual(update.returncode, 0, update.stderr or update.stdout)

        validate = subprocess.run(
            ["python3", "kdb/scripts/validate_kdb.py"],
            cwd=self.tmp,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            validate.returncode,
            0,
            f"validate_kdb failed:\n{validate.stdout}\n{validate.stderr}",
        )

    def test_init_force_overwrites(self):
        self.run_carve()
        self.run_init()
        agents = Path(self.tmp) / "AGENTS.md"
        agents.write_text("# touched\n", encoding="utf-8")
        self.run_init(force=True)
        self.assertIn("Agent Routing", agents.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
