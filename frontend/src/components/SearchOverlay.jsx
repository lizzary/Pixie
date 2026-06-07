import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Settings, Download, Trash2, X, Monitor } from 'lucide-react';
import useQuality, { QUALITY_OPTIONS } from '../hooks/useQuality';
import { searchIllustrations, deleteIllustration } from '../api';
import { useToast } from './Toast';
import IllustrationCard from './IllustrationCard';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';
import ColorGroup from './ColorGroup';
import DropdownSelect from './DropdownSelect';
import TagPromptSuggest from './TagPromptSuggest';
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
  const [filterQuery, setFilterQuery] = useState('');
  const [filterScope, setFilterScope] = useState('all');
  const { addToast } = useToast();
  const [quality, setQuality] = useQuality();

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

  // ── Client-side filter (tags + prompts) ──────────────

  const filteredItems = useMemo(() => {
    if (!filterQuery.trim()) return items;
    const q = filterQuery.trim().toLowerCase();
    return items.filter((ill) => {
      const tags = (ill.tags || '').toLowerCase();
      const ext = ill.extended_data || {};
      const pos = (ext['Positive Prompt'] || '').toLowerCase();
      const neg = (ext['Negative Prompt'] || '').toLowerCase();
      switch (filterScope) {
        case 'tag':
          return tags.includes(q);
        case 'prompt':
          return pos.includes(q) || neg.includes(q);
        default:
          return tags.includes(q) || pos.includes(q) || neg.includes(q);
      }
    });
  }, [items, filterQuery, filterScope]);

  // ── Grouping ───────────────────────────────────────────

  const groupedIllustrations = useMemo(() => {
    if (groupBy === 'none' || activeConfig.pairs.length === 0 || filteredItems.length === 0) return null;
    const matchFn = groupBy === 'tag' ? matchesTagPair : matchesPromptPair;
    return groupIllustrations(filteredItems, activeConfig.pairs, activeConfig.otherColor, matchFn);
  }, [groupBy, filteredItems, activeConfig]);

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
    return filteredItems;
  }, [groupedIllustrations, collapsedGroups, filteredItems]);

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
      handleCtrlClick(ill);
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
    quality,
  }), [selectedIds, lastClickedId, displayedItems, quality]);

  // ── Render ─────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-surface-primary">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-edge-primary shrink-0">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-content-primary">
            Search: <span className="text-accent">{query}</span>
          </h2>
          {results && (
            <>
              <span className="text-sm text-content-muted">
                {filterQuery.trim()
                  ? `${filteredItems.length} of ${results.total} results`
                  : `${results.total} results`}
              </span>
              {filterQuery.trim() && filterScope !== 'all' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium uppercase">
                  {filterScope}
                </span>
              )}
            </>
          )}

          {/* Group By & Quality controls */}
          <div className="ml-auto flex items-center gap-3">
            {/* In-page search */}
            <TagPromptSuggest
              type="mixed"
              value={filterQuery}
              onChange={(v) => { setFilterQuery(v); if (!v) setFilterScope('all'); }}
              onSelect={(v, scope) => { setFilterQuery(v); setFilterScope(scope); }}
              onEnter={(v) => { setFilterQuery(v); setFilterScope('all'); }}
              placeholder="Filter by tag or prompt..."
              className="w-52"
              inputClassName="w-full pl-3 pr-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary placeholder-content-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
            {items.length > 1 && (
              <DropdownSelect
                icon={Layers}
                label="Group"
                options={GROUP_BY_OPTIONS}
                value={groupBy}
                onChange={(v) => { setGroupBy(v); setCollapsedGroups(new Set()); }}
                rightElement={
                  groupBy !== 'none' ? (
                    <button
                      onClick={() => setShowGroupConfig(true)}
                      className="p-2 rounded-lg bg-surface-tertiary border border-edge-secondary hover:border-edge-primary text-content-tertiary hover:text-content-primary transition-all"
                      title={`Configure ${groupBy === 'tag' ? 'Tag' : 'Prompt'} Groups`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            )}
            <DropdownSelect
              icon={Monitor}
              label="Quality"
              options={QUALITY_OPTIONS}
              value={quality}
              onChange={setQuality}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-content-muted text-sm">Searching...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-danger text-sm">{error}</div>
          ) : !results || results.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-content-muted">
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
                {filteredItems.map((ill) => (
                  <IllustrationCard {...cardProps(ill)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Key hints */}
        {selectedIds.size === 0 && items.length > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-4 py-2 rounded-lg bg-overlay/50 backdrop-blur text-xs text-content-muted flex items-center gap-3 select-none">
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Ctrl+Click</kbd> multi-select</span>
            <span className="text-content-muted/50">|</span>
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Shift+Click</kbd> range select</span>
          </div>
        )}

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-[55] bg-surface-secondary border-t border-edge-primary px-6 py-4 flex items-center justify-between shadow-2xl"
          >
            <span className="text-sm text-content-secondary">{selectedIds.size} selected</span>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchDownload}
                className="px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-edge-secondary text-sm text-content-secondary hover:text-content-primary transition-all flex items-center gap-2 font-medium border border-transparent hover:border-edge-primary"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="px-4 py-2 rounded-xl bg-danger hover:bg-danger-hover disabled:opacity-50 text-sm text-white shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all hover:scale-[1.02] flex items-center gap-2 font-medium"
              >
                <Trash2 className="w-4 h-4" />
                {batchDeleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => { setSelectedIds(new Set()); setLastClickedId(null); }}
                className="px-3 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary transition-colors flex items-center gap-1.5"
              >
                <X className="w-4 h-4" />
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
          onUpdate={(updated) => {
            setResults((prev) => prev ? {
              ...prev,
              items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
            } : prev);
          }}
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
