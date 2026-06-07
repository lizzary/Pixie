import { useState, useCallback } from 'react';

const GROUP_COLORS = [
  { bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.35)' },
  { bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.35)' },
  { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.35)' },
  { bg: 'rgba(251, 191, 36, 0.08)', border: 'rgba(251, 191, 36, 0.35)' },
  { bg: 'rgba(168, 85, 247, 0.08)', border: 'rgba(168, 85, 247, 0.35)' },
  { bg: 'rgba(236, 72, 153, 0.08)', border: 'rgba(236, 72, 153, 0.35)' },
  { bg: 'rgba(20, 184, 166, 0.08)', border: 'rgba(20, 184, 166, 0.35)' },
  { bg: 'rgba(249, 115, 22, 0.08)', border: 'rgba(249, 115, 22, 0.35)' },
  { bg: 'rgba(99, 102, 241, 0.08)', border: 'rgba(99, 102, 241, 0.35)' },
  { bg: 'rgba(244, 114, 182, 0.08)', border: 'rgba(244, 114, 182, 0.35)' },
];

const OTHER_COLOR = { bg: 'rgba(156, 163, 175, 0.06)', border: 'rgba(156, 163, 175, 0.25)' };

function getStorageKey(type) {
  return `gallery_group_${type}_config`;
}

function loadConfig(type) {
  try {
    const raw = localStorage.getItem(getStorageKey(type));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return { pairs: [] };
}

function saveConfig(type, config) {
  localStorage.setItem(getStorageKey(type), JSON.stringify(config));
}

let nextId = 1;
function genId() {
  return `pair_${Date.now()}_${nextId++}`;
}

function assignColors(pairs) {
  return pairs.map((p, i) => ({
    ...p,
    color: p.color || GROUP_COLORS[i % GROUP_COLORS.length].bg,
    borderColor: p.borderColor || GROUP_COLORS[i % GROUP_COLORS.length].border,
  }));
}

export default function useGroupConfig(type) {
  const [config, setConfig] = useState(() => loadConfig(type));

  const persist = useCallback((newConfig) => {
    setConfig(newConfig);
    saveConfig(type, newConfig);
  }, [type]);

  const addPair = useCallback((keywords) => {
    setConfig((prev) => {
      const pairs = [...prev.pairs, { id: genId(), keywords }];
      const updated = { ...prev, pairs: assignColors(pairs) };
      saveConfig(type, updated);
      return updated;
    });
  }, [type]);

  const removePair = useCallback((pairId) => {
    setConfig((prev) => {
      const pairs = prev.pairs.filter((p) => p.id !== pairId);
      const updated = { ...prev, pairs: assignColors(pairs) };
      saveConfig(type, updated);
      return updated;
    });
  }, [type]);

  const updatePair = useCallback((pairId, keywords) => {
    setConfig((prev) => {
      const pairs = prev.pairs.map((p) =>
        p.id === pairId ? { ...p, keywords } : p
      );
      const updated = { ...prev, pairs };
      saveConfig(type, updated);
      return updated;
    });
  }, [type]);

  const setPairs = useCallback((pairs) => {
    persist({ pairs: assignColors(pairs) });
  }, [persist]);

  // Ensure pairs have colors assigned (for loaded configs without colors)
  const pairs = assignColors(config.pairs);

  return {
    pairs,
    addPair,
    removePair,
    updatePair,
    setPairs,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
  };
}
