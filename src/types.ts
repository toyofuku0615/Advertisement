export interface TopicAlias { id: string; text: string; language: string }
export interface Topic { id: string; title: string; category: string; aliases: TopicAlias[]; observationIds: string[] }
export type SourceId = string;
export interface Source { id: SourceId; name: string; kind: 'search' | 'social' | 'news' | 'survey'; url: string; termsUrl: string; metricDescription: string; license: string; enabled: boolean }
export interface Observation {
  id: string; topicId: string; source: SourceId; sourceId: string; sourceUrl: string; title: string;
  publishedAt: string; observedAt: string; fetchedAt: string; regionCode: string | null;
  regionMeaning: 'search-market' | 'publisher-country' | 'not-geolocated';
  metric: { name: string; value: number | null; unit: string; normalization: string };
  population: string; reliability: 'observed'; method: string; license: string; status: 'fresh' | 'stale';
  relatedLinks?: { title: string; url: string }[]; thumbnailUrl?: string;
}
export interface GeoObservation {
  id: string; topicId: string; source: string; sourceUrl: string; regionCode: string; regionMeaning: string;
  date: string; fetchedAt: string; layer: 'news-publisher' | 'search-interest'; value: number;
  unit: string; normalization: string; population: string; importId?: string; originalSource?: string; originalImportId?: string;
}
export interface CollectionRun { scope?: string; id: string; source: string; regionCode: string | null; startedAt: string; finishedAt: string; status: 'success' | 'error' | 'disabled'; count: number; error?: string }
export interface Dataset { schemaVersion: 1; generatedAt: string; topics: Topic[]; observations: Observation[]; geoObservations: GeoObservation[]; collectionRuns: CollectionRun[]; sources: Source[] }
export interface AudienceEvidence {
  id: string; title: string; sourceUrl: string; fetchedAt: string; surveyDate: string;
  regionCode: string; age: string; gender: string; segment: string; population: string;
  sampleSize: number | null; question: string; value: number; unit: string; methodology: string;
  comparabilityKey: string;
}
export interface CreativeAnalysis {
  id: string; url: string; brand: string; category: string; hook: string; firstThreeSeconds: string;
  copy: string; appeal: string; format: string; emotion: string; cta: string; composition: string;
  story: string; cast: string; surprise: string; empathy: string; benefit: string; metrics: string; notes: string; createdAt: string;
}
export interface InsightHypothesis { id: string; topicId: string; text: string; evidenceIds: string[]; updatedAt: string }
export interface Brief { id: string; brand: string; category: string; features: string; target: string; competitors: string; challenge: string; topicIds: string[]; notes: string; updatedAt: string }
export interface SavedResearch { id: string; kind: 'topic' | 'filter' | 'finding'; title: string; content: string; topicId?: string; createdAt: string; lastSeenAt?: string }
export interface TopicMapping { topicId: string; aliases: TopicAlias[] }
export interface LocalData {
  saved: SavedResearch[]; creatives: CreativeAnalysis[]; hypotheses: InsightHypothesis[]; briefs: Brief[];
  audienceEvidence: AudienceEvidence[]; importedGeo: GeoObservation[]; customTopics: Topic[];
  topicMappings: TopicMapping[]; categories: string[];
}

export interface Claim { text: string; kind: 'source_summary' | 'interpretation'; evidenceIds: string[] }
export interface ExplanationEvidence { id: string; url: string; title: string; source: string; observedAt: string; fetchedAt: string; observationId: string }
export interface TopicExplanation {
  topicId: string; inputHash: string; generatedAt: string; provider: string; model: string;
  status: 'ready' | 'stale' | 'unavailable'; overview: Claim; contexts: Claim[];
  attention: Claim | null; marketing: Claim | null; caveats: string[]; evidence: ExplanationEvidence[];
}
export interface ExplanationBundle {
  schemaVersion: 1; generatedAt: string;
  providerStatus: { status: 'ready' | 'disabled' | 'error'; provider: string; model: string; message: string; checkedAt: string };
  explanations: TopicExplanation[];
}
