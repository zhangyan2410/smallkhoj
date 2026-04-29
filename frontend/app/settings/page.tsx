"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function SettingsPage() {
  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>LLM 配置</CardTitle>
          <CardDescription>后续扩展：对接 OpenAI / Anthropic / 本地模型</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <Input type="password" placeholder="sk-..." disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">API Base URL</label>
            <Input placeholder="https://api.openai.com/v1" disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <Input placeholder="gpt-4o-mini" disabled />
          </div>
          <Button disabled>保存（骨架阶段不可用）</Button>
        </CardContent>
      </Card>
    </main>
  )
}
