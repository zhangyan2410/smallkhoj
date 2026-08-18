from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.evidence import EvidenceRecorder, normalize_sanitized_evidence


class EvidenceRecorderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temp_dir.name)
        self.recorder = EvidenceRecorder(raw_root=self.root / "raw", evidence_root=self.root / "evidence")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_writes_only_sanitized_evidence_then_deletes_raw_transcript(self) -> None:
        handle = self.recorder.begin("run-1", "case-1")
        self.recorder.append(
            handle,
            source="stderr",
            kind="provider-error",
            payload={"line": "Authorization: Bearer abc.def.ghi"},
        )
        evidence_path = self.recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "executionStatus": "delivery_uncertain",
                "terminal": {
                    "adapterState": "process_exit",
                    "contradictorySignals": ["exit=0", "terminal provider error"],
                },
            },
        )

        serialized = evidence_path.read_text(encoding="utf-8")
        parsed = json.loads(serialized)
        self.assertNotIn("abc.def.ghi", serialized)
        self.assertFalse(handle.raw_path.exists())
        self.assertEqual(["exit=0", "terminal provider error"], parsed["terminal"]["contradictorySignals"])
        self.assertGreaterEqual(parsed["redaction"]["count"], 1)

    def test_evidence_paths_are_task_safe_identifiers_not_raw_provider_output(self) -> None:
        handle = self.recorder.begin("run-2", "codex-appserver")

        with self.assertRaises(ValueError):
            self.recorder.begin("../escape", "case")

        path = self.recorder.finalize(handle, {"schemaVersion": 1, "executionStatus": "blocked"})
        self.assertEqual("evidence.json", path.name)
        self.assertTrue(path.is_relative_to(Path(self.temp_dir.name) / "evidence"))

    def test_strips_agent_thought_and_message_chunks_from_protocol_transcripts(self) -> None:
        handle = self.recorder.begin("run-3", "acp-transcript")
        private_thought = "internal-thought-must-not-enter-task-evidence"
        assistant_text = "assistant-output-must-not-enter-task-evidence"
        for update_type, text in (
            ("agent_thought_chunk", private_thought),
            ("agent_thought_chunk", "another-thought-chunk"),
            ("agent_message_chunk", assistant_text),
        ):
            self.recorder.append(
                handle,
                source="stdout",
                kind="acp-frame",
                payload={
                    "reservationId": "reservation-opaque",
                    "text": json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "method": "session/update",
                            "params": {
                                "sessionId": "session-opaque",
                                "update": {
                                    "sessionUpdate": update_type,
                                    "content": {"type": "text", "text": text},
                                },
                            },
                        }
                    ),
                },
            )

        evidence_path = self.recorder.finalize(handle, {"schemaVersion": 1, "executionStatus": "passed"})
        serialized = evidence_path.read_text(encoding="utf-8")
        parsed = json.loads(serialized)

        self.assertNotIn(private_thought, serialized)
        self.assertNotIn(assistant_text, serialized)
        frames = [observation["payload"]["frame"] for observation in parsed["observations"]]
        self.assertEqual(["agent_message_chunk", "agent_thought_chunk"], [frame["sessionUpdate"] for frame in frames])
        self.assertTrue(all(frame["content"] == "redacted" for frame in frames))
        self.assertEqual([1, 2], [frame["chunksRedacted"] for frame in frames])

    def test_normalizes_preexisting_sanitized_evidence_without_raw_transcript(self) -> None:
        path = self.root / "evidence" / "legacy" / "case" / "evidence.json"
        path.parent.mkdir(parents=True)
        private_thought = "legacy-thought-must-be-removed"
        path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "executionStatus": "passed",
                    "observations": [
                        {
                            "at": "2026-07-14T00:00:00Z",
                            "source": "stdout",
                            "kind": "acp-frame",
                            "payload": {
                                "text": json.dumps(
                                    {
                                        "jsonrpc": "2.0",
                                        "method": "session/update",
                                        "params": {
                                            "update": {
                                                "sessionUpdate": "agent_thought_chunk",
                                                "content": {"type": "text", "text": private_thought},
                                            }
                                        },
                                    }
                                )
                            },
                        }
                    ],
                    "redaction": {"version": 1, "count": 0, "rawTranscript": "deleted_after_sanitization"},
                }
            ),
            encoding="utf-8",
        )

        changed = normalize_sanitized_evidence(path)
        serialized = path.read_text(encoding="utf-8")
        parsed = json.loads(serialized)

        self.assertEqual(1, changed)
        self.assertNotIn(private_thought, serialized)
        self.assertEqual("agent_thought_chunk", parsed["observations"][0]["payload"]["frame"]["sessionUpdate"])
        self.assertEqual(1, parsed["posthocEvidenceNormalization"]["protocolFramesSummarized"])
        self.assertEqual(0, normalize_sanitized_evidence(path))


if __name__ == "__main__":
    unittest.main()
