import unittest

from scripts import lighthouse_host_probe as probe
from scripts.initial_release_deploy_preflight import STATUS_FAILED, STATUS_PASSED, STATUS_WARNING


class LighthouseHostProbeTests(unittest.TestCase):
    def test_resource_checks_warn_for_two_gib_host_without_swap(self) -> None:
        checks = probe.classify_resources(
            cpu_count=2,
            memory_bytes=2 * 1024**3,
            swap_bytes=0,
            disk_free_bytes=20 * 1024**3,
        )

        by_name = {check.name: check for check in checks}
        self.assertEqual(by_name["host.cpu"].status, STATUS_PASSED)
        self.assertEqual(by_name["host.memory"].status, STATUS_PASSED)
        self.assertEqual(by_name["host.swap"].status, STATUS_WARNING)
        self.assertEqual(by_name["host.disk"].status, STATUS_PASSED)

    def test_resource_checks_fail_below_minimum_memory_and_disk(self) -> None:
        checks = probe.classify_resources(
            cpu_count=1,
            memory_bytes=1024**3,
            swap_bytes=0,
            disk_free_bytes=4 * 1024**3,
        )

        by_name = {check.name: check for check in checks}
        self.assertEqual(by_name["host.cpu"].status, STATUS_WARNING)
        self.assertEqual(by_name["host.memory"].status, STATUS_FAILED)
        self.assertEqual(by_name["host.disk"].status, STATUS_FAILED)

    def test_runtime_checks_classify_missing_docker_and_compose(self) -> None:
        checks = probe.classify_runtime_dependencies(
            docker_path=None,
            docker_info_code=None,
            docker_info_output="",
            compose_code=None,
            compose_output="",
        )

        by_name = {check.name: check for check in checks}
        self.assertEqual(by_name["host.docker.command"].status, STATUS_FAILED)
        self.assertEqual(by_name["host.docker.daemon"].status, STATUS_FAILED)
        self.assertEqual(by_name["host.docker.compose"].status, STATUS_FAILED)

    def test_ubuntu_bootstrap_commands_are_suggested_but_not_executed(self) -> None:
        commands = probe.suggest_bootstrap_commands(
            os_id="ubuntu",
            package_manager="apt-get",
            docker_available=False,
            memory_bytes=2 * 1024**3,
            swap_bytes=0,
            firewall_tools=["ufw"],
        )

        joined = "\n".join(command["command"] for command in commands)
        self.assertIn("install -m 0755 -d /etc/apt/keyrings", joined)
        self.assertIn("docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin", joined)
        self.assertIn("fallocate -l 2G /swapfile", joined)
        self.assertIn("ufw allow 80/tcp", joined)
        self.assertTrue(all(command["mode"] == "suggested" for command in commands))

    def test_exit_code_for_warnings_and_failures(self) -> None:
        warning_report = probe.HostProbeReport(
            checks=[
                probe.warning(
                    "host.swap",
                    "HOST_PROBE_SWAP_MISSING",
                    "Swap is missing.",
                )
            ],
            suggested_commands=[],
        )
        failed_report = probe.HostProbeReport(
            checks=[
                probe.failed(
                    "host.memory",
                    "HOST_PROBE_MEMORY_TOO_LOW",
                    "Memory too low.",
                )
            ],
            suggested_commands=[],
        )

        self.assertEqual(probe.exit_code_for(warning_report, strict_warnings=False), 0)
        self.assertEqual(probe.exit_code_for(warning_report, strict_warnings=True), 2)
        self.assertEqual(probe.exit_code_for(failed_report, strict_warnings=False), 1)


if __name__ == "__main__":
    unittest.main()
