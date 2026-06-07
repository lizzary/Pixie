import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchIllustrations } from '../api';

export default function SearchOverlay({ query, onClose }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgErrors, setImgErrors] = useState({});

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

  const handleImgError = (id) => {
    setImgErrors((prev) => ({ ...prev, [id]: true }));
  };

  return (
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
        ) : results.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm">No matching illustrations found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            <AnimatePresence mode="popLayout">
              {results.items.map((ill) => (
                <motion.div
                  key={ill.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden"
                >
                  <div className="aspect-square bg-gray-800 flex items-center justify-center overflow-hidden">
                    {imgErrors[ill.id] ? (
                      <span className="text-gray-600 text-xs">Load failed</span>
                    ) : (
                      <img
                        src={`http://localhost:8000${ill.thumbnail_url}`}
                        alt={ill.original_filename}
                        onError={() => handleImgError(ill.id)}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-gray-400 truncate">{ill.artist_name}</p>
                    {ill.tags && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ill.tags.split(',').filter(Boolean).slice(0, 3).map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
