#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Lightweight CLI wrapper for TMWebDriver.

This is intentionally small: it exposes the GA browser bridge as commands that
Claude Code / Codex / humans can call from shell.  Start one persistent master
with `python twd.py serve`, then use `python twd.py tabs`, `eval`, etc. from
other terminals/agents.
"""
from __future__ import annotations

import argparse
import ast
import base64
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from tmwebdriver_core import TMWebDriver

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18765


def jdump(obj: Any, pretty: bool = True) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None)


def print_json(obj: Any, pretty: bool = True) -> None:
    print(jdump(obj, pretty=pretty))


def ok(**kw: Any) -> dict[str, Any]:
    return {"ok": True, **kw}


def err(code: str, message: str, **kw: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **kw}


def make_driver(args: argparse.Namespace) -> TMWebDriver:
    return TMWebDriver(host=getattr(args, "host", DEFAULT_HOST), port=getattr(args, "port", DEFAULT_PORT))


def wait_sessions(driver: TMWebDriver, timeout: float = 8.0) -> list[dict[str, Any]]:
    deadline = time.time() + timeout
    last: list[dict[str, Any]] = []
    while time.time() < deadline:
        try:
            last = driver.get_all_sessions()
        except Exception:
            last = []
        if last:
            return last
        time.sleep(0.25)
    return last


def choose_session(driver: TMWebDriver, args: argparse.Namespace) -> str | None:
    tab_id = getattr(args, "tab", None)
    if tab_id is not None:
        return str(tab_id)
    sessions = wait_sessions(driver, timeout=getattr(args, "wait", 8.0))
    if not sessions:
        return None
    url = getattr(args, "url_match", None)
    if url:
        matched = [s for s in sessions if url in str(s.get("url", ""))]
        if not matched:
            return None
        sessions = matched
    active = [s for s in sessions if s.get("active")]
    return str((active or sessions)[0]["id"])


def unwrap_exec_result(r: Any) -> Any:
    """TMWebDriver returns {'data': ...}; remote master returns same under r."""
    if isinstance(r, dict) and "data" in r and len(r) <= 2:
        return r["data"]
    return r


def load_script(args: argparse.Namespace) -> str:
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if args.script == "-":
        return sys.stdin.read()
    return args.script


def parse_jsonish(s: str) -> Any:
    try:
        return json.loads(s)
    except Exception:
        return ast.literal_eval(s)


def cmd_serve(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    print_json(ok(message="TMWebDriver master running", host=args.host, ws_port=args.port, http_port=args.port + 1))
    print("Press Ctrl+C to stop.", file=sys.stderr)
    try:
        while True:
            time.sleep(args.interval)
            if args.verbose:
                sessions = driver.get_all_sessions()
                print_json(ok(sessions=sessions), pretty=False)
    except KeyboardInterrupt:
        return 0


def cmd_tabs(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sessions = wait_sessions(driver, timeout=args.wait)
    print_json(ok(tabs=sessions, count=len(sessions)), pretty=not args.compact)
    return 0 if sessions else 2


def cmd_eval(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected. Start Chrome with TMWD extension and/or run `python twd.py serve`."))
        return 2
    script = load_script(args)
    r = driver.execute_js(script, timeout=args.timeout, session_id=sid)
    print_json(ok(tabId=sid, result=unwrap_exec_result(r)), pretty=not args.compact)
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    if args.text:
        js = "return document.body ? document.body.innerText : '';"
    else:
        js = "return document.documentElement ? document.documentElement.outerHTML : '';"
    r = unwrap_exec_result(driver.execute_js(js, timeout=args.timeout, session_id=sid))
    if args.out:
        Path(args.out).write_text(str(r), encoding="utf-8")
        print_json(ok(tabId=sid, path=str(Path(args.out).resolve()), chars=len(str(r))))
    else:
        print_json(ok(tabId=sid, text=r if args.text else None, html=None if args.text else r), pretty=not args.compact)
    return 0


def cmd_goto(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    target = json.dumps(args.target, ensure_ascii=False)
    js = f"location.href = {target}; return true;"
    r = unwrap_exec_result(driver.execute_js(js, timeout=args.timeout, session_id=sid))
    print_json(ok(tabId=sid, navigated=bool(r), url=args.target), pretty=not args.compact)
    return 0


def cmd_input(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    text = sys.stdin.read() if args.text == "-" else args.text
    selector = json.dumps(args.selector)
    text_json = json.dumps(text, ensure_ascii=False)
    contains = json.dumps(args.contains, ensure_ascii=False)
    js = f"""
const selector = {selector};
const text = {text_json};
const contains = {contains};
const els = Array.from(document.querySelectorAll(selector));
const el = contains ? els.find(e => ((e.placeholder||'') + ' ' + (e.innerText||'') + ' ' + (e.getAttribute('aria-label')||'')).includes(contains)) : els[0];
if (!el) throw new Error('element not found: ' + selector);
el.focus();
const proto = Object.getPrototypeOf(el);
const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
if (desc && desc.set) desc.set.call(el, text); else el.value = text;
el.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
el.dispatchEvent(new Event('change', {{ bubbles: true }}));
return {{ valueLength: (el.value || '').length, tag: el.tagName, selector }};
"""
    r = unwrap_exec_result(driver.execute_js(js, timeout=args.timeout, session_id=sid))
    print_json(ok(tabId=sid, result=r), pretty=not args.compact)
    return 0


def cmd_click(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    selector = json.dumps(args.selector)
    contains = json.dumps(args.contains, ensure_ascii=False)
    js = f"""
const selector = {selector};
const contains = {contains};
const els = Array.from(document.querySelectorAll(selector));
const el = contains ? els.find(e => ((e.innerText||'') + ' ' + (e.value||'') + ' ' + (e.getAttribute('aria-label')||'')).includes(contains)) : els[0];
if (!el) throw new Error('element not found: ' + selector);
if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('element disabled: ' + selector);
el.scrollIntoView({{ block: 'center', inline: 'center' }});
el.click();
return {{ clicked: true, tag: el.tagName, text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 100) }};
"""
    r = unwrap_exec_result(driver.execute_js(js, timeout=args.timeout, session_id=sid))
    print_json(ok(tabId=sid, result=r), pretty=not args.compact)
    return 0


def cmd_cdp(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    params = parse_jsonish(args.params) if args.params else {}
    cmd = {"cmd": "cdp", "tabId": int(sid), "method": args.method, "params": params}
    # Extension WS protocol treats JSON strings with cmd as bridge commands.
    r = unwrap_exec_result(driver.execute_js(json.dumps(cmd, ensure_ascii=False), timeout=args.timeout, session_id=sid))
    print_json(ok(tabId=sid, result=r), pretty=not args.compact)
    return 0


def cmd_screenshot(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    cmd = {"cmd": "cdp", "tabId": int(sid), "method": "Page.captureScreenshot", "params": {"format": args.format}}
    r = unwrap_exec_result(driver.execute_js(json.dumps(cmd), timeout=args.timeout, session_id=sid))
    out = Path(args.out)
    data = r.get("data") if isinstance(r, dict) else None
    if not data:
        print_json(err("NO_SCREENSHOT", "CDP did not return screenshot data", result=r))
        return 3
    out.write_bytes(base64.b64decode(data))
    print_json(ok(tabId=sid, path=str(out.resolve()), bytes=out.stat().st_size))
    return 0


def cmd_ext(args: argparse.Namespace) -> int:
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    obj = parse_jsonish(sys.stdin.read() if args.json == "-" else args.json)
    if isinstance(obj, dict) and obj.get("tabId") is None:
        obj["tabId"] = int(sid)
    r = unwrap_exec_result(driver.execute_js(json.dumps(obj, ensure_ascii=False), timeout=args.timeout, session_id=sid))
    print_json(ok(tabId=sid, result=r), pretty=not args.compact)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="twd", description="TMWebDriver lightweight CLI for local agents")
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help="WS port; HTTP control uses port+1")
    p.add_argument("--compact", action="store_true", help="single-line JSON output")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser, tab: bool = True) -> None:
        if tab:
            sp.add_argument("--tab", type=int, help="Chrome tab id / TMWebDriver session id")
            sp.add_argument("--url-match", help="choose first connected tab whose URL contains this text")
            sp.add_argument("--wait", type=float, default=8.0, help="seconds to wait for a connected tab")
        sp.add_argument("--timeout", type=float, default=15.0, help="JS/CDP timeout seconds")

    sp = sub.add_parser("serve", help="start persistent TMWebDriver master")
    sp.add_argument("--interval", type=float, default=60.0)
    sp.add_argument("--verbose", action="store_true")
    sp.set_defaults(func=cmd_serve)

    sp = sub.add_parser("tabs", help="list connected browser tabs")
    sp.add_argument("--wait", type=float, default=8.0)
    sp.set_defaults(func=cmd_tabs)

    sp = sub.add_parser("eval", help="execute JavaScript in a tab; remember explicit `return` with await")
    common(sp)
    sp.add_argument("script", nargs="?", default="-", help="JS code, '-' for stdin")
    sp.add_argument("--file", "-f", help="read JS code from file")
    sp.set_defaults(func=cmd_eval)

    sp = sub.add_parser("scan", help="dump body text or outerHTML")
    common(sp)
    sp.add_argument("--text", action="store_true", help="return document.body.innerText instead of HTML")
    sp.add_argument("--out", help="write content to file and return path")
    sp.set_defaults(func=cmd_scan)

    sp = sub.add_parser("goto", help="navigate selected tab")
    common(sp)
    sp.add_argument("target", help="URL to open")
    sp.set_defaults(func=cmd_goto)

    sp = sub.add_parser("input", help="set input/textarea value with native setter + events")
    common(sp)
    sp.add_argument("selector")
    sp.add_argument("text", help="text or '-' for stdin")
    sp.add_argument("--contains", help="optional placeholder/label/text substring filter")
    sp.set_defaults(func=cmd_input)

    sp = sub.add_parser("click", help="JS click selected element")
    common(sp)
    sp.add_argument("selector")
    sp.add_argument("--contains", help="optional text/aria-label substring filter")
    sp.set_defaults(func=cmd_click)

    sp = sub.add_parser("cdp", help="call Chrome DevTools Protocol through extension")
    common(sp)
    sp.add_argument("method", help="e.g. Page.captureScreenshot")
    sp.add_argument("params", nargs="?", default="{}", help="JSON params")
    sp.set_defaults(func=cmd_cdp)

    sp = sub.add_parser("screenshot", help="save PNG/JPEG screenshot via CDP")
    common(sp)
    sp.add_argument("out")
    sp.add_argument("--format", choices=["png", "jpeg"], default="png")
    sp.set_defaults(func=cmd_screenshot)

    sp = sub.add_parser("ext", help="send raw extension command JSON: tabs/cookies/cdp/batch/management")
    common(sp)
    sp.add_argument("json", help="JSON object or '-' for stdin")
    sp.set_defaults(func=cmd_ext)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        print_json(err("EXCEPTION", str(e), type=type(e).__name__))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
