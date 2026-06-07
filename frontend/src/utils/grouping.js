export function matchesTagPair(ill, keywords) {
  const tags = ill.tags
    ? ill.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : [];
  return keywords.every((k) => tags.includes(k.trim().toLowerCase()));
}

export function matchesPromptPair(ill, keywords) {
  const ext = ill.extended_data || {};
  // Backend stores these as "Positive Prompt" / "Negative Prompt" (title case with space)
  const text = [
    ext['Positive Prompt'] || '',
    ext['Negative Prompt'] || '',
  ].join(' ').toLowerCase();
  return keywords.every((k) => text.includes(k.trim().toLowerCase()));
}

export function groupIllustrations(illustrations, pairs, otherColor, matchFn) {
  const groups = pairs.map((p) => ({ ...p, name: p.keywords.join(', '), items: [] }));
  const matchedIds = new Set();
  for (const ill of illustrations) {
    let found = false;
    for (const g of groups) {
      if (matchFn(ill, g.keywords)) {
        g.items.push(ill);
        matchedIds.add(ill.id);
        found = true;
        break;
      }
    }
  }
  const otherItems = illustrations.filter((ill) => !matchedIds.has(ill.id));
  const result = [...groups.filter((g) => g.items.length > 0)];
  if (otherItems.length > 0) {
    result.push({
      id: 'other',
      name: 'Other',
      color: otherColor.bg,
      borderColor: otherColor.border,
      items: otherItems,
    });
  }
  return result;
}

export const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'No Grouping' },
  { value: 'tag', label: 'Group by Tag' },
  { value: 'prompt', label: 'Group by Prompt' },
];
