# aaa-daemon

Minimal Slock Daemon prototype - 基于对 Slock Daemon v0.54.0 架构分析的最小化复现。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    aaa-daemon v0.1.0                         │
│                                                             │
│  CLI入口(index.ts)  ─┬─  3个CLI命令 (commander)              │
│                      │                                       │
│  DaemonCore         ───  管理模块生命周期                     │
│                      │   - WebSocket 连接                     │
│                      │   - 消息 inbox 管理 & 去重             │
│                      │   - 进程信号处理                        │
│                      │                                       │
│  Agent Proxy        ───  HTTP 代理服务器 (动态端口)           │
│                      │   - 嵌入 agent token 转发请求           │
│                      │   - freshness check (消息同步检测)      │
│                      │                                       │
│  Chat Bridge        ───  MCP stdio 服务器                    │
│                      │   - 工具调用处理                        │
│                      │   - JSON-RPC 2.0 协议                 │
│                                                             │
│  WebSocket Manager  ───  WebSocket 客户端                    │
│                      │   - 自动重连                           │
│                      │   - 心跳保持                           │
└─────────────────────────────────────────────────────────────┘
```

## 文件结构

```
aaa-daemon/
├── src/
│   ├── index.ts          # CLI 入口
│   ├── daemon.ts         # DaemonCore - 主控制器
│   ├── websocket.ts      # WebSocket 连接管理
│   ├── mcp-bridge.ts     # MCP stdio 桥接
│   ├── proxy.ts          # HTTP 代理 + token 注入
│   └── types.ts          # 共享类型定义
├── package.json
├── tsconfig.json
└── README.md
```

## 安装

```bash
npm install
npm run build
```

## 使用

### 启动 Daemon

```bash
# 基本启动
npm run daemon

# 自定义配置
npm run daemon -- --server https://api.slock.io --ws wss://ws.slock.io --proxy-port 3456

# 指定 credential
npm run daemon -- --credential ./my-credential.json
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `daemon` | 启动守护程序 |
| `send` | 发送消息（演示） |
| `status` | 检查状态 |

## 已实现的关键机制

1. **WebSocket 连接管理**
   - 自动重连（5秒间隔）
   - Token 认证头注入
   - 消息事件分发

2. **HTTP 代理**
   - 动态端口监听
   - Agent Token 自动注入
   - Freshness check 头管理
   - 双向数据流转发

3. **MCP stdio 桥接**
   - JSON-RPC 2.0 协议
   - 工具调用处理（send_message, check_messages, read_history）
   - 异步请求/响应匹配

4. **Inbox 管理**
   - 消息去重（基于 message id）
   - 未读消息追踪
   - 序列号递增

## 与原版对比

| 特性 | Slock Daemon v0.54.0 | aaa-daemon (prototype) |
|------|----------------------|------------------------|
| CLI 命令 | 34 个 | 3 个 (demo) |
| WebSocket | 完整实现 | 基础实现 |
| MCP Bridge | 完整实现 | 基础实现 |
| HTTP Proxy | 完整实现 | 基础实现 |
| Agent 进程管理 | spawn/kill | 未实现 |
| machineLock | 有 | 未实现 |
| 多 Agent 支持 | 有 | 未实现 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SLOCK_AGENT_ID` | Agent ID | prototype-agent |
| `SLOCK_SERVER_URL` | 服务器地址 | https://api.slock.io |
| `SLOCK_WS_URL` | WebSocket 地址 | wss://ws.slock.io |

## 协议参考

### 消息格式 (RFC 5424 风格)
```
[target=#channel msg=shortid time=iso8601 type=agent] @sender: content
```

### MCP 请求格式
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "send_message",
  "params": {
    "target": "#all",
    "content": "hello"
  }
}
```

### Freshness Check
代理自动在请求头中添加 `X-Freshness-Seq`，服务端返回 `X-Freshness-Hold` 时触发同步等待。

## 许可证

MIT
