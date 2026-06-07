import { useState } from 'react';
import { motion } from 'framer-motion';

export default function IllustrationCard({
  illustration,
  onClick,
  onCtrlClick,
  onShiftClick,
  onSetCover,
  onDelete,
  isSelected = false,
  showHoverActions = true,
}) {
  const [imgError, setImgError] = useState(false);

  const handleClick = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onCtrlClick?.(illustration);
    } else if (e.shiftKey) {
      e.preventDefault();
      onShiftClick?.(illustration);
    } else {
      onClick(illustration);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`group relative bg-gray-900 rounded-lg border overflow-hidden transition-colors ${
        isSelected ? 'border-purple-500 ring-2 ring-purple-500/40' : 'border-gray-800 hover:border-purple-500/40'
      }`}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center shadow-lg">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Thumbnail */}
      <div
        className="aspect-square bg-gray-800 flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={handleClick}
      >
        {imgError ? (
          <span className="text-gray-600 text-xs">Load failed</span>
        ) : (
          <img
            src={`http://localhost:8000${illustration.thumbnail_url}`}
            alt={illustration.original_filename}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-transform duration-200 ${
              showHoverActions ? 'group-hover:scale-105' : ''
            }`}
          />
        )}
      </div>

      {/* Hover actions */}
      {showHoverActions && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-center gap-2">
          {onSetCover && (
            <button
              onClick={(e) => { e.stopPropagation(); onSetCover(illustration); }}
              className="px-2 py-1 rounded text-xs bg-purple-600/80 hover:bg-purple-500 text-white transition-colors"
            >
              Set Cover
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(illustration); }}
              className="px-2 py-1 rounded text-xs bg-red-600/80 hover:bg-red-500 text-white transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
