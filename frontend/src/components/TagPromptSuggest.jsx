import { useState, useEffect, useRef, useCallback } from 'react';
import { listTags, listPrompts } from '../api';

// Module-level cache shared across all instances
const _cache = { tag: null, prompt: null };

export default function TagPromptSuggest({
  type,
  value,
  onChange,
  placeholder = '',
  className = '',
  inputClassName = '',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fetch full list once, using cache
  useEffect(() => {
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
  }, [type]);

  // Filter suggestions based on input
  useEffect(() => {
    if (!value || !allItems.length) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const lower = value.toLowerCase();
    const matches = allItems
      .filter((item) => item.toLowerCase().includes(lower) && item.toLowerCase() !== lower)
      .slice(0, 8);
    setSuggestions(matches);
    setShowDropdown(matches.length > 0);
    setActiveIndex(-1);
  }, [value, allItems]);

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
      onChange(item);
      setShowDropdown(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange]
  );

  const handleKeyDown = (e) => {
    if (!showDropdown) return;
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
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setActiveIndex(-1);
        break;
    }
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
          className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
        >
          {suggestions.map((item, idx) => (
            <button
              key={item}
              onClick={() => selectSuggestion(item)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                idx === activeIndex
                  ? 'bg-purple-600/30'
                  : 'hover:bg-gray-700'
              }`}
            >
              <span className={idx === activeIndex ? 'text-purple-300' : 'text-gray-300'}>{item}</span>
              <span className="text-xs text-gray-600 shrink-0 ml-3">{type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
