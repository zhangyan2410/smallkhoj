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

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None  # type: ignore

try:
    from act_assets import (
        OPT_HTML_JS,
        INJECT_HELPERS_JS,
        snap_js as _snap_js,
        start_monitor_js as _start_monitor_js,
        drain_monitor_js as _drain_monitor_js,
    )
except Exception:  # pragma: no cover
    OPT_HTML_JS = INJECT_HELPERS_JS = None  # type: ignore
    _snap_js = _start_monitor_js = _drain_monitor_js = None  # type: ignore

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


# ------------------------------------------------------------------ act / snapshot
#
# 借鉴 GenericAgent/simphtml 的 find_changed_elements 算法：用 BeautifulSoup
# 比较前后两份 outerHTML，定位被新增/修改/删除的节点，并打上 <change ...> 提示。
# optHTML / temp_monitor 通过 act_assets 注入，浏览器侧可直接运行。

CHANGE_KIND_VALUES = ("new", "removed", "modified")


def _direct_text(el) -> str:
    return "".join(t.strip() for t in el.find_all(string=True, recursive=False)).strip()


def _sig(el) -> tuple:
    attrs = {k: v for k, v in el.attrs.items() if k not in ("id",) or not str(v).startswith("_ljq")}
    return (el.name, el.name == "input" and (el.get("type") or ""), _direct_text(el)[:80], len(el.contents), str(attrs)[:200])


def _wrap(soup, el, kind: str, sig: tuple) -> None:
    """Insert a <change> marker right after the el so we don't disturb the DOM tree."""
    hint = soup.new_tag("change")
    hint["kind"] = kind
    snippet = str(el)
    if len(snippet) > 200:
        snippet = snippet[:200] + "..."
    hint["snippet"] = snippet
    el.insert_after(hint)


def find_changed_elements(before_html: str, after_html: str) -> dict:
    """Faithful port of GenericAgent/simphtml.find_changed_elements.

    Returns ``{"changed": N, "top_change": "..."|None}``.
    """
    if BeautifulSoup is None:
        return {"changed": 0, "top_change": None, "error": "BeautifulSoup not installed"}
    before_soup = BeautifulSoup(before_html or "", "html.parser")
    after_soup = BeautifulSoup(after_html or "", "html.parser")

    def direct_text(el):
        return "".join(t.strip() for t in el.find_all(string=True, recursive=False)).strip()

    def get_sig(el):
        attrs = {k: v for k, v in el.attrs.items() if k != "data-track-id"}
        return f"{el.name}:{attrs}:{direct_text(el)}"

    def build_sigs(soup):
        out = {}
        for el in soup.find_all(True):
            sig = get_sig(el)
            out.setdefault(sig, []).append(el)
        return out

    before_sigs = build_sigs(before_soup)
    after_sigs = build_sigs(after_soup)
    changed = []
    for sig, els in after_sigs.items():
        if sig not in before_sigs:
            changed.extend(els)
        elif len(els) > len(before_sigs[sig]):
            changed.extend(els[: len(els) - len(before_sigs[sig])])

    if len(changed) == 0 and str(before_soup) != str(after_soup):
        b_els = before_soup.find_all(True)
        a_els = after_soup.find_all(True)
        for i in range(min(len(b_els), len(a_els))):
            if get_sig(b_els[i]) != get_sig(a_els[i]):
                changed.append(a_els[i])

    cids = set(id(el) for el in changed)
    boundaries = [el for el in changed if el.parent is None or id(el.parent) not in cids]
    top = max(boundaries, key=lambda el: len(str(el))) if boundaries else None
    result = {"changed": len(changed)}
    if top:
        h = str(top)
        result["top_change"] = h if len(h) <= 2000 else h[:2000] + "...[TRUNCATED]"
    return result


def _ensure_helpers(driver, sid: str, timeout: float) -> None:
    """Inject optHTML + _ga_* helpers into the page if not already present."""
    raw = unwrap_exec_result(driver.execute_js("return typeof window._ga_snap === 'function';", timeout=timeout, session_id=sid))
    if raw is True:
        return
    if OPT_HTML_JS is None or INJECT_HELPERS_JS is None:
        raise RuntimeError("act_assets missing OPT_HTML_JS / INJECT_HELPERS_JS")
    # Bundled: define optHTML(), then attach window._ga_snap / _ga_start / _ga_drain.
    js = OPT_HTML_JS + "\n" + INJECT_HELPERS_JS
    unwrap_exec_result(driver.execute_js(js, timeout=timeout, session_id=sid))


def _take_snapshot(driver, sid: str, text_only: bool, timeout: float) -> str:
    _ensure_helpers(driver, sid, timeout)
    raw = unwrap_exec_result(driver.execute_js(_snap_js(text_only), timeout=timeout, session_id=sid))
    return str(raw) if raw is not None else ""


def _start_monitor(driver, sid: str, monitor_seconds: float, timeout: float) -> dict:
    _ensure_helpers(driver, sid, timeout)
    # sample ~6-12 times over the action window so we don't miss short-lived text
    interval = max(80, int(monitor_seconds * 1000 / 8)) if monitor_seconds > 0 else 450
    r = unwrap_exec_result(driver.execute_js(_start_monitor_js(interval), timeout=timeout, session_id=sid))
    return r if r is not None else True


def _drain_monitor(driver, sid: str, timeout: float) -> dict:
    _ensure_helpers(driver, sid, timeout)
    r = unwrap_exec_result(driver.execute_js(_drain_monitor_js(), timeout=timeout, session_id=sid))
    return r if isinstance(r, dict) else {"transients": []}


def cmd_snapshot(args: argparse.Namespace) -> int:
    """Take an optHTML snapshot of the current tab. Default = text-only optimized HTML."""
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    try:
        html = _take_snapshot(driver, sid, text_only=not args.html, timeout=args.timeout)
    except Exception as e:
        print_json(err("SNAPSHOT_FAIL", str(e)))
        return 3
    if args.out:
        Path(args.out).write_text(html, encoding="utf-8")
        print_json(ok(tabId=sid, path=str(Path(args.out).resolve()), chars=len(html), mode=("html" if args.html else "text")))
        return 0
    print_json(ok(tabId=sid, snapshot=html, chars=len(html), mode=("html" if args.html else "text")), pretty=not args.compact)
    return 0


def cmd_act(args: argparse.Namespace) -> int:
    """Execute arbitrary JS in the tab, with before/after snapshot + transients + change diff.

    Returns {ok, result, before_chars, after_chars, change_count, transients, changes}.
    """
    driver = make_driver(args)
    sid = choose_session(driver, args)
    if not sid:
        print_json(err("NO_TAB", "No browser tab connected."))
        return 2
    if OPT_HTML_JS is None or INJECT_HELPERS_JS is None:
        print_json(err("ASSETS_MISSING", "act_assets.py is not importable in this Python environment."))
        return 4

    script = load_script(args)
    monitor_seconds = max(0.0, float(args.monitor))

    # 1) start transient monitor (text additions during the action)
    monitor_meta: dict = {}
    if monitor_seconds > 0:
        try:
            monitor_meta = _start_monitor(driver, sid, monitor_seconds, timeout=min(args.timeout, 10.0))
        except Exception as e:
            monitor_meta = {"error": str(e)}

    # 2) before snapshot (always text mode for diff stability)
    before_html = _take_snapshot(driver, sid, text_only=True, timeout=args.timeout)

    # 3) execute the user action
    action_error: str | None = None
    result: Any = None
    try:
        result = unwrap_exec_result(driver.execute_js(script, timeout=args.timeout, session_id=sid))
    except Exception as e:
        action_error = str(e)

    # Give the page a moment to settle (animations, network for post-action hooks)
    settle = max(0.0, float(args.settle))
    if settle:
        time.sleep(settle)

    # 4) after snapshot
    after_html = _take_snapshot(driver, sid, text_only=True, timeout=args.timeout)

    # 4b) optional cleanup (DOM hygiene) - run as JS, does not affect before/after snapshots
    if args.cleanup_after:
        try:
            _js = (
                "(function(sel){"
                "try{var n=document.querySelectorAll(sel);n.forEach(function(e){e.remove();});"
                "return n.length;}catch(e){return -1;}"
                "})(arguments[0])"
            )
            unwrap_exec_result(driver.execute_js(_js, timeout=min(args.timeout, 5.0), session_id=sid, args=[args.cleanup_after]))
        except Exception:
            pass

    # 5) drain monitor (collects transients like "New chat", toast strings)
    transients: list[str] = []
    if monitor_seconds > 0 and action_error is None:
        try:
            payload = _drain_monitor(driver, sid, timeout=min(args.timeout, 10.0))
            transients = list((payload or {}).get("transients", []))
        except Exception as e:
            transients = [f"<drain error: {e}>"]

    # 6) diff
    diff = find_changed_elements(before_html, after_html)

    summary = f"changed={diff.get('changed', 0)} transients={len(transients)}"
    if diff.get("changed", 0) == 0 and not transients and action_error is None:
        summary += " (page no change)"

    payload: dict[str, Any] = {
        "tabId": sid,
        "ok": action_error is None,
        "summary": summary,
        "result": result,
        "action_error": action_error,
        "before_chars": len(before_html),
        "after_chars": len(after_html),
        "changed": diff.get("changed", 0),
        "top_change": diff.get("top_change"),
        "after_html_preview": (diff.get("after_html") or after_html)[: args.preview_chars],
        "transients": transients[: args.max_transients],
        "monitor_meta": monitor_meta,
    }
    if args.save_after:
        Path(args.save_after).write_text(diff.get("after_html") or after_html, encoding="utf-8")
        payload["after_path"] = str(Path(args.save_after).resolve())
    if args.save_before:
        Path(args.save_before).write_text(before_html, encoding="utf-8")
        payload["before_path"] = str(Path(args.save_before).resolve())
    print_json(ok(**payload), pretty=not args.compact)
    return 0 if action_error is None else 5


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

    sp = sub.add_parser("snapshot", help="return an optimized (text-only or HTML) snapshot of the tab")
    common(sp)
    sp.add_argument("--html", action="store_true", help="return HTML instead of text-only mode")
    sp.add_argument("--out", help="write snapshot to file and return path")
    sp.set_defaults(func=cmd_snapshot)

    sp = sub.add_parser("act", help="run JS in the tab, capture before/after snapshot + diff + transients")
    common(sp)
    sp.add_argument("script", nargs="?", default="-", help="JS code, '-' for stdin")
    sp.add_argument("--file", "-f", help="read JS from file")
    sp.add_argument("--monitor", type=float, default=1.2, help="transient text monitor seconds (0 = off)")
    sp.add_argument("--settle", type=float, default=0.4, help="seconds to wait between action and after-snapshot")
    sp.add_argument("--max-changes", type=int, default=20)
    sp.add_argument("--max-transients", type=int, default=20)
    sp.add_argument("--preview-chars", type=int, default=400)
    sp.add_argument("--save-after", help="write annotated after_html to this file")
    sp.add_argument("--save-before", help="write before snapshot to this file")
    sp.add_argument("--cleanup-after", help="CSS selector to remove after action (DOM hygiene)")
    sp.set_defaults(func=cmd_act)
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
