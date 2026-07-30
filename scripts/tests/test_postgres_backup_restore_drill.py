import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import postgres_backup_restore_drill as drill
from scripts.tests.test_initial_release_deploy_preflight import write


class PostgresBackupRestoreDrillTests(unittest.TestCase):
    def test_dry_run_has_no_destructive_pre_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / ".env.prod", "POSTGRES_PASSWORD=secret\n")
            write(root / "docker-compose.prod.yml", "services:\n  db:\n    image: pgvector/pgvector:pg16\n")

            result = drill.run_drill(
                root=root,
                env_file=Path(".env.prod"),
                compose_file=Path("docker-compose.prod.yml"),
                backup_dir=Path("backups"),
                restore_database="smallkhoj_restore_test",
                dry_run=True,
            )

            self.assertTrue(result.ready)
            self.assertTrue(result.dry_run)
            self.assertEqual(
                [step["name"] for step in result.steps],
                [
                    "backup",
                    "create-restore-db",
                    "restore",
                    "verify-restore",
                    "drop-restore-db-after",
                ],
            )
            create_index = next(
                index for index, step in enumerate(result.steps) if "createdb" in step["command"]
            )
            self.assertFalse(
                any("dropdb" in step["command"] for step in result.steps[:create_index])
            )
            self.assertEqual(
                [step["name"] for step in result.steps if "dropdb" in step["command"]],
                ["drop-restore-db-after"],
            )
            text = json.dumps(drill.report_to_dict(result))
            self.assertIn("pg_dump", text)
            self.assertIn("pg_restore", text)
            self.assertIn("SELECT 1", text)
            self.assertNotIn("secret", text)

    def test_createdb_collision_fails_without_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / ".env.prod", "POSTGRES_PASSWORD=secret\n")
            write(root / "docker-compose.prod.yml", "services:\n  db:\n    image: pgvector/pgvector:pg16\n")
            commands: list[list[str]] = []

            def run_command(command: list[str], **_: object) -> dict[str, object]:
                commands.append(command)
                return {
                    "command": command,
                    "exitCode": 1 if "createdb" in command else 0,
                    "stdoutTail": "",
                    "stderrTail": "database already exists" if "createdb" in command else "",
                }

            with (
                mock.patch.object(
                    drill,
                    "run_capture_to_file",
                    return_value={"command": ["pg_dump"], "exitCode": 0, "stderrTail": ""},
                ),
                mock.patch.object(drill, "run_command", side_effect=run_command),
            ):
                result = drill.run_drill(
                    root=root,
                    env_file=Path(".env.prod"),
                    compose_file=Path("docker-compose.prod.yml"),
                    backup_dir=Path("backups"),
                    restore_database="smallkhoj_restore_test",
                )

            self.assertFalse(result.ready)
            self.assertEqual(
                [step["name"] for step in result.steps],
                ["backup", "create-restore-db"],
            )
            self.assertTrue(any("createdb" in command for command in commands))
            self.assertFalse(any("dropdb" in command for command in commands))

    def test_build_steps_use_compose_env_file_without_printing_secret_values(self) -> None:
        steps = drill.build_steps(
            env_file=Path(".env.prod"),
            compose_file=Path("docker-compose.prod.yml"),
            service="db",
            db_name="smallkhoj",
            user="smallkhoj",
            backup_file=Path("backups/smallkhoj.dump"),
            restore_database="smallkhoj_restore_test",
        )

        backup = steps[0].command
        restore = next(step.command for step in steps if step.name == "restore")
        verify = next(step.command for step in steps if step.name == "verify-restore")

        self.assertIn("pg_dump", backup)
        self.assertIn("--format=custom", backup)
        self.assertIn("pg_restore", restore)
        self.assertIn("smallkhoj_restore_test", restore)
        self.assertEqual(verify[-1], "SELECT 1")
        self.assertNotIn("POSTGRES_PASSWORD", " ".join(drill.shell_join(step.command) for step in steps))


if __name__ == "__main__":
    unittest.main()
