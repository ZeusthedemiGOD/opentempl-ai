import { AgentError, type AiProvider, type ProviderRequest } from './types';

const NVIDIA_ENDPOINT = '/api/nvidia';

export const nvidiaProvider: AiProvider = {
  id: 'nvidia',
  label: 'NVIDIA',
  async chat(request: ProviderRequest) {
    if (!request.apiKey.trim()) throw new AgentError('Connect your NVIDIA API key first.');
    if (!request.model.trim()) throw new AgentError('Choose an NVIDIA model first.');
    let response: Response;
    try {
      response = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${request.apiKey.trim()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: 1,
          top_p: 0.95,
          max_tokens: 8192,
          stream: false,
          ...(request.model.includes('nemotron') ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
        signal: request.signal,
      });
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') throw cause;
      throw new AgentError('Could not reach NVIDIA. Check your connection and try again.');
    }
    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
    };
    if (!response.ok) {
      const message = data.error?.message || `NVIDIA answered ${response.status}.`;
      if (response.status === 401) throw new AgentError('NVIDIA did not accept this API key.');
      throw new AgentError(message);
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new AgentError('NVIDIA returned an empty answer.');
    return content;
  },
};
