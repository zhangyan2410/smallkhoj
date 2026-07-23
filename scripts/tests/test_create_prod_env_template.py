import tempfile
import unittest
from pathlib import Path

from scripts import create_prod_env_template as env_template


class CreateProdEnvTemplateTests(unittest.TestCase):
    def test_template_contains_required_keys_without_real_secrets(self) -> None:
        content = env_template.render_template()

        self.assertIn("SMALLKHOJ_SITE_ADDRESS=<domain-or-ip-site-address>", content)
        self.assertIn("SMALLKHOJ_BACKEND_IMAGE=<registry>/smallkhoj-backend:<tag>", content)
        self.assertIn("SMALLKHOJ_FRONTEND_IMAGE=<registry>/smallkhoj-frontend:<tag>", content)
        self.assertIn("POSTGRES_PASSWORD=<set-outside-repo>", content)
        self.assertIn("PUBLIC_API_KEY=<set-outside-repo>", content)
        self.assertNotIn("NEXT_PUBLIC_API_KEY=", content)
        self.assertIn("BACKEND_CORS_ORIGINS=<public-origin>", content)
        self.assertIn("FEISHU_WORKER_APP_SECRET=<optional-set-outside-repo>", content)
        self.assertNotIn("sk_live", content)

    def test_write_template_refuses_to_overwrite_without_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / ".env.prod"
            output.write_text("EXISTING=1\n", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                env_template.write_template(output, force=False)

            self.assertEqual(output.read_text(encoding="utf-8"), "EXISTING=1\n")

    def test_write_template_allows_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / ".env.prod"
            output.write_text("EXISTING=1\n", encoding="utf-8")

            env_template.write_template(output, force=True)

            self.assertIn("SMALLKHOJ_SITE_ADDRESS=", output.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
