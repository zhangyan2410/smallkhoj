import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "frontend" / "Dockerfile"


class FrontendDockerfileAuthTest(unittest.TestCase):
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
