import { describe, expect, it } from 'vitest';
import { batchEditionEvidence, canIncludeBatchEdition } from './batchEditionEvidence';

const item = {
  title: 'Example Movie',
  source_status: 'Owned',
  source_context: {
    url: 'https://www.blu-ray.com/movies/Example-Movie/123/',
    captured_at: '2026-11-26T00:00:00.000Z',
    extension_version: '0.3.0',
    enrichment_status: 'enriched',
    ownership_basis: 'collection_page',
    identifiers: { bluray_product_id: '123', upc: '012345678905', asin: 'B012345678', imdb_id: 'tt1234567' },
    page_metadata: {
      release_title: 'Example Movie 4K Blu-ray',
      media_format: '4K Ultra HD + Blu-ray',
      edition: 'SteelBook',
      country: 'United States',
      release_details: { year: '2026', studio: 'Example Studio', runtime: '120 min' },
      specs: { video: '2160p', audio: 'Dolby Atmos' }
    }
  }
};

describe('batchEditionEvidence', () => {
  it('exposes normalized edition identity and technical evidence for review', () => {
    expect(batchEditionEvidence(item)).toMatchObject({
      releaseTitle: 'Example Movie 4K Blu-ray',
      mediaFormat: '4K Ultra HD + Blu-ray',
      edition: 'SteelBook',
      blurayProductId: '123',
      upc: '012345678905',
      asin: 'B012345678',
      imdbId: 'tt1234567',
      studio: 'Example Studio',
      runtime: '120 min',
      enrichmentStatus: 'enriched',
      ownershipBasis: 'collection_page'
    });
    expect(batchEditionEvidence(item).specs).toEqual([
      { label: 'video', value: '2160p' },
      { label: 'audio', value: 'Dolby Atmos' }
    ]);
    expect(canIncludeBatchEdition(item)).toBe(true);
  });

  it('keeps partial or unsafe evidence visible but ineligible for import', () => {
    const partial = { ...item, source_context: { ...item.source_context, enrichment_status: 'failed', url: 'javascript:alert(1)' } };
    expect(batchEditionEvidence(partial)).toMatchObject({ enrichmentStatus: 'failed', sourceUrl: null });
    expect(canIncludeBatchEdition(partial)).toBe(false);
  });
});
