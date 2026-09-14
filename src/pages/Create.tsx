import { AlertTriangle, BookOpen, FileCheck2, FolderPlus, ArrowRight } from 'lucide-react';
import { PageHeader } from '../components/knowledge/ApplicationUI';
import { useRouter } from '../router';
export function Create() {
 const {params}=useRouter(); const suffix=params.playbook?`?playbook=${encodeURIComponent(params.playbook)}`:'';
 const options=[{title:'Issue',description:'Document a problem, its symptoms and what Support needs to investigate.',icon:AlertTriangle,path:'issue'},{title:'Guide',description:'Select an existing Issue and document its step-by-step solution.',icon:BookOpen,path:'guide'},{title:'SOP',description:'Define a standard process, checklist or escalation workflow.',icon:FileCheck2,path:'sop'},{title:'Playbook',description:'Organize knowledge around a product, platform or problem area.',icon:FolderPlus,path:'playbook'}];
 return <div className="page reading-page"><PageHeader title="Create" description="Document what we learned."/><div className="create-options">{options.map(({title,description,icon:Icon,path})=><a key={path} className="create-option" href={`#/create/${path}${suffix}`}><Icon size={23} strokeWidth={1.5}/><div><h2>New {title}</h2><p>{description}</p></div><ArrowRight size={18}/></a>)}</div></div>;
}
