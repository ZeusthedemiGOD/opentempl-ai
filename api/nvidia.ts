const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_CONTENT = 120000;

export interface NvidiaInput {
  authorization?: string;
  model?: unknown;
  messages?: unknown;
}

export interface NvidiaResult {
  status: number;
  body: unknown;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

function validMessages(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 24) return null;
  const messages: { role: string; content: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const message = item as { role?: unknown; content?: unknown };
    if (!['system', 'user', 'assistant'].includes(String(message.role))) return null;
    if (typeof message.content !== 'string' || !message.content.length || message.content.length > MAX_CONTENT) return null;
    messages.push({ role: String(message.role), content: message.content });
  }
  return messages;
}

export async function handleNvidia(input: NvidiaInput, doFetch: Fetch = fetch as unknown as Fetch): Promise<NvidiaResult> {
  const authorization = input.authorization?.trim() ?? '';
  const key = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!key || key.length > 500) return { status: 401, body: { error: { message: 'A valid NVIDIA API key is required.' } } };
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 200) return { status: 400, body: { error: { message: 'Choose an NVIDIA model.' } } };
  const messages = validMessages(input.messages);
  if (!messages) return { status: 400, body: { error: { message: 'The design request is not valid.' } } };

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: 1,
    top_p: 0.95,
    max_tokens: 8192,
    stream: false,
  };
  if (model.includes('nemotron')) payload.chat_template_kwargs = { enable_thinking: false };

  let response: Awaited<ReturnType<Fetch>>;
  try {
    response = await doFetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: 502, body: { error: { message: 'Could not reach NVIDIA.' } } };
  }
  const text = await response.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { message: text || `NVIDIA answered ${response.status}.` } };
  }
  return { status: response.status, body };
}

interface VercelReq {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status(code: number): VercelRes;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') {
    res.status(204).json({});
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Use POST.' } });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = typeof req.body === 'string' ? (JSON.parse(req.body) as Record<string, unknown>) : ((req.body ?? {}) as Record<string, unknown>);
  } catch {
    res.status(400).json({ error: { message: 'The design request is not valid.' } });
    return;
  }
  const authorization = req.headers.authorization;
  const out = await handleNvidia({ authorization: Array.isArray(authorization) ? authorization[0] : authorization, model: body.model, messages: body.messages });
  res.status(out.status).json(out.body);
}
