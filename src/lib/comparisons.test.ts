import { describe,it,expect } from 'vitest';
import {compareGeo} from './comparisons';
import type {GeoObservation} from '../types';
const a:GeoObservation={id:'1',topicId:'t',source:'csv-import',sourceUrl:'https://trends.google.com/trends/explore',regionCode:'JP',regionMeaning:'search-market',date:'2025-01-01',fetchedAt:'2025-02-01T00:00:00Z',layer:'search-interest',value:50,unit:'index',normalization:'one joint export across regions',population:'sampled Google searches',importId:'same-export'};
describe('geographic comparisons',()=>{
 it('allows regions in the same explicitly documented extract',()=>{expect(compareGeo(a,{...a,id:'2',regionCode:'US',value:40}).difference).toBe(10);});
 it('rejects independently normalized CSV exports',()=>{expect(compareGeo(a,{...a,importId:'other-export'}).comparable).toBe(false);});
 it('does not compare undocumented historical index scales',()=>{expect(compareGeo({...a,source:'google-trends-archive'},{...a,source:'google-trends-archive',regionCode:'US'}).comparable).toBe(false);});
 it('never combines publisher country and search market',()=>{expect(compareGeo(a,{...a,regionMeaning:'publisher-country',layer:'news-publisher'}).comparable).toBe(false);});
 it('requires same observation time and query',()=>{expect(compareGeo(a,{...a,date:'2025-02-01'}).difference).toBeNull();expect(compareGeo(a,{...a,topicId:'other'}).difference).toBeNull();});
});
