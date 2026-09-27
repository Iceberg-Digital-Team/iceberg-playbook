import { useState, useEffect } from 'react';
import { ArrowLeft, Edit, Link2, Share2 } from 'lucide-react';
import { useRouter } from '../router';
import {
  guideContent,
  formatGuideVersion,
  type Playbook,
  type VersionedGuide,
  type Issue,
  type GuideVersion
} from '../data';
import { getPlaybookBySlug } from '../services/playbookService';
import { getGuideById } from '../services/guideService';
import { getIssueById } from '../services/issueService';
import { GuideArticle } from '../components/knowledge/GuideArticle';
import { GuideHistory } from '../components/knowledge/GuideHistory';
import '../components/knowledge/Knowledge.css';
import { StateMessage } from '../components/knowledge/ApplicationUI';

export function GuideDetail() {
  const { params, navigate } = useRouter();
  const [message, setMessage] = useState('');
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [current, setCurrent] = useState<VersionedGuide | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(Boolean(params.slug && params.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!params.slug || !params.id) {
      return;
    }
    Promise.all([
      getPlaybookBySlug(params.slug),
      getGuideById(params.id)
    ])
      .then(async ([pbData, guideData]) => {
        if (!active) return;
        setPlaybook(pbData);
        if (guideData && pbData && guideData.playbookId === pbData.id) {
          setCurrent(guideData);
          if (guideData.issueId) {
            try {
              const issueData = await getIssueById(guideData.issueId);
              if (active) setIssue(issueData);
            } catch {
              // Non-fatal if issue details cannot be loaded
            }
          }
        } else {
          setCurrent(null);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load Guide.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params.slug, params.id]);

  if (loading) {
    return (
      <div className="guide-article">
        <StateMessage title="Loading Guide…">
          Retrieving guide details…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="guide-article">
        <StateMessage
          error
          title="Unable to load Guide"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        >
          {error}
        </StateMessage>
      </div>
    );
  }

  if (!current || !playbook) {
    return (
      <StateMessage
        title="Guide not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      />
    );
  }

  const baseUrl = `#/playbooks/${playbook.slug}/guides/${current.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Link copied.');
    } catch {
      setMessage('Could not copy the link. Copy the address from your browser.');
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: current.title, url: window.location.href });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setMessage('Could not share the Guide.');
      }
    }
  };

  const initialVersionItem: GuideVersion = {
    id: current.currentVersionId,
    guideId: current.id,
    versionNumber: current.versionNumber,
    changeSummary: 'Initial Guide created.',
    createdAt: current.createdAt,
    createdBy: current.createdBy,
    ...guideContent(current)
  };

  return (
    <div className="guide-article">
      <div className="knowledge-actions guide-toolbar">
        <button
          className="btn-secondary"
          onClick={() => navigate(`/playbooks/${playbook.slug}`)}
        >
          <ArrowLeft size={14} />Back to {playbook.name} Playbook
        </button>
        <div className="knowledge-actions">
          <button
            className="btn-secondary"
            onClick={() => setMessage('Guide editing is not available in this preview yet.')}
          >
            <Edit size={14} />Edit Guide
          </button>
          <button className="btn-secondary" onClick={share}>
            <Share2 size={14} />Share
          </button>
          <button className="btn-secondary" onClick={copy}>
            <Link2 size={14} />Copy Link
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <GuideArticle
        key={current.currentVersionId}
        guide={current}
        versionLabel={`Current version: v${formatGuideVersion(current.versionNumber)}`}
        playbook={playbook}
        issue={issue}
      />
      <GuideHistory
        guide={current}
        versions={[initialVersionItem]}
        baseUrl={baseUrl}
      />
    </div>
  );
}
