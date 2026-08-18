from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.redact import redact_text, sanitize_payload, stable_id


class RedactionTests(unittest.TestCase):
    def test_redacts_bearer_tokens_provider_keys_and_url_credentials(self) -> None:
        source = (
            "Authorization: Bearer abc.def-ghi_jkl\n"
            "api_key=super-secret-value\n"
            "https://example.test/callback?token=one-time-token&safe=yes\n"
            "sk_agent_very_secret_value"
        )

        result = redact_text(source, home=Path("/Users/example"))

        self.assertNotIn("abc.def-ghi_jkl", result.text)
        self.assertNotIn("super-secret-value", result.text)
        self.assertNotIn("one-time-token", result.text)
        self.assertNotIn("sk_agent_very_secret_value", result.text)
        self.assertIn("Bearer <redacted>", result.text)
        self.assertIn("safe=yes", result.text)
        self.assertGreaterEqual(result.count, 4)

    def test_redacts_home_paths_without_hiding_fixture_paths(self) -> None:
        source = "/Users/example/.config/provider.json /tmp/smallkhoj-agent-runtime-capability-matrix/run-1"

        result = redact_text(source, home=Path("/Users/example"))

        self.assertIn("<HOME>/.config/provider.json", result.text)
        self.assertIn("/tmp/smallkhoj-agent-runtime-capability-matrix/run-1", result.text)

    def test_stable_id_is_correlatable_but_does_not_return_the_original_id(self) -> None:
        opaque_id = "thread_0123456789abcdef"

        value = stable_id(opaque_id)

        self.assertEqual(f"id_{hashlib.sha256(opaque_id.encode()).hexdigest()[:12]}", value)
        self.assertNotIn(opaque_id, value)

    def test_redacts_uuid_shaped_provider_and_installation_ids(self) -> None:
        opaque_id = "019f5e8e-8f95-7c70-b242-f01c6dded480"

        text_result = redact_text(f"threadId={opaque_id}")
        payload_result = sanitize_payload({"providerSessionIds": [opaque_id], "installationId": opaque_id})

        self.assertNotIn(opaque_id, text_result.text)
        self.assertEqual(stable_id(opaque_id), payload_result["providerSessionIds"][0])
        self.assertEqual(stable_id(opaque_id), payload_result["installationId"])

    def test_large_unknown_payload_is_reduced_to_a_redacted_digest_summary(self) -> None:
        payload = {"unknown": "x" * 4096, "message": "Authorization: Bearer abc.def.ghi"}

        sanitized = sanitize_payload(payload, max_string_bytes=128)

        self.assertEqual("digest", sanitized["unknown"]["kind"])
        self.assertEqual(4096, sanitized["unknown"]["bytes"])
        self.assertNotIn("abc.def.ghi", sanitized["message"])


if __name__ == "__main__":
    unittest.main()
