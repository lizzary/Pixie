import { useState } from 'react';
import { motion } from 'framer-motion';
import TagPromptSuggest from './TagPromptSuggest';

export default function GroupConfigModal({ type, pairs, palette, otherColor, onSave, onClose }) {
  const label = type === 'tag' ? 'Tag' : 'Prompt';

  // Local editing copy — changes not persisted until Save
  const [editingPairs, setEditingPairs] = useState(() =>
    pairs.map((p) => ({ ...p, keywords: [...p.keywords] }))
  );

  const handleKeywordChange = (pairId, index, value) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        const kw = [...p.keywords];
        kw[index] = value;
        return { ...p, keywords: kw };
      })
    );
  };

  const handleAddKeyword = (pairId) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        return { ...p, keywords: [...p.keywords, ''] };
      })
    );
  };

  const handleRemoveKeyword = (pairId, index) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        const kw = p.keywords.filter((_, i) => i !== index);
        return { ...p, keywords: kw.length === 0 ? [''] : kw };
      })
    );
  };

  const handleAddPair = () => {
    const id = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idx = editingPairs.length;
    const color = palette[idx % palette.length];
    setEditingPairs((prev) => [
      ...prev,
      { id, keywords: [''], color: color.bg, borderColor: color.border },
    ]);
  };

  const handleRemovePair = (pairId) => {
    setEditingPairs((prev) => prev.filter((p) => p.id !== pairId));
  };

  const handleSave = () => {
    const cleaned = editingPairs
      .map((p) => ({
        ...p,
        keywords: p.keywords.map((k) => k.trim()).filter(Boolean),
      }))
      .filter((p) => p.keywords.length > 0);
    onSave(cleaned);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">
            Configure {label} Groups
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Each group defines a set of keywords. An illustration is placed in the{' '}
            <strong className="text-gray-400">first</strong> group where{' '}
            <strong className="text-gray-400">all</strong> keywords match.
            {type === 'prompt' && (
              <> Matching searches both the Positive and Negative prompt text.</>
            )}
            {' '}Unmatched illustrations go to &ldquo;Other&rdquo;.
          </p>

          {editingPairs.length === 0 && (
            <div className="text-center py-6 text-gray-600 text-sm">
              No groups defined yet. Click &ldquo;Add Group&rdquo; below.
            </div>
          )}

          {editingPairs.map((pair, pi) => {
            const colorIdx = pi % palette.length;
            const color = palette[colorIdx];
            return (
              <div
                key={pair.id}
                className="rounded-xl p-4 border"
                style={{ backgroundColor: color.bg, borderColor: color.border }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: color.border }}
                    />
                    <span className="text-sm font-medium text-gray-200">
                      Group {pi + 1}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemovePair(pair.id)}
                    className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
                    title="Remove group"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-1.5">
                  {pair.keywords.map((kw, ki) => (
                    <div key={ki} className="flex items-center gap-1.5">
                      <TagPromptSuggest
                        type={type}
                        value={kw}
                        onChange={(val) => handleKeywordChange(pair.id, ki, val)}
                        placeholder={type === 'tag' ? 'e.g. girl' : 'e.g. masterpiece'}
                        className="flex-1"
                        inputClassName="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-white/30 transition-colors"
                      />
                      {pair.keywords.length > 1 && (
                        <button
                          onClick={() => handleRemoveKeyword(pair.id, ki)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => handleAddKeyword(pair.id)}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1 mt-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add keyword
                  </button>
                </div>
              </div>
            );
          })}

          <button
            onClick={handleAddPair}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-800 hover:border-gray-600 text-gray-600 hover:text-gray-400 text-sm transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Group
          </button>

          {/* Other group preview */}
          <div
            className="rounded-xl p-3 border flex items-center gap-3"
            style={{ backgroundColor: otherColor.bg, borderColor: otherColor.border }}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: otherColor.border }}
            />
            <span className="text-sm text-gray-400">Other</span>
            <span className="text-xs text-gray-600">— unmatched illustrations</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
