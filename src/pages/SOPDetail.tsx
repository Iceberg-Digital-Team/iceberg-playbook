import { useState } from 'react';
import { ArrowLeft, Link2, Edit } from 'lucide-react';
import { useRouter } from '../router';
import { getSOPs, getPlaybooks, getIssues, getGuides, formatGuideDate } from '../data';
import { ArticleHeader, SummarySection, RequirementsSection, StepsSection, InternalNotes, RevisionHistory } from '../components/article/ArticleComponents';
import { ContentRow, StateMessage } from '../components/knowledge/ApplicationUI';
export function SOPDetail() {
 const {params}=useRouter(); const [completed,setCompleted]=useState<Record<number,boolean>>({}); const [message,setMessage]=useState('');
 const pb=getPlaybooks().find(p=>p.slug===params.slug); const sop=getSOPs().find(s=>s.id===params.id&&s.playbookId===pb?.id);
 if(!pb||!sop)return <StateMessage title="SOP not found" action={<a href="#/playbooks">Back to Playbooks</a>}>Choose an existing standard process.</StateMessage>;
 const related=[...getIssues().filter(i=>sop.relatedIssues.includes(i.id)),...getGuides().filter(g=>sop.relatedGuides.includes(g.id))];
 return <div className="page reading-page"><div className="toolbar"><a className="back-link" href={`#/playbooks/${pb.slug}`}><ArrowLeft size={14}/>Back to {pb.name} Playbook</a><div className="inline-actions"><button className="btn-secondary" onClick={()=>setMessage('SOP editing is not available in this preview yet.')}><Edit size={14}/>Edit</button><button className="btn-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setMessage('Link copied.');}catch{setMessage('Could not copy the link.');}}}><Link2 size={14}/>Copy Link</button></div></div>{message&&<p role="status" className="helper-text">{message}</p>}
 <ArticleHeader code={sop.id} title={sop.title} status={sop.status} playbookName={pb.name} estimatedTime={sop.estimatedTime} authorOrOwner={sop.owner} updatedAt={formatGuideDate(sop.updatedAt)} type="SOP"/>
 <SummarySection text={sop.purpose} title="Purpose"/><SummarySection text={sop.whenToUse} title="When to Use"/><SummarySection text={sop.responsibleTeam} title="Responsible Team"/>
 <RequirementsSection requirements={sop.requirements}/>
 {!!sop.checklist.length&&<section className="article-section"><div className="section-heading"><h2>Process Checklist</h2><span className="helper-text">{sop.checklist.filter((_,i)=>completed[i]).length} of {sop.checklist.length} complete</span></div><div className="article-checklist">{sop.checklist.map((stage,i)=><label key={i}><input type="checkbox" checked={!!completed[i]} onChange={e=>setCompleted({...completed,[i]:e.target.checked})}/><span>{stage}</span></label>)}</div></section>}
 <StepsSection steps={sop.steps} title="Process Steps"/>
 {sop.escalationRules&&<section className="article-section"><h2>Escalation Rules</h2><div className="quiet-callout"><p>{sop.escalationRules}</p></div></section>}
 <SummarySection text={sop.completionCriteria} title="Completion Criteria"/>
 {!!related.length&&<section><h2>Related Resources</h2>{related.map(item=><ContentRow key={item.id} item={item}/>)}</section>}
 <InternalNotes notes={sop.internalNotes}/><RevisionHistory history={sop.revisionHistory}/>
 </div>;
}
