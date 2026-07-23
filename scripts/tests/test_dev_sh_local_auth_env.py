import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEV_SH = ROOT / "dev.sh"


class DevScriptLocalAuthEnvTest(unittest.TestCase):
    def _start_line(self, marker: str) -> str:
        for line in DEV_SH.read_text().splitlines():
            if marker in line and "start_background" in line:
                return line
        self.fail(f"Missing start line for {marker}")

    def test_start_exports_matching_auth_bridge_secret_to_backend_and_frontend(self):
        backend_start = self._start_line("$BACKEND_PID_FILE")
        frontend_start = self._start_line("$FRONTEND_PID_FILE")

        self.assertIn("AUTH_BRIDGE_SECRET=", backend_start)
        self.assertIn("AUTH_BRIDGE_SECRET=", frontend_start)
        self.assertIn("LOCAL_AUTH_BRIDGE_SECRET", backend_start)
        self.assertIn("LOCAL_AUTH_BRIDGE_SECRET", frontend_start)

    def test_start_exports_better_auth_local_env_to_frontend(self):
        frontend_start = self._start_line("$FRONTEND_PID_FILE")

        self.assertIn("BETTER_AUTH_SECRET=", frontend_start)
        self.assertIn("BETTER_AUTH_URL=", frontend_start)
        self.assertIn("BETTER_AUTH_DATABASE_URL=", frontend_start)
        self.assertIn("INTERNAL_API_BASE_URL=", frontend_start)

    def test_start_derives_backend_and_frontend_public_key_from_one_source(self):
        script = DEV_SH.read_text()
        backend_start = self._start_line("$BACKEND_PID_FILE")
        frontend_start = self._start_line("$FRONTEND_PID_FILE")

        self.assertIn(
            'local_public_api_key="${PUBLIC_API_KEY:-sk_public_local}"',
            script,
        )
        self.assertIn('PUBLIC_API_KEY="$local_public_api_key"', backend_start)
        self.assertIn(
            'NEXT_PUBLIC_API_KEY="$local_public_api_key"',
            frontend_start,
        )
        self.assertIn("NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev", frontend_start)
        self.assertNotIn("${NEXT_PUBLIC_API_KEY:-sk_public_local}", frontend_start)

    def test_start_background_is_not_wrapped_in_command_substitution(self):
        script = DEV_SH.read_text()

        self.assertNotRegex(script, r"be_pid=\$\([^\\n]*start_background")
        self.assertNotRegex(script, r"fe_pid=\$\([^\\n]*start_background")

    def test_unix_background_processes_are_detached_from_parent_shell(self):
        script = DEV_SH.read_text()

        self.assertIn('nohup "$@" >> "$logfile" 2>&1 < /dev/null &', script)
        self.assertIn('disown "$child_pid"', script)


if __name__ == "__main__":
    unittest.main()
