/**
 * lib/ai/provider —— 大模型接入（OpenAI 兼容协议 + Anthropic）
 *
 * 设计目标：不绑定任何一家服务商。设置 AI_PROVIDER 即可切换，
 * 未识别的一律按 OpenAI 兼容协议处理，用 AI_BASE_URL / AI_MODEL 覆盖。
 *
 * 服务端专用：所有 Key 只从 process.env 读取，绝不下发到浏览器。
 */

import type { ChatMessage } from './types';

export type { ChatMessage };

export interface ProviderConfig {
  kind: 'openai' | 'anthropic';
  /** OpenAI 兼容协议的 base url，已去掉尾部斜杠 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用于报错提示的可读名称 */
  label: string;
}

interface Preset {
  kind: 'openai';
  baseUrl: string;
  model: string;
  keyEnv: string[];
}

/** 常见服务商的预设（都走 OpenAI 兼容协议） */
const PRESETS: Record<string, Preset> = {
  deepseek: {
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyEnv: ['DEEPSEEK_API_KEY'],
  },
  openai: {
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyEnv: ['OPENAI_API_KEY'],
  },
  moonshot: {
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyEnv: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  },
  qwen: {
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyEnv: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
  },
  zhipu: {
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyEnv: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
  },
  siliconflow: {
    kind: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    keyEnv: ['SILICONFLOW_API_KEY'],
  },
};

/** 兼容 .env.example 里的 MIMO_* 自定义配置（任意 OpenAI 兼容网关） */
const MIMO_PRESET: Preset = {
  kind: 'openai',
  baseUrl: 'https://api.mimo.ai/v1',
  model: 'mimo-chat',
  keyEnv: ['MIMO_API_KEY'],
};

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function firstEnv(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * 读取环境变量，组装出当前生效的模型配置。
 * 没有可用的 Key 时返回 null —— 调用方据此返回可读的配置提示。
 */
export function resolveProvider(): ProviderConfig | null {
  const provider = (process.env.AI_PROVIDER || 'deepseek').trim().toLowerCase();

  // Anthropic 原生协议
  if (provider === 'anthropic' || provider === 'claude') {
    const apiKey = firstEnv(['ANTHROPIC_API_KEY', 'AI_API_KEY']);
    if (!apiKey) return null;
    return {
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey,
      model: (process.env.AI_MODEL || 'claude-sonnet-4-5').trim(),
      label: 'Anthropic',
    };
  }

  const preset = PRESETS[provider] ?? (provider === 'mimo' ? MIMO_PRESET : undefined);

  const baseUrl = trimSlash(
    process.env.AI_BASE_URL
    || (provider === 'mimo' ? process.env.MIMO_BASE_URL : '')
    || preset?.baseUrl
    || '',
  );
  if (!baseUrl) return null;

  const apiKey = firstEnv([
    ...(preset?.keyEnv ?? []),
    'AI_API_KEY',
  ]);
  if (!apiKey) return null;

  const model = (
    process.env.AI_MODEL
    || (provider === 'mimo' ? process.env.MIMO_MODEL : '')
    || preset?.model
    || ''
  ).trim();
  if (!model) return null;

  return { kind: 'openai', baseUrl, apiKey, model, label: provider };
}

/** 给用户看的配置缺失提示（会作为可读文本流回前端） */
export const CONFIG_HINT = [
  'AI 服务尚未配置。请在项目根目录创建 .env.local，填入下面任意一组后重启：',
  '',
  '  AI_PROVIDER=deepseek',
  '  DEEPSEEK_API_KEY=sk-xxxxxxxx',
  '',
  '也支持 openai / moonshot / qwen / zhipu / siliconflow / anthropic，',
  '或用 AI_BASE_URL + AI_MODEL + AI_API_KEY 指向任意 OpenAI 兼容网关。',
].join('\n');

/** 把上游返回的错误体压缩成一行可读信息 */
function briefError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || detail;
  } catch { /* 非 JSON，原文截断 */ }
  detail = detail.replace(/\s+/g, ' ').slice(0, 300);
  return `上游接口返回 ${status}${detail ? `：${detail}` : ''}`;
}

/**
 * 流式对话。逐段 yield 文本增量，调用方直接拼进 SSE。
 * 出错时抛出 Error，message 是给用户看的可读中文。
 */
export async function* streamChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string> {
  const { temperature = 0.7, maxTokens = 2048 } = options;

  if (config.kind === 'anthropic') {
    yield* streamAnthropic(config, messages, { temperature, maxTokens });
    return;
  }
  yield* streamOpenAI(config, messages, { temperature, maxTokens });
}

async function* streamOpenAI(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: { temperature: number; maxTokens: number },
): AsyncGenerator<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(briefError(res.status, await res.text().catch(() => '')));
  }
  if (!res.body) throw new Error('上游未返回响应流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    // 最后一段可能是半行，留到下一轮
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const text = parsed?.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) yield text;
      } catch { /* 忽略心跳等非 JSON 行 */ }
    }
  }
}

async function* streamAnthropic(
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: { temperature: number; maxTokens: number },
): AsyncGenerator<string> {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const dialogue = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: system || undefined,
      messages: dialogue,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(briefError(res.status, await res.text().catch(() => '')));
  }
  if (!res.body) throw new Error('上游未返回响应流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta') {
          const text = parsed.delta.text;
          if (typeof text === 'string' && text) yield text;
        }
      } catch { /* 忽略 */ }
    }
  }
}
