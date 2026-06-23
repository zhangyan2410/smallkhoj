export type AgentStatusBucket = "OFFLINE" | "IDLE" | "STARTING" | "THINKING" | "ACTIVE" | "ERROR"
export type StatusBucket = AgentStatusBucket

export const STATUS_BUCKET_MAP: Record<string, StatusBucket> = {
  offline: "OFFLINE",
  disconnected: "OFFLINE",
  stopped: "OFFLINE",
  idle: "IDLE",
  online: "IDLE",
  ready: "IDLE",
  done: "IDLE",
  fired: "IDLE",
  start: "STARTING",
  starting: "STARTING",
  pending_start: "STARTING",
  loading: "STARTING",
  restarting: "STARTING",
  thinking: "THINKING",
  planning: "THINKING",
  analyzing: "THINKING",
  in_review: "THINKING",
  pending: "THINKING",
  working: "ACTIVE",
  running: "ACTIVE",
  active: "ACTIVE",
  busy: "ACTIVE",
  in_progress: "ACTIVE",
  stopping: "ACTIVE",
  searching: "ACTIVE",
  writing: "ACTIVE",
  summarizing: "ACTIVE",
  failed: "ERROR",
  error: "ERROR",
  crashed: "ERROR",
  cancelled: "ERROR",
  timeout: "ERROR",
}

export const STATUS_LABELS: Record<string, string> = {
  offline: "离线",
  disconnected: "离线",
  stopped: "已停止",
  idle: "待命",
  online: "在线",
  ready: "就绪",
  done: "完成",
  fired: "完成",
  start: "启动中",
  starting: "启动中",
  pending_start: "等待启动",
  loading: "加载中",
  restarting: "重启中",
  thinking: "思考中",
  planning: "规划中",
  analyzing: "分析中",
  in_review: "评审中",
  pending: "等待中",
  working: "执行中",
  running: "运行中",
  active: "活跃",
  busy: "忙碌",
  in_progress: "进行中",
  stopping: "停止中",
  searching: "搜索中",
  writing: "写作中",
  summarizing: "总结中",
  failed: "失败",
  error: "出错",
  crashed: "崩溃",
  cancelled: "已取消",
  timeout: "超时",
}

const BUCKET_DOT_CLASS: Record<StatusBucket, string> = {
  OFFLINE: "bg-slate-400",
  IDLE: "bg-emerald-500",
  STARTING: "bg-orange-400 animate-pulse",
  THINKING: "bg-amber-400 animate-pulse",
  ACTIVE: "bg-indigo-500 animate-[pulse_0.8s_ease-in-out_infinite]",
  ERROR: "bg-red-500",
}

function normalizeStatus(status?: string | null): string {
  return (status || "").toLowerCase()
}

export function getStatusBucket(status?: string | null): StatusBucket {
  return STATUS_BUCKET_MAP[normalizeStatus(status)] ?? "OFFLINE"
}

export function getStatusLabel(status?: string | null): string {
  if (!status) return "离线"
  return STATUS_LABELS[normalizeStatus(status)] ?? status
}

export function statusDotClass(status?: string | null): string {
  return BUCKET_DOT_CLASS[getStatusBucket(status)]
}
