from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.assess import (
    AssessmentError,
    adapter_terminal_implies_handled,
    classify_busy_input,
    retry_allowed,
    suspend_continuation_observed,
    validate_support_evidence,
)
from lib.schema import CapabilitySupport


class AssessmentTests(unittest.TestCase):
    def test_verified_or_conditional_support_requires_dynamic_same_surface_evidence(self) -> None:
        support = CapabilitySupport.from_dict(
            {
                "level": "conditional",
                "evidenceIds": ["static/help/1"],
                "constraints": ["only documented statically"],
            }
        )

        with self.assertRaises(AssessmentError):
            validate_support_evidence(
                support,
                dynamic_evidence_ids=set(),
                evidence_surfaces={"static/help/1": "kimi-acp"},
                expected_surface="kimi-acp",
            )

    def test_static_absence_stays_unverified_and_reproducible_rejection_can_be_unsupported(self) -> None:
        unverified = CapabilitySupport.from_dict({"level": "unverified", "reason": "help omits the method"})
        validate_support_evidence(
            unverified,
            dynamic_evidence_ids=set(),
            evidence_surfaces={},
            expected_surface="opencode-acp",
        )

        rejected = CapabilitySupport.from_dict(
            {
                "level": "unsupported",
                "evidenceIds": ["live/rejection/1"],
                "basis": "reproducible_rejection",
            }
        )
        validate_support_evidence(
            rejected,
            dynamic_evidence_ids={"live/rejection/1"},
            evidence_surfaces={"live/rejection/1": "opencode-acp"},
            expected_surface="opencode-acp",
        )

    def test_busy_input_attribution_uses_evidence_priority_order(self) -> None:
        self.assertEqual("adapter_queued", classify_busy_input({"adapterQueued": True, "providerAck": True}))
        self.assertEqual("provider_queued", classify_busy_input({"providerAck": True, "sameTurnCorrelation": True}))
        self.assertEqual("same_turn_steer", classify_busy_input({"sameTurnCorrelation": True}))
        self.assertEqual("parallel_invocation", classify_busy_input({"parallelInvocation": True}))
        self.assertEqual("rejected", classify_busy_input({"explicitRejection": True}))
        self.assertEqual("unknown", classify_busy_input({}))

    def test_adapter_terminal_never_means_business_work_handled(self) -> None:
        self.assertFalse(adapter_terminal_implies_handled({"adapterState": "completed", "stopReason": "end_turn"}))
        self.assertFalse(suspend_continuation_observed({"sessionResumeAccepted": True}))
        self.assertTrue(suspend_continuation_observed({"unfinishedContinuationResumed": True}))

    def test_delivery_uncertainty_blocks_automatic_retry(self) -> None:
        self.assertFalse(retry_allowed({"executionStatus": "delivery_uncertain", "sideEffectRisk": "fixture_only"}))
        self.assertFalse(retry_allowed({"executionStatus": "passed", "sideEffectRisk": "external_or_unknown"}))
        self.assertTrue(retry_allowed({"executionStatus": "passed", "sideEffectRisk": "none"}))


if __name__ == "__main__":
    unittest.main()
