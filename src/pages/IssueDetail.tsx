import { useState } from 'react';
import { ArrowLeft, Share2, Link2, Edit, ArrowRight, Plus } from 'lucide-react';
import { useRouter } from '../router';
import { getIssues, getPlaybooks, getPrimaryGuide, formatGuideVersion, formatGuideDate } from '../data';
import { ArticleHeader, SummarySection, InternalNotes } from '../components/article/ArticleComponents';
import { StateMessage } from '../components/knowledge/ApplicationUI';
import { safeMediaUrl } from '../guideTemplate';
export function IssueDetail() {
 const {params}=useRouter();const [message,setMessage]=useState('');const pb=getPlaybooks().find(p=>p.slug===params.slug);const issue=getIssues().find(i=>i.id===params.id&&i.playbookId===pb?.id);
 if(!issue||!pb)return <StateMessage title="Issue not found" action={<a href="#/playbooks">Back to Playbooks</a>}>Choose an existing problem from a Playbook.</StateMessage>;
 const guide=getPrimaryGuide(issue.id);
 const copy=async()=>{try{await navigator.clipboard.writeText(window.location.href);setMessage('Link copied.');}catch{setMessage('Could not copy the link. Copy the address from your browser.');}};
 const share=async()=>{if(!navigator.share){await copy();return;}try{await navigator.share({title:issue.title,url:window.location.href});}catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setMessage('Could not share the Issue.');}};
 return <div className="page reading-page"><div className="toolbar"><a className="back-link" href={`#/playbooks/${pb.slug}`}><ArrowLeft size={14}/>Back to {pb.name} Playbook</a><div className="inline-actions"><button className="btn-secondary" onClick={()=>setMessage('Issue editing is not available in this preview yet.')}><Edit size={14}/>Edit</button><button className="btn-secondary" onClick={share}><Share2 size={14}/>Share</button><button className="btn-secondary" onClick={copy}><Link2 size={14}/>Copy Link</button></div></div>{message&&<p className="helper-text" role="status">{message}</p>}
 <ArticleHeader code={issue.id} title={issue.title} status={issue.status} playbookName={pb.name} difficulty={issue.difficulty} estimatedTime={issue.estimatedTime} updatedAt={formatGuideDate(issue.updatedAt)} authorOrOwner={issue.author} type="Issue"/>
 <SummarySection text={issue.summary} title="Problem Summary"/>
 <section className="article-section"><h2>Symptoms</h2>{issue.symptoms.length?<ul className="plain-list">{issue.symptoms.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p>No symptoms documented yet.</p>}</section>
 {issue.errorMessage&&<SummarySection text={issue.errorMessage} title="Error Message / Code"/>}{issue.context&&<SummarySection text={issue.context} title="When Does This Happen?"/>}{issue.affectedArea&&<SummarySection text={issue.affectedArea} title="Affected Area"/>}
 <section className="article-section"><h2>Information to Collect</h2>{issue.informationToCollect.length?<ul className="plain-list">{issue.informationToCollect.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p>No information requirements documented yet.</p>}</section>
 {!!issue.attachments.length&&<section className="article-section"><h2>Attachments</h2>{issue.attachments.map((a,i)=><div className="document-row" key={i}><a href={safeMediaUrl(a.url)} target="_blank" rel="noreferrer">{a.name||a.url}</a></div>)}</section>}
 <InternalNotes notes={issue.internalNotes}/><section className="issue-connection" aria-labelledby="solution-guide-heading"><h3 id="solution-guide-heading">Solution Guide</h3>{guide?<><p className="helper-text">Solution Available</p><h2>{guide.title}</h2><p className="helper-text">{guide.status} · {guide.estimatedTime} · Current version: v{formatGuideVersion(guide.versionNumber)} · Updated {formatGuideDate(guide.updatedAt)}</p><a className="btn-primary" href={`#/playbooks/${pb.slug}/guides/${guide.id}`}>Open Guide<ArrowRight size={16}/></a></>:<><h2>Guide Needed</h2><p>This problem has been documented but does not have a solution Guide yet.</p><a className="btn-primary" href={`#/create/guide?issue=${encodeURIComponent(issue.id)}`}><Plus size={16}/>Create Guide</a></>}</section></div>;
}
