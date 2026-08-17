#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trellis Dashboard CLI 入口（本地只读）。

用法:
    ./trellis-dashboard                 # 启动仪表盘，默认 127.0.0.1:4322（冲突自动 +1）
    ./trellis-dashboard --json          # 输出一次快照 JSON 后退出（脚本化）
    ./trellis-dashboard --port 4400     # 指定起始端口
    ./trellis-dashboard --no-open       # 不自动打开浏览器
    ./trellis-dashboard --demo          # 打开的 URL 附带 ?demo 演示模式
    ./trellis-dashboard --root <path>   # 指向其他仓库根目录（读取其 .trellis 数据）
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

from collector import collect_snapshot  # noqa: E402
from server import DEFAULT_PORT, create_server  # noqa: E402


def _open_browser(url: str) -> None:
    import platform

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", url], check=False)
        elif system == "Windows":
            subprocess.run(["cmd", "/c", "start", "", url], check=False)
        else:
            subprocess.run(["xdg-open", url], check=False)
        return
    except Exception:
        pass
    import webbrowser

    webbrowser.open(url)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="trellis-dashboard",
        description="Trellis 本地只读任务仪表盘",
    )
    parser.add_argument("-p", "--port", type=int, default=DEFAULT_PORT,
                        help=f"起始端口（默认 {DEFAULT_PORT}，被占用时自动 +1，最多重试 20 次；0 表示随机）")
    parser.add_argument("--json", action="store_true",
                        help="采集一次快照并输出 JSON 到 stdout 后退出")
    parser.add_argument("--no-open", action="store_true",
                        help="启动后不自动打开浏览器")
    parser.add_argument("--demo", action="store_true",
                        help="自动打开的 URL 附带 ?demo（前端加载内置演示数据）")
    parser.add_argument("--root", default=str(REPO_ROOT),
                        help="数据根目录（默认本仓库根；任务解析模块始终取自本仓库）")
    args = parser.parse_args(argv)

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"错误: 根目录不存在: {root}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(collect_snapshot(root), ensure_ascii=False, indent=2))
        return 0

    try:
        server, port = create_server(root, args.port)
    except RuntimeError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{port}/"
    if args.demo:
        url += "?demo"
    print(f"Trellis Dashboard（只读）运行于 {url}")
    print(f"数据根目录: {root}   ·   Ctrl+C 停止")
    if not args.no_open:
        _open_browser(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
