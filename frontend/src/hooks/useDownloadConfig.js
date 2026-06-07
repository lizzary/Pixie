import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'gallery-download-naming-format';

export const NAMING_TAGS = [
  { key: 'date', label: 'date', always: true },
  { key: 'Resolution', label: 'Resolution', always: true },
  { key: 'File Size', label: 'File Size', always: true },
  { key: 'Date Created', label: 'Date Created', always: true },
  { key: 'group', label: 'group', always: true },
  { key: 'Model', label: 'model', always: false },
  { key: 'Seed', label: 'seed', always: false },
  { key: 'Sampler', label: 'sampler', always: false },
  { key: 'Steps', label: 'step', always: false },
  { key: 'CFG Scale', label: 'cfg scale', always: false },
  { key: 'Lora', label: 'lora', always: false },
];

const FORBIDDEN_RE = /[<>:"/\\|?*\x00]/g;

export function sanitizeFilename(name) {
  return name.replace(FORBIDDEN_RE, '').trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDateStr(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function resolveFilename(format, illustration) {
  if (!format || !format.trim()) return illustration.original_filename;

  const originalName = illustration.original_filename || '';
  const dotIdx = originalName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? originalName.slice(dotIdx + 1) : '';
  const extData = illustration.extended_data || {};

  const now = new Date();
  const created = illustration.created_at ? new Date(illustration.created_at) : now;

  const replacements = {
    '<date>': formatDateStr(now),
    '<Resolution>': `${illustration.width || 0}x${illustration.height || 0}`,
    '<File Size>': formatFileSize(illustration.file_size),
    '<Date Created>': formatDateStr(created),
    '<group>': illustration.group_name || '',
    '<Model>': extData['Model'] || '',
    '<Seed>': extData['Seed'] != null ? String(extData['Seed']) : '',
    '<Sampler>': extData['Sampler'] || '',
    '<Steps>': extData['Steps'] != null ? String(extData['Steps']) : '',
    '<CFG Scale>': extData['CFG Scale'] != null ? String(extData['CFG Scale']) : '',
  };

  // LoRA: check multiple key variants
  let loraVal = '';
  for (const k of ['Lora', 'LoRA', 'LoRAs', 'lora']) {
    if (extData[k]) { loraVal = String(extData[k]); break; }
  }
  replacements['<Lora>'] = loraVal;

  let filename = format;
  for (const [placeholder, value] of Object.entries(replacements)) {
    filename = filename.split(placeholder).join(value);
  }

  // Remove any unresolved <tag> placeholders
  filename = filename.replace(/<[^>]*>/g, '');

  filename = sanitizeFilename(filename);

  if (!filename) return illustration.original_filename;
  return ext ? `${filename}.${ext}` : filename;
}

export default function useDownloadConfig() {
  const [format, setFormat] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch { /* ignore */ }
  }, [format]);

  const resetFormat = useCallback(() => setFormat(''), []);

  return { format, setFormat, resetFormat };
}
