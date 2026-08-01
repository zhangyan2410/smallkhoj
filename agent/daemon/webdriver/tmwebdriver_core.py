import json, threading, time, uuid, queue, socket, requests, traceback, sys
from typing import Any
from simple_websocket_server import WebSocketServer, WebSocket
import bottle
from bottle import request


class TMWebDriverError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ExecutionTimeoutError(TMWebDriverError):
    def __init__(self, message: str):
        super().__init__('EXECUTION_TIMEOUT', message)


class ExecutionInterruptedError(TMWebDriverError):
    def __init__(self, message: str):
        super().__init__('EXECUTION_INTERRUPTED', message)

class Session:
    def __init__(self, session_id, info, client=None):
        self.id = session_id
        self.info = info
        self.connect_at = time.time()
        self.disconnect_at = None
        self.type = info.get('type', 'ws')
        self.ws_client = client if self.type in ('ws', 'ext_ws') else None
        self.http_queue = client if self.type == 'http' else None
    @property
    def url(self): return self.info.get('url', '')
    def is_active(self):
        if self.type == 'http' and time.time() - self.connect_at > 60: self.mark_disconnected()
        return self.disconnect_at is None
    def reconnect(self, client, info):
        self.info = info
        self.type = info.get('type', 'ws')
        if self.type in ('ws', 'ext_ws'):
            self.ws_client = client
            self.http_queue = None
        elif self.type == 'http':
            self.http_queue = client
        self.connect_at = time.time()
        self.disconnect_at = None
    def mark_disconnected(self):
        if self.is_active(): print(f"Tab disconnected: {self.url} (Session: {self.id})", file=sys.stderr)
        self.disconnect_at = time.time()


def should_disconnect_ext_session(session, current_tab_ids, client) -> bool:
    return (
        session.type == 'ext_ws'
        and session.ws_client == client
        and session.id not in current_tab_ids
    )


def ext_tab_session_info(tab) -> dict:
    session_info = {'url': tab.get('url'), 'title': tab.get('title', ''), 'connected_at': time.time(), 'type': 'ext_ws'}
    for key in ('active', 'windowId'):
        if key in tab:
            session_info[key] = tab.get(key)
    return session_info


def upsert_ext_tab_session(driver, tab, client) -> None:
    session_id = str(tab['id'])
    session_info = ext_tab_session_info(tab)
    sess = driver.sessions.get(session_id)
    if sess and sess.is_active() and sess.ws_client == client:
        sess.info = session_info
    else:
        driver._register_client(session_id, client, session_info)


class TMWebDriver:
    def __init__(self, host: str = '127.0.0.1', port: int = 18765, token: str | None = None):
        self.host, self.port = host, port
        self.token = token
        self.sessions, self.results, self.acks = {}, {}, {}
        self.pending = set()
        self.default_session_id = None
        self.latest_session_id = None
        with socket.socket() as probe_socket:
            self.is_remote = probe_socket.connect_ex((host, port+1)) == 0
        if not self.is_remote:
            self.start_ws_server()
            self.start_http_server()
        else:
            self.remote = f'http://{self.host}:{self.port+1}/link'

    def _check_token(self):
        """Validate token from Authorization header or X-TWD-Token header."""
        if not self.token:
            return True
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer ') and auth[7:] == self.token:
            return True
        if request.headers.get('X-TWD-Token') == self.token:
            return True
        return False

    def _token_error(self):
        bottle.response.status = 401
        return json.dumps({'ok': False, 'code': 'UNAUTHORIZED', 'message': 'Invalid or missing token'})


    def start_http_server(self):
        self.app = app = bottle.Bottle()

        @app.route('/api/longpoll', method=['GET', 'POST'])
        def long_poll():
            if not self._check_token():
                return self._token_error()
            data = request.json
            session_id = data.get('sessionId')
            session_info = {'url': data.get('url'), 'title': data.get('title', ''), 'type': 'http'}
            if session_id not in self.sessions:
                session = Session(session_id, session_info, queue.Queue())
                print(f"Browser http connected: {session.url} (Session: {session_id})", file=sys.stderr)
                self.sessions[session_id] = session
            session = self.sessions[session_id]
            if session.disconnect_at is not None and session.type != 'http': session.reconnect(queue.Queue(), session_info)
            session.disconnect_at = None
            if session.type == 'http': msgQ = session.http_queue
            else: return json.dumps({"id": "", "ret": "use ws"})
            session.connect_at = start_time = time.time()
            while time.time() - start_time < 5:
                try:
                    msg = msgQ.get(timeout=0.2)
                    try: self._record_ack(json.loads(msg).get('id',''))
                    except Exception: traceback.print_exc()
                    return msg
                except queue.Empty: continue
            return json.dumps({"id": "", "ret": "next long-poll"})

        @app.route('/api/result', method=['GET','POST'])
        def result():
            if not self._check_token():
                return self._token_error()
            data = request.json
            if data.get('type') == 'result':
                self._record_result(data.get('id'), success=True, data=data.get('result'), new_tabs=data.get('newTabs', []))
            elif data.get('type') == 'error':
                self._record_result(data.get('id'), success=False, data=data.get('error'), new_tabs=data.get('newTabs', []))
            return 'ok'

        @app.route('/link', method=['GET','POST'])
        def link():
            if not self._check_token():
                return self._token_error()
            data = request.json
            if data.get('cmd') == 'get_all_sessions': return json.dumps({'r': self.get_all_sessions()}, ensure_ascii=False)
            if data.get('cmd') == 'find_session':
                url_pattern = data.get('url_pattern', '')
                return json.dumps({'r': self.find_session(url_pattern)}, ensure_ascii=False)
            if data.get('cmd') == 'execute_js':
                session_id = data.get('sessionId')
                code = data.get('code')
                timeout = float(data.get('timeout', 10.0))
                try:
                    result = self.execute_js(code, timeout=timeout, session_id=session_id)
                    print('[remote result]', (str(code)[:50] + ' RESULT:' +str(result)[:50]).replace('\n', ' '), file=sys.stderr)
                    return json.dumps({'r': result}, ensure_ascii=False)
                except Exception as e:
                    return json.dumps({'r': {'error': str(e), 'code': getattr(e, 'code', 'EXECUTION_FAILED')}}, ensure_ascii=False)
            return 'ok'
        def run():
            from wsgiref.simple_server import make_server, WSGIServer, WSGIRequestHandler
            from socketserver import ThreadingMixIn
            class _T(ThreadingMixIn, WSGIServer): pass
            class _H(WSGIRequestHandler):
                def log_request(self, *a): pass
            make_server(self.host, self.port+1, app, server_class=_T, handler_class=_H).serve_forever()
        http_thread = threading.Thread(target=run, daemon=True)
        http_thread.start()

    def clean_sessions(self):
        sids = list(self.sessions.keys())
        for sid in sids:
            session = self.sessions[sid]
            if not session.is_active() and time.time() - session.disconnect_at > 600:
                del self.sessions[sid]

    def start_ws_server(self) -> None:
        driver = self
        class JSExecutor(WebSocket):
            def handle(self) -> None:
                try:
                    data = json.loads(self.data)
                    if data.get('type') == 'ready':
                        session_id = data.get('sessionId')
                        session_info = {'url': data.get('url'), 'title': data.get('title', ''),
                            'connected_at': time.time(), 'type': 'ws'}
                        driver._register_client(session_id, self, session_info)
                    elif data.get('type') in ['ext_ready', 'tabs_update']:
                        tabs = data.get('tabs', [])
                        current_tab_ids = {str(tab['id']) for tab in tabs}
                        print(f"Received tabs update: {current_tab_ids}", file=sys.stderr)
                        for sid in list(driver.sessions.keys()):
                            sess = driver.sessions[sid]
                            if should_disconnect_ext_session(sess, current_tab_ids, self):
                                sess.mark_disconnected()
                        for tab in tabs:
                            upsert_ext_tab_session(driver, tab, self)
                    elif data.get('type') == 'ack': driver._record_ack(data.get('id',''))
                    elif data.get('type') == 'result':
                        driver._record_result(data.get('id'), success=True, data=data.get('result'), new_tabs=data.get('newTabs', []))
                    elif data.get('type') == 'error':
                        driver._record_result(data.get('id'), success=False, data=data.get('error'), new_tabs=data.get('newTabs', []))
                except Exception as e:
                    print(f"Error handling message: {e}", file=sys.stderr)
                    if hasattr(self, 'data'): print(self.data, file=sys.stderr)
            def connected(self): (f"New connection from {self.address}")
            def handle_close(self):
                print(f"WS Connection closed: {self.address}", file=sys.stderr)
                driver._unregister_client(self)

        self.server = WebSocketServer(self.host, self.port, JSExecutor)
        server_thread = threading.Thread(target=self.server.serve_forever)
        server_thread.daemon = True
        server_thread.start()
        print(f"WebSocket server running on ws://{self.host}:{self.port}", file=sys.stderr)

    def _register_client(self, session_id: str, client: WebSocket, session_info) -> None:
        is_new_session = session_id not in self.sessions

        if is_new_session:
            session = Session(session_id, session_info, client)
            self.sessions[session_id] = session
            print(f"New tab connected: {session.url} (Session: {session_id})", file=sys.stderr)
        else:
            session = self.sessions[session_id]
            session.reconnect(client, session_info)
            print(f"Tab reconnected: {session.url} (Session: {session_id})", file=sys.stderr)

        self.latest_session_id = session_id
        if self.default_session_id is None: self.default_session_id = session_id

    def _unregister_client(self, client: WebSocket) -> None:
        for session in self.sessions.values():
            if session.ws_client == client: session.mark_disconnected()

    def _record_ack(self, exec_id: str) -> bool:
        if not exec_id or exec_id not in self.pending:
            return False
        self.acks[exec_id] = True
        return True

    def _record_result(self, exec_id: str, *, success: bool, data: Any, new_tabs=None) -> bool:
        if not exec_id or exec_id not in self.pending:
            return False
        self.results[exec_id] = {
            'success': success,
            'data': data,
            'newTabs': new_tabs or [],
        }
        return True

    def execute_js(self, code, timeout=15, session_id=None) -> Any:
        explicit_session_id = session_id is not None
        if session_id is None: session_id = self.default_session_id
        if self.is_remote:
            response = self._remote_cmd({"cmd": "execute_js", "sessionId": session_id,
                                         "code": code, "timeout": str(timeout)}).get('r', {})
            if response.get('error'):
                raise TMWebDriverError(response.get('code', 'EXECUTION_FAILED'), response['error'])
            return response

        session = self.sessions.get(session_id)
        if not session or not session.is_active():
            time.sleep(3)
            session = self.sessions.get(session_id)
            if not session or not session.is_active():
                if explicit_session_id:
                    raise ValueError(f"会话ID {session_id} 未连接")
                alive_sessions = [s for s in self.sessions.values() if s.is_active()]
                if alive_sessions:
                    session = alive_sessions[0]
                    print(f"会话 {session_id} 未连接，自动切换到最新活动会话: {session.id}")
                    session_id = self.default_session_id = session.id
                if not session or not session.is_active():
                    raise ValueError(f"会话ID {session_id} 未连接")

        tp = session.type
        if tp not in ('ws', 'http', 'ext_ws'):
            raise ValueError(f"Unsupported session type: {tp}")
        exec_id = str(uuid.uuid4())
        payload_dict = {'id': exec_id, 'code': code}
        if tp == 'ext_ws': payload_dict['tabId'] = int(session.id)
        payload = json.dumps(payload_dict)
        self.pending.add(exec_id)
        try:
            if tp in ['ws', 'ext_ws']:
                session.ws_client.send_message(payload)
            elif tp == 'http':
                session.http_queue.put(payload)

            start_time = time.time()
            self.clean_sessions()
            hasjump = acked = False

            while exec_id not in self.results:
                time.sleep(0.2)
                if not acked and exec_id in self.acks:
                    acked = True
                    start_time = time.time()
                if tp in ['ws', 'ext_ws']:
                    if not session.is_active():
                        hasjump = True
                    if hasjump and session.is_active():
                        raise ExecutionInterruptedError(f"Session {session_id} reloaded before the script returned a result")
                if time.time() - start_time > timeout:
                    if hasjump:
                        raise ExecutionInterruptedError(f"Session {session_id} reloaded and the new page did not return a result")
                    if acked:
                        raise ExecutionTimeoutError(
                            f"Session {session_id} delivered the script but returned no result within {timeout}s"
                        )
                    raise ExecutionTimeoutError(
                        f"Session {session_id} did not acknowledge the script; it was not delivered within {timeout}s"
                    )

            result = self.results.pop(exec_id)
            if not result['success']:
                raise TMWebDriverError('EXECUTION_FAILED', str(result['data']))
            rr = {'data': result['data']}
            newtabs = result.get('newTabs', [])
            [x.pop('ts', None) for x in newtabs]
            if newtabs:
                rr['newTabs'] = newtabs
            return rr
        finally:
            self.pending.discard(exec_id)
            self.acks.pop(exec_id, None)
            self.results.pop(exec_id, None)

    def _remote_cmd(self, cmd):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try: return requests.post(self.remote, headers=headers, json=cmd, timeout=30).json()
        except (ConnectionError, requests.exceptions.ConnectionError):
            raise ConnectionError("TMWebDriver master未运行，看tmwebdriver_sop启动master")

    def get_all_sessions(self):
        if self.is_remote:
            return self._remote_cmd({"cmd": "get_all_sessions"}).get('r', [])
        return [{'id': session.id, **session.info} for session in self.sessions.values()
                if session.is_active()]

    def get_session_dict(self):
        return {session['id']: session['url'] for session in self.get_all_sessions()}

    def find_session(self, url_pattern: str):
        if url_pattern == '':
            session = self.sessions.get(self.latest_session_id)
            return [(session.id, session.info)] if session else []
        matching_sessions = []
        for session in self.sessions.values():
            if not session.is_active(): continue
            if 'url' in session.info and url_pattern in session.info['url']:
                matching_sessions.append((session.id, session.info))
        return matching_sessions

    def set_session(self, url_pattern: str) -> bool:
        if self.is_remote:
            matched = self._remote_cmd({"cmd": "find_session", "url_pattern": url_pattern}).get('r', [])
        else:
            matched = self.find_session(url_pattern)
        if not matched: return print(f"警告: 未找到URL包含 '{url_pattern}' 的会话")
        if len(matched) > 1: print(f"警告: 找到多个URL包含 '{url_pattern}' 的会话，选择第一个")
        self.default_session_id, info = matched[0]
        print(f"成功设置默认会话: {self.default_session_id}: {info['url']}")
        return self.default_session_id

    def jump(self, url, timeout=10): self.execute_js(f"window.location.href='{url}'", timeout=timeout)

if __name__ == "__main__":
    driver = TMWebDriver(host='127.0.0.1', port=18765)
