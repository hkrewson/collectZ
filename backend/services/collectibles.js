const COLLECTIBLE_SUBTYPES = ['collectible', 'art', 'card'];

const COLLECTIBLE_CATEGORY_DEFINITIONS = [
  { key: 'lego', label: 'Lego' },
  { key: 'figures_statues', label: 'Figures / Statues' },
  { key: 'props_replicas_originals', label: 'Props / Replicas / Originals' },
  { key: 'funko', label: 'Funko' },
  { key: 'comic_panels', label: 'Comic Panels' },
  { key: 'anime', label: 'Anime' },
  { key: 'toys', label: 'Toys' },
  { key: 'clothing', label: 'Clothing' }
];

const CATEGORY_KEY_TO_LABEL = new Map(
  COLLECTIBLE_CATEGORY_DEFINITIONS.map((entry) => [entry.key, entry.label])
);
const CATEGORY_LABEL_TO_KEY = new Map(
  COLLECTIBLE_CATEGORY_DEFINITIONS.map((entry) => [entry.label, entry.key])
);

const resolveCategoryKey = (value) => {
  if (!value) return null;
  const asText = String(value).trim();
  if (!asText) return null;
  if (CATEGORY_KEY_TO_LABEL.has(asText)) return asText;
  return CATEGORY_LABEL_TO_KEY.get(asText) || null;
};

const resolveCategoryLabel = (value) => {
  const key = resolveCategoryKey(value);
  return key ? CATEGORY_KEY_TO_LABEL.get(key) : null;
};

module.exports = {
  COLLECTIBLE_SUBTYPES,
  COLLECTIBLE_CATEGORY_DEFINITIONS,
  CATEGORY_KEY_TO_LABEL,
  CATEGORY_LABEL_TO_KEY,
  resolveCategoryKey,
  resolveCategoryLabel
};
