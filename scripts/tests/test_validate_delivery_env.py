import unittest

from scripts.validate_delivery_env import (
    DeliveryEnvError,
    validate_backend_env,
    validate_e2e_env,
    validate_frontend_env,
)


def backend_env(**overrides: str) -> dict[str, str]:
    values = {
        "E2E_DATABASE_SCOPE": "disposable",
        "DATABASE_URL": "postgresql+asyncpg://postgres:secret@127.0.0.1:5432/smallkhoj_test_ci",
        "PUBLIC_API_KEY": "sk_test_ephemeral",
        "AUTH_BRIDGE_SECRET": "test-bridge-secret",
        "SMALLKHOJ_MIGRATION_TEST_ADMIN_URL": "postgresql://postgres:secret@127.0.0.1:5432/postgres",
        "SMALLKHOJ_MIGRATION_TEST_DATABASE_URL": "postgresql+asyncpg://postgres:secret@127.0.0.1:5432/smallkhoj_audit_ci",
        "SMALLKHOJ_TEST_ADMIN_DATABASE_URL": "postgresql://postgres:secret@127.0.0.1:5432/postgres",
        "SMALLKHOJ_TEST_DATABASE_URL": "postgresql+asyncpg://postgres:secret@127.0.0.1:5432/smallkhoj_test_ci",
    }
    values.update(overrides)
    return values


def e2e_env(**overrides: str) -> dict[str, str]:
    values = {
        "E2E_DATABASE_SCOPE": "disposable",
        "E2E_PUBLIC_API_KEY": "sk_test_ephemeral",
        "E2E_RUN_NAMESPACE": "audit-123",
        "E2E_DAEMON_VERSION": "0.2.1",
        "MINIMUM_DAEMON_VERSION": "0.2.0",
        "DAEMON_RELEASE_VERSION": "0.2.1",
        "API_BASE": "http://127.0.0.1:8000",
        "FRONTEND_BASE": "http://localhost:3000",
        "INTERNAL_API_BASE_URL": "http://127.0.0.1:8000",
        "BETTER_AUTH_URL": "http://localhost:3000",
        "DATABASE_URL": (
            "postgresql+asyncpg://postgres:secret@127.0.0.1:5432/smallkhoj_e2e_ci"
        ),
        "BETTER_AUTH_DATABASE_URL": (
            "postgresql://postgres:secret@127.0.0.1:5432/smallkhoj_e2e_ci"
        ),
    }
    values.update(overrides)
    return values


class BackendDeliveryEnvironmentTest(unittest.TestCase):
    def test_accepts_loopback_disposable_database_matrix(self):
        validate_backend_env(backend_env())

    def test_rejects_remote_database_even_when_scope_claims_disposable(self):
        unsafe = "postgresql+asyncpg://admin:secret@db.production.example:5432/app_test"
        with self.assertRaisesRegex(DeliveryEnvError, "loopback") as caught:
            validate_backend_env(backend_env(DATABASE_URL=unsafe))
        self.assertNotIn("secret", str(caught.exception))

        query_override = (
            "postgresql+asyncpg://postgres:secret@127.0.0.1:5432/"
            "smallkhoj_test_ci?host=db.production.example"
        )
        with self.assertRaisesRegex(DeliveryEnvError, "query parameters") as caught:
            validate_backend_env(backend_env(DATABASE_URL=query_override))
        self.assertNotIn("secret", str(caught.exception))

    def test_rejects_database_without_a_disposable_marker(self):
        with self.assertRaisesRegex(DeliveryEnvError, "safe marker"):
            validate_backend_env(
                backend_env(
                    DATABASE_URL="postgresql+asyncpg://postgres:secret@127.0.0.1:5432/smallkhoj",
                )
            )
        with self.assertRaisesRegex(DeliveryEnvError, "safe marker"):
            validate_backend_env(
                backend_env(
                    DATABASE_URL="postgresql+asyncpg://postgres:secret@127.0.0.1:5432/special",
                )
            )

    def test_rejects_admin_target_on_different_server_or_same_database(self):
        with self.assertRaisesRegex(DeliveryEnvError, "same PostgreSQL server"):
            validate_backend_env(
                backend_env(
                    SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=(
                        "postgresql+asyncpg://postgres:secret@localhost:5432/smallkhoj_audit_ci"
                    ),
                )
            )
        with self.assertRaisesRegex(DeliveryEnvError, "non-admin database"):
            validate_backend_env(
                backend_env(
                    SMALLKHOJ_TEST_ADMIN_DATABASE_URL=(
                        "postgresql://postgres:secret@127.0.0.1:5432/smallkhoj_test_ci"
                    ),
                )
            )


class FrontendDeliveryEnvironmentTest(unittest.TestCase):
    def test_accepts_same_origin_public_urls_and_valid_runtime_shape(self):
        validate_frontend_env(
            {
                "NODE_ENV": "production",
                "NEXT_PUBLIC_DEPLOYMENT_ENV": "production",
                "NEXT_PUBLIC_API_KEY": "sk_test_ephemeral",
                "NEXT_PUBLIC_API_BASE_URL": "",
                "NEXT_PUBLIC_WS_BASE_URL": "",
                "INTERNAL_API_BASE_URL": "http://127.0.0.1:8000",
                "BETTER_AUTH_SECRET": "test-secret-at-least-thirty-two-characters",
                "BETTER_AUTH_URL": "http://127.0.0.1:3000",
                "BETTER_AUTH_DATABASE_URL": (
                    "postgresql://postgres:secret@127.0.0.1:5432/smallkhoj_test_ci"
                ),
                "AUTH_BRIDGE_SECRET": "test-bridge-secret",
            }
        )

    def test_rejects_explicit_loopback_browser_override_in_production(self):
        env = {
            "NODE_ENV": "production",
            "NEXT_PUBLIC_DEPLOYMENT_ENV": "production",
            "NEXT_PUBLIC_API_KEY": "sk_test_ephemeral",
            "NEXT_PUBLIC_API_BASE_URL": "http://localhost:8000",
            "NEXT_PUBLIC_WS_BASE_URL": "",
            "INTERNAL_API_BASE_URL": "http://127.0.0.1:8000",
            "BETTER_AUTH_SECRET": "test-secret-at-least-thirty-two-characters",
            "BETTER_AUTH_URL": "http://127.0.0.1:3000",
            "BETTER_AUTH_DATABASE_URL": "postgresql://postgres:secret@127.0.0.1:5432/test",
            "AUTH_BRIDGE_SECRET": "test-bridge-secret",
        }
        with self.assertRaisesRegex(DeliveryEnvError, "browser URL"):
            validate_frontend_env(env)


class E2EDeliveryEnvironmentTest(unittest.TestCase):
    def test_accepts_loopback_candidate_urls(self):
        validate_e2e_env(e2e_env())

    def test_rejects_remote_or_mismatched_database_targets(self):
        with self.assertRaisesRegex(DeliveryEnvError, "loopback") as caught:
            validate_e2e_env(
                e2e_env(
                    DATABASE_URL=(
                        "postgresql+asyncpg://admin:secret@db.production.example:5432/"
                        "smallkhoj_e2e_ci"
                    )
                )
            )
        self.assertNotIn("secret", str(caught.exception))

        with self.assertRaisesRegex(DeliveryEnvError, "same disposable database"):
            validate_e2e_env(
                e2e_env(
                    BETTER_AUTH_DATABASE_URL=(
                        "postgresql://postgres:secret@127.0.0.1:5432/other_e2e_ci"
                    )
                )
            )

    def test_rejects_remote_or_credential_bearing_candidate_urls(self):
        base = e2e_env(
            API_BASE="https://production.example",
            FRONTEND_BASE="https://production.example",
        )
        with self.assertRaisesRegex(DeliveryEnvError, "loopback"):
            validate_e2e_env(base)

        base["API_BASE"] = "http://user:secret@127.0.0.1:8000"
        base["FRONTEND_BASE"] = "http://127.0.0.1:3000"
        with self.assertRaisesRegex(DeliveryEnvError, "credentials") as caught:
            validate_e2e_env(base)
        self.assertNotIn("secret", str(caught.exception))

        base["API_BASE"] = "http://127.0.0.1:8000"
        base["E2E_DAEMON_VERSION"] = "e2e"
        with self.assertRaisesRegex(DeliveryEnvError, "semantic version"):
            validate_e2e_env(base)

        base["E2E_DAEMON_VERSION"] = "0.1.9"
        with self.assertRaisesRegex(DeliveryEnvError, "meet MINIMUM"):
            validate_e2e_env(base)

        base["E2E_DAEMON_VERSION"] = "0.2.0"
        with self.assertRaisesRegex(DeliveryEnvError, "equal DAEMON_RELEASE_VERSION"):
            validate_e2e_env(base)

    def test_rejects_frontend_consumers_that_do_not_match_validated_candidates(self):
        with self.assertRaisesRegex(DeliveryEnvError, "INTERNAL_API_BASE_URL"):
            validate_e2e_env(
                e2e_env(INTERNAL_API_BASE_URL="https://api.production.example")
            )

        with self.assertRaisesRegex(DeliveryEnvError, "BETTER_AUTH_URL"):
            validate_e2e_env(
                e2e_env(BETTER_AUTH_URL="https://production.example")
            )


if __name__ == "__main__":
    unittest.main()
