import { describe, expect, it } from 'vitest';
import dataset from '../../public/data/dataset.json';
import cache from '../../public/data/explanations.json';
import { parseDataset } from './repository';
import { buildContextEvidence, contextFingerprint, parseExplanationBundle, reconcileExplanations } from './explanations';
describe('published AI context cache integrity',()=>{
 it('accepts the real AI cache and verifies every ready claim against current source fingerprints',async()=>{
  const d=parseDataset(dataset);const b=parseExplanationBundle(cache);const reconciled=await reconcileExplanations(b,d);
  for(const entry of b.explanations.filter(e=>e.status==='ready')){
   const topic=d.topics.find(t=>t.id===entry.topicId);expect(topic).toBeDefined();
   expect(await contextFingerprint(topic!,buildContextEvidence(topic!,d))).toBe(entry.inputHash);
   expect(reconciled.explanations.find(e=>e.topicId===entry.topicId)?.status).toBe('ready');
   expect(entry.contexts.every(c=>['source_summary','interpretation'].includes(c.kind))).toBe(true);
  }
 });
});
