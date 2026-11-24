const STORAGE_KEY = 'opentempl.ai.nvidia';

export interface AgentSettings {
  key: string;
  model: string;
}

export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

export const MODEL_SUGGESTIONS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-bolt-e4b',
  'minimaxai/minimax-m3.1-flash',
];

export function getAgentSettings(): AgentSettings {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') as Partial<AgentSettings>;
    return { key: saved.key ?? '', model: saved.model ?? DEFAULT_MODEL };
  } catch {
    return { key: '', model: DEFAULT_MODEL };
  }
}

export function saveAgentSettings(settings: AgentSettings) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}
