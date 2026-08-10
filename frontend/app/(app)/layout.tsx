import type { ReactNode } from "react"

import { AppDeskBackground } from "@/components/inkframe/app-desk-background"
import { InkMaterialRuntimeScript } from "@/components/inkframe/ink-material-engine"
import { AppRail } from "@/components/app-rail"
import { ActivityUnreadTracker } from "@/components/activity-unread-tracker"
import { BackgroundNotificationTracker } from "@/components/background-notification-tracker"
import { RealtimeProvider } from "@/components/realtime-provider"
import { requireCurrentAccount } from "@/lib/server-auth"

/**
 * 已登录应用的外壳 layout（Next 路由组，URL 不变）。
 *
 * 把原本每页 ProductShell 各自挂载的「稳定 chrome」上移到这里，整个会话只挂载一次：
 * - InkMaterialRuntimeScript + AppDeskBackground（水墨背景层，static 模式零 WebGL 开销）
 * - AppRail（左侧图标导航，active 从 usePathname 派生）
 *
 * 这样切页时外壳不再拆掉重建，消除「加载工作台」的视觉闪。
 * requireCurrentAccount() 在此统一做 auth gate：未登录跳 /login。
 *
 * login / join/[token] 等公开路由不在本路由组内，不受此 layout 影响。
 *
 * 各页面仍渲染自己的 <ProductShell>（已瘦身为 body-only：header + 三栏 body），
 * 负责自己的 title / sidebar / list 等内容区。
 */
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const session = await requireCurrentAccount()
  // 当前账号的 member 标识：tracker 用它排除「自己发的消息」未读。
  // 名字集合用于兼容旧事件的 message.sender 文本匹配；id 用于真实事件
  // 载荷的扁平 senderId/actorId 匹配（旧写法从未命中，自己消息会计未读）。
  const currentMemberNames = session?.member
    ? [session.member.name, session.member.displayName, session.member.handle].filter(
        (n): n is string => Boolean(n)
      )
    : undefined
  const currentMemberIds = session?.member?.id ? [session.member.id] : undefined
  return (
    <RealtimeProvider serverId={session?.server.id}>
      {/* 全局未读活动 tracker（无 UI）：订阅复用同一条 SSE，事件→未读键映射写入统一存储。 */}
      <ActivityUnreadTracker currentMemberNames={currentMemberNames} currentMemberIds={currentMemberIds} />
      {/* 后台系统通知 tracker（无 UI）：同一条 SSE 订阅，权限授予且页面不在前台对应路由时弹通知。 */}
      <BackgroundNotificationTracker currentMemberIds={currentMemberIds} />
      <main
        data-slot="workbench-desk"
        data-inkframe-background-owner="product-shell"
        data-inkframe-background-scope="global-desk"
        className="sk-workbench-desk relative isolate h-screen w-full overflow-hidden text-foreground"
      >
        <InkMaterialRuntimeScript />
        <AppDeskBackground />
        {/* Col 0 — icon rail：fixed 钉死在视口左侧，不随任何滚动离开位置。 */}
        <AppRail session={session} />
        {/* 主内容区—— 留出 rail 宽度 (w-14 = 56px)，自身占满 h-screen。
            子栏的滚动由各页 ProductShellBody 内部按列独立控制。 */}
        <div className="relative z-10 flex h-screen min-w-0 flex-col sm:ml-14">
          {children}
        </div>
      </main>
    </RealtimeProvider>
  )
}
