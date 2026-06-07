import { useState } from 'react';
import { Link } from 'react-router-dom';
import TagPromptSuggest from './TagPromptSuggest';

export default function Layout({ children, onSearch }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed && onSearch) onSearch(trimmed);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href="/" className="text-xl font-bold tracking-tight text-white hover:text-purple-400 transition-colors">
              Gallery
            </a>
            <nav className="flex items-center gap-4">
              <Link to="/tags" className="text-sm text-gray-400 hover:text-purple-400 transition-colors">
                Tags
              </Link>
              <Link to="/prompts" className="text-sm text-gray-400 hover:text-purple-400 transition-colors">
                Prompts
              </Link>
            </nav>
          </div>
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <TagPromptSuggest
              type="tag"
              value={query}
              onChange={setQuery}
              placeholder="Search tags..."
              inputClassName="w-64 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-medium transition-colors"
            >
              Search
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
