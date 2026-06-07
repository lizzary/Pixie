import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchIllustrations, updateArtist, deleteIllustration } from '../api';
import { useToast } from './Toast';
import IllustrationCard from './IllustrationCard';
import Lightbox from './Lightbox';
import ConfirmModal from './ConfirmModal';

export default function SearchOverlay({ query, onClose }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [coverTarget, setCoverTarget] = useState(null);
  const { addToast } = useToast();

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

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIllustration(deleteTarget.id);
      setResults((prev) => prev ? {
        ...prev,
        items: prev.items.filter((i) => i.id !== deleteTarget.id),
        total: prev.total - 1,
      } : prev);
      addToast('Illustration deleted', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSetCoverConfirm = async () => {
    if (!coverTarget) return;
    try {
      await updateArtist(coverTarget.artist_id, { cover_illustration_id: coverTarget.id });
      addToast('Cover updated successfully', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to set cover', 'error');
    } finally {
      setCoverTarget(null);
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
      addToast('Illustration deleted', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete', 'error');
    }
  };

  const handleLightboxSetCover = async (ill) => {
    setCoverTarget(ill);
  };

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
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              <AnimatePresence mode="popLayout">
                {results.items.map((ill, idx) => (
                  <IllustrationCard
                    key={ill.id}
                    illustration={ill}
                    onClick={() => setLightboxIndex(idx)}
                    onSetCover={setCoverTarget}
                    onDelete={setDeleteTarget}
                    showHoverActions={true}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Confirm: set as cover */}
      {coverTarget && (
        <ConfirmModal
          title="Set as Cover"
          message={`Use "${coverTarget.original_filename}" as the cover for ${coverTarget.artist_name}?`}
          confirmText="Set Cover"
          onConfirm={handleSetCoverConfirm}
          onCancel={() => setCoverTarget(null)}
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

      {/* Lightbox */}
      {lightboxIndex !== null && results && (
        <Lightbox
          illustrations={results.items}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
          onSetCover={handleLightboxSetCover}
        />
      )}
    </>
  );
}
