/**
 * Browser-side helper for Slock DM send tests.
 *
 * This module intentionally contains no GA-specific bridge calls.  The exported
 * string/function can be passed to any future browser bridge (GA runcode today,
 * standalone bridge later) and returns a small structured result.
 */

export function browserSendSlockMessageSource() {
  return String.raw`async function sendSlockMessageFromBrowser(options) {
    const text = String(options?.text ?? '');
    if (!text.trim()) throw new Error('Missing message text');

    const placeholderIncludes = options?.placeholderIncludes ?? '@deepseek';
    const textareaSelector = options?.textareaSelector ?? 'textarea';
    const sendButtonSelector = options?.sendButtonSelector ?? 'button[aria-label="Send"]';
    const settleMs = Number(options?.settleMs ?? 120);

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textareas = Array.from(document.querySelectorAll(textareaSelector));
    const textarea = textareas.find((el) => {
      const placeholder = el.getAttribute('placeholder') || '';
      const aria = el.getAttribute('aria-label') || '';
      return placeholder.includes(placeholderIncludes) || aria.includes(placeholderIncludes);
    }) || textareas.find((el) => !el.disabled && el.offsetParent !== null);

    if (!textarea) {
      throw new Error(`Slock textarea not found (selector=${textareaSelector}, placeholderIncludes=${placeholderIncludes})`);
    }

    textarea.focus();
    const proto = Object.getPrototypeOf(textarea);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) throw new Error('Native textarea.value setter not found');
    setter.call(textarea, text);
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(settleMs);

    const sendButton = document.querySelector(sendButtonSelector);
    if (!sendButton) throw new Error(`Slock Send button not found (${sendButtonSelector})`);
    if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
      throw new Error('Slock Send button is disabled after input; message was not sent');
    }

    sendButton.click();
    await sleep(settleMs);
    return { ok: true, text, textareaPlaceholder: textarea.getAttribute('placeholder') || '', clicked: true };
  }`;
}

export function makeBrowserSendSlockMessageScript(options) {
  return `(${browserSendSlockMessageSource()})(${JSON.stringify(options)})`;
}
