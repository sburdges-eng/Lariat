/**
 * sagemaker.ts — SageMaker inference client for Lariat kitchen assistant.
 *
 * Drop-in alternative to lib/ollama.ts for production. When LARIAT_SAGEMAKER_ENDPOINT
 * is set, the kitchen assistant routes to the SageMaker endpoint instead of local Ollama.
 *
 * The API route (app/api/kitchen-assistant/route.js) checks for this env var
 * and calls sagemakerChat() instead of ollamaChat().
 */

// Lazy-loaded AWS SDK v3 — optional dependency, only needed when
// LARIAT_SAGEMAKER_ENDPOINT is set.
let _SageMakerRuntimeClient: any;
let _InvokeEndpointCommand: any;

async function ensureSdk(): Promise<void> {
  if (!_SageMakerRuntimeClient) {
    try {
      // @ts-expect-error — optional dependency, only needed at runtime when LARIAT_SAGEMAKER_ENDPOINT is set
      const mod = await import('@aws-sdk/client-sagemaker-runtime');
      _SageMakerRuntimeClient = mod.SageMakerRuntimeClient;
      _InvokeEndpointCommand = mod.InvokeEndpointCommand;
    } catch {
      throw new Error(
        'SageMaker inference requires @aws-sdk/client-sagemaker-runtime. ' +
        'Install: npm install @aws-sdk/client-sagemaker-runtime'
      );
    }
  }
}

/* ── Types ──────────────────────────────────────────────────────────── */

export interface SageMakerChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SageMakerChatOpts {
  model?: string;       // ignored — model is baked into the endpoint
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface SageMakerChatResult {
  answer: string;
  model: string;
  latencyMs: number;
}

/* ── Config ─────────────────────────────────────────────────────────── */

const ENDPOINT_NAME = process.env.LARIAT_SAGEMAKER_ENDPOINT || 'lariat-kitchen-assistant';
const AWS_REGION = process.env.AWS_REGION || process.env.LARIAT_AWS_REGION || 'us-east-1';
const TIMEOUT_MS = Math.min(
  120_000,
  Math.max(5_000, parseInt(process.env.LARIAT_SAGEMAKER_TIMEOUT_MS || '60000', 10) || 60_000),
);

/* ── Client (singleton) ─────────────────────────────────────────────── */

let _client: any = null;

async function getClient(): Promise<any> {
  await ensureSdk();
  if (!_client) {
    _client = new _SageMakerRuntimeClient({
      region: AWS_REGION,
      // Credentials auto-discovered from env, IAM role, or ~/.aws/credentials
    });
  }
  return _client;
}

/* ── Chat function ──────────────────────────────────────────────────── */

/**
 * Send a chat-completion request to the SageMaker endpoint.
 * Compatible with the HuggingFace TGI Messages API format.
 */
export async function sagemakerChat(
  messages: SageMakerChatMessage[],
  opts: SageMakerChatOpts = {},
): Promise<SageMakerChatResult> {
  const t0 = Date.now();

  const payload = {
    // TGI Messages API format (OpenAI-compatible)
    messages,
    parameters: {
      max_new_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.2,
      top_p: opts.topP ?? 0.85,
      do_sample: (opts.temperature ?? 0.2) > 0,
      return_full_text: false,
    },
  };

  await ensureSdk();
  const command = new _InvokeEndpointCommand({
    EndpointName: ENDPOINT_NAME,
    ContentType: 'application/json',
    Accept: 'application/json',
    Body: JSON.stringify(payload),
  });

  const client = await getClient();
  const response = await client.send(command, {
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = new TextDecoder().decode(response.Body);
  const parsed = JSON.parse(body);

  // TGI returns either:
  //   [{ "generated_text": "..." }]              (legacy /generate)
  //   { "choices": [{ "message": { "content" } }] }  (messages API)
  let answer: string;
  if (Array.isArray(parsed)) {
    answer = parsed[0]?.generated_text ?? '';
  } else if (parsed.choices?.[0]?.message?.content) {
    answer = parsed.choices[0].message.content;
  } else if (typeof parsed === 'string') {
    answer = parsed;
  } else {
    answer = JSON.stringify(parsed);
  }

  return {
    answer: answer.trim(),
    model: `sagemaker:${ENDPOINT_NAME}`,
    latencyMs: Date.now() - t0,
  };
}

/* ── Health check ───────────────────────────────────────────────────── */

export interface SageMakerConfig {
  endpoint: string;
  region: string;
  configured: boolean;
}

export function getSageMakerConfig(): SageMakerConfig {
  return {
    endpoint: ENDPOINT_NAME,
    region: AWS_REGION,
    configured: Boolean(process.env.LARIAT_SAGEMAKER_ENDPOINT),
  };
}

/**
 * Ping the endpoint to check if it's reachable.
 * Returns true if the endpoint responds (even with an error — it means it's alive).
 */
export async function pingSageMaker(): Promise<boolean> {
  try {
    await sagemakerChat(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 1, temperature: 0 },
    );
    return true;
  } catch (e: any) {
    // ValidationError means the endpoint exists but rejected our input — still alive
    if (e.name === 'ValidationError') return true;
    return false;
  }
}

/**
 * Check if SageMaker inference is configured and should be used
 * instead of local Ollama.
 */
export function isSageMakerConfigured(): boolean {
  return Boolean(process.env.LARIAT_SAGEMAKER_ENDPOINT);
}
