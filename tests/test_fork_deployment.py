#!/usr/bin/env python3
"""Exercise fork build generation and reject untrusted deployment destinations."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
GENERATOR = REPO / "scripts/generate-fork-deployment.py"


class ForkDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        (self.repo / "config").mkdir()
        self.config = json.loads((REPO / "config/fork-deployment.json").read_text())

    def generate(self, check=False):
        (self.repo / "config/fork-deployment.json").write_text(json.dumps(self.config))
        args = ["python3", str(GENERATOR), "--repo", str(self.repo)]
        if check:
            args.append("--check")
        return subprocess.run(args, capture_output=True, text=True)

    def test_production_origin_and_project_reach_generated_build_inputs(self):
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        shell = self.repo / "scripts/lib/fork-deployment.env"
        process = subprocess.run(
            ["bash", "-c", 'source "$1"; printf "%s\\n%s\\n%s" "$CMUX_FORK_PRODUCTION_ORIGIN" "$CMUX_FORK_VERCEL_ORG_ID" "$CMUX_FORK_VERCEL_PROJECT_ID"', "fork-test", str(shell)],
            capture_output=True, text=True,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout.splitlines(), [
            "https://cmux.w3dev.app", "team_bhbVYR6BqVYMXKwAp7F1k5ib",
            "prj_3z4VuRVvSvlm5LYNnEuqHa4FKKtn",
        ])
        self.assertEqual(self.generate(check=True).returncode, 0)

    def test_untrusted_service_origins_are_rejected_before_outputs_are_created(self):
        for value in ["https://cmux.com", "https://presence.cmux.dev", "https://cmux.w3dev.app.evil.example", "http://presence.cmux.w3dev.app", "https://user:secret@presence.cmux.w3dev.app", "https://presence.cmux.w3dev.app/path"]:
            with self.subTest(value=value):
                self.config["presenceOrigin"] = value
                self.assertNotEqual(self.generate().returncode, 0)
                self.assertFalse((self.repo / "scripts/lib/fork-deployment.env").exists())

    def test_production_target_cannot_silently_select_another_project(self):
        self.config["vercel"]["projectID"] = "prj_other"
        self.assertNotEqual(self.generate().returncode, 0)

    def test_generated_input_drift_is_detected(self):
        self.assertEqual(self.generate().returncode, 0)
        shell = self.repo / "scripts/lib/fork-deployment.env"
        shell.write_text(shell.read_text().replace("https://cmux.w3dev.app", "https://cmux.com"))
        result = self.generate(check=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale", result.stderr)


if __name__ == "__main__":
    unittest.main()
