import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getPlaybooks, savePlaybooks } from '../data';
import { PageHeader, FormSection } from '../components/knowledge/ApplicationUI';
function DeleteDialog({name,onCancel,onConfirm}:{name:string;onCancel:()=>void;onConfirm:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const el=ref.current!;el.showModal();return()=>el.close();},[]);
 return <dialog className="guide-restore-dialog" ref={ref} aria-labelledby="delete-title" onCancel={e=>{e.preventDefault();onCancel();}}><h2 id="delete-title">Delete {name}?</h2><p>This empty Playbook will be removed. This cannot be undone.</p><div className="knowledge-actions"><button autoFocus className="btn-secondary" onClick={onCancel}>Cancel</button><button className="btn-primary" onClick={onConfirm}>Delete Playbook</button></div></dialog>;
}
export function Settings() {
 const {session,signOut}=useAuth();
 const [playbooks,setPlaybooks]=useState(getPlaybooks());const [defaultPlaybook,setDefaultPlaybook]=useState('whatsapp');const [itemsPerPage,setItemsPerPage]=useState('10');const [pending,setPending]=useState<string>();const [message,setMessage]=useState('');
 const deletion=()=>{try{const pb=getPlaybooks().find(p=>p.id===pending);if(pb&&(pb.issueCount||pb.guideCount||pb.sopCount))throw Error('This Playbook contains content and cannot be deleted.');const updated=playbooks.filter(p=>p.id!==pending);savePlaybooks(updated);setPlaybooks(updated);setMessage('Playbook deleted.');}catch(e){setMessage(e instanceof Error?e.message:'Could not delete Playbook.');}setPending(undefined);};
 return <div className="editor settings-page"><PageHeader title="Settings" description="Your profile, Playbooks and content preferences."/>
 <FormSection title="Support Profile"><dl className="settings-profile"><div><dt>Name</dt><dd>{session?.profile?.full_name || "Internal user"}</dd></div><div><dt>Email</dt><dd>{session?.user.email}</dd></div><div><dt>Role</dt><dd>{session?.profile?.role || "Internal user"}</dd></div></dl></FormSection>
 <FormSection title="Playbooks"><div>{playbooks.map(pb=><div className="settings-row" key={pb.id}><a href={`#/playbooks/${pb.slug}`}>{pb.name}</a><span className="helper-text">{pb.code}</span><button className="back-link" onClick={()=>{if(pb.issueCount||pb.guideCount||pb.sopCount){setMessage('This Playbook contains content and cannot be deleted.');return;}setPending(pb.id);}} aria-label={`Delete ${pb.name}`}>Delete</button></div>)}</div><a href="#/create/playbook">New Playbook →</a></FormSection>
 {message&&<p role="status" className="helper-text">{message}</p>}
 <FormSection title="Content Preferences"><div className="form-grid"><label>Default Playbook<select value={defaultPlaybook} onChange={e=>setDefaultPlaybook(e.target.value)}>{playbooks.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Items per page<select value={itemsPerPage} onChange={e=>setItemsPerPage(e.target.value)}>{['5','10','20','50'].map(n=><option key={n} value={n}>{n} items</option>)}</select></label></div><p className="helper-text">Preference controls are a preview and do not yet change content lists.</p></FormSection>
 <FormSection title="Integrations"><div className="settings-row"><div><h3>Jira Integration</h3><p className="helper-text">Connect support tickets to documented solutions.</p></div><span className="helper-text">Coming Soon</span></div></FormSection>
 <button className="back-link" onClick={async()=>{try{await signOut();}catch{setMessage('Unable to sign out. Please try again.');}}}>Sign Out of Account</button>
 {pending&&<DeleteDialog name={playbooks.find(p=>p.id===pending)?.name||'Playbook'} onCancel={()=>setPending(undefined)} onConfirm={deletion}/>}
 </div>;
}
