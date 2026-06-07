import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import ArtistCard from '../components/ArtistCard';
import CreateArtistModal from '../components/CreateArtistModal';
import ArtistOverlay from '../components/ArtistOverlay';
import SearchOverlay from '../components/SearchOverlay';
import { listArtists, createArtist, deleteArtist } from '../api';

export default function HomePage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [searchQuery, setSearchQuery] = useState(null);

  const fetchArtists = useCallback(async () => {
    try {
      const data = await listArtists();
      setArtists(data);
      setError('');
    } catch (err) {
      setError(err.message || '加载画师列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  const handleCreate = async (name) => {
    await createArtist(name);
    await fetchArtists();
  };

  const handleDelete = async (artistId) => {
    try {
      await deleteArtist(artistId);
      await fetchArtists();
      setError('');
    } catch (err) {
      setError(err.message || '删除失败');
    }
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
  };

  return (
    <Layout onSearch={handleSearch}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-900/20 border border-red-800/50 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-300 hover:text-red-200 underline text-xs">关闭</button>
          </div>
        )}

        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">画师</h1>
            <p className="text-sm text-gray-500 mt-1">{artists.length} 位画师</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-medium shadow-lg shadow-purple-600/20 transition-all"
          >
            + 新建画师
          </button>
        </div>

        {/* Artist grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500 text-sm">加载中...</div>
        ) : artists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm">还没有画师，点击上方按钮创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {artists.map((artist) => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                onClick={setSelectedArtist}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateArtistModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Artist overlay */}
      {selectedArtist && (
        <ArtistOverlay
          artist={selectedArtist}
          onClose={() => setSelectedArtist(null)}
          onArtistUpdated={fetchArtists}
        />
      )}

      {/* Search overlay */}
      {searchQuery && (
        <SearchOverlay
          query={searchQuery}
          onClose={() => setSearchQuery(null)}
        />
      )}
    </Layout>
  );
}
