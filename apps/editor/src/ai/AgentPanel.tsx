import { useEffect, useMemo, useRef, useState } from 'react';
import { designerMessages } from './agent';
import { nvidiaProvider } from './nvidia';
import { describeOp, parseAgentResult } from './provider';
import { applyPlan, preparePlan, sceneFromSnapshot, type PreparedPlan } from './scene';
import { getAgentSettings, MODEL_SUGGESTIONS, saveAgentSettings } from './settings';
import type { ChatMessage } from './types';
import { useEditor } from '../editor/Editor';
import { useDoc } from '../editor/hooks';
import { Icon } from '../ui/icons';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  raw?: string;
}

const SUGGESTIONS = ['Make this more modern', 'Improve the visual hierarchy', 'Balance the layout'];

export default function AgentPanel() {
  const editor = useEditor();
  const snapshot = useDoc((state) => state);
  const [settings, setSettings] = useState(getAgentSettings);
  const [request, setRequest] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [plan, setPlan] = useState<PreparedPlan | null>(null);
  const [planReply, setPlanReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveAgentSettings(settings);
  }, [settings]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const selected = useMemo(() => {
    const scene = sceneFromSnapshot(snapshot);
    const byReal = new Map([...scene.elementIds].map(([stable, real]) => [real, stable]));
    return editor.state.selection.map((id) => byReal.get(id)).filter((id): id is string => !!id);
  }, [snapshot, editor.state.selection]);

  async function send(text = request) {
    const prompt = text.trim();
    if (!prompt || busy || !settings.key.trim() || !settings.model.trim()) return;
    setBusy(true);
    setError('');
    setPlan(null);
    setPlanReply('');
    const controller = new AbortController();
    abortRef.current = controller;
    const userTurn: Turn = { id: `${Date.now()}-user`, role: 'user', text: prompt };
    const history: ChatMessage[] = turns.map((turn) => ({ role: turn.role, content: turn.role === 'user' ? turn.text : turn.raw ?? turn.text }));
    try {
      const scene = sceneFromSnapshot(snapshot);
      const messages = designerMessages(scene, prompt, selected, history);
      const raw = await nvidiaProvider.chat({ apiKey: settings.key, model: settings.model.trim(), messages, signal: controller.signal });
      const result = parseAgentResult(raw);
      setTurns((current) => [...current, userTurn, { id: `${Date.now()}-assistant`, role: 'assistant', text: result.reply, raw }]);
      setRequest('');
      if (result.ops.length) {
        const prepared = await preparePlan(snapshot, result.ops);
        setPlan(prepared);
        setPlanReply(result.reply);
      }
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setError((cause as Error).message || 'The designer could not finish this request.');
        setTurns((current) => [...current, userTurn]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan || applying) return;
    setApplying(true);
    setError('');
    try {
      const applied = await applyPlan(editor, plan);
      const count = plan.ops.length;
      setTurns((current) => [...current, { id: `${Date.now()}-applied`, role: 'assistant', text: `Applied ${count} ${count === 1 ? 'edit' : 'edits'} to the design.` }]);
      setPlan(null);
      setPlanReply('');
      editor.toast(applied.missingImages.length ? 'Design updated. Some images could not be loaded.' : 'Design updated');
    } catch (cause) {
      setError((cause as Error).message || 'The edits could not be applied.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-hero">
        <span className="ai-hero-icon">
          <Icon name="sparkle" size={22} />
        </span>
        <div>
          <h3>AI designer</h3>
          <p>Describe a change. The designer returns editable layout, type, colour and page operations.</p>
        </div>
      </div>

      <details className="ai-settings">
        <summary>
          <span>{settings.key ? 'NVIDIA connected' : 'Connect NVIDIA'}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <div className="ai-settings-body">
          <label>
            <span>API key</span>
            <input type="password" autoComplete="off" value={settings.key} placeholder="nvapi-..." onChange={(event) => setSettings((current) => ({ ...current, key: event.target.value }))} />
          </label>
          <label>
            <span>Model</span>
            <input list="ai-model-options" value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} />
            <datalist id="ai-model-options">
              {MODEL_SUGGESTIONS.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <p className="hint">The key stays in this browser tab. The local proxy forwards it only to NVIDIA and does not store it.</p>
        </div>
      </details>

      {turns.length ? (
        <div className="ai-turns">
          {turns.map((turn) => (
            <div key={turn.id} className={`ai-turn is-${turn.role}`}>
              <span className="ai-turn-label">{turn.role === 'user' ? 'You' : 'Designer'}</span>
              <p>{turn.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="ai-suggestions">
          <span className="label">Try a direction</span>
          <div>
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} disabled={busy || !settings.key || !settings.model} onClick={() => send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {plan ? (
        <div className="ai-plan">
          <div className="ai-plan-head">
            <span className="ai-plan-icon">
              <Icon name="check" size={15} />
            </span>
            <div>
              <strong>Edit preview</strong>
              <p>{planReply}</p>
            </div>
          </div>
          <ul>
            {plan.ops.map((op, index) => (
              <li key={`${op.op}-${index}`}>{describeOp(op)}</li>
            ))}
          </ul>
          <div className="ai-plan-actions">
            <button className="btn btn-primary btn-sm" disabled={applying} onClick={apply}>
              {applying ? 'Applying' : `Apply ${plan.ops.length} ${plan.ops.length === 1 ? 'edit' : 'edits'}`}
            </button>
            <button className="btn btn-outline btn-sm" disabled={applying} onClick={() => setPlan(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="ai-error">{error}</div> : null}

      <div className="ai-composer">
        <textarea
          value={request}
          placeholder={settings.key ? 'Make the headline bolder and balance the composition' : 'Connect NVIDIA to start designing'}
          disabled={busy}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-ink btn-sm" disabled={busy || !request.trim() || !settings.key || !settings.model} onClick={() => void send()}>
          {busy ? 'Thinking' : 'Send'}
        </button>
      </div>
    </div>
  );
}
