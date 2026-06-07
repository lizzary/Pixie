import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTags } from '../api';

export default function TagsPage() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? tags.filter((t) => t.toLowerCase().includes(filter.toLowerCase()))
    : tags;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold">All Tags</h1>
            <span className="text-sm text-gray-500">{tags.length} unique tags</span>
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags..."
            className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 w-64"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-64 text-red-400">{error}</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filtered.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700/50 text-sm text-gray-300 hover:bg-gray-700/80 hover:border-gray-600/50 hover:text-gray-200 transition-colors cursor-default"
              >
                {tag}
              </span>
            ))}
            {filtered.length === 0 && (
              <p className="text-gray-600 text-sm">No tags found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
