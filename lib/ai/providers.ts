import { customProvider } from 'ai';
import {
  artifactModel as testArtifactModel,
  chatModel as testChatModel,
  reasoningModel as testReasoningModel,
  titleModel as testTitleModel,
} from './models.test';
import { isTestEnvironment } from '../constants';

/**
 * Bridge: template's "language model" -> your Cloudflare Worker /ask
 * We intercept the model call, pull the last user message, POST to /ask,
 * and return `data.answer` as the assistant text. Non-streaming for now.
 */

const WORKER_URL = process.env.CF_WORKER_ASK_URL;

if (!WORKER_URL) {
  // Don't throw on import; just make it obvious in dev logs.
  console.warn(
    '[providers] CF_WORKER_ASK_URL is not set. Add it to .env.local (and Vercel env) to use the Bahá’í backend.',
  );
}

/** Extract latest user text from AI SDK v5 messages (string or multipart). */
function lastUserQuestion(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') {
      // Supports both string content and [{ type: 'text', text: '...' }]
      if (typeof m.content === 'string') {
        const s = m.content.trim();
        if (s) return s;
      }
      const parts = Array.isArray(m.content) ? m.content : [];
      const text = parts
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

/** A minimal model object compatible with customProvider() across betas. */
const workerBackedModel: any = {
  provider: 'bahai-worker',
  modelId: 'bahai-rag',

  /**
   * Called by the AI SDK for a non-streaming generation.
   * If you later add streaming to your Worker, we can implement doStream().
   */
  async doGenerate(options: any) {
    try {
      // messages might be on options.prompt.messages or options.messages
      const messages =
        (options && options.prompt && options.prompt.messages) ||
        (options && options.messages) ||
        [];

      const q = lastUserQuestion(messages);

      if (!q) {
        return {
          text: 'Please enter a question.',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      if (!WORKER_URL) {
        return {
          text: 'Server is missing CF_WORKER_ASK_URL. Set it in .env.local and redeploy.',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      const r = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });

      let data: any = null;
      try {
        data = await r.json();
      } catch {
        data = null;
      }

      if (!r.ok) {
        const msg =
          (data && (data.error || data.message)) || `HTTP ${r.status}`;
        return {
          text: `Backend error from Bahá’í assistant: ${msg}`,
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      const answer =
        data && typeof data.answer === 'string'
          ? data.answer
          : 'Sorry, the Bahá’í assistant returned no answer.';

      return {
        text: answer,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        // raw: data, // uncomment for debugging: exposes { answer, matches }
      };
    } catch (err: any) {
      return {
        text:
          err?.message ||
          'An error occurred contacting the Bahá’í assistant backend.',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  },
};

// Keep template's mock models in tests; otherwise map all expected IDs to our model.
export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': testChatModel,
        'chat-model-reasoning': testReasoningModel,
        'title-model': testTitleModel,
        'artifact-model': testArtifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': workerBackedModel,
        'chat-model-reasoning': workerBackedModel,
        'title-model': workerBackedModel,
        'artifact-model': workerBackedModel,
      },
      // imageModels: {} // add if/when your Worker handles images
    });
