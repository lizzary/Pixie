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

function getSetsKey(type) {
  return `gallery_group_${type}_sets`;
}

function getActiveKey(type) {
  return `gallery_group_${type}_active`;
}

let _nextId = 1;
function genSetId() {
  return `set_${Date.now()}_${_nextId++}`;
}

function genPairId() {
  return `pair_${Date.now()}_${_nextId++}`;
}

function assignColors(pairs) {
  return pairs.map((p, i) => ({
    ...p,
    color: p.color || GROUP_COLORS[i % GROUP_COLORS.length].bg,
    borderColor: p.borderColor || GROUP_COLORS[i % GROUP_COLORS.length].border,
  }));
}

function migrateIfNeeded(type) {
  const oldKey = `gallery_group_${type}_config`;
  const newKey = getSetsKey(type);
  if (localStorage.getItem(newKey)) return null;
  try {
    const raw = localStorage.getItem(oldKey);
    if (raw) {
      const data = JSON.parse(raw);
      const defaultSet = {
        id: genSetId(),
        name: 'Default',
        pairs: assignColors(data.pairs || []),
      };
      const sets = [defaultSet];
      localStorage.setItem(newKey, JSON.stringify(sets));
      localStorage.setItem(getActiveKey(type), defaultSet.id);
      localStorage.removeItem(oldKey);
      return { sets, activeId: defaultSet.id };
    }
  } catch { /* ignore */ }
  return null;
}

function loadState(type) {
  const migrated = migrateIfNeeded(type);
  if (migrated) return migrated;
  try {
    const raw = localStorage.getItem(getSetsKey(type));
    if (raw) {
      const sets = JSON.parse(raw).map((s) => ({ ...s, pairs: assignColors(s.pairs || []) }));
      const activeId = (() => {
        const id = localStorage.getItem(getActiveKey(type));
        if (id && sets.some((s) => s.id === id)) return id;
        return sets[0]?.id || null;
      })();
      return { sets, activeId };
    }
  } catch { /* ignore */ }
  const defaultSet = { id: genSetId(), name: 'Default', pairs: [] };
  localStorage.setItem(getSetsKey(type), JSON.stringify([defaultSet]));
  localStorage.setItem(getActiveKey(type), defaultSet.id);
  return { sets: [defaultSet], activeId: defaultSet.id };
}

export default function useGroupConfig(type) {
  const [state, setState] = useState(() => loadState(type));

  const { sets, activeId } = state;
  const activeSet = sets.find((s) => s.id === activeId) || sets[0];

  const switchSet = useCallback((id) => {
    setState((prev) => {
      if (prev.activeId === id) return prev;
      saveActiveId(type, id);
      return { ...prev, activeId: id };
    });
  }, [type]);

  const addSet = useCallback((name) => {
    setState((prev) => {
      const newSet = {
        id: genSetId(),
        name: name || `Set ${prev.sets.length + 1}`,
        pairs: [],
      };
      const updated = [...prev.sets, newSet];
      saveSets(type, updated);
      saveActiveId(type, newSet.id);
      return { sets: updated, activeId: newSet.id };
    });
  }, [type]);

  const removeSet = useCallback((id) => {
    setState((prev) => {
      if (prev.sets.length <= 1) return prev;
      const updated = prev.sets.filter((s) => s.id !== id);
      const newActiveId = prev.activeId === id ? updated[0].id : prev.activeId;
      saveSets(type, updated);
      saveActiveId(type, newActiveId);
      return { sets: updated, activeId: newActiveId };
    });
  }, [type]);

  const renameSet = useCallback((id, name) => {
    setState((prev) => {
      const updated = prev.sets.map((s) => (s.id === id ? { ...s, name } : s));
      saveSets(type, updated);
      return { ...prev, sets: updated };
    });
  }, [type]);

  const setPairs = useCallback((pairs) => {
    setState((prev) => {
      const updated = prev.sets.map((s) =>
        s.id === prev.activeId ? { ...s, pairs: assignColors(pairs) } : s
      );
      saveSets(type, updated);
      return { ...prev, sets: updated };
    });
  }, [type]);

  return {
    sets,
    activeSetId: activeId,
    activeSet: activeSet || sets[0],
    // Backward-compatible convenience accessors
    pairs: activeSet?.pairs || [],
    setPairs,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    // Set management
    switchSet,
    addSet,
    removeSet,
    renameSet,
  };
}

function saveSets(type, sets) {
  localStorage.setItem(getSetsKey(type), JSON.stringify(sets));
}

function saveActiveId(type, id) {
  localStorage.setItem(getActiveKey(type), id);
}
