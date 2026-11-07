/**
 * lib/ai/sse —— 把文本增量流包装成前端约定的 SSE 响应
 *
 * 前端（ChatPanel / InsightPanel / heming）统一按这个格式解析：
 *   data: {"delta":{"text":"..."}}\n\n
 *   data: [DONE]\n\n
 */

const encoder = new TextEncoder();

const frame = (payload: unknown) =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

const deltaFrame = (text: string) => frame({ delta: { text } });

export function sseResponse(source: AsyncGenerator<string>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) {
          if (chunk) controller.enqueue(deltaFrame(chunk));
        }
      } catch (error) {
        // 上游报错也走 200 的正常流，把原因直接显示在对话里，
        // 比前端一句"解读失败"更有排查价值。
        const message = error instanceof Error ? error.message : '未知错误';
        controller.enqueue(deltaFrame(`\n\n[解读中断] ${message}`));
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 配置缺失 / 参数非法时，仍然用 SSE 回一段说明，前端可直接展示 */
export function sseTextResponse(text: string): Response {
  async function* once() {
    yield text;
  }
  return sseResponse(once());
}
