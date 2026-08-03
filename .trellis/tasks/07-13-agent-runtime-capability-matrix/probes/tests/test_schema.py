from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.schema import CapabilitySupport, SchemaError


class CapabilitySupportTests(unittest.TestCase):
    def test_verified_support_requires_at_least_one_evidence_id(self) -> None:
        with self.assertRaises(SchemaError):
            CapabilitySupport.from_dict({"level": "verified", "evidenceIds": []})

    def test_conditional_support_preserves_constraints_and_fallback(self) -> None:
        support = CapabilitySupport.from_dict(
            {
                "level": "conditional",
                "evidenceIds": ["run-1/case-1/1"],
                "constraints": ["expectedTurnId is required"],
                "fallback": "queue for a later invocation",
            }
        )

        self.assertEqual("conditional", support.level)
        self.assertEqual(["expectedTurnId is required"], support.constraints)
        self.assertEqual("queue for a later invocation", support.fallback)

    def test_unsupported_requires_a_supported_basis(self) -> None:
        with self.assertRaises(SchemaError):
            CapabilitySupport.from_dict(
                {
                    "level": "unsupported",
                    "evidenceIds": ["run-1/case-1/1"],
                    "basis": "absence_from_help",
                }
            )


if __name__ == "__main__":
    unittest.main()
