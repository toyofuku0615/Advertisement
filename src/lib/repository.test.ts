import { describe, expect, it } from 'vitest';
import dataset from '../../public/data/dataset.json';
import { contentItemsFor, evidenceFor, parseDataset } from './repository';
describe('static repository and evidence identities',()=>{
 it('accepts actual fetched production data, with separate evidence and content views',()=>{const valid=parseDataset(dataset);expect(evidenceFor(valid)).toHaveLength(valid.observations.length+valid.geoObservations.length);expect(contentItemsFor(valid)[0].url).toBe(valid.observations[0].sourceUrl);expect(valid.observations.every(o=>Boolean(o.sourceUrl&&o.fetchedAt))).toBe(true);});
 it('rejects a schema change before any chart or summary is rendered',()=>{expect(()=>parseDataset({...dataset,schemaVersion:2})).toThrow('schemaVersion');const copy=structuredClone(dataset);copy.observations[0].metric.value=-4;expect(()=>parseDataset(copy)).toThrow('指標');});
 it('rejects orphan topic references and geographies with wrong semantics',()=>{const copy=structuredClone(dataset);copy.observations[0].topicId='missing';expect(()=>parseDataset(copy)).toThrow('存在');const geo=structuredClone(dataset);geo.geoObservations[0].regionMeaning='publisher-country';expect(()=>parseDataset(geo)).toThrow('混同');});
 it('does not let an unlinked credential-bearing URL become evidence',()=>{const copy=structuredClone(dataset);copy.observations[0].sourceUrl='https://token:secret@example.test/';expect(()=>parseDataset(copy)).toThrow('原典');});
});
