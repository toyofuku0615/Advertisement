import type { GeoObservation } from '../types';
export interface GeoComparison { comparable:boolean; reasons:string[]; difference:number|null }
export function compareGeo(a:GeoObservation,b:GeoObservation):GeoComparison {
 const reasons:string[]=[];
 if(a.topicId!==b.topicId)reasons.push('トピックが異なります');
 if(a.source!==b.source)reasons.push('情報源が異なります');
 if(a.layer!==b.layer||a.regionMeaning!==b.regionMeaning)reasons.push('地域・指標の定義が異なります');
 if(a.date!==b.date)reasons.push('観測時点が異なります');
 if(a.unit!==b.unit)reasons.push('単位が異なります');
 if(!a.normalization||a.normalization!==b.normalization)reasons.push('正規化・比較条件が異なります');
 if(a.source.includes('archive')||b.source.includes('archive')||/未詳|未確認|不明|unknown|undocumented|unverified/i.test(a.normalization+' '+b.normalization))reasons.push('正規化範囲が未確認のため国間の指数値は比較できません');
 if(a.source==='csv-import'&&(!a.importId||a.importId!==b.importId))reasons.push('別々のCSVにある独立した検索指数は直接比較しません');
 if(a.sourceUrl!==b.sourceUrl)reasons.push('同一の抽出・集計元であることを確認できません');
 return {comparable:reasons.length===0,reasons,difference:reasons.length?null:a.value-b.value};
}
