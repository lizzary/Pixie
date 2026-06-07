import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listIllustrations, uploadIllustrations, updateArtist, deleteIllustration } from '../api';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';

export default function ArtistOverlay({ artist, onClose, onArtistUpdated }) {
  const [illustrations, setIllustrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [coverTarget, setCoverTarget] = useState(null);
  const [lightboxIll, setLightboxIll] = useState(null);
  const fileInputRef = useRef(null);

  const fetchIllustrations = useCallback(async () => {
    try {
      const data = await listIllustrations(artist.id);
      setIllustrations(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [artist.id]);

  useEffect(() => {
    fetchIllustrations();
  }, [fetchIllustrations]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      await uploadIllustrations(artist.id, files);
      await fetchIllustrations();
      if (onArtistUpdated) onArtistUpdated();
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSetCoverConfirm = async () => {
    if (!coverTarget) return;
    try {
      await updateArtist(artist.id, { cover_illustration_id: coverTarget.id });
      setCoverTarget(null);
      if (onArtistUpdated) onArtistUpdated();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIllustration(deleteTarget.id);
      setDeleteTarget(null);
      await fetchIllustrations();
      if (onArtistUpdated) onArtistUpdated();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-gray-100">{artist.name}</h2>
            <span className="text-sm text-gray-500">{illustrations.length} illustrations</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-400 text-sm">
              {error}
              <button onClick={() => setError('')} className="ml-2 underline hover:text-red-300">Dismiss</button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading...</div>
          ) : illustrations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-600">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
              <p className="text-sm">No illustrations yet. Click Upload above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              <AnimatePresence mode="popLayout">
                {illustrations.map((ill) => (
                  <IllustrationGridItem
                    key={ill.id}
                    illustration={ill}
                    onSetCover={setCoverTarget}
                    onDelete={setDeleteTarget}
                    onClick={setLightboxIll}
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
          message={`Use "${coverTarget.original_filename}" as the cover for ${artist.name}?`}
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
      {lightboxIll && (
        <Lightbox
          illustration={lightboxIll}
          onClose={() => setLightboxIll(null)}
        />
      )}
    </>
  );
}

function IllustrationGridItem({ illustration, onSetCover, onDelete, onClick }) {
  const [imgError, setImgError] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="group relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden hover:border-purple-500/40 transition-colors"
    >
      {/* Thumbnail */}
      <div
        className="aspect-square bg-gray-800 flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={() => onClick(illustration)}
      >
        {imgError ? (
          <span className="text-gray-600 text-xs">Load failed</span>
        ) : (
          <img
            src={`http://localhost:8000${illustration.thumbnail_url}`}
            alt={illustration.original_filename}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        )}
      </div>

      {/* Hover actions */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onSetCover(illustration); }}
          className="px-2 py-1 rounded text-xs bg-purple-600/80 hover:bg-purple-500 text-white transition-colors"
        >
          Set Cover
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(illustration); }}
          className="px-2 py-1 rounded text-xs bg-red-600/80 hover:bg-red-500 text-white transition-colors"
        >
          Delete
        </button>
      </div>

      {/* Tags */}
      {illustration.tags && (
        <div className="p-2">
          <div className="flex flex-wrap gap-1">
            {illustration.tags.split(',').filter(Boolean).slice(0, 3).map((tag, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">
                {tag.trim()}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
