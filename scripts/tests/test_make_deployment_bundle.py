import io
import json
import tarfile
import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts import make_deployment_bundle as bundle


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def make_repo(root: Path) -> None:
    write(root / "docker-compose.prod.yml", "services:\n  backend: {}\n")
    write(root / "deploy" / "caddy" / "Dockerfile", "FROM caddy:2\nCOPY Caddyfile /etc/caddy/Caddyfile\n")
    write(root / "deploy" / "caddy" / "Caddyfile", ":80 {\n  reverse_proxy frontend:3000\n}\n")
    write(root / "frontend" / "Dockerfile", "COPY --from=builder /app/.next/standalone ./\nCMD [\"node\", \"server.js\"]\n")
    write(root / "frontend" / "next.config.mjs", "export default { output: \"standalone\" };\n")
    write(root / "docs" / "initial-release-production-deployment.md", "# Deploy\n")
    write(root / "scripts" / "create_prod_env_template.py", "print('env template')\n")
    write(root / "scripts" / "initial_release_deploy_preflight.py", "print('preflight')\n")
    write(root / "scripts" / "lighthouse_host_probe.py", "print('host')\n")
    write(root / "scripts" / "post_deploy_smoke.py", "print('smoke')\n")
    write(root / "scripts" / "remote_deploy_evidence.py", "print('evidence')\n")
    write(root / "scripts" / "update_prod_env_from_stdin.py", "print('env update')\n")
    write(root / ".env.prod", "POSTGRES_PASSWORD=secret\n")


def read_tar_json(tar: tarfile.TarFile, name: str) -> dict:
    member = tar.getmember(name)
    data = tar.extractfile(member)
    assert data is not None
    return json.loads(data.read().decode("utf-8"))


class DeploymentBundleTests(unittest.TestCase):
    def test_bundle_contains_only_expected_deployment_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            output = root / "bundle.tar.gz"

            bundle.create_bundle(root=root, output=output, prefix="smallkhoj-deploy")

            with tarfile.open(output, "r:gz") as tar:
                names = sorted(tar.getnames())

            self.assertEqual(names, sorted([
                "smallkhoj-deploy/README.deploy-bundle.md",
                "smallkhoj-deploy/deploy/caddy/Dockerfile",
                "smallkhoj-deploy/deploy/caddy/Caddyfile",
                "smallkhoj-deploy/docker-compose.prod.yml",
                "smallkhoj-deploy/docs/initial-release-production-deployment.md",
                "smallkhoj-deploy/frontend/Dockerfile",
                "smallkhoj-deploy/frontend/next.config.mjs",
                "smallkhoj-deploy/manifest.json",
                "smallkhoj-deploy/scripts/create_prod_env_template.py",
                "smallkhoj-deploy/scripts/initial_release_deploy_preflight.py",
                "smallkhoj-deploy/scripts/lighthouse_host_probe.py",
                "smallkhoj-deploy/scripts/post_deploy_smoke.py",
                "smallkhoj-deploy/scripts/remote_deploy_evidence.py",
                "smallkhoj-deploy/scripts/update_prod_env_from_stdin.py",
            ]))
            self.assertNotIn(".env.prod", "\n".join(names))

    def test_manifest_hashes_match_tar_contents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            output = root / "bundle.tar.gz"

            bundle.create_bundle(root=root, output=output, prefix="smallkhoj-deploy")

            with tarfile.open(output, "r:gz") as tar:
                manifest = read_tar_json(tar, "smallkhoj-deploy/manifest.json")
                files = {item["path"]: item for item in manifest["files"]}
                compose = tar.extractfile("smallkhoj-deploy/docker-compose.prod.yml")
                assert compose is not None
                data = compose.read()

            self.assertEqual(files["docker-compose.prod.yml"]["sha256"], bundle.sha256_bytes(data))
            self.assertEqual(files["docker-compose.prod.yml"]["size"], len(data))

    def test_readme_contains_server_command_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            output = root / "bundle.tar.gz"

            bundle.create_bundle(root=root, output=output, prefix="smallkhoj-deploy")

            with tarfile.open(output, "r:gz") as tar:
                readme_file = tar.extractfile("smallkhoj-deploy/README.deploy-bundle.md")
                assert readme_file is not None
                readme = readme_file.read().decode("utf-8")

            self.assertLess(readme.index("lighthouse_host_probe.py"), readme.index("initial_release_deploy_preflight.py"))
            self.assertLess(readme.index("initial_release_deploy_preflight.py"), readme.index("docker compose"))
            self.assertLess(readme.index("docker compose"), readme.index("post_deploy_smoke.py"))

    def test_tar_member_names_are_relative_under_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            output = root / "bundle.tar.gz"

            bundle.create_bundle(root=root, output=output, prefix="smallkhoj-deploy")

            with tarfile.open(output, "r:gz") as tar:
                for member in tar.getmembers():
                    self.assertTrue(member.name.startswith("smallkhoj-deploy/"))
                    self.assertNotIn("..", Path(member.name).parts)
                    self.assertFalse(Path(member.name).is_absolute())

    def test_add_bytes_rejects_env_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "bundle.tar.gz"
            with tarfile.open(output, "w:gz") as tar:
                with self.assertRaises(ValueError):
                    bundle.add_bytes(tar, prefix="smallkhoj-deploy", relative_path=".env.prod", data=b"secret")


if __name__ == "__main__":
    unittest.main()
