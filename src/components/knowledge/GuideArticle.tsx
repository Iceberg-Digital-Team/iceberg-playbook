import type { Guide, Playbook, Issue } from '../../data';
import { getIssues, getPlaybooks, formatGuideDate } from '../../data';
import { guideChecklist } from '../../guideTemplate';
import { ArticleHeader, SummarySection, ChecklistSection, ImportantInfoSection, StepsSection, CommonProblemsAccordion, InternalNotes, VideoSection, PDFSection } from '../article/ArticleComponents';
import './Knowledge.css';

export function GuideArticle({
  guide,
  versionLabel,
  playbook,
  issue
}: {
  guide: Guide;
  versionLabel?: string;
  playbook?: Playbook | null;
  issue?: Issue | null;
}) {
  const pb = playbook ?? getPlaybooks().find(p => p.id === guide.playbookId);
  const iss = issue ?? getIssues().find(i => i.id === guide.issueId);
  if (!pb || !iss) return <p>The related Issue is unavailable.</p>;
  return (
    <article className="guide-article">
      <ArticleHeader
        code={guide.id}
        title={guide.title}
        status={guide.status}
        playbookName={pb.name}
        difficulty={guide.difficulty}
        estimatedTime={guide.estimatedTime}
        updatedAt={formatGuideDate(guide.updatedAt)}
        authorOrOwner={guide.author}
        type="Guide"
        versionLabel={versionLabel}
        connection={<a href={`#/playbooks/${pb.slug}/issues/${iss.id}`}>{iss.id} — {iss.title}</a>}
      />
      <SummarySection text={guide.summary} />
      <ChecklistSection items={guideChecklist(guide)} />
      <ImportantInfoSection info={guide.importantInformation} />
      <VideoSection key={guide.video} url={guide.video} />
      <StepsSection steps={guide.steps} linkedMedia />
      <PDFSection url={guide.pdf} updatedAt={formatGuideDate(guide.updatedAt)} />
      <CommonProblemsAccordion problems={guide.commonProblems} />
      <InternalNotes notes={guide.internalNotes} />
    </article>
  );
}
