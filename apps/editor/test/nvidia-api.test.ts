import { describe, expect, it, vi } from 'vitest';
import { handleNvidia } from '../../../api/nvidia';

describe('NVIDIA proxy', () => {
  it('forwards only the fixed NVIDIA chat endpoint', async () => {
    const upstream = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Done' } }] }) }));
    const out = await handleNvidia(
      {
        authorization: 'Bearer nvapi-secret',
        model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        messages: [{ role: 'user', content: 'Make it bolder' }],
      },
      upstream as never,
    );
    expect(out.status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    const init = upstream.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe('Bearer nvapi-secret');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
  });

  it('rejects missing keys and malformed conversations', async () => {
    const upstream = vi.fn();
    expect((await handleNvidia({ model: 'test', messages: [{ role: 'user', content: 'Hi' }] }, upstream as never)).status).toBe(401);
    expect(
      (await handleNvidia({ authorization: 'Bearer secret', model: 'test', messages: [{ role: 'tool', content: 'Hi' }] }, upstream as never)).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
