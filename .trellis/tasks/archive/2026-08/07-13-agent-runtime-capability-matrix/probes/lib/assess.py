from __future__ import annotations

from collections.abc import Mapping, Set

from .schema import CapabilitySupport


class AssessmentError(ValueError):
    """A capability claim exceeds the evidence supplied to the matrix."""


def validate_support_evidence(
    support: CapabilitySupport,
    *,
    dynamic_evidence_ids: Set[str],
    evidence_surfaces: Mapping[str, str],
    expected_surface: str,
) -> None:
    """Reject claims that borrow static or cross-surface evidence.

    ``verified`` and ``conditional`` must be backed by a real dynamic probe
    for exactly the surface named by the matrix row. ``unsupported`` may use
    a protocol/documented basis, but a claimed reproducible rejection must be
    dynamic as well.
    """
    if not isinstance(expected_surface, str) or not expected_surface:
        raise AssessmentError("expected_surface must be a non-empty string")

    requires_dynamic = support.level in {"verified", "conditional"} or (
        support.level == "unsupported" and support.basis == "reproducible_rejection"
    )
    if not requires_dynamic:
        return
    for evidence_id in support.evidence_ids:
        if evidence_id not in dynamic_evidence_ids:
            raise AssessmentError(f"{support.level} claim needs dynamic evidence: {evidence_id}")
        observed_surface = evidence_surfaces.get(evidence_id)
        if observed_surface != expected_surface:
            raise AssessmentError(
                f"evidence {evidence_id} belongs to {observed_surface!r}, not {expected_surface!r}"
            )


def classify_busy_input(observations: Mapping[str, object]) -> str:
    """Classify a second input by the strongest direct observation available."""
    if observations.get("adapterQueued") is True:
        return "adapter_queued"
    if observations.get("providerAck") is True:
        return "provider_queued"
    if observations.get("sameTurnCorrelation") is True:
        return "same_turn_steer"
    if observations.get("parallelInvocation") is True:
        return "parallel_invocation"
    if observations.get("explicitRejection") is True:
        return "rejected"
    return "unknown"


def adapter_terminal_implies_handled(_: Mapping[str, object]) -> bool:
    """A transport/provider terminal signal is never business semantic proof."""
    return False


def suspend_continuation_observed(observations: Mapping[str, object]) -> bool:
    """Session reference/resume does not imply an unfinished continuation resumed."""
    return observations.get("unfinishedContinuationResumed") is True


def retry_allowed(observations: Mapping[str, object]) -> bool:
    """Fail closed after an uncertain effect or anything outside fixture scope."""
    if observations.get("executionStatus") == "delivery_uncertain":
        return False
    if observations.get("sideEffectRisk") in {"external_or_unknown", "unknown"}:
        return False
    return observations.get("sideEffectRisk") in {None, "none", "fixture_only"}
