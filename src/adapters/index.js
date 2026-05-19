import { ClaudeAdapter } from './claude.js';
import { ChatGPTAdapter } from './chatgpt.js';
import { GeminiAdapter } from './gemini.js';

export function getAdapter() {
  const host = window.location.hostname;
  if (host === 'claude.ai') return new ClaudeAdapter();
  if (host === 'chatgpt.com' || host === 'chat.openai.com') return new ChatGPTAdapter();
  if (host === 'gemini.google.com') return new GeminiAdapter();
  throw new Error(`Unsupported site: ${host}`);
}
