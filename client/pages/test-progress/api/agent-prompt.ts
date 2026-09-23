import { resolveAppUrl } from '@nocobase/app-client';

/** Where the guide lives; the page renders what an Agent reads at this URL. */
export function apiGuideUrl(): string {
  return new URL(resolveAppUrl('/api-guide.md'), window.location.origin).href;
}

/**
 * The prompt handed to an Agent: connection details plus the URL of the full
 * reference. The document itself is not copied, so a change to the guide reaches
 * the Agent on its next read instead of living on in a stale clipboard.
 */
export function buildAgentPrompt(): string {
  const site = new URL(resolveAppUrl('/'), window.location.origin).href;
  const api = new URL(resolveAppUrl('/api'), window.location.origin).href;
  return [
    '你是 Test Manager（测试进展统计）系统的操作助手。',
    '',
    `- 站点：${site}`,
    `- 接口前缀：${api}`,
    `- 完整接口文档（Markdown，请先读取）：${apiGuideUrl()}`,
    '- 认证（用我自己的账号，详见文档第 1 节，二选一）：',
    `  - 让用户在应用「设置 → API Keys」创建一把 key 交给你，你用它作请求头 \`x-api-key: <key>\``,
    `  - 或用户提供账号密码：POST ${api}/auth/sign-in/username，body { "username": "...", "password": "..." }，用返回的会话 Cookie 调用`,
    '- 权限跟随所用账号；凭据不要写进代码或提交，也不要尝试默认密码',
    '',
    '请先读取接口文档，再按文档调用接口；写操作前先读取当前状态，不要臆造 id。',
  ].join('\n');
}

/** Clipboard API where available, with a selection fallback for plain HTTP hosts. */
export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(area);
  if (!copied) {
    throw new Error('Copy failed');
  }
}
