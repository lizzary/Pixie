import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchIllustrations, deleteIllustration } from '../api';
import { useToast } from './Toast';
import IllustrationCard from './IllustrationCard';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';
import ColorGroup from './ColorGroup';
import GroupConfigModal from './GroupConfigModal';
import useGroupConfig from '../hooks/useGroupConfig';
import { matchesTagPair, matchesPromptPair, groupIllustrations, GROUP_BY_OPTIONS } from '../utils/grouping';

// ── Main component ───────────────────────────────────────

export default function SearchOverlay({ query, onClose }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [showGroupConfig, setShowGroupConfig] = useState(false);
  const { addToast } = useToast();

  const tagGroupConfig = useGroupConfig('tag');
  const promptGroupConfig = useGroupConfig('prompt');

  const activeConfig = groupBy === 'tag' ? tagGroupConfig : promptGroupConfig;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    searchIllustrations(query)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [query]);

  const items = results ? results.items : [];

  // ── Grouping ───────────────────────────────────────────

  const groupedIllustrations = useMemo(() => {
    if (groupBy === 'none' || activeConfig.pairs.length === 0 || items.length === 0) return null;
    const matchFn = groupBy === 'tag' ? matchesTagPair : matchesPromptPair;
    return groupIllustrations(items, activeConfig.pairs, activeConfig.otherColor, matchFn);
  }, [groupBy, items, activeConfig]);

  const displayedItems = useMemo(() => {
    if (groupedIllustrations) {
      const flat = [];
      for (const g of groupedIllustrations) {
        if (!collapsedGroups.has(g.id)) {
          flat.push(...g.items);
        }
      }
      return flat;
    }
    return items;
  }, [groupedIllustrations, collapsedGroups, items]);

  const toggleGroupCollapse = useCallback((groupId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── Handlers ───────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIllustration(deleteTarget.id);
      setResults((prev) => prev ? {
        ...prev,
        items: prev.items.filter((i) => i.id !== deleteTarget.id),
        total: prev.total - 1,
      } : prev);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      addToast('Illustration deleted', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCardClick = (ill) => {
    setSelectedIds(new Set());
    setLastClickedId(ill.id);
    const idx = displayedItems.findIndex((i) => i.id === ill.id);
    if (idx !== -1) setLightboxIndex(idx);
  };

  const handleCtrlClick = (ill) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ill.id)) next.delete(ill.id);
      else next.add(ill.id);
      return next;
    });
    setLastClickedId(ill.id);
  };

  const handleShiftClick = (ill) => {
    if (lastClickedId === null) {
      handleCardClick(ill);
      return;
    }
    const lastIdx = displayedItems.findIndex((i) => i.id === lastClickedId);
    const currIdx = displayedItems.findIndex((i) => i.id === ill.id);
    if (lastIdx === -1 || currIdx === -1) return;
    const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
    const rangeIds = displayedItems.slice(start, end + 1).map((i) => i.id);
    setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
    setLastClickedId(ill.id);
  };

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteIllustration(id);
      } catch {
        failed++;
      }
    }
    setBatchDeleting(false);
    setSelectedIds(new Set());
    setLastClickedId(null);
    setResults((prev) => prev ? {
      ...prev,
      items: prev.items.filter((i) => !ids.includes(i.id)),
      total: prev.total - (ids.length - failed),
    } : prev);
    if (failed === 0) {
      addToast(`${ids.length} illustration(s) deleted`, 'success');
    } else {
      addToast(`${ids.length - failed} deleted, ${failed} failed`, 'error');
    }
  };

  const handleBatchDownload = async () => {
    const selected = items.filter((i) => selectedIds.has(i.id));
    addToast(`Downloading ${selected.length} file(s)...`, 'success');
    for (const ill of selected) {
      try {
        const res = await fetch(`http://localhost:8000${ill.file_url}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ill.original_filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // continue
      }
    }
  };

  const handleLightboxDelete = async (ill) => {
    try {
      await deleteIllustration(ill.id);
      setResults((prev) => prev ? {
        ...prev,
        items: prev.items.filter((i) => i.id !== ill.id),
        total: prev.total - 1,
      } : prev);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(ill.id); return next; });
      addToast('Illustration deleted', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete', 'error');
    }
  };

  const cardProps = useCallback((ill) => ({
    key: ill.id,
    illustration: ill,
    onClick: handleCardClick,
    onCtrlClick: handleCtrlClick,
    onShiftClick: handleShiftClick,
    onDelete: setDeleteTarget,
    isSelected: selectedIds.has(ill.id),
    showHoverActions: true,
  }), [selectedIds, lastClickedId, displayedItems]);

  // ── Render ─────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 shrink-0">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-100">
            Search: <span className="text-purple-400">{query}</span>
          </h2>
          {results && <span className="text-sm text-gray-500">{results.total} results</span>}

          {/* Group By controls */}
          {items.length > 1 && (
            <div className="flex items-center gap-1 ml-auto">
              <select
                value={groupBy}
                onChange={(e) => { setGroupBy(e.target.value); setCollapsedGroups(new Set()); }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 appearance-none cursor-pointer"
              >
                {GROUP_BY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-gray-900 text-gray-200">
                    {opt.label}
                  </option>
                ))}
              </select>
              {groupBy !== 'none' && (
                <button
                  onClick={() => setShowGroupConfig(true)}
                  className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
                  title={`Configure ${groupBy === 'tag' ? 'Tag' : 'Prompt'} Groups`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Searching...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-red-400 text-sm">{error}</div>
          ) : !results || results.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-600">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm">No matching illustrations found</p>
            </div>
          ) : groupedIllustrations ? (
            /* Grouped rendering */
            <div>
              {groupedIllustrations.map((group) => (
                <ColorGroup
                  key={group.id}
                  group={group}
                  collapsed={collapsedGroups.has(group.id)}
                  onToggle={() => toggleGroupCollapse(group.id)}
                >
                  {group.items.map((ill) => (
                    <IllustrationCard {...cardProps(ill)} />
                  ))}
                </ColorGroup>
              ))}
            </div>
          ) : (
            /* Flat grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              <AnimatePresence mode="popLayout">
                {items.map((ill) => (
                  <IllustrationCard {...cardProps(ill)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Key hints */}
        {selectedIds.size === 0 && items.length > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-4 py-2 rounded-lg bg-black/50 backdrop-blur text-xs text-gray-500 flex items-center gap-3 select-none">
            <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">Ctrl+Click</kbd> multi-select</span>
            <span className="text-gray-700">|</span>
            <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">Shift+Click</kbd> range select</span>
          </div>
        )}

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-[55] bg-gray-900 border-t border-gray-800 px-6 py-4 flex items-center justify-between shadow-2xl"
          >
            <span className="text-sm text-gray-300">{selectedIds.size} selected</span>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchDownload}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-sm text-white transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {batchDeleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => { setSelectedIds(new Set()); setLastClickedId(null); }}
                className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Group Config Modal */}
      <AnimatePresence>
        {showGroupConfig && (
          <GroupConfigModal
            type={groupBy}
            pairs={activeConfig.pairs}
            palette={activeConfig.palette}
            otherColor={activeConfig.otherColor}
            onSave={(pairs) => {
              activeConfig.setPairs(pairs);
              setShowGroupConfig(false);
            }}
            onClose={() => setShowGroupConfig(false)}
          />
        )}
      </AnimatePresence>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          illustrations={displayedItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
        />
      )}

      {/* Confirm: delete illustration */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Illustration"
          message={`Are you sure you want to delete "${deleteTarget.original_filename}"?`}
          confirmText="Delete"
          danger
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
