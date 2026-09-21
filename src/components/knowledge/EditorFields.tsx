import { Plus, Trash2 } from 'lucide-react';
import type { Step } from '../../data';
import { MediaUploadField } from './MediaUploadField';
export function StringList({ label, values, onChange }: { label: string; values: string[]; onChange: (values:string[])=>void }) {
  return <div className="knowledge-list">{values.map((value,i)=><div className="knowledge-list-row" key={i}><input aria-label={`${label} ${i+1}`} value={value} onChange={e=>onChange(values.map((v,n)=>n===i?e.target.value:v))}/><button type="button" aria-label={`Remove ${label} ${i+1}`} onClick={()=>onChange(values.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div>)}<button className="btn-secondary" type="button" onClick={()=>onChange([...values,''])}><Plus size={14}/>Add {label}</button></div>;
}
export function StepEditor({ steps, initialSteps, onChange }: { steps: Omit<Step,'number'>[]; initialSteps?: Omit<Step,'number'>[]; onChange:(steps:Omit<Step,'number'>[])=>void }) {
  const update=(i:number,key:keyof Omit<Step,'number'>,value:string)=>onChange(steps.map((s,n)=>n===i?{...s,[key]:value}:s));
  return <div>{steps.map((step,i)=>{
    const initialScreenshot = initialSteps?.[i]?.screenshot;
    return <details className="editor-step" open={i===0 || undefined} key={i}><summary>Step {String(i+1).padStart(2,'0')} · {step.title || 'New step'}</summary><div className="form-section-body">
    <label>Title *<input required aria-label={`Step ${i+1} title`} value={step.title} onChange={e=>update(i,'title',e.target.value)} /></label>
    <label>Description *<textarea required aria-label={`Step ${i+1} description`} rows={4} value={step.description} onChange={e=>update(i,'description',e.target.value)}/></label>
    <label>Expected Result<input aria-label={`Step ${i+1} expected result`} value={step.successIndicator||''} onChange={e=>update(i,'successIndicator',e.target.value)} /></label>
    <details className="disclosure"><summary>Screenshot, notes & references</summary><div className="optional-fields">
    <label>Screenshot
      <MediaUploadField
        type="image"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        acceptedFormatsText="Accepted formats: PNG, JPG, WebP"
        dropText="Drag & drop a screenshot here"
        buttonText="Choose Screenshot"
        value={step.screenshot || ''}
        initialValue={initialScreenshot}
        showPreviewImage
        onChange={(url) => update(i, 'screenshot', url)}
      />
    </label>
    {(['importantNote','estimatedTime','videoLink','pdfReference'] as const).map(field=><label key={field}>{{importantNote:'Important Note',estimatedTime:'Estimated Time',videoLink:'Video Reference URL',pdfReference:'PDF Reference URL'}[field]}<input aria-label={`Step ${i+1} ${field}`} value={step[field]||''} onChange={e=>update(i,field,e.target.value)}/></label>)}
    </div></details>{steps.length>1 && <button className="back-link" type="button" onClick={()=>onChange(steps.filter((_,n)=>n!==i))}><Trash2 size={14}/>Remove Step {i+1}</button>}
  </div></details>;
  })}<button className="btn-secondary" type="button" onClick={()=>onChange([...steps,{title:'',description:''}])}><Plus size={14}/>Add Step</button></div>;
}
// Native validation must be able to focus a required control inside a collapsed section.
export function revealInvalid(event: React.InvalidEvent<HTMLFormElement>) {
  let node: HTMLElement | null = event.target as HTMLElement;
  while(node) { if(node instanceof HTMLDetailsElement) node.open=true; node=node.parentElement; }
}

