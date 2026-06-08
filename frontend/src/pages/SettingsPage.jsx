import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Monitor, Cpu, Globe, Download, ChevronDown, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import NamingFormatInput from '../components/NamingFormatInput';
import useDownloadConfig from '../hooks/useDownloadConfig';
import { listModels, uploadModel, deleteModel } from '../api';

const BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000';
const LANG_OPTIONS = [
  { value: 'en', labelKey: 'settings.general.language.en' },
  { value: 'zh', labelKey: 'settings.general.language.zh' },
];

function modelDisplayName(m) {
  if (m.type === 'huggingface') return m.repo || m.name;
  return m.name;
}

export default function SettingsPage() {
  const { locale, setLocale, t } = useLocale();
  const { addToast } = useToast();
  const { format, setFormat } = useDownloadConfig();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formatSaved, setFormatSaved] = useState(false);

  // Model management state
  const [models, setModels] = useState([]);
  const [activeRepo, setActiveRepo] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const modelDropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchModels = useCallback(() => {
    listModels()
      .then(data => {
        setModels(data.models || []);
        setActiveRepo(data.active_repo || '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings`)
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
    fetchModels();
  }, [fetchModels]);

  // Click-outside for model dropdown
  useEffect(() => {
    const handler = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
    };
    if (modelDropdownOpen) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  const handleFormatBlur = () => {
    if (formatSaved) return;
    addToast(t('settings.toast.saved'), 'success');
    setFormatSaved(true);
    setTimeout(() => setFormatSaved(false), 3000);
  };

  const handleBackendSettingChange = async (key, value) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setSettings(updated);
      addToast(t('settings.toast.saved'), 'success');
    } catch {
      setSettings(prev => prev ? { ...prev, [key]: !value } : prev);
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleModelSelect = async (repo) => {
    setModelDropdownOpen(false);
    if (repo === activeRepo) return;
    setActiveRepo(repo);
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagger_model: repo }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setSettings(updated);
      addToast(t('settings.toast.saved'), 'success');
    } catch {
      setActiveRepo(activeRepo);
      addToast(t('settings.toast.saveFailed'), 'error');
    }
  };

  const handleModelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadModel(file);
      addToast(t('settings.toast.saved'), 'success');
      fetchModels();
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleModelDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteModel(deleteTarget.name);
      addToast(t('settings.toast.saved'), 'success');
      fetchModels();
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const selectedLabel = activeRepo
    ? (models.find(m => (m.type === 'huggingface' ? m.repo : m.name) === activeRepo) || { name: activeRepo })
    : null;
  const selectedDisplayName = selectedLabel
    ? modelDisplayName(selectedLabel)
    : t('settings.indexing.modelNone');

  return (
    <div className="min-h-screen bg-surface-primary text-content-primary">
      <header className="sticky top-0 z-40 border-b border-edge-primary bg-surface-primary/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link to="/" className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">{t('settings.heading')}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* General */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-4 flex items-center gap-2">
            <Monitor className="w-4 h-4" />
            {t('settings.general.heading')}
          </h2>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-content-tertiary" />
                <span className="text-sm font-medium text-content-primary">{t('settings.general.language')}</span>
              </div>
              <select
                value={locale}
                onChange={e => setLocale(e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Image Indexing */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-1 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            {t('settings.indexing.heading')}
          </h2>
          <p className="text-xs text-content-muted mb-4 ml-6">
            {t('settings.indexing.description')}
          </p>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            {/* Model selector */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.model')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.modelDesc')}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {/* Dropdown */}
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    onClick={() => setModelDropdownOpen(v => !v)}
                    disabled={uploading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary hover:border-accent/50 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all min-w-[180px]"
                  >
                    <span className="flex-1 text-left truncate max-w-[180px]">{selectedDisplayName}</span>
                    <ChevronDown className={`w-4 h-4 text-content-tertiary transition-transform flex-shrink-0 ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {modelDropdownOpen && (
                    <div className="absolute top-full mt-1 right-0 w-[320px] bg-surface-secondary border border-edge-primary rounded-xl shadow-2xl z-50 overflow-hidden">
                      {/* Default option */}
                      <button
                        onClick={() => handleModelSelect('')}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-surface-tertiary ${
                          !activeRepo ? 'text-accent bg-accent/5' : 'text-content-primary'
                        }`}
                      >
                        <span className="truncate">{t('settings.indexing.modelNone')}</span>
                        {!activeRepo && (
                          <span className="w-4 h-4 rounded-full bg-accent flex items-center justify-center flex-shrink-0 ml-2">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                      </button>

                      <div className="border-t border-edge-subtle" />

                      {/* Model list */}
                      {models.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-content-muted">
                          {t('settings.indexing.modelNoModels')}
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          {models.map(m => {
                            const repo = m.type === 'huggingface' ? m.repo : m.name;
                            const isActive = repo === activeRepo;
                            return (
                              <div
                                key={m.name}
                                className={`flex items-center group transition-colors ${
                                  isActive ? 'bg-accent/5' : 'hover:bg-surface-tertiary'
                                }`}
                              >
                                <button
                                  onClick={() => handleModelSelect(repo)}
                                  className={`flex-1 text-left px-4 py-2.5 text-sm truncate transition-colors ${
                                    isActive ? 'text-accent font-medium' : 'text-content-primary'
                                  }`}
                                >
                                  {modelDisplayName(m)}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget(m);
                                  }}
                                  className="px-3 py-2.5 text-content-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 flex-shrink-0 mr-1"
                                  title={t('settings.indexing.modelDeleteConfirm')}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className={`p-2 rounded-lg border border-edge-secondary bg-surface-tertiary hover:bg-edge-secondary hover:border-accent/50 text-content-tertiary hover:text-accent transition-all ${
                    uploading ? 'opacity-50 cursor-wait' : ''
                  }`}
                  title={t('settings.indexing.modelUpload')}
                >
                  <Upload className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pth,.pt,.bin,.safetensors,.ckpt,.onnx,.zip"
                  onChange={handleModelUpload}
                />
              </div>
            </div>

            {/* Auto-tag toggle */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.autoTag')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.autoTagDesc')}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings?.auto_tag ?? true}
                disabled={saving || !settings}
                onClick={() => handleBackendSettingChange('auto_tag', !(settings?.auto_tag ?? true))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                  (settings?.auto_tag ?? true) ? 'bg-accent' : 'bg-gray-400 dark:bg-gray-600'
                } ${saving ? 'opacity-50 cursor-wait' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (settings?.auto_tag ?? true) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* GPU toggle */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.gpu')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.gpuDesc')}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings?.gpu_enabled ?? false}
                disabled={saving || !settings}
                onClick={() => handleBackendSettingChange('gpu_enabled', !(settings?.gpu_enabled ?? false))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                  (settings?.gpu_enabled ?? false) ? 'bg-accent' : 'bg-gray-400 dark:bg-gray-600'
                } ${saving ? 'opacity-50 cursor-wait' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (settings?.gpu_enabled ?? false) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Download Settings */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-1 flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('settings.download.heading')}
          </h2>
          <p className="text-xs text-content-muted mb-4 ml-6">
            {t('settings.download.description')}
          </p>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            <div className="px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.download.namingFormat')}</span>
                <p className="text-xs text-content-muted mt-0.5 mb-3">{t('settings.download.namingFormatDesc')}</p>
              </div>
              <NamingFormatInput
                value={format}
                onChange={setFormat}
                onBlur={handleFormatBlur}
                placeholder={t('settings.download.namingFormatPlaceholder')}
              />
            </div>
          </div>
        </section>
      </main>

      {/* Delete model confirmation modal */}
      {deleteTarget && (
        <ConfirmModal
          title={t('settings.indexing.modelDeleteTitle')}
          message={t('settings.indexing.modelDeleteMessage', { name: modelDisplayName(deleteTarget) })}
          confirmText={t('settings.indexing.modelDeleteConfirm')}
          cancelText={t('confirmModal.cancel')}
          onConfirm={handleModelDelete}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}
    </div>
  );
}
