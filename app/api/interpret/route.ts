/**
 * POST /api/interpret —— 命盘 AI 解读（流式）
 *
 * 请求体：{ chart: ZiweiChart, messages: { role, content }[] }
 * 响应：text/event-stream，格式见 lib/ai/sse.ts
 *
 * 开源版原本没有这个路由，前端会提示「开源版不含 AI 解读接口」。
 * 这里补齐最小可用实现：命盘事实交给模型，论断由模型生成。
 */

import type { ZiweiChart } from '@/lib/ziwei/types';
import { CONFIG_HINT, resolveProvider, streamChat } from '@/lib/ai/provider';
import { buildInterpretSystem } from '@/lib/ai/prompt';
import { sseResponse, sseTextResponse } from '@/lib/ai/sse';
import type { ChatMessage } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 40;
const MAX_CONTENT = 8000;

function parseMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const raw of input.slice(-MAX_MESSAGES)) {
    if (!raw || typeof raw !== 'object') return null;
    const { role, content } = raw as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    out.push({ role, content: content.slice(0, MAX_CONTENT) });
  }
  return out.length ? out : null;
}

export async function POST(request: Request) {
  let body: { chart?: ZiweiChart; messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return sseTextResponse('请求格式有误：需要一个 JSON 请求体。');
  }

  const chart = body.chart;
  if (!chart || !Array.isArray(chart.palaces) || chart.palaces.length === 0) {
    return sseTextResponse('请求缺少有效的命盘数据，请重新排盘后再试。');
  }

  const messages = parseMessages(body.messages);
  if (!messages) {
    return sseTextResponse('请求缺少提问内容。');
  }

  const provider = resolveProvider();
  if (!provider) {
    return sseTextResponse(CONFIG_HINT);
  }

  const conversation: ChatMessage[] = [
    { role: 'system', content: buildInterpretSystem(chart) },
    ...messages,
  ];

  return sseResponse(streamChat(provider, conversation, { temperature: 0.7, maxTokens: 2400 }));
}
