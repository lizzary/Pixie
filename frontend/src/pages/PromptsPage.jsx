import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPrompts } from '../api';

export default function PromptsPage() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listPrompts()
      .then(setPrompts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? prompts.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
    : prompts;

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
            <h1 className="text-xl font-semibold">All Prompts</h1>
            <span className="text-sm text-gray-500">{prompts.length} unique prompt terms</span>
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter prompts..."
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
            {filtered.map((prompt) => (
              <span
                key={prompt}
                className="px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700/50 text-sm text-gray-300 hover:bg-gray-700/80 hover:border-gray-600/50 hover:text-gray-200 transition-colors cursor-default"
              >
                {prompt}
              </span>
            ))}
            {filtered.length === 0 && (
              <p className="text-gray-600 text-sm">No prompts found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
