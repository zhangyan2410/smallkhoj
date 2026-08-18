# 孤儿 Daemon 识别与安全清理指引

> 适用场景：同一台 computer 出现多个 daemon 进程（消息重复投递、一条回复
> 多条、runtime 多开）。成因与强制机制见任务
> `08-16-single-active-daemon-lease`（后端已实现单活跃租约：新实例 WS 注册
> 即接管，旧连接收到 `lease.revoked` 消息并以 close code `4001` 断开，
> daemon 停止自身 runtimes 后退出）。

## 1. 识别（谁在同一台机器上重复跑）

```bash
# 全部 daemon 进程（注意 PPID：launchd 托管残留的 parent 通常是 1）
ps -axo pid,ppid,lstart,command | grep -E "aaa-daemon|smallkhoj.*daemon" | grep -v grep

# 每个进程用的 machine 凭证（确认是否指向同一 computer）
lsof -p <PID> | grep -E "\.smallkhoj|credential" 
```

判定标准：

- **同凭证多进程** = 单活跃租约场景；后端已强制只剩一个，多余实例会自行
  退出。若仍在重复投递，先升级 daemon 到包含 lease.revoked 处理的版本。
- **PPID=1 且启动时间在凭证改写之后** = 托管拉起的孤儿（2026-08-16 事故
  形态：supervisor 在全局 credential 被改写后连续 spawn）。
- **测试残留**：隔离目录里的新旧两代隔离 daemon，与生产实例同 computer。

## 2. 安全清理顺序

1. 先停托管源（否则 kill 后会被重新拉起）：
   ```bash
   launchctl list | grep -i smallkhoj        # 找到 label
   launchctl bootout gui/$(id -u)/<label>    # macOS；其它系统用对应 service manager
   ```
2. 逐个终止进程（先旧后新，最后留一个）：
   ```bash
   kill <PID>          # 优雅退出（daemon 会停 runtime、删 pid 文件）
   # 10s 后仍存活再 kill -9
   ```
3. 校验只剩一个实例、且它持有租约：
   - 服务端：`GET /api/v1/computers` 看 `activeDaemonId`；
   - 现象：发一条 DM 消息应只收到一条回复。
4. 清掉孤儿的全局凭证目录（仅确认废弃的实例）：
   `~/.smallkhoj/` 下对应 machine 的 credential——删除前确认活跃实例不使用它。

## 3. 预防

- 每台 computer 只保留一个受管的 daemon 安装（aura install root 唯一）。
- 凭证改写/重置流程结束后，重启 supervisor 前先确认旧进程全部退出。
- daemon 收到 `lease.revoked`（或 close 4001）会直接退出且**不重连**——
  两个受管实例互抢会形成接管循环；发现循环按本指引清理多余安装。
