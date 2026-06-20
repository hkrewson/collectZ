export const CONDITION_LIKE_MEDIA_TYPES = new Set(['audio', 'book', 'movie', 'tv_series', 'tv_episode']);

export const DRAWER_METADATA_IDS = Object.freeze({
  edition: 'edition',
  grading: 'grading',
  proof: 'proof',
  related: 'related',
  loan: 'loan'
});

const DRAWER_METADATA_BASE = Object.freeze({
  [DRAWER_METADATA_IDS.edition]: {
    id: DRAWER_METADATA_IDS.edition,
    form: 'edition_variant',
    displayPriority: 20
  },
  [DRAWER_METADATA_IDS.grading]: {
    id: DRAWER_METADATA_IDS.grading,
    form: 'grading',
    displayPriority: 30
  },
  [DRAWER_METADATA_IDS.proof]: {
    id: DRAWER_METADATA_IDS.proof,
    form: 'provenance',
    displayPriority: 40
  },
  [DRAWER_METADATA_IDS.related]: {
    id: DRAWER_METADATA_IDS.related,
    form: 'object_relationship',
    displayPriority: 50
  },
  [DRAWER_METADATA_IDS.loan]: {
    id: DRAWER_METADATA_IDS.loan,
    form: 'loan',
    displayPriority: 60
  }
});

const EDITION_MEDIA_CONFIG = {
  book: {
    title: 'Book edition',
    help: 'Record printing, ARC, first edition, or limited-run details for this copy.',
    fields: [
      { key: 'edition', label: 'Edition', placeholder: 'First edition' },
      { key: 'printing', label: 'Printing', placeholder: 'Second printing' },
      { key: 'publisher_line', label: 'Publisher line', placeholder: 'Del Rey Legends' }
    ],
    flags: [
      { key: 'first_edition', label: 'First edition' },
      { key: 'arc', label: 'ARC / advance copy' },
      { key: 'limited_release', label: 'Limited release' }
    ],
    numbered: true
  },
  comic_book: {
    title: 'Comic edition',
    help: 'Record cover, printing, run, or issue variant details for this copy.',
    fields: [
      { key: 'variant', label: 'Variant cover', placeholder: 'Virgin variant' },
      { key: 'printing', label: 'Printing', placeholder: 'Second printing' },
      { key: 'run_context', label: 'Run / volume', placeholder: 'Vol. 2' }
    ],
    flags: [
      { key: 'newsstand', label: 'Newsstand' },
      { key: 'direct_edition', label: 'Direct edition' },
      { key: 'limited_release', label: 'Limited release' }
    ],
    numbered: true
  },
  game: {
    title: 'Game edition',
    help: 'Record platform, region, release type, or collector edition details.',
    fields: [
      { key: 'platform', label: 'Platform', placeholder: 'PlayStation 5' },
      { key: 'region', label: 'Region', placeholder: 'North America' },
      { key: 'release_line', label: 'Release line', placeholder: 'Limited Run Games' }
    ],
    flags: [
      { key: 'collector_edition', label: 'Collector edition' },
      { key: 'limited_release', label: 'Limited release' },
      { key: 'promo_demo', label: 'Promo / demo' }
    ]
  },
  audio: {
    title: 'Audio edition',
    help: 'Record pressing, color, promo, or limited-release details for this copy.',
    fields: [
      { key: 'variant', label: 'Variant', placeholder: 'Clear vinyl' },
      { key: 'pressing', label: 'Pressing', placeholder: '2024 remaster' },
      { key: 'release_line', label: 'Release line', placeholder: 'Record Store Day' }
    ],
    flags: [
      { key: 'limited_release', label: 'Limited release' },
      { key: 'promo_demo', label: 'Promo copy' }
    ],
    numbered: true
  },
  movie: {
    title: 'Movie edition',
    help: 'Record package, release, screener, or promo-disc details for this copy.',
    fields: [
      { key: 'package_variant', label: 'Package', placeholder: 'SteelBook' },
      { key: 'release_edition', label: 'Release edition', placeholder: "Director's cut" },
      { key: 'region', label: 'Region', placeholder: 'Region A' }
    ],
    flags: [
      { key: 'slipcover', label: 'Slipcover' },
      { key: 'screener', label: 'Screener' },
      { key: 'promo_demo', label: 'Promo disc' }
    ]
  },
  tv_series: {
    title: 'TV edition',
    help: 'Record package, complete-series, screener, or release edition details.',
    fields: [
      { key: 'package_variant', label: 'Package', placeholder: 'Complete series box' },
      { key: 'release_edition', label: 'Release edition', placeholder: 'Collector edition' },
      { key: 'region', label: 'Region', placeholder: 'Region 1' }
    ],
    flags: [
      { key: 'complete_series', label: 'Complete series' },
      { key: 'screener', label: 'Screener' },
      { key: 'limited_release', label: 'Limited release' }
    ]
  },
  tv_episode: {
    title: 'TV edition',
    help: 'Record package, screener, or release edition details.',
    fields: [
      { key: 'release_edition', label: 'Release edition', placeholder: 'Screener' },
      { key: 'region', label: 'Region', placeholder: 'Region 1' }
    ],
    flags: [
      { key: 'screener', label: 'Screener' },
      { key: 'promo_demo', label: 'Promo disc' }
    ]
  }
};

export function findGradingTrait(traits = []) {
  return Array.isArray(traits)
    ? traits.find((trait) => trait?.family === 'graded' || trait?.key === 'grading')
    : null;
}

export function findProvenanceTrait(traits = []) {
  return Array.isArray(traits)
    ? traits.find((trait) => trait?.family === 'provenance' || trait?.key === 'provenance')
    : null;
}

export function findEditionVariantTrait(traits = []) {
  return Array.isArray(traits)
    ? traits.find((trait) => trait?.family === 'edition_variant' || trait?.key === 'edition_variant')
    : null;
}

export function editionConfigForMediaType(mediaType = '') {
  return EDITION_MEDIA_CONFIG[String(mediaType || '').trim()] || EDITION_MEDIA_CONFIG.movie;
}

export function compactDetailString(details = []) {
  return (Array.isArray(details) ? details : [])
    .filter((detail) => detail?.label && detail?.value)
    .map((detail) => `${detail.label}: ${detail.value}`)
    .join(' · ');
}

export function gradingCopyForContext({ mediaType = '', ownerType = '' } = {}) {
  const normalizedOwner = String(ownerType || '').trim().toLowerCase();
  const normalizedMedia = String(mediaType || '').trim().toLowerCase();
  if (normalizedOwner === 'art') {
    return {
      title: 'Authentication',
      help: 'Record appraisal, certificate, or authenticator details.',
      companyLabel: 'Authority',
      companyPlaceholder: 'Appraiser or authenticator',
      gradeLabel: 'Assessment',
      gradePlaceholder: 'Authenticated',
      notesLabel: 'Notes',
      savedToast: 'Authentication details saved',
      removedToast: 'Authentication details removed',
      saveError: 'Failed to save authentication details',
      removeError: 'Failed to remove authentication details',
      missingError: 'Add an authority, assessment, or certificate number first'
    };
  }
  if (CONDITION_LIKE_MEDIA_TYPES.has(normalizedMedia)) {
    return {
      title: 'Condition',
      help: 'Record condition, certification, or appraisal details.',
      companyLabel: 'Authority',
      companyPlaceholder: 'Grader, seller, or appraiser',
      gradeLabel: 'Condition',
      gradePlaceholder: normalizedMedia === 'audio' ? 'VG+ / NM' : 'Near fine',
      notesLabel: 'Notes',
      savedToast: 'Condition details saved',
      removedToast: 'Condition details removed',
      saveError: 'Failed to save condition details',
      removeError: 'Failed to remove condition details',
      missingError: 'Add an authority, condition, or certificate number first'
    };
  }
  return {
    title: 'Grading',
    help: 'Record slab or certification details.',
    companyLabel: 'Grader',
    companyPlaceholder: 'Select grader',
    gradeLabel: 'Grade',
    gradePlaceholder: '9.8',
    notesLabel: 'Slab notes',
    savedToast: 'Grading details saved',
    removedToast: 'Grading details removed',
    saveError: 'Failed to save grading details',
    removeError: 'Failed to remove grading details',
    missingError: 'Add a grader, grade, or certificate number first'
  };
}

export function buildEditionMetadata({ trait = null, mediaType = 'movie' } = {}) {
  const base = DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.edition];
  const config = editionConfigForMediaType(mediaType);
  const hasValue = Boolean(trait);
  return {
    id: base.id,
    label: config.title,
    emptyLabel: 'Add',
    displayPriority: base.displayPriority,
    applies: true,
    mediaType,
    hasValue,
    summary: trait?.summary || '',
    details: compactDetailString(trait?.details),
    form: base.form
  };
}

export function buildGradingMetadata({ trait = null, mediaType = '', ownerType = '' } = {}) {
  const base = DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.grading];
  const copy = gradingCopyForContext({ mediaType, ownerType });
  const normalizedOwner = String(ownerType || '').trim().toLowerCase();
  const normalizedMedia = String(mediaType || '').trim().toLowerCase();
  const hasValue = Boolean(trait);
  return {
    id: normalizedOwner === 'art'
      ? 'authentication'
      : (CONDITION_LIKE_MEDIA_TYPES.has(normalizedMedia) ? 'condition' : 'grading'),
    label: copy.title,
    emptyLabel: 'Add',
    displayPriority: base.displayPriority,
    applies: true,
    mediaType,
    ownerType,
    hasValue,
    summary: trait?.summary || '',
    details: compactDetailString(trait?.details),
    form: base.form,
    copy
  };
}

export function buildProvenanceMetadata({ trait = null } = {}) {
  const base = DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.proof];
  const hasValue = Boolean(trait);
  return {
    id: base.id,
    label: 'Proof',
    emptyLabel: 'Add',
    displayPriority: base.displayPriority,
    applies: true,
    hasValue,
    summary: trait?.summary || '',
    details: compactDetailString(trait?.details),
    form: base.form
  };
}

export function buildObjectRelationshipMetadata({ relationships = [], loading = false } = {}) {
  const base = DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.related];
  const count = Array.isArray(relationships) ? relationships.length : 0;
  return {
    id: base.id,
    label: 'Related',
    emptyLabel: 'Add',
    displayPriority: base.displayPriority,
    applies: true,
    hasValue: count > 0,
    summary: loading ? 'Loading...' : (count ? `${count} linked` : ''),
    details: '',
    form: base.form
  };
}

export function buildLoanMetadata({ loan = null, loading = false, formatDate = (value) => value } = {}) {
  const base = DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.loan];
  return {
    id: base.id,
    label: 'Loan',
    emptyLabel: 'Loan out',
    displayPriority: base.displayPriority,
    applies: true,
    hasValue: Boolean(loan),
    summary: loan ? `${loan.borrower_name || 'Borrower'}${loan.due_at ? ` · Due ${formatDate(loan.due_at)}` : ''}` : (loading ? 'Loading...' : ''),
    details: '',
    form: base.form
  };
}

export const DRAWER_METADATA_REGISTRY = Object.freeze({
  [DRAWER_METADATA_IDS.edition]: Object.freeze({
    ...DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.edition],
    appliesTo: () => true,
    build: buildEditionMetadata
  }),
  [DRAWER_METADATA_IDS.grading]: Object.freeze({
    ...DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.grading],
    appliesTo: () => true,
    build: buildGradingMetadata
  }),
  [DRAWER_METADATA_IDS.proof]: Object.freeze({
    ...DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.proof],
    appliesTo: () => true,
    build: buildProvenanceMetadata
  }),
  [DRAWER_METADATA_IDS.related]: Object.freeze({
    ...DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.related],
    appliesTo: () => true,
    build: buildObjectRelationshipMetadata
  }),
  [DRAWER_METADATA_IDS.loan]: Object.freeze({
    ...DRAWER_METADATA_BASE[DRAWER_METADATA_IDS.loan],
    appliesTo: () => true,
    build: buildLoanMetadata
  })
});

export function getDrawerMetadataRegistryEntry(id = '') {
  return DRAWER_METADATA_REGISTRY[String(id || '').trim()] || null;
}

export function buildDrawerMetadata(id = '', context = {}) {
  const entry = getDrawerMetadataRegistryEntry(id);
  if (!entry) return null;
  const metadata = entry.build(context);
  if (context?.applies === false || entry.appliesTo(context) === false) {
    return { ...metadata, applies: false };
  }
  return metadata;
}

export function buildDrawerMetadataItems(entries = [], sharedContext = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      const context = {
        ...sharedContext,
        ...((entry && typeof entry === 'object' && entry.context) ? entry.context : {})
      };
      const metadata = buildDrawerMetadata(id, context);
      return metadata ? { id, metadata } : null;
    })
    .filter((item) => item && item.metadata?.applies !== false)
    .sort((left, right) => {
      const leftPriority = Number(left?.metadata?.displayPriority ?? 0);
      const rightPriority = Number(right?.metadata?.displayPriority ?? 0);
      return leftPriority - rightPriority;
    });
}

export function buildObjectDrawerMetadataRecords({
  traits = [],
  ownerType = '',
  mediaType = '',
  includeEdition = false,
  includeRelated = true
} = {}) {
  const entries = [];
  if (includeEdition) {
    entries.push({
      id: DRAWER_METADATA_IDS.edition,
      context: {
        trait: findEditionVariantTrait(traits),
        mediaType
      }
    });
  }
  entries.push(
    {
      id: DRAWER_METADATA_IDS.grading,
      context: {
        trait: findGradingTrait(traits),
        mediaType,
        ownerType
      }
    },
    {
      id: DRAWER_METADATA_IDS.proof,
      context: {
        trait: findProvenanceTrait(traits)
      }
    }
  );
  if (includeRelated) {
    entries.push({ id: DRAWER_METADATA_IDS.related });
  }
  return buildDrawerMetadataItems(entries);
}
