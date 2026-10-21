import { describe,it,expect } from 'vitest';
import { parseSurveyCsv,compareSurveys,surveyMatches } from './surveys';
import type { AudienceEvidence } from '../types';
const row:AudienceEvidence={id:'a',title:'test',sourceUrl:'https://example.org/survey',fetchedAt:'2026-01-01T00:00:00Z',surveyDate:'2025-12-01',regionCode:'JP',age:'20-29',gender:'all',segment:'student',population:'enrolled university students',sampleSize:100,question:'Do you agree?',value:42,unit:'%',methodology:'same cross-country survey',comparabilityKey:'study-wave1-q1'};
const csv='title,sourceUrl,fetchedAt,surveyDate,regionCode,age,gender,segment,population,sampleSize,question,value,unit,methodology,comparabilityKey\nTest,https://example.org/survey,2026-01-01T00:00:00Z,2025-12-01,JP,20-29,all,student,Students,100,"Do you agree, today?",42,%,online,same-study-wave';
describe('survey CSV',()=>{
 it('retains survey population, samples, source and dates; deduplicates',()=>{const parsed=parseSurveyCsv('\uFEFF'+csv+'\n'+csv.split('\n')[1]);expect(parsed.errors).toEqual([]);expect(parsed.rows).toHaveLength(1);expect(parsed.rows[0].sampleSize).toBe(100);expect(parsed.rows[0].question).toBe('Do you agree, today?');});
 it('rejects missing provenance and unsafe URLs',()=>{expect(parseSurveyCsv('value\n42').errors.length).toBeGreaterThan(0);expect(parseSurveyCsv(csv.replace('https://example.org/survey','javascript:alert(1)')).rows).toHaveLength(0);});
 it('rejects invalid percentages and sample size',()=>{expect(parseSurveyCsv(csv.replace(',42,%,',',142,%,')).errors.length).toBeGreaterThan(0);expect(parseSurveyCsv(csv.replace(',100,',',-1,')).rows).toHaveLength(0);});
 it('rejects impossible calendar dates and timezone-less timestamps',()=>{expect(parseSurveyCsv(csv.replace('2025-12-01','2025-02-31')).rows).toHaveLength(0);expect(parseSurveyCsv(csv.replace('2026-01-01T00:00:00Z','2026-01-01T00:00:00')).rows).toHaveLength(0);});
 it('keeps permission-restricted Seikatsu Teiten reference-only',()=>{const parsed=parseSurveyCsv(csv.replace('https://example.org/survey','https://seikatsusoken.jp/teiten/'));expect(parsed.rows).toHaveLength(0);expect(parsed.errors.join(' ')).toContain('参照専用');});
 it('missing sample size stays null not zero',()=>{expect(parseSurveyCsv(csv.replace(',100,',',,')).rows[0].sampleSize).toBeNull();});
});
describe('comparability checks',()=>{
 it('compares only same study, time, method and matching cohorts',()=>{expect(compareSurveys(row,{...row,id:'b',regionCode:'US',value:35}).difference).toBe(7);});
 it('does not compare samples from mismatched age, period or method',()=>{for(const changes of [{age:'40-49'},{methodology:'different'},{surveyDate:'2024-12-01'},{sampleSize:null},{comparabilityKey:'another'}]) expect(compareSurveys(row,{...row,...changes}).comparable).toBe(false);});
 it('preserves demographic missingness instead of inferring relevance',()=>{expect(surveyMatches({...row,age:'all'},{region:'JP',age:'20-29',gender:'all',segment:'all'})).toBe(false);});
 it('permits age comparison only inside same region and segment',()=>{expect(compareSurveys(row,{...row,age:'40-49'},'age').comparable).toBe(true);expect(compareSurveys(row,{...row,age:'40-49',regionCode:'US'},'age').comparable).toBe(false);});
});
