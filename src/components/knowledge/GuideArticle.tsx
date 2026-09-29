import { useState, useEffect } from 'react';
import type { Guide, Playbook, Issue, Step } from '../../data';
import { formatGuideDate } from '../../data';
import { guideChecklist } from '../../guideTemplate';
import { getSignedMediaUrl, getSignedMediaUrls, isStorageKey } from '../../services/mediaService';
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
  const pb = playbook ?? null;
  const iss = issue ?? null;

  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string | undefined>(guide.video);
  const [resolvedPdfUrl, setResolvedPdfUrl] = useState<string | undefined>(guide.pdf);
  const [resolvedSteps, setResolvedSteps] = useState<Step[]>(guide.steps);

  useEffect(() => {
    let active = true;

    async function resolveUrls() {
      // 1. Video
      const videoKey = guide.videoStorageKey || (isStorageKey(guide.video) ? guide.video : null);
      if (videoKey) {
        try {
          const signed = await getSignedMediaUrl(videoKey);
          if (active) setResolvedVideoUrl(signed);
        } catch (e) {
          console.warn('Could not load signed video URL:', e);
        }
      } else {
        if (active) setResolvedVideoUrl(guide.video);
      }

      // 2. PDF
      const pdfKey = guide.pdfStorageKey || (isStorageKey(guide.pdf) ? guide.pdf : null);
      if (pdfKey) {
        try {
          const signed = await getSignedMediaUrl(pdfKey);
          if (active) setResolvedPdfUrl(signed);
        } catch (e) {
          console.warn('Could not load signed PDF URL:', e);
        }
      } else {
        if (active) setResolvedPdfUrl(guide.pdf);
      }

      // 3. Step Screenshots
      const screenshotKeys = (guide.steps || [])
        .map(s => s.screenshot)
        .filter((s): s is string => Boolean(s && isStorageKey(s)));

      if (screenshotKeys.length > 0) {
        try {
          const map = await getSignedMediaUrls(screenshotKeys);
          if (active) {
            setResolvedSteps(
              guide.steps.map(s => ({
                ...s,
                screenshot: s.screenshot && map.has(s.screenshot) ? map.get(s.screenshot)! : s.screenshot
              }))
            );
          }
        } catch (e) {
          console.warn('Could not load signed screenshot URLs:', e);
        }
      } else {
        if (active) setResolvedSteps(guide.steps);
      }
    }

    resolveUrls();

    return () => {
      active = false;
    };
  }, [guide.id, guide.video, guide.videoStorageKey, guide.pdf, guide.pdfStorageKey, guide.steps]);

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
        jiraCode={iss.jiraCode}
      />
      <SummarySection text={guide.summary} />
      <ChecklistSection items={guideChecklist(guide)} />
      <ImportantInfoSection info={guide.importantInformation} />
      <VideoSection key={resolvedVideoUrl || guide.video} url={resolvedVideoUrl || guide.video} />
      <StepsSection steps={resolvedSteps} linkedMedia />
      <PDFSection url={resolvedPdfUrl || guide.pdf} updatedAt={formatGuideDate(guide.updatedAt)} />
      <CommonProblemsAccordion problems={guide.commonProblems} />
      <InternalNotes notes={guide.internalNotes} />
    </article>
  );
}
