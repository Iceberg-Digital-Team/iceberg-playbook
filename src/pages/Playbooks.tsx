import { useState } from 'react';
import { Plus, MessageSquare, Briefcase, Home, Video, Mic, Globe, ArrowRight, type LucideIcon } from 'lucide-react';
import { getPlaybooks } from '../data';
import { PageHeader, SearchField, StateMessage } from '../components/knowledge/ApplicationUI';
const icons:Record<string,LucideIcon>={MessageSquare,Briefcase,Home,Video,Mic,Globe};
export function Playbooks() {
 const [query,setQuery]=useState(''); const playbooks=getPlaybooks().filter(p=>`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()));
 return <div className="page"><PageHeader title="Playbooks" description="Choose a product, platform or problem area." action={<a className="btn-primary" href="#/create/playbook"><Plus size={16}/>New Playbook</a>}/><SearchField label="Search Playbooks" placeholder="Search Playbooks…" value={query} onChange={setQuery}/>
 {playbooks.length?<div className="playbook-grid">{playbooks.map(p=>{const Icon=icons[p.icon]||MessageSquare;return <a className="playbook-tile" key={p.id} href={`#/playbooks/${p.slug}`}><div className="tile-heading"><Icon size={23} strokeWidth={1.5}/><h2>{p.name}</h2></div><p>{p.description}</p><div className="tile-footer"><span>{p.issueCount} Issues · {p.guideCount} Guides · {p.sopCount} SOPs</span><ArrowRight size={17}/></div></a>;})}</div>:<StateMessage title="No Playbooks found" action={<a href="#/create/playbook">Create a Playbook →</a>}>Try another search or create a new problem area.</StateMessage>}</div>;
}
