import type { CollectionRun } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function safeUrl(value: string): string {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function formatDate(value: string, short = false): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', ...(!short ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
export function downloadText(name: string, text: string, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (typeof value !== 'number' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function downloadCsv(filename: string, rows: unknown[][] | Record<string, unknown>[]) {
  if (!rows.length) { downloadText(filename, '\uFEFF', 'text/csv;charset=utf-8'); return; }
  const arrays: unknown[][] = Array.isArray(rows[0]) ? rows as unknown[][] : [Object.keys(rows[0]), ...rows.map(row => Object.values(row))];
  downloadText(filename, '\uFEFF' + arrays.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
export const REGIONS: Record<string, string> = { JP:'日本', US:'アメリカ', KR:'韓国', GB:'イギリス', FR:'フランス', DE:'ドイツ', CA:'カナダ', AU:'オーストラリア', IN:'インド', BR:'ブラジル', TW:'台湾', TH:'タイ', ID:'インドネシア', MX:'メキシコ', IT:'イタリア', ES:'スペイン', CN:'中国' };
export const DEFAULT_CATEGORIES = ['食品・飲料','美容・ファッション','エンタメ','音楽','ミーム','恋愛・人間関係','ライフスタイル','テクノロジー','旅行','スポーツ','ビジネス','社会・ニュース'];
export function id(prefix = 'local') { return `${prefix}-${crypto.randomUUID()}`; }
export function isArchive(source: string) { return source.includes('archive'); }

export function latestCollectionRuns(runs:CollectionRun[]):CollectionRun[] {
 const latest=new Map<string,CollectionRun>();
 for(const run of runs){const key=[run.source,run.regionCode||'',run.scope||''].join('|');const previous=latest.get(key);if(!previous||run.finishedAt>previous.finishedAt)latest.set(key,run);}
 return [...latest.values()].sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt));
}
