"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">SmallKhoj</h1>
          <p className="text-muted-foreground">基于 Khoj 架构的轻量 AI 聊天框架</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Chat</CardTitle>
              <CardDescription>WebSocket 实时聊天</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/chat">
                <Button className="w-full">开始聊天</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>框架配置</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/settings">
                <Button variant="outline" className="w-full">打开设置</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <p>后端: FastAPI + SQLAlchemy | 前端: Next.js + shadcn/ui</p>
          <p>
            <a href="http://localhost:8000/docs" className="underline" target="_blank">
              API 文档 (Swagger)
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}
