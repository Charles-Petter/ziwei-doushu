/** 对话消息（服务端与前端共用的最小结构） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
