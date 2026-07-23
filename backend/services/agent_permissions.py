from collections.abc import Mapping


AGENT_PERMISSION_CAPABILITIES = frozenset(
    {
        "sendMessage",
        "createTask",
        "claimTask",
        "updateTask",
        "createReminder",
        "updateReminder",
        "fileWrite",
        "updateProfile",
        "manageIntegration",
    }
)


def agent_permissions_for_creation(
    requested: Mapping[str, object] | None,
) -> dict[str, bool]:
    """Persist a complete policy map so runtime checks never need implicit allow."""
    if requested is None:
        return {capability: True for capability in AGENT_PERMISSION_CAPABILITIES}
    unknown = set(requested) - AGENT_PERMISSION_CAPABILITIES
    if unknown:
        raise ValueError(f"Unknown agent permissions: {', '.join(sorted(unknown))}")
    invalid = [key for key, value in requested.items() if not isinstance(value, bool)]
    if invalid:
        raise ValueError(f"Agent permissions must be booleans: {', '.join(sorted(invalid))}")
    return {
        capability: requested.get(capability) is True
        for capability in AGENT_PERMISSION_CAPABILITIES
    }


DEFAULT_LEGACY_AGENT_PERMISSIONS = agent_permissions_for_creation(None)
