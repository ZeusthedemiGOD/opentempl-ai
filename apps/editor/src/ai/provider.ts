import type { Op } from '../../../../mcp/recipe';
import { AgentError, type AgentResult } from './types';

function decode(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? value).trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new AgentError('The model did not return a design plan.');
    try {
      return JSON.parse(raw.slice(start, end + 1)) as unknown;
    } catch {
      throw new AgentError('The model returned a design plan that could not be read.');
    }
  }
}

export function parseAgentResult(value: string): AgentResult {
  const parsed = decode(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AgentError('The model returned an invalid design plan.');
  const data = parsed as { reply?: unknown; ops?: unknown };
  if (!Array.isArray(data.ops)) throw new AgentError('The model did not return any design edits.');
  const ops = data.ops.filter((op): op is Op => !!op && typeof op === 'object' && typeof (op as { op?: unknown }).op === 'string');
  if (ops.length !== data.ops.length) throw new AgentError('The model returned an invalid design edit.');
  const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : 'Here are the changes.';
  return { reply, ops };
}

export function describeOp(op: Op) {
  switch (op.op) {
    case 'set_text':
      return `Change text in ${op.id}`;
    case 'style':
      return `Restyle ${op.id ?? op.ids?.join(', ')}`;
    case 'set_image':
      return `Set the image in ${op.id}`;
    case 'add':
      return `Add a ${String(op.element?.type ?? 'new')} element to ${op.page}`;
    case 'duplicate':
      return `Duplicate ${op.id}`;
    case 'remove':
      return `Remove ${op.id ?? op.ids?.join(', ')}`;
    case 'recolor':
      return 'Recolour the design';
    case 'align':
      return `Align ${op.ids.join(', ')}`;
    case 'distribute':
      return `Distribute ${op.ids.join(', ')}`;
    case 'page':
      return `Update page ${op.id}`;
    case 'add_page':
      return 'Add a page';
    case 'move_page':
      return `Move page ${op.id}`;
    case 'arrange':
      return `Move ${op.id} in the layer order`;
    case 'title':
      return 'Change the design title';
  }
}
