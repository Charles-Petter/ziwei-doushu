/**
 * POST /api/heming —— 双人合盘 AI 分析（流式）
 *
 * 请求体：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 响应：text/event-stream，格式见 lib/ai/sse.ts
 *
 * 起盘本身在前端用本地引擎完成，这里只负责解读。
 */

import type { ZiweiChart } from '@/lib/ziwei/types';
import { CONFIG_HINT, resolveProvider, streamChat } from '@/lib/ai/provider';
import { buildHemingSystem } from '@/lib/ai/prompt';
import { sseResponse, sseTextResponse } from '@/lib/ai/sse';
import type { ChatMessage } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isChart = (v: unknown): v is ZiweiChart =>
  !!v && typeof v === 'object'
  && Array.isArray((v as ZiweiChart).palaces)
  && (v as ZiweiChart).palaces.length > 0;

export async function POST(request: Request) {
  let body: { chartA?: ZiweiChart; chartB?: ZiweiChart; question?: unknown };
  try {
    body = await request.json();
  } catch {
    return sseTextResponse('请求格式有误：需要一个 JSON 请求体。');
  }

  if (!isChart(body.chartA) || !isChart(body.chartB)) {
    return sseTextResponse('请求缺少有效的双方命盘，请先填写完整出生信息再试。');
  }

  const provider = resolveProvider();
  if (!provider) {
    return sseTextResponse(CONFIG_HINT);
  }

  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';

  const conversation: ChatMessage[] = [
    { role: 'system', content: buildHemingSystem(body.chartA, body.chartB) },
    {
      role: 'user',
      content: question
        ? `请结合两张命盘回答这个具体问题：${question}`
        : '请对这两张命盘做一次完整的合盘分析：先各自性格与感情基调，再谈两人互动的契合点与需要磨合的地方，最后给相处建议。',
    },
  ];

  return sseResponse(streamChat(provider, conversation, { temperature: 0.7, maxTokens: 2600 }));
}
