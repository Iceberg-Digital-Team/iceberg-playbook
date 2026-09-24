import { useState } from 'react';
import { ArrowLeft, Edit, Link2, Share2 } from 'lucide-react';
import { useRouter } from '../router';
import { getGuides, getPlaybooks, getGuideVersion, getGuideVersions, guideContent, restoreGuideVersion, formatGuideDate, formatGuideVersion, formatStorageError } from '../data';
import { GuideArticle } from '../components/knowledge/GuideArticle';
import { GuideHistory, RestoreGuideDialog } from '../components/knowledge/GuideHistory';
import '../components/knowledge/Knowledge.css';
import { StateMessage } from '../components/knowledge/ApplicationUI';
import { getGuideSessionMedia } from '../components/knowledge/mediaUtils';

export function GuideDetail() {
  const { params, navigate } = useRouter();
  const [confirmation, setConfirmation] = useState<{ target: string; expected: string; number: number; current: number }>();
  const [message, setMessage] = useState('');
  const playbook = getPlaybooks().find(p => p.slug === params.slug);
  const current = getGuides().find(g => g.id === params.id && g.playbookId === playbook?.id);
  const version = current && params.version ? getGuideVersion(current.id, params.version) : undefined;
  if (!current || !playbook) return <StateMessage title="Guide not found" action={<a href="#/playbooks">Back to Playbooks</a>}/>;
  const baseUrl = `#/playbooks/${playbook.slug}/guides/${current.id}`;
  if (params.version && !version) return <StateMessage title="Version not found" action={<a href={baseUrl}>Back to Current Version</a>}/>;
  const historical = version && version.id !== current.currentVersionId;
  const displayed = version ? { ...current, ...guideContent(version), updatedAt: version.createdAt, author: version.createdBy } : { ...current, author: current.updatedBy };
  const sessionMedia = !historical ? getGuideSessionMedia(current.id) : undefined;
  const guideToRender = sessionMedia ? {
    ...displayed,
    video: sessionMedia.video ?? displayed.video,
    pdf: sessionMedia.pdf ?? displayed.pdf,
    steps: displayed.steps.map((s, i) => ({
      ...s,
      screenshot: sessionMedia.screenshots?.[i] ?? s.screenshot
    }))
  } : displayed;
  const restore = () => {
    if (!confirmation) return;
    try {
      restoreGuideVersion(current.id, confirmation.target, confirmation.expected);
      setConfirmation(undefined); setMessage('Version restored successfully.'); navigate(baseUrl);
    } catch (e) { setConfirmation(undefined); setMessage(formatStorageError(e, 'Could not restore this version.')); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setMessage('Link copied.'); }
    catch { setMessage('Could not copy the link. Copy the address from your browser.'); }
  };
  const share = async () => {
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: displayed.title, url: window.location.href }); }
    catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setMessage('Could not share the Guide.'); }
  };
  return <div className="guide-article">
    <div className="knowledge-actions guide-toolbar">
      <button className="btn-secondary" onClick={() => navigate(`/playbooks/${playbook.slug}`)}><ArrowLeft size={14} />Back to {playbook.name} Playbook</button>
      <div className="knowledge-actions">{!historical && <button className="btn-secondary" onClick={() => navigate(`/guides/${current.id}/edit`)}><Edit size={14} />Edit Guide</button>}
        <button className="btn-secondary" onClick={share}><Share2 size={14} />Share</button><button className="btn-secondary" onClick={copy}><Link2 size={14} />Copy Link</button>
      </div>
    </div>
    {message && <p role="status">{message}</p>}
    {historical && <section className="issue-connection"><h2>You are viewing an older version</h2><p>Version {formatGuideVersion(version.versionNumber)} · {formatGuideDate(version.createdAt)} · {version.createdBy}</p>
      <div className="knowledge-actions"><a className="btn-secondary" href={baseUrl}>Back to Current Version</a><button className="btn-primary" onClick={() => setConfirmation({ target: version.id, expected: current.currentVersionId, number: version.versionNumber, current: current.versionNumber })}>Restore This Version</button></div>
    </section>}
    <GuideArticle key={version?.id || current.currentVersionId} guide={guideToRender} versionLabel={`${historical ? 'Viewing version' : 'Current version'}: v${formatGuideVersion(version?.versionNumber || current.versionNumber)}`} />
    <GuideHistory guide={current} versions={getGuideVersions(current.id)} baseUrl={baseUrl} />
    {confirmation && <RestoreGuideDialog current={confirmation.current} target={confirmation.number} onCancel={() => setConfirmation(undefined)} onRestore={restore} />}
  </div>;
}
