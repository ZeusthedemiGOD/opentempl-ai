import { describe, expect, it, vi } from 'vitest';
import { applyOps } from '../../../mcp/recipe';
import { designerMessages } from '../src/ai/agent';
import { nvidiaProvider } from '../src/ai/nvidia';
import { parseAgentResult } from '../src/ai/provider';
import { applyPlan, sceneFromSnapshot } from '../src/ai/scene';
import { DesignDoc } from '../src/doc/design';
import { makeText } from '../src/doc/factory';
import type { DesignSnapshot } from '../src/doc/types';
import type { Editor } from '../src/editor/Editor';

function snapshot(): DesignSnapshot {
  const element = makeText({ id: 'element-1', text: 'Original title' });
  return {
    meta: { id: 'design-1', title: 'Poster', width: 1080, height: 1350, unit: 'px', createdAt: 1, updatedAt: 1 },
    pageOrder: ['page-1'],
    pages: {
      'page-1': { id: 'page-1', name: 'Cover', background: { type: 'solid', color: '#FFFFFF' }, elementIds: ['element-1'], notes: '', transition: 'none', duration: 5 },
    },
    elements: { 'element-1': element },
  };
}

describe('AI designer', () => {
  it('reads a JSON plan from plain or fenced model output', () => {
    const result = parseAgentResult('```json\n{"reply":"Ready","ops":[{"op":"title","title":"Launch"}]}\n```');
    expect(result.reply).toBe('Ready');
    expect(result.ops).toEqual([{ op: 'title', title: 'Launch' }]);
  });

  it('rejects a model response that is not a structured plan', () => {
    expect(() => parseAgentResult('Here are some ideas')).toThrow(/did not return/);
    expect(() => parseAgentResult('{"reply":"Ready"}')).toThrow(/did not return any design edits/);
  });

  it('sends the system rules and current scene to the provider', () => {
    const doc = new DesignDoc();
    doc.load(snapshot());
    const scene = sceneFromSnapshot(doc.snapshot);
    const messages = designerMessages(scene, 'Make it bolder', ['p1-e1'], []);
    expect(messages[0].role).toBe('system');
    expect(messages.at(-1)?.content).toContain('p1-e1');
    expect(messages.at(-1)?.content).toContain('Make it bolder');
  });

  it('sends the NVIDIA key only in the authorization header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"Done","ops":[]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const answer = await nvidiaProvider.chat({ apiKey: 'nvapi-secret', model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] });
    expect(answer).toContain('Done');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer nvapi-secret');
    expect(JSON.stringify(init.body)).not.toContain('nvapi-secret');
    fetchMock.mockRestore();
  });

  it('applies a validated plan to the live document in one undo step', async () => {
    const doc = new DesignDoc();
    doc.load(snapshot());
    const scene = sceneFromSnapshot(doc.snapshot);
    const op = { op: 'set_text', id: 'p1-e1', text: 'A stronger title' } as const;
    const design = structuredClone(scene.design);
    applyOps(design, [op], { fonts: new Set(['Host Grotesk']) });
    const editor = {
      doc,
      select: vi.fn(),
      ui: { set: vi.fn() },
      refitAllText: vi.fn(),
      pruneSelection: vi.fn(),
      toast: vi.fn(),
    } as unknown as Editor;
    await applyPlan(editor, { scene, design, ops: [op], version: doc.snapshot.version });
    expect(doc.snapshot.elements['element-1'].type === 'text' && doc.snapshot.elements['element-1'].text).toBe('A stronger title');
    doc.undo.undo();
    expect(doc.snapshot.elements['element-1'].type === 'text' && doc.snapshot.elements['element-1'].text).toBe('Original title');
  });

  it('adds pages and editable elements without losing the document structure', async () => {
    const doc = new DesignDoc();
    doc.load(snapshot());
    const scene = sceneFromSnapshot(doc.snapshot);
    const ops = [
      { op: 'add', page: 'p1', element: { type: 'shape', shape: 'rect', x: 10, y: 20, w: 100, h: 80, fill: '#FF0000' } },
      { op: 'add_page', name: 'Second', background: '#000000' },
    ] as const;
    const design = structuredClone(scene.design);
    applyOps(design, [...ops], { fonts: new Set(['Host Grotesk']) });
    const editor = { doc, select: vi.fn(), ui: { set: vi.fn() }, refitAllText: vi.fn(), pruneSelection: vi.fn(), toast: vi.fn() } as unknown as Editor;
    await applyPlan(editor, { scene, design, ops: [...ops], version: doc.snapshot.version });
    expect(doc.snapshot.pageOrder).toHaveLength(2);
    expect(doc.snapshot.pages[doc.snapshot.pageOrder[1]].name).toBe('Second');
    expect(doc.snapshot.pages[doc.snapshot.pageOrder[0]].elementIds).toHaveLength(2);
    doc.undo.undo();
    expect(doc.snapshot.pageOrder).toHaveLength(1);
    expect(doc.snapshot.pages[doc.snapshot.pageOrder[0]].elementIds).toHaveLength(1);
  });
});
