import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "frontend" / "Dockerfile"
MAKEFILE = ROOT / "Makefile"
ROOT_DOCKERIGNORE = ROOT / ".dockerignore"


class FrontendDockerfileAuthTest(unittest.TestCase):
    def test_secret_dependent_production_build_disables_cache(self):
        makefile = MAKEFILE.read_text()

        target = makefile.split("frontend-image-build:", 1)[1].split("\n\n", 1)[0]
        self.assertIn("frontend-image-build: verify-release-source", makefile)
        self.assertGreaterEqual(target.count("--check-source-only"), 2)
        self.assertIn("docker build --no-cache", target)
        self.assertIn("--secret id=public_api_key,env=PUBLIC_API_KEY", target)
        self.assertIn("--label org.opencontainers.image.revision=", target)
        self.assertIn("$(RELEASE_SOURCE_REVISION)", target)

    def test_root_backend_context_excludes_runtime_data(self):
        patterns = ROOT_DOCKERIGNORE.read_text(encoding="utf-8").splitlines()

        self.assertIn("backend/.data", patterns)

    def test_production_uses_buildkit_secret_and_arg_is_local_dev_only(self):
        content = DOCKERFILE.read_text()

        self.assertIn(
            'if [ "$NEXT_PUBLIC_DEPLOYMENT_ENV" = "local-dev" ]; then',
            content,
        )
        self.assertIn('public_api_key="$NEXT_PUBLIC_API_KEY"', content)
        self.assertIn('elif [ -f /run/secrets/public_api_key ]; then', content)
        self.assertIn(
            "PUBLIC_API_KEY BuildKit secret is required for production builds",
            content,
        )


if __name__ == "__main__":
    unittest.main()
