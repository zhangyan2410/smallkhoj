import assert from "node:assert/strict"
import test from "node:test"

/**
 * IME（中文/日文等输入法）Enter 拦截逻辑测试。
 *
 * message-composer / channel-client 的 keydown 处理：当 isComposing 为真
 * 或 keyCode===229（IME 仍在组合）时，Enter 不应触发提交。
 *
 * 这里直接测判断逻辑（与组件内联条件一致），不依赖 DOM 渲染。
 */

// 复刻组件里的判断条件
function shouldSubmitOnEnter(event: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  )
}

test("plain Enter (no IME) submits", () => {
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 }),
    true,
  )
})

test("Shift+Enter does not submit (newline)", () => {
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", shiftKey: true, isComposing: false, keyCode: 13 }),
    false,
  )
})

test("Enter while IME composing (isComposing=true) does not submit", () => {
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: true, keyCode: 13 }),
    false,
  )
})

test("Enter with IME keyCode 229 does not submit", () => {
  assert.equal(
    shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 }),
    false,
  )
})

test("non-Enter key does not submit", () => {
  assert.equal(
    shouldSubmitOnEnter({ key: "a", shiftKey: false, isComposing: false, keyCode: 65 }),
    false,
  )
})
