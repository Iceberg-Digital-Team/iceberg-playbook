import React, { useState } from 'react';
import { 
  ArrowLeft, ArrowRight, RefreshCw 
} from 'lucide-react';
import { getPlaybooks } from '../data';
import { PageHeader, StateMessage } from '../components/knowledge/ApplicationUI';
import { resolveTroubleshooting } from '../search/searchService';

interface DecisionStep {
  playbookId: string | null;
  category: string | null;
  symptom: string | null;
}

export const Troubleshooting: React.FC = () => {
  const [selections, setSelections] = useState<DecisionStep>({
    playbookId: null,
    category: null,
    symptom: null
  });

  const playbooks = getPlaybooks();

  // 1. Playbook Options
  const handleSelectPlaybook = (id: string) => {
    setSelections({ playbookId: id, category: null, symptom: null });
  };

  // 2. Category Options mapping
  const getCategories = (pbId: string): string[] => {
    switch (pbId) {
      case 'whatsapp':
        return ['Phone Number', 'Account', 'Verification', 'Templates', 'Migration', 'Embedded Signup'];
      case 'meta-business':
        return ['Business Verification', 'System User', 'Permissions', 'Business Portfolio'];
      case 'lifesycle':
        return ['Property Matching', 'Webhooks', 'Lead Syncing'];
      case 'zoom':
        return ['Meetings', 'SSO', 'Webhooks'];
      default:
        return ['Other Issues'];
    }
  };

  const handleSelectCategory = (cat: string) => {
    setSelections(prev => ({ ...prev, category: cat, symptom: null }));
  };

  // 3. Symptom Options mapping
  const getSymptoms = (pbId: string, category: string): string[] => {
    if (pbId === 'whatsapp') {
      if (category === 'Phone Number') {
        return ['Number already registered', 'OTP not received', 'Number unavailable', 'Migration failed', 'Other'];
      }
      if (category === 'Embedded Signup') {
        return ['Popup closes abruptly', 'Blank window displays', 'Permissions error'];
      }
    }
    if (pbId === 'meta-business' && category === 'Business Verification') {
      return ['Document rejected', 'BM block restriction', 'Verification button greyed out'];
    }
    // Generic fallback symptoms
    return ['Integration fails to trigger', 'Sync lag or delay', 'Configuration error', 'Unknown error code'];
  };

  const handleSelectSymptom = (sym: string) => {
    setSelections(prev => ({ ...prev, symptom: sym }));
  };

  const resetTree = () => {
    setSelections({ playbookId: null, category: null, symptom: null });
  };

  const selectedPlaybook = playbooks.find(p => p.id === selections.playbookId);
  const recommendedSolution = resolveTroubleshooting(selections.playbookId, selections.category, selections.symptom);

  const options = !selections.playbookId ? playbooks.map(p=>({label:p.name,value:p.id})) : !selections.category ? getCategories(selections.playbookId).map(value=>({label:value,value})) : !selections.symptom ? getSymptoms(selections.playbookId,selections.category).map(value=>({label:value,value})) : [];
  const choose=(value:string)=>{if(!selections.playbookId)handleSelectPlaybook(value);else if(!selections.category)handleSelectCategory(value);else handleSelectSymptom(value);};
  const back=()=>{if(selections.symptom)setSelections({...selections,symptom:null});else if(selections.category)setSelections({...selections,category:null});else resetTree();};
  return <div className="page reading-page"><PageHeader title="Troubleshooting" description="Identify the problem, then open its Issue to find the solution."/>
    {selections.playbookId&&<div className="toolbar"><div className="inline-actions"><button className="back-link" onClick={back}><ArrowLeft size={14}/>Back</button><span className="helper-text">{selectedPlaybook?.name}{selections.category&&` / ${selections.category}`}</span></div><button className="back-link" onClick={resetTree}><RefreshCw size={14}/>Start Over</button></div>}
    {options.length>0?<section><p className="helper-text flow-position">Step {!selections.playbookId?'1':!selections.category?'2':'3'} of 3</p><h2>{!selections.playbookId?'What are you having trouble with?':!selections.category?'What is the problem related to?':'What are you seeing?'}</h2><div className="flow-options">{options.map(o=><button key={o.value} onClick={()=>choose(o.value)}>{o.label}<ArrowRight size={17}/></button>)}</div></section>:<>
    {recommendedSolution?<section className="flow-result"><p className="helper-text">Possible Issue</p><span className="row-code">{recommendedSolution.id}</span><h2>{recommendedSolution.title}</h2><p>{recommendedSolution.summary}</p>{recommendedSolution.estimatedTime&&<p className="helper-text">Estimated investigation: {recommendedSolution.estimatedTime}</p>}<a className="btn-primary" href={`#/playbooks/${selectedPlaybook?.slug}/issues/${recommendedSolution.id}`}>Open Issue<ArrowRight size={16}/></a></section>:<StateMessage title="No matching Issue found">Try searching the Playbook or document this problem for the team.</StateMessage>}
    <div className="toolbar"><p className="helper-text">Not the problem you are seeing?</p><div className="inline-actions"><a href="#/search">Search knowledge</a><a className="btn-secondary" href={`#/create/issue?playbook=${selectedPlaybook?.id}`}>Create New Issue</a></div></div></>}
  </div>;
};
