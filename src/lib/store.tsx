import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, set } from 'idb-keyval';
import type { Dataset, ExplanationBundle, LocalData } from '../types';
import { DEFAULT_CATEGORIES } from './utils';
import { loadDataset } from './repository';
import { loadExplanations, reconcileExplanations } from './explanations';
import { installResumeRefresh } from './resume-refresh';
export type Page = 'radar'|'audience'|'map'|'compare'|'creative'|'insight'|'brief';
const PAGES: Page[] = ['radar','audience','map','compare','creative','insight','brief'];
const initialLocal: LocalData = { saved: [], creatives: [], hypotheses: [], briefs: [], audienceEvidence: [], importedGeo: [], customTopics: [], topicMappings: [], categories: DEFAULT_CATEGORIES };
const empty: Dataset = {schemaVersion:1, generatedAt:'', topics:[],observations:[],geoObservations:[],collectionRuns:[],sources:[]};
interface AppContext {
  dataset:Dataset; local:LocalData; updateLocal:(fn:(data:LocalData)=>LocalData)=>void;
  notify:(message:string)=>void; selectedTopicId:string; selectTopic:(id:string)=>void;
  navigate:(page:Page)=>void; page:Page; loading:boolean; error:string; refresh:()=>void;
  storageReady:boolean; explanations:ExplanationBundle|null; explanationsLoading:boolean; explanationsError:string;
}
const Context = createContext<AppContext | null>(null);
function currentPage():Page { const p = location.hash.slice(1).split('?')[0] as Page; return PAGES.includes(p) ? p : 'radar'; }
export function AppProvider({children}:{children:ReactNode}) {
  const [base,setBase] = useState<Dataset>(empty); const [local, setLocal] = useState<LocalData>(initialLocal);
  const [storageReady,setStorageReady] = useState(false); const [page,setPage] = useState(currentPage);
  const [explanations,setExplanations]=useState<ExplanationBundle|null>(null);const [explanationsLoading,setExplanationsLoading]=useState(true);const [explanationsError,setExplanationsError]=useState('');
  const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [version,setVersion] = useState(0);
  const [selectedTopicId, selectTopic] = useState(''); const [message,setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hydrated = useRef(false); const pendingEdits = useRef<Array<(data:LocalData)=>LocalData>>([]);
  const snapshot = useRef({base,explanations}); snapshot.current={base,explanations};
  const lastAttemptAt=useRef(0);const fetching=useRef(false);const requestSequence=useRef(0);
  function updateLocal(fn:(data:LocalData)=>LocalData){if(!hydrated.current)pendingEdits.current.push(fn);else setLocal(fn);}
  function notify(msg:string) { setMessage(msg); clearTimeout(timer.current); timer.current = setTimeout(()=>setMessage(''),5000); }
  useEffect(()=>{let live=true;get<LocalData>('culture-radar-research-v1').then(value=>{if(!live)return;let next={...initialLocal,...value};for(const apply of pendingEdits.current)next=apply(next);pendingEdits.current=[];hydrated.current=true;setLocal(next);setStorageReady(true);}).catch(()=>{if(!live)return;hydrated.current=true;setLocal(current=>pendingEdits.current.reduce((value,fn)=>fn(value),current));pendingEdits.current=[];setStorageReady(true);notify('ブラウザ保存を開けませんでした。保存機能を使うには通常のブラウザモードで開いてください。');});return()=>{live=false;};},[]);
  useEffect(()=>{if(storageReady) set('culture-radar-research-v1',local).catch(()=>notify('保存に失敗しました。ストレージの空き容量とブラウザ設定を確認してください。'));},[local,storageReady]);
  useEffect(()=>{
    const controller=new AbortController();const sequence=++requestSequence.current;
    lastAttemptAt.current=Date.now();fetching.current=true;
    if(!snapshot.current.base.generatedAt)setLoading(true);
    setError('');
    async function readPublishedSnapshot(){
      try{
        const next=await loadDataset(`${import.meta.env.BASE_URL}data/dataset.json`,controller.signal);
        if(controller.signal.aborted)return;
        setExplanationsLoading(true);
        let nextExplanations:ExplanationBundle|null=null;let explanationError='';
        try{nextExplanations=await loadExplanations(`${import.meta.env.BASE_URL}data/explanations.json`,next,controller.signal);}
        catch(e){
          if(controller.signal.aborted)return;
          explanationError=e instanceof Error?e.message:String(e);
          if(snapshot.current.explanations)nextExplanations=await reconcileExplanations(snapshot.current.explanations,next);
        }
        if(controller.signal.aborted)return;
        // Commit both together: Japanese search and source citations never see a half-updated snapshot.
        setBase(next);setExplanations(nextExplanations);setExplanationsError(explanationError);
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
      finally{if(sequence===requestSequence.current)fetching.current=false;if(!controller.signal.aborted){setLoading(false);setExplanationsLoading(false);}}
    }
    void readPublishedSnapshot();
    return()=>controller.abort();
  },[version]);
  useEffect(()=>installResumeRefresh({documentTarget:document,windowTarget:window,lastAttemptAt:()=>lastAttemptAt.current,isLoading:()=>fetching.current,requestRefresh:()=>setVersion(v=>v+1)}),[]);
  useEffect(()=>{const change=()=>setPage(currentPage()); window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const dataset=useMemo(()=>({...base, topics:[...base.topics,...local.customTopics.filter(t=>!base.topics.some(b=>b.id===t.id))].map(t=>{const mapping=local.topicMappings.find(m=>m.topicId===t.id);return mapping?{...t,aliases:mapping.aliases}:t;}), geoObservations:[...base.geoObservations,...local.importedGeo]}),[base,local.customTopics,local.importedGeo,local.topicMappings]);
  const context:AppContext={dataset,local,updateLocal,notify,selectedTopicId,selectTopic,navigate:p=>{location.hash=p;setPage(p);},page,loading,error,refresh:()=>setVersion(v=>v+1),storageReady,explanations,explanationsLoading,explanationsError};
  return <Context.Provider value={context}>{children}{message&&<div className="toast" role="status">{message}<button aria-label="通知を閉じる" onClick={()=>setMessage('')}>×</button></div>}</Context.Provider>;
}
export function useApp() { const ctx=useContext(Context);if(!ctx)throw new Error('AppProvider required');return ctx; }
