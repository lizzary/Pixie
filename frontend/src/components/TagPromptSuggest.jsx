import { useState, useEffect, useRef, useCallback } from 'react';
import { listTags, listPrompts } from '../api';

// Module-level cache shared across all instances
const _cache = { tag: null, prompt: null, mixed: null };

export default function TagPromptSuggest({
  type,
  value,
  onChange,
  placeholder = '',
  className = '',
  inputClassName = '',
  onEnter,
  onSelect,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fetch full list once, using cache
  useEffect(() => {
    if (type !== 'mixed') {
      if (_cache[type]) {
        setAllItems(_cache[type]);
        return;
      }
      const fetcher = type === 'tag' ? listTags : listPrompts;
      let cancelled = false;
      fetcher()
        .then((data) => {
          if (!cancelled) {
            _cache[type] = data;
            setAllItems(data);
          }
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    // Mixed type — fetch both
    if (_cache.mixed) {
      setAllItems(_cache.mixed);
      return;
    }
    let cancelled = false;
    Promise.all([listTags(), listPrompts()])
      .then(([tags, prompts]) => {
        if (cancelled) return;
        const map = new Map();
        for (const t of tags) map.set(t, { types: ['tag'] });
        for (const p of prompts) {
          if (map.has(p)) {
            map.get(p).types.push('prompt');
          } else {
            map.set(p, { types: ['prompt'] });
          }
        }
        const merged = [...map.entries()].map(([text, meta]) => ({
          text,
          types: meta.types,
        }));
        _cache.mixed = merged;
        setAllItems(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [type]);

  // Filter suggestions based on input
  useEffect(() => {
    if (!value || !allItems.length) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const lower = value.toLowerCase();
    let matches;
    if (type === 'mixed') {
      matches = allItems
        .filter((item) => item.text.toLowerCase().includes(lower) && item.text.toLowerCase() !== lower)
        .slice(0, 8);
    } else {
      matches = allItems
        .filter((item) => item.toLowerCase().includes(lower) && item.toLowerCase() !== lower)
        .slice(0, 8);
    }
    setSuggestions(matches);
    setShowDropdown(matches.length > 0);
    setActiveIndex(-1);
  }, [value, allItems, type]);

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectSuggestion = useCallback(
    (item) => {
      if (type === 'mixed') {
        onChange(item.text);
        const scope = item.types.length === 2 ? 'all' : item.types[0];
        if (onSelect) onSelect(item.text, scope);
      } else {
        onChange(item);
      }
      setShowDropdown(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange, onSelect, type]
  );

  const handleKeyDown = (e) => {
    if (!showDropdown) {
      if (e.key === 'Enter' && onEnter && value.trim()) {
        e.preventDefault();
        onEnter(value.trim());
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
        } else if (onEnter && value.trim()) {
          e.preventDefault();
          onEnter(value.trim());
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setActiveIndex(-1);
        break;
    }
  };

  const resolveItemKey = (item) => (type === 'mixed' ? item.text : item);
  const resolveItemText = (item) => (type === 'mixed' ? item.text : item);

  const typeLabel = (item) => {
    if (type !== 'mixed') return type;
    if (item.types.length === 2) return 'tag & prompt';
    return item.types[0];
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value && suggestions.length > 0) setShowDropdown(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName}
      />
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-surface-tertiary border border-edge-secondary rounded-lg shadow-xl z-50 overflow-hidden"
        >
          {suggestions.map((item, idx) => (
            <button
              key={resolveItemKey(item)}
              onClick={() => selectSuggestion(item)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                idx === activeIndex
                  ? 'bg-accent/30'
                  : 'hover:bg-edge-secondary'
              }`}
            >
              <span className={idx === activeIndex ? 'text-accent' : 'text-content-secondary'}>
                {resolveItemText(item)}
              </span>
              <span className="text-xs text-content-muted shrink-0 ml-3">{typeLabel(item)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
