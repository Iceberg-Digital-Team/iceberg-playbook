import { Plus, Trash2 } from 'lucide-react';
import type { Step } from '../../data';
import { MediaUploadField } from './MediaUploadField';
export function StringList({ label, values, onChange }: { label: string; values: string[]; onChange: (values:string[])=>void }) {
  return <div className="knowledge-list">{values.map((value,i)=><div className="knowledge-list-row" key={i}><input aria-label={`${label} ${i+1}`} value={value} onChange={e=>onChange(values.map((v,n)=>n===i?e.target.value:v))}/><button type="button" aria-label={`Remove ${label} ${i+1}`} onClick={()=>onChange(values.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div>)}<button className="btn-secondary" type="button" onClick={()=>onChange([...values,''])}><Plus size={14}/>Add {label}</button></div>;
}
export interface StepEditorProps {
  steps: Omit<Step, 'number'>[];
  initialSteps?: Omit<Step, 'number'>[];
  onChange: (steps: Omit<Step, 'number'>[]) => void;
  domain?: 'guides' | 'issues' | 'sops';
  entityId?: string;
}

export function StepEditor({
  steps,
  initialSteps,
  onChange,
  domain = 'guides',
  entityId,
}: StepEditorProps) {
  const update = (i: number, key: keyof Omit<Step, 'number'>, value: string) =>
    onChange(steps.map((s, n) => (n === i ? { ...s, [key]: value } : s)));

  return (
    <div>
      {steps.map((step, i) => {
        const initialScreenshot = initialSteps?.[i]?.screenshot;
        return (
          <details className="editor-step" open={i === 0 || undefined} key={i}>
            <summary>
              Step {String(i + 1).padStart(2, '0')} · {step.title || 'New step'}
            </summary>
            <div className="form-section-body">
              <label>
                Title *
                <input
                  required
                  aria-label={`Step ${i + 1} title`}
                  value={step.title}
                  onChange={e => update(i, 'title', e.target.value)}
                />
              </label>
              <label>
                Description *
                <textarea
                  required
                  aria-label={`Step ${i + 1} description`}
                  rows={4}
                  value={step.description}
                  onChange={e => update(i, 'description', e.target.value)}
                />
              </label>
              <label>
                Expected Result
                <input
                  aria-label={`Step ${i + 1} expected result`}
                  value={step.successIndicator || ''}
                  onChange={e => update(i, 'successIndicator', e.target.value)}
                />
              </label>
              <details className="disclosure">
                <summary>Screenshot, media & notes</summary>
                <div className="optional-fields">
                  <label>
                    Screenshot
                    <MediaUploadField
                      type="image"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      acceptedFormatsText="Accepted formats: PNG, JPG, WebP"
                      dropText="Drag & drop a screenshot here"
                      buttonText="Choose Screenshot"
                      value={step.screenshot || ''}
                      initialValue={initialScreenshot}
                      domain={domain}
                      entityId={entityId}
                      showPreviewImage
                      onChange={(url, _file, storageKey) =>
                        update(i, 'screenshot', storageKey || url)
                      }
                    />
                  </label>

                  <div className="step-media-block">
                    <span className="step-media-label">Video Reference (Optional)</span>
                    <MediaUploadField
                      type="video"
                      accept="video/mp4,video/webm,.mp4,.webm"
                      acceptedFormatsText="Accepted formats: MP4, WebM"
                      dropText="Drag & drop a video here"
                      buttonText="Choose Video"
                      value={step.videoLink || ''}
                      initialValue={initialSteps?.[i]?.videoLink}
                      domain={domain}
                      entityId={entityId}
                      allowExternalUrl
                      externalUrlPlaceholder="https://example.com/video.mp4 or YouTube / Vimeo link"
                      onChange={(url, _file, storageKey) =>
                        update(i, 'videoLink', storageKey || url)
                      }
                    />
                  </div>

                  <div className="step-media-block">
                    <span className="step-media-label">PDF Reference (Optional)</span>
                    <MediaUploadField
                      type="pdf"
                      accept="application/pdf,.pdf"
                      acceptedFormatsText="Accepted format: PDF"
                      dropText="Drag & drop a PDF here"
                      buttonText="Choose PDF"
                      value={step.pdfReference || ''}
                      initialValue={initialSteps?.[i]?.pdfReference}
                      domain={domain}
                      entityId={entityId}
                      allowExternalUrl
                      externalUrlPlaceholder="https://example.com/document.pdf"
                      onChange={(url, _file, storageKey) =>
                        update(i, 'pdfReference', storageKey || url)
                      }
                    />
                  </div>

                  <label>
                    Important Note
                    <input
                      aria-label={`Step ${i + 1} importantNote`}
                      value={step.importantNote || ''}
                      onChange={e => update(i, 'importantNote', e.target.value)}
                    />
                  </label>
                  <label>
                    Estimated Time
                    <input
                      aria-label={`Step ${i + 1} estimatedTime`}
                      value={step.estimatedTime || ''}
                      onChange={e => update(i, 'estimatedTime', e.target.value)}
                    />
                  </label>
                </div>
              </details>
              {steps.length > 1 && (
                <button
                  className="back-link"
                  type="button"
                  onClick={() => onChange(steps.filter((_, n) => n !== i))}
                >
                  <Trash2 size={14} />
                  Remove Step {i + 1}
                </button>
              )}
            </div>
          </details>
        );
      })}
      <button
        className="btn-secondary"
        type="button"
        onClick={() => onChange([...steps, { title: '', description: '' }])}
      >
        <Plus size={14} />
        Add Step
      </button>
    </div>
  );
}
// Native validation must be able to focus a required control inside a collapsed section.
export function revealInvalid(event: React.InvalidEvent<HTMLFormElement>) {
  let node: HTMLElement | null = event.target as HTMLElement;
  while(node) { if(node instanceof HTMLDetailsElement) node.open=true; node=node.parentElement; }
}

