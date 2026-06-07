import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Trash2, Info } from 'lucide-react';
import { getIllustrationMetadata, updateIllustration } from '../api';
import TagPromptSuggest from './TagPromptSuggest';
import { useLocale } from '../contexts/LocaleContext';

export default function Lightbox({ illustrations, initialIndex, onClose, onDelete, onSetCover, onUpdate }) {
  const { t } = useLocale();

  const META_KEYS = useMemo(() => [
    { key: 'Model', label: t('lightbox.meta.model') },
    { key: 'Seed', label: t('lightbox.meta.seed') },
    { key: 'Positive Prompt', label: t('lightbox.meta.positivePrompt') },
    { key: 'Negative Prompt', label: t('lightbox.meta.negativePrompt') },
    { key: 'Sampler', label: t('lightbox.meta.sampler') },
    { key: 'Scheduler', label: t('lightbox.meta.scheduler') },
    { key: 'Steps', label: t('lightbox.meta.steps') },
    { key: 'CFG Scale', label: t('lightbox.meta.cfgScale') },
    { key: 'LoRAs', label: t('lightbox.meta.loras') },
  ], [t]);

  const FILEINFO_KEYS = useMemo(() => [
    { key: 'resolution', label: t('lightbox.fileInfo.resolution') },
    { key: 'size', label: t('lightbox.fileInfo.fileSize') },
    { key: 'date', label: t('lightbox.fileInfo.dateCreated') },
  ], [t]);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showDetails, setShowDetails] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [draftTags, setDraftTags] = useState([]);
  const [savingTags, setSavingTags] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  // Sync from initialIndex when reopened with different image
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Clamp index when list changes
  useEffect(() => {
    if (illustrations.length === 0) {
      onClose();
      return;
    }
    if (currentIndex >= illustrations.length) {
      setCurrentIndex(Math.max(0, illustrations.length - 1));
    }
  }, [illustrations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset per-image state on navigation
  useEffect(() => {
    setMetadata(null);
    setMetaError('');
    setImageError(false);
    setTagsExpanded(false);
    setEditingTags(false);
    setDraftTags([]);
    setNewTagInput('');
  }, [currentIndex]);

  // Fetch metadata when details panel opens
  useEffect(() => {
    if (showDetails && !metadata && !loadingMeta) {
      const ill = illustrations[currentIndex];
      if (!ill) return;
      setLoadingMeta(true);
      getIllustrationMetadata(ill.id)
        .then(setMetadata)
        .catch((err) => setMetaError(err.message))
        .finally(() => setLoadingMeta(false));
    }
  }, [showDetails, metadata, loadingMeta, currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentIllustration = illustrations[currentIndex];
  const total = illustrations.length;

  const navigate = useCallback((delta) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return total - 1;
      if (next >= total) return 0;
      return next;
    });
  }, [total]);

  // Keyboard handling
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowDetails((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, navigate]);

  if (!currentIllustration) return null;

  const allTags = currentIllustration.tags
    ? currentIllustration.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  // ── Tag editing handlers ────────────────────────────────

  const enterEditMode = () => {
    setDraftTags([...allTags]);
    setNewTagInput('');
    setEditingTags(true);
  };

  const cancelEdit = () => {
    setEditingTags(false);
    setDraftTags([]);
    setNewTagInput('');
  };

  const addDraftTag = (tag) => {
    const trimmed = tag.trim();
    if (trimmed && !draftTags.includes(trimmed)) {
      setDraftTags((prev) => [...prev, trimmed]);
    }
    setNewTagInput('');
  };

  const removeDraftTag = (tag) => {
    setDraftTags((prev) => prev.filter((t) => t !== tag));
  };

  const saveTags = async () => {
    setSavingTags(true);
    try {
      const updated = await updateIllustration(currentIllustration.id, {
        tags: draftTags.join(', '),
      });
      if (onUpdate) onUpdate(updated);
      setEditingTags(false);
    } catch {
      // keep edit mode open on failure
    } finally {
      setSavingTags(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] flex flex-col bg-overlay/95">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="flex items-center justify-between px-6 py-4 shrink-0"
        >
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm text-gray-400 truncate max-w-[200px]">
              {currentIllustration.original_filename}
            </span>
            {total > 1 && (
              <span className="text-xs text-gray-600">
                {currentIndex + 1} / {total}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Action buttons */}
            {onSetCover && (
              <button
                onClick={() => onSetCover(currentIllustration)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-accent/85 hover:bg-accent text-white shadow-lg shadow-accent/25 transition-all hover:scale-105 inline-flex items-center gap-1.5"
              >
                <Star className="w-3.5 h-3.5" />
                {t('lightbox.setCover')}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(currentIllustration)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-danger/85 hover:bg-danger text-white shadow-lg shadow-danger/25 transition-all hover:scale-105 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('lightbox.delete')}
              </button>
            )}

            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`px-4 py-2 rounded-xl text-sm font-medium shadow-lg transition-all hover:scale-105 inline-flex items-center gap-2 ${
                showDetails
                  ? 'bg-accent text-white shadow-accent/25'
                  : 'bg-white/10 hover:bg-white/20 text-gray-300'
              }`}
            >
              <Info className="w-4 h-4" />
              {t('lightbox.details')}
            </button>
          </div>
        </motion.div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Image area */}
          <motion.div layout className="flex-1 flex items-center justify-center p-4 relative">
            {imageError ? (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                <span className="text-sm">{currentIllustration.original_filename}</span>
              </div>
            ) : (
              <img
                src={`http://localhost:8000${currentIllustration.file_url}`}
                alt={currentIllustration.original_filename}
                onError={() => setImageError(true)}
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            )}

            {/* Navigation arrows */}
            {total > 1 && (
              <>
                <button
                  onClick={() => navigate(-1)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-all"
                >
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => navigate(1)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-all"
                >
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </motion.div>

          {/* Details panel */}
          {showDetails && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="shrink-0 border-l border-white/10 bg-overlay/80 backdrop-blur overflow-y-auto"
            >
              <div className="p-6 w-[360px]">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">{t('lightbox.panel.heading')}</h3>

                <div className="space-y-3">
                  {/* Group (always visible) */}
                  <div className="pb-3 border-b border-white/10">
                    <span className="text-xs text-gray-500">{t('lightbox.panel.group')}</span>
                    <p className="text-sm text-gray-200">{currentIllustration.group_name}</p>
                  </div>

                  {loadingMeta ? (
                    <p className="text-sm text-gray-500">{t('lightbox.panel.loading')}</p>
                  ) : metaError ? (
                    <p className="text-sm text-danger">{metaError}</p>
                  ) : metadata ? (
                    <>
                      {/* File info */}
                      {metadata.fileinfo && (
                        <div className="space-y-2 pb-3 border-b border-white/10">
                          {FILEINFO_KEYS.map(({ key, label }) => (
                            <InfoRow key={key} label={label} value={metadata.fileinfo[key]} />
                          ))}
                        </div>
                      )}

                      {/* Generation params */}
                      {META_KEYS.map(({ key, label }) => {
                        const value = metadata[key];
                        if (!value || value === 'N/A') return null;
                        return <InfoRow key={key} label={label} value={value} />;
                      })}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">{t('lightbox.panel.noMetadata')}</p>
                  )}

                  {/* Tags */}
                  <div className="pt-3 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">{t('lightbox.panel.tags')}</span>
                      {!editingTags && (
                        <button
                          onClick={enterEditMode}
                          className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                          title={t('lightbox.panel.editTags')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {editingTags ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {draftTags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs bg-accent/30 text-accent border border-accent/30"
                            >
                              {tag}
                              <button
                                onClick={() => removeDraftTag(tag)}
                                className="text-accent hover:text-accent-hover transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        </div>
                        <TagPromptSuggest
                          type="tag"
                          value={newTagInput}
                          onChange={setNewTagInput}
                          onEnter={() => addDraftTag(newTagInput)}
                          placeholder={t('lightbox.panel.addTag')}
                          className="w-full"
                          inputClassName="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 transition-colors"
                        />
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-gray-600">
                            {t('lightbox.panel.pressEnter')}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
                            >
                              {t('lightbox.panel.cancel')}
                            </button>
                            <button
                              onClick={saveTags}
                              disabled={savingTags}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shadow-lg shadow-accent/25 transition-all hover:scale-105"
                            >
                              {savingTags ? t('lightbox.panel.saving') : t('lightbox.panel.save')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : allTags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(tagsExpanded ? allTags : allTags.slice(0, 3)).map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-white/10 text-gray-300">
                            {tag}
                          </span>
                        ))}
                        {allTags.length > 3 && (
                          <button
                            onClick={() => setTagsExpanded((prev) => !prev)}
                            className="px-1.5 py-0.5 rounded text-xs bg-white/10 text-accent hover:text-accent-hover hover:bg-white/20 transition-colors inline-flex items-center gap-0.5"
                          >
                            {tagsExpanded ? (
                              <>
                                {t('lightbox.panel.collapse')}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </>
                            ) : (
                              <>
                                {t('lightbox.panel.expand', { n: allTags.length - 3 })}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 mt-1">{t('lightbox.panel.noTags')}</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Key hints */}
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-lg bg-overlay/50 backdrop-blur text-xs text-gray-500 flex items-center gap-3 select-none">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">&#8592;</kbd>
            <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">&#8594;</kbd>
            {' '}{t('lightbox.keyHints.navigate')}
          </span>
          <span className="text-gray-700">|</span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">Esc</kbd>
            {' '}{t('lightbox.keyHints.close')}
          </span>
          <span className="text-gray-700">|</span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">D</kbd>
            {' '}{t('lightbox.keyHints.details')}
          </span>
        </div>
      </div>
    </AnimatePresence>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-sm text-gray-200 break-words whitespace-pre-wrap">{String(value)}</p>
    </div>
  );
}
