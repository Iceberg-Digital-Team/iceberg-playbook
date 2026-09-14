import React, { useState } from 'react';
import { Search, ArrowRight, MessageSquare, Briefcase, Home as HomeIcon, Video, Mic, Globe, type LucideIcon } from 'lucide-react';
import { useRouter } from '../router';
import { getPlaybooks, getIssues, getGuides, getSOPs } from '../data';
import './Home.css';

const iconMap: Record<string, LucideIcon> = { MessageSquare, Briefcase, Home: HomeIcon, Video, Mic, Globe };
interface HomeProps { onSearchTrigger: (query: string) => void; }

export const Home: React.FC<HomeProps> = ({ onSearchTrigger }) => {
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');
  const playbooks = getPlaybooks();
  const recentItems = [
    ...getIssues().map(item => ({ ...item, type: 'Issue', folder: 'issues' })),
    ...getGuides().map(item => ({ ...item, type: 'Guide', folder: 'guides' })),
    ...getSOPs().map(item => ({ ...item, type: 'SOP', folder: 'sops' })),
  ]
    .filter(item => item.status === 'Verified' && playbooks.some(pb => pb.id === item.playbookId))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, 4);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    onSearchTrigger(query.trim());
    navigate('/search');
  };

  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <h1 id="home-title">How can we help?</h1>
        <p>Find the answer. Get back to solving.</p>
        <form className="home-search" role="search" onSubmit={submitSearch}>
          <Search size={22} strokeWidth={1.6} aria-hidden="true" />
          <label className="home-sr-only" htmlFor="home-query">Search issues, guides, SOPs or issue codes</label>
          <input id="home-query" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search issues, guides, SOPs or issue codes…" autoComplete="off" />
          <button type="submit" aria-label="Search Playbook"><ArrowRight size={20} aria-hidden="true" /></button>
        </form>
        <p className="home-search-hint">Start with an issue code or describe the problem.</p>
      </section>
      <section className="home-discovery" aria-labelledby="home-playbooks-title">
        <div className="home-section-heading">
          <h2 id="home-playbooks-title">Playbooks</h2>
          <a href="#/playbooks">View all <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
        {playbooks.length ? <div className="home-playbooks">
          {playbooks.slice(0, 4).map(pb => {
            const Icon = iconMap[pb.icon] || MessageSquare;
            return <a key={pb.id} className="home-playbook" href={`#/playbooks/${pb.slug}`}>
              <span className="home-playbook-icon"><Icon size={21} strokeWidth={1.5} aria-hidden="true" /></span>
              <span>{pb.name}</span>
              <ArrowRight className="home-link-arrow" size={16} aria-hidden="true" />
            </a>;
          })}
        </div> : <p className="home-empty">Your team’s playbooks will appear here. <a href="#/create/playbook">Create a playbook</a></p>}
      </section>
      <section className="home-recent" aria-labelledby="home-recent-title">
        <div className="home-section-heading"><h2 id="home-recent-title">Recent solutions</h2></div>
        {recentItems.length ? <ul className="home-solutions">
          {recentItems.map(item => {
            const pb = playbooks.find(book => book.id === item.playbookId)!;
            return <li key={`${item.folder}-${item.id}`}>
              <a className="home-solution" href={`#/playbooks/${pb.slug}/${item.folder}/${encodeURIComponent(item.id)}`}>
                <span className="home-solution-code">{item.id}</span>
                <span className="home-solution-title">{item.title}</span>
                <span className="home-solution-type">{item.type}</span>
                <ArrowRight className="home-link-arrow" size={16} aria-hidden="true" />
              </a>
            </li>;
          })}
        </ul> : <p className="home-empty">Verified solutions will appear here as your team documents them.</p>}
      </section>
    </div>
  );
};
