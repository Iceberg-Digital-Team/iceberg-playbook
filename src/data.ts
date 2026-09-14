export interface Playbook {
  id: string;
  slug: string;
  name: string;
  code: string;
  description: string;
  icon: string;
  issueCount: number;
  guideCount: number;
  sopCount: number;
  updatedAt: string;
  owner?: string;
  visibility?: 'Internal' | 'Public';
}

export interface Step {
  number: number;
  title: string;
  description: string;
  estimatedTime?: string;
  screenshot?: string;
  importantNote?: string;
  successIndicator?: string;
  videoLink?: string;
  pdfReference?: string;
}

export interface CommonProblem {
  problem: string;
  cause: string;
  solution: string;
  relatedIssue?: string;
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface Revision {
  version: string;
  date: string;
  updatedBy: string;
  changes: string;
}

export interface Attachment { name: string; url: string; }
export interface Issue {
  id: string;
  playbookId: string;
  title: string;
  summary: string;
  symptoms: string[];
  errorMessage: string;
  context: string;
  affectedArea: string;
  informationToCollect: string[];
  attachments: Attachment[];
  internalNotes: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

interface LegacyIssue {
  id: string; // e.g. "WA-001"
  playbookId: string; // e.g. "whatsapp"
  title: string;
  summary: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime: string;
  author: string;
  updatedAt: string;
  requirements: string[];
  beforeYouStart: string[];
  importantInformation: string;
  steps: Step[];
  commonProblems: CommonProblem[];
  faq: FAQ[];
  relatedItems: string[]; // List of related issue/guide codes, e.g. ["WA-003", "META-006"]
  internalNotes: string;
  revisionHistory: Revision[];
}

export interface Guide {
  issueId: string;
  video?: string;
  pdf?: string;
  id: string; // e.g. "WA-G01" or similar
  playbookId: string;
  title: string;
  summary: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime: string;
  author: string;
  updatedAt: string;
  requirements: string[];
  beforeYouStart: string[];
  importantInformation: string;
  steps: Step[];
  commonProblems: CommonProblem[];
  faq: FAQ[];
  relatedItems: string[];
  internalNotes: string;
  revisionHistory: Revision[];
}

export type GuideContent = Pick<Guide, 'title' | 'summary' | 'status' | 'difficulty' | 'estimatedTime' | 'requirements' | 'beforeYouStart' | 'importantInformation' | 'video' | 'pdf' | 'steps' | 'commonProblems' | 'faq' | 'relatedItems' | 'internalNotes'>;
export interface GuideIdentity {
  currentVersionId: string;
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
}
// Guide remains the stable identity/current-content projection used by lists.
// Immutable snapshots are separate records and never appear in normal search.
export type VersionedGuide = Guide & GuideIdentity;
export interface GuideVersion extends GuideContent {
  id: string;
  guideId: string;
  versionNumber: number;
  changeSummary: string;
  createdAt: string;
  createdBy: string;
  restoredFromVersionId?: string;
}
export const formatGuideVersion = (number: number) => `1.${number - 1}`;
export const formatGuideDate = (date: string) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}) });
const contentFields = ['title', 'summary', 'status', 'difficulty', 'estimatedTime', 'requirements', 'beforeYouStart', 'importantInformation', 'video', 'pdf', 'steps', 'commonProblems', 'faq', 'relatedItems', 'internalNotes'] as const;
export function guideContent(guide: GuideContent): GuideContent {
  return JSON.parse(JSON.stringify(Object.fromEntries(contentFields.map(key => [key, guide[key] ?? (key === 'video' || key === 'pdf' ? '' : guide[key])]))));
}
function initialVersion(guide: Guide, imported = false): GuideVersion {
  return { ...guideContent(guide), id: `${guide.id}:v1`, guideId: guide.id, versionNumber: 1,
    changeSummary: imported ? 'Existing Guide captured as initial version.' : 'Initial Guide created.', createdAt: guide.updatedAt, createdBy: guide.author };
}
function initialIdentity(guide: Guide): VersionedGuide {
  return { ...guide, currentVersionId: `${guide.id}:v1`, versionNumber: 1, createdAt: guide.updatedAt, createdBy: guide.author, updatedBy: guide.author };
}

export interface SOP {
  id: string; // e.g. "WA-SOP01"
  playbookId: string;
  title: string;
  owner: string;
  status: 'Verified' | 'Draft';
  estimatedTime: string;
  updatedAt: string;
  purpose: string;
  whenToUse: string;
  requirements: string[];
  responsibleTeam: string;
  checklist: string[];
  steps: Step[];
  escalationRules: string;
  completionCriteria: string;
  relatedIssues: string[];
  relatedGuides: string[];
  internalNotes: string;
  revisionHistory: Revision[];
}

// Initial default seed data
const defaultPlaybooks: Playbook[] = [
  {
    id: 'whatsapp',
    slug: 'whatsapp',
    name: 'WhatsApp',
    code: 'WA',
    description: 'WhatsApp related issues, API onboarding, and BSP numbers migration processes.',
    icon: 'MessageSquare',
    issueCount: 12,
    guideCount: 4,
    sopCount: 2,
    updatedAt: '2 days ago'
  },
  {
    id: 'meta-business',
    slug: 'meta-business',
    name: 'Meta Business',
    code: 'META',
    description: 'Business Manager verification, system user setup, and WABA permissions management.',
    icon: 'Briefcase',
    issueCount: 8,
    guideCount: 3,
    sopCount: 1,
    updatedAt: '5 days ago'
  },
  {
    id: 'lifesycle',
    slug: 'lifesycle',
    name: 'Lifesycle',
    code: 'LIFE',
    description: 'Property match automation configurations, webhook integrations, and CRM syncing issues.',
    icon: 'Home',
    issueCount: 5,
    guideCount: 2,
    sopCount: 1,
    updatedAt: '1 week ago'
  },
  {
    id: 'zoom',
    slug: 'zoom',
    name: 'Zoom',
    code: 'ZOOM',
    description: 'Zoom meeting triggers, API integrations, OAuth setups, and webhook diagnostics.',
    icon: 'Video',
    issueCount: 3,
    guideCount: 1,
    sopCount: 1,
    updatedAt: '3 days ago'
  },
  {
    id: 'plaud',
    slug: 'plaud',
    name: 'Plaud',
    code: 'PLAUD',
    description: 'Plaud AI transcription integrations, audio device pairing guides, and CRM exports.',
    icon: 'Mic',
    issueCount: 2,
    guideCount: 1,
    sopCount: 0,
    updatedAt: '2 weeks ago'
  },
  {
    id: 'website',
    slug: 'website',
    name: 'Website',
    code: 'WEB',
    description: 'Iceberg Digital main website integrations, tracking scripts, and widget setups.',
    icon: 'Globe',
    issueCount: 4,
    guideCount: 2,
    sopCount: 1,
    updatedAt: 'Yesterday'
  }
];

const defaultIssues: LegacyIssue[] = [
  {
    id: 'WA-001',
    playbookId: 'whatsapp',
    title: 'Phone Number Already Registered',
    summary: 'Occurs when a customer attempts to verify a WhatsApp phone number that is already associated with an existing WhatsApp account (either personal, business, or another BSP). This blocks embedded signup and requires manual API/deletion interventions.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    author: 'Tarik Deniz',
    updatedAt: '2026-08-24',
    requirements: [
      'Business Portfolio ID (Meta BM)',
      'Phone Number (unlocked, ready to receive SMS/voice)',
      'WhatsApp Business Account (WABA) Admin access',
      'Approved Display Name in Meta BM'
    ],
    beforeYouStart: [
      'Ensure the client owns the phone number and has it physically available to receive the OTP code.',
      'Check if the number is currently registered to a consumer WhatsApp app or another business App.'
    ],
    importantInformation: 'Deleting the existing account is destructive. All message history on the consumer device will be lost once migrated to WABA. Meta does not allow backing up consumer messages and restoring them into WABA.',
    steps: [
      {
        number: 1,
        title: 'Check the existing WhatsApp Business Account',
        description: 'Navigate to Meta Business Manager -> WhatsApp Manager. Under the Phone Numbers tab, check if the phone number is displayed with a status. If it is already registered elsewhere, you will see a warning message that the number belongs to another account.',
        estimatedTime: '2 min',
        successIndicator: 'You can see the affected phone number status inside the WABA dashboard.'
      },
      {
        number: 2,
        title: 'Delete/Disconnect Old Client Account',
        description: 'If the client is running the number on a consumer WhatsApp App, open the App on the mobile phone -> Settings -> Account -> Delete My Account. If it is registered under another BSP, the client must trigger a migration or sign a consent form.',
        estimatedTime: '5 min',
        importantNote: 'Deleting the account can take up to 3 minutes to propagate through Meta\'s registers.',
        successIndicator: 'The WhatsApp client on the phone says "Welcome to WhatsApp" indicating it is unregistered.'
      },
      {
        number: 3,
        title: 'Trigger Embedded Signup verification',
        description: 'Go to the onboarding dashboard, start the Embedded Signup process again, select the appropriate BM and WABA, and enter the phone number.',
        estimatedTime: '5 min',
        successIndicator: 'The page proceeds to the OTP verification screen without the "number already registered" error.'
      },
      {
        number: 4,
        title: 'Enter Verification OTP',
        description: 'Choose SMS or Voice call for OTP verification. Enter the 6-digit code received on the device.',
        estimatedTime: '3 min',
        successIndicator: 'Number successfully verified. Status changes to "Connected" and certificate is generated.'
      }
    ],
    commonProblems: [
      {
        problem: 'OTP not received after deleting consumer account',
        cause: 'Meta is rate-limiting SMS requests due to multiple previous triggers.',
        solution: 'Wait 10 minutes and trigger a "Voice Call" instead of SMS.',
        relatedIssue: 'WA-002'
      },
      {
        problem: 'Number is locked in a deleted Business Manager',
        cause: 'The client deleted their old Meta Business Manager without removing the WhatsApp number first.',
        solution: 'Open a Meta Support Ticket requesting the release of the phone number from the orphaned WABA ID.',
        relatedIssue: 'META-006'
      }
    ],
    faq: [
      {
        question: 'Can we revert this back to a consumer account?',
        answer: 'Yes, but the number must first be deleted from the WABA account. Once deleted, it can be re-registered on a mobile phone.'
      },
      {
        question: 'How long does a BSP migration take?',
        answer: 'If the source BSP approves the release, the migration takes less than 10 minutes. If they do not, it requires manual paperwork taking 2-3 days.'
      }
    ],
    relatedItems: ['WA-002', 'WA-003', 'META-006'],
    internalNotes: 'Ensure the customer understands that their consumer chats will be permanently deleted. Do NOT skip Step 2. Keep customer on line until OTP is verified.',
    revisionHistory: [
      {
        version: '1.0.0',
        date: '2026-08-20',
        updatedBy: 'Tarik Deniz',
        changes: 'Initial draft and verification steps added.'
      },
      {
        version: '1.0.1',
        date: '2026-08-24',
        updatedBy: 'Tarik Deniz',
        changes: 'Added screenshot notes and migration caveats.'
      }
    ]
  },
  {
    id: 'WA-002',
    playbookId: 'whatsapp',
    title: 'OTP Not Received',
    summary: 'Support agents and customers failing to receive the 6-digit OTP code via SMS or voice when verifying a new WhatsApp Business profile.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    author: 'Support Team',
    updatedAt: '2026-08-25',
    requirements: ['Phone number active', 'WABA onboarding access'],
    beforeYouStart: ['Verify phone signal strength', 'Ensure landline can receive direct dial calls if using landline'],
    importantInformation: 'Do not click "Resend SMS" repeatedly. Meta blocks OTP triggers for 24 hours after 3 failed consecutive attempts.',
    steps: [
      {
        number: 1,
        title: 'Check phone status',
        description: 'Verify if the phone can receive standard incoming SMS or calls. If it is a virtual number, ensure SMS forwarders are working.',
        estimatedTime: '1 min',
        successIndicator: 'Incoming SMS successfully received from another test phone number.'
      },
      {
        number: 2,
        title: 'Choose Voice OTP alternative',
        description: 'In the OTP modal, click on "Call me" or "Voice Call" instead of SMS.',
        estimatedTime: '2 min',
        successIndicator: 'Incoming phone call from Meta playing the audio verification code.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: ['WA-001'],
    internalNotes: 'Usually caused by roaming issues or local carrier blocks on international SMS.',
    revisionHistory: []
  },
  {
    id: 'WA-003',
    playbookId: 'whatsapp',
    title: 'Embedded Signup Failed',
    summary: 'The WhatsApp Embedded Signup pop-up fails to complete, closing abruptly or rendering a blank window after selecting a Facebook Business account.',
    status: 'Verified',
    difficulty: 'Advanced',
    estimatedTime: '20 min',
    author: 'Support Team',
    updatedAt: '2026-08-22',
    requirements: ['Admin permission on Facebook BM', 'Ad blocker disabled'],
    beforeYouStart: ['Disable all browser extensions and ad blockers.', 'Clear cookies and cache for facebook.com.'],
    importantInformation: 'This is usually caused by browser policy issues or Meta service downtime.',
    steps: [
      {
        number: 1,
        title: 'Open in Incognito Mode',
        description: 'Copy the signup URL and paste it in an Incognito / Private window.',
        estimatedTime: '2 min',
        successIndicator: 'Embedded popup displays the Meta login prompt correctly.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: [],
    internalNotes: 'Known bug in Safari. Recommend Chrome or Firefox.',
    revisionHistory: []
  },
  {
    id: 'META-006',
    playbookId: 'meta-business',
    title: 'Business Verification Failed',
    summary: 'Occurs when Meta rejects the official documentation submitted for Business Portfolio verification. This prevents approval of WhatsApp numbers and system links.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    author: 'Support Team',
    updatedAt: '2026-08-20',
    requirements: ['Official trade license or utility bills', 'Matching Business Name and Address'],
    beforeYouStart: ['Verify that name on invoice matches the Meta Business Portfolio name exactly.'],
    importantInformation: 'Documents must be in supported languages or accompanied by official English translations.',
    steps: [
      {
        number: 1,
        title: 'Check rejection details',
        description: 'Go to Meta Business Suite -> Settings -> Business Info -> Business Portfolio Info. Check the exact reason for rejection.',
        estimatedTime: '2 min',
        successIndicator: 'Understand if rejection was due to address mismatch, name mismatch, or invalid ID.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: [],
    internalNotes: 'Ensure the utility bill is less than 3 months old.',
    revisionHistory: []
  },
  {
    id: 'ZOOM-002',
    playbookId: 'zoom',
    title: 'Zoom Meeting Not Starting',
    summary: 'The automated CRM integration fails to launch a Zoom meeting when a client schedules an appointment.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    author: 'Support Team',
    updatedAt: '2026-08-25',
    requirements: ['Zoom Account Connected', 'API Keys refreshed'],
    beforeYouStart: ['Check if integration is toggled on in Settings.'],
    importantInformation: 'The customer may need to re-authorize the OAuth connection.',
    steps: [
      {
        number: 1,
        title: 'Disconnect and Reconnect Zoom',
        description: 'Navigate to Integrations -> Zoom. Click "Disconnect", then click "Connect with Zoom" to authenticate again.',
        estimatedTime: '2 min',
        successIndicator: 'Zoom OAuth window redirects back to CRM successfully.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: [],
    internalNotes: 'Most common cause is an expired Zoom access token.',
    revisionHistory: []
  }
];

const defaultGuides: Omit<Guide, 'issueId'>[] = [
  {
    id: 'WA-G01',
    playbookId: 'whatsapp',
    title: 'How to migrate WhatsApp Business from another BSP',
    summary: 'Detailed instructions explaining how to transfer a WhatsApp Business phone number from an external BSP (Business Solution Provider) like Twilio or Wati to Iceberg Digital\'s Meta Business account.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '20 min',
    author: 'Tarik Deniz',
    updatedAt: '2026-08-21',
    requirements: ['Phone number active', 'Access to source BSP', 'WABA Admin Access on target WABA'],
    beforeYouStart: ['Check if source BSP has any contract locks.', 'Disable any active auto-reply bots on the source number.'],
    importantInformation: 'No message history will be migrated. Template messages must be recreated on the new WABA.',
    steps: [
      {
        number: 1,
        title: 'Obtain migration consent',
        description: 'Verify client has signed off and owns the number. Get source WABA ID.',
        estimatedTime: '5 min',
        successIndicator: 'Migration consent documented.'
      },
      {
        number: 2,
        title: 'Initiate migration in WhatsApp Manager',
        description: 'Navigate to WhatsApp Manager -> Phone Numbers -> Migrate. Enter the phone number and source WABA ID.',
        estimatedTime: '10 min',
        successIndicator: 'Migration status pending OTP verification.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: ['WA-001'],
    internalNotes: 'Ensure the customer understands templates do not migrate.',
    revisionHistory: []
  },
  {
    id: 'WA-G02',
    playbookId: 'whatsapp',
    title: 'How to configure a new WhatsApp number',
    summary: 'Standard onboarding workflow for setting up a brand new, clean phone number for a customer\'s WhatsApp Business API.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '10 min',
    author: 'Support Team',
    updatedAt: '2026-08-25',
    requirements: ['Brand new number', 'WABA Admin Access'],
    beforeYouStart: ['Ensure the number can receive external SMS.'],
    importantInformation: 'Do not use a number that is currently used on a mobile phone.',
    steps: [
      {
        number: 1,
        title: 'Add to WABA',
        description: 'Go to WABA -> Phone Numbers -> Add Phone Number. Fill out display name and category.',
        estimatedTime: '5 min',
        successIndicator: 'Number shows in WABA as pending verification.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: [],
    internalNotes: 'Ensure display name matches branding guidelines.',
    revisionHistory: []
  },
  {
    id: 'LIFE-G01',
    playbookId: 'lifesycle',
    title: 'Property matching issue configuration',
    summary: 'Guide for diagnosing why certain property listings fail to match with leads in the Lifesycle integration.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    author: 'Support Team',
    updatedAt: '2026-08-15',
    requirements: ['Lifesycle Admin permissions', 'Lead criteria log'],
    beforeYouStart: ['Obtain the ID of the property and lead that failed to match.'],
    importantInformation: 'Check budget buffer sizes in Lifesycle settings.',
    steps: [
      {
        number: 1,
        title: 'Check budget criteria',
        description: 'Compare lead budget max to property asking price. Ensure it falls within the tolerance limit.',
        estimatedTime: '5 min',
        successIndicator: 'Tolerance match verified.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: [],
    internalNotes: 'Most match failures are due to location radius boundary settings.',
    revisionHistory: []
  }
];

const defaultSOPs: SOP[] = [
  {
    id: 'WA-SOP01',
    playbookId: 'whatsapp',
    title: 'WhatsApp Customer Onboarding Process',
    owner: 'Onboarding Team',
    status: 'Verified',
    estimatedTime: '45 min',
    updatedAt: '2026-08-25',
    purpose: 'Standardize the customer onboarding flow when introducing them to the WhatsApp Business API.',
    whenToUse: 'Use this SOP every time a customer upgrades their subscription to include the WhatsApp Business channel.',
    requirements: ['Meta Business Manager Admin permissions', 'Verified customer email address', 'Credit card for Meta billing (if high volume)'],
    responsibleTeam: 'Support & Onboarding Team',
    checklist: [
      'Customer information received',
      'Business verification checked',
      'WABA setup completed',
      'Phone verification completed',
      'Embedded Signup triggered',
      'Testing & sign-off completed'
    ],
    steps: [
      {
        number: 1,
        title: 'Verify customer contract details',
        description: 'Ensure the client has signed the WhatsApp Addendum and provided their Facebook Business ID.',
        estimatedTime: '5 min',
        successIndicator: 'Facebook ID matched to Salesforce record.'
      },
      {
        number: 2,
        title: 'Trigger Meta Business Invitation',
        description: 'Send WABA ownership invitation from our partner dashboard to client BM.',
        estimatedTime: '10 min',
        successIndicator: 'Client BM displays invitation under requests.'
      },
      {
        number: 3,
        title: 'Assist customer with Embedded Signup',
        description: 'Guide customer through the Embedded Signup flow to link their phone number and select display name.',
        estimatedTime: '15 min',
        successIndicator: 'WABA created successfully.'
      },
      {
        number: 4,
        title: 'Send initial test WhatsApp message',
        description: 'Trigger a welcome template message from CRM to customer\'s personal number to confirm outbound is working.',
        estimatedTime: '5 min',
        successIndicator: 'Customer replies "Received".'
      }
    ],
    escalationRules: 'If business verification fails more than twice, escalate to the Compliance Officer. If OTP fails for 24 hours, escalate to the WhatsApp Lead Support.',
    completionCriteria: 'Onboarding is complete when the WhatsApp number status is "Connected", display name is approved, and the welcome message is successfully received and replied to.',
    relatedIssues: ['WA-001', 'WA-002', 'WA-003'],
    relatedGuides: ['WA-G02'],
    internalNotes: 'Ensure Meta billing credentials are set up if they plan to send over 1,000 marketing messages per month.',
    revisionHistory: []
  }
];

// Load from local storage or set default
const loadData = <T>(key: string, defaults: T[]): T[] => {
  try {
    const data = localStorage.getItem(`ib_playbook_${key}`);
    return data ? JSON.parse(data) : defaults;
  } catch {
    return defaults;
  }
};

const saveData = <T>(key: string, data: T[]) => {
  try {
    localStorage.setItem(`ib_playbook_${key}`, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
};

// One atomic, versioned envelope keeps Issue/Guide relationships consistent.
// Legacy storage keys are retained as the original backup; SOP storage is unchanged.
interface LegacyKnowledge { version: 2; issues: Issue[]; guides: Guide[]; }
interface Knowledge { version: 3; issues: Issue[]; guides: VersionedGuide[]; guideVersions: GuideVersion[]; }
const knowledgeKey = 'ib_playbook_knowledge_v3';
export const getPlaybooks = (): Playbook[] => {
  const knowledge = readKnowledge();
  const sops = getSOPs();
  return loadData('playbooks', defaultPlaybooks).map(p => ({ ...p,
    issueCount: knowledge.issues.filter(i => i.playbookId === p.id).length,
    guideCount: knowledge.guides.filter(g => g.playbookId === p.id).length,
    sopCount: sops.filter(s => s.playbookId === p.id).length,
  }));
};
export const getSOPs = (): SOP[] => loadData('sops', defaultSOPs);
export const savePlaybooks = (data: Playbook[]) => saveData('playbooks', data);
export const saveSOPs = (data: SOP[]) => saveData('sops', data);

function nextCode(ids: string[], prefix: string, digits: number) {
  const numbers = ids.filter(id => id.startsWith(prefix)).map(id => Number(id.slice(prefix.length))).filter(Number.isFinite);
  return prefix + String(Math.max(0, ...numbers) + 1).padStart(digits, '0');
}

export function migrateKnowledge(oldIssues: LegacyIssue[], oldGuides: Omit<Guide, 'issueId'>[], playbooks: Playbook[]): LegacyKnowledge {
  const issues: Issue[] = oldIssues.map(i => ({
    id: i.id, playbookId: i.playbookId, title: i.title, summary: i.summary,
    symptoms: [i.title], errorMessage: '', context: '', affectedArea: '',
    informationToCollect: i.requirements || [], attachments: [],
    internalNotes: '', status: i.status, difficulty: i.difficulty,
    estimatedTime: i.estimatedTime, author: i.author,
    createdAt: i.updatedAt, updatedAt: i.updatedAt,
  }));
  const guides: Guide[] = [];
  const reservedIds = oldGuides.map(g => g.id);
  for (const old of oldIssues) {
    if (!old.steps?.length && !old.importantInformation && !old.beforeYouStart?.length && !old.commonProblems?.length && !old.faq?.length) {
      issues.find(i => i.id === old.id)!.internalNotes = old.internalNotes || '';
      continue;
    }
    const prefix = (playbooks.find(p => p.id === old.playbookId)?.code || 'GD') + '-G';
    const id = nextCode([...reservedIds, ...guides.map(g => g.id)], prefix, 2);
    guides.push({
      id, issueId: old.id, playbookId: old.playbookId,
      title: old.id === 'WA-001' ? 'How to Resolve a Registered WhatsApp Number' : `How to resolve: ${old.title}`,
      summary: `Follow the documented solution for ${old.title}.`, status: old.status,
      difficulty: old.difficulty, estimatedTime: old.estimatedTime, author: old.author, updatedAt: old.updatedAt,
      requirements: old.requirements || [], beforeYouStart: old.beforeYouStart || [], importantInformation: old.importantInformation || '',
      steps: old.steps || [], commonProblems: old.commonProblems || [], faq: old.faq || [],
      relatedItems: old.relatedItems || [], internalNotes: old.internalNotes || '', revisionHistory: old.revisionHistory || [],
    });
  }
  const seedProblems: Record<string, { id: string; title: string; summary: string }> = {
    'WA-G01': { id: 'WA-004', title: 'WhatsApp BSP Migration Required', summary: 'The customer’s WhatsApp Business number is hosted with another BSP and needs to move to Iceberg Digital.' },
    'WA-G02': { id: 'WA-005', title: 'New WhatsApp Number Not Configured', summary: 'A new customer phone number has not yet been configured for the WhatsApp Business API.' },
    'LIFE-G01': { id: 'LIFE-003', title: 'Property Matching Issue', summary: 'Property listings fail to match with leads in the Lifesycle integration.' },
  };
  for (const old of oldGuides) {
    // Retain old Guide IDs so bookmarks and SOP references continue to work.
    let issue = issues.find(i => old.relatedItems?.includes(i.id) && i.playbookId === old.playbookId && !guides.some(g => g.issueId === i.id));
    if (!issue) {
      const seed = seedProblems[old.id];
      const prefix = (playbooks.find(p => p.id === old.playbookId)?.code || 'ISS') + '-';
      const id = seed && !issues.some(i => i.id === seed.id) ? seed.id : nextCode(issues.map(i => i.id), prefix, 3);
      issue = {
        id, playbookId: old.playbookId, title: seed?.title || `Problem documented by: ${old.title}`,
        summary: seed?.summary || old.summary, symptoms: [], errorMessage: '', context: '', affectedArea: '',
        informationToCollect: [], attachments: [], internalNotes: seed ? '' : 'Imported from an existing Guide. Review and complete the problem description.',
        status: seed ? old.status : 'Draft', difficulty: old.difficulty, estimatedTime: '',
        author: old.author, createdAt: old.updatedAt, updatedAt: old.updatedAt,
      };
      issues.push(issue);
    }
    guides.push({ ...old, issueId: issue.id, playbookId: issue.playbookId });
  }
  return { version: 2, issues, guides };
}

function validateKnowledge(data: Knowledge) {
  const ids = new Set<string>();
  for (const issue of data.issues) {
    if (!issue.id || ids.has(issue.id)) throw new Error('Issue codes must be unique.');
    ids.add(issue.id);
  }
  const assigned = new Set<string>();
  const guideIds = new Set<string>();
  for (const guide of data.guides) {
    const issue = data.issues.find(i => i.id === guide.issueId);
    if (!issue) throw new Error('Select an existing Related Issue.');
    if (guide.playbookId !== issue.playbookId) throw new Error('The Guide must use its Issue’s Playbook.');
    if (assigned.has(issue.id)) throw new Error('This Issue already has a primary Guide. Open the existing Guide.');
    if (guideIds.has(guide.id)) throw new Error('Guide codes must be unique.');
    const versions = data.guideVersions.filter(v => v.guideId === guide.id);
    const active = versions.find(v => v.id === guide.currentVersionId);
    if (!active || active.versionNumber !== guide.versionNumber || JSON.stringify(guideContent(active)) !== JSON.stringify(guideContent(guide))) throw new Error('Guide version history is inconsistent.');
    if (new Set(versions.map(v => v.id)).size !== versions.length || new Set(versions.map(v => v.versionNumber)).size !== versions.length) throw new Error('Duplicate Guide version.');
    assigned.add(issue.id); guideIds.add(guide.id);
  }
}
function writeKnowledge(data: Knowledge) {
  validateKnowledge(data);
  try { localStorage.setItem(knowledgeKey, JSON.stringify(data)); }
  catch { throw new Error('Could not save. Browser storage may be full or unavailable. Your form has been kept open.'); }
}
function readKnowledge(): Knowledge {
  const stored = localStorage.getItem(knowledgeKey);
  if (stored) {
    const data = JSON.parse(stored) as Knowledge;
    validateKnowledge(data);
    return data;
  }
  const previous = localStorage.getItem('ib_playbook_knowledge_v2');
  const legacy: LegacyKnowledge = previous ? JSON.parse(previous) : migrateKnowledge(loadData('issues', defaultIssues), loadData('guides', defaultGuides), loadData('playbooks', defaultPlaybooks));
  const migrated: Knowledge = { version: 3, issues: legacy.issues, guides: legacy.guides.map(initialIdentity), guideVersions: legacy.guides.map(g => initialVersion(g, true)) };
  writeKnowledge(migrated);
  return migrated;
}
export const getIssues = (): Issue[] => readKnowledge().issues;
export const getGuides = (): VersionedGuide[] => readKnowledge().guides;
export const getPrimaryGuide = (issueId: string): VersionedGuide | undefined => getGuides().find(g => g.issueId === issueId);
export const getSolutionState = (issueId: string) => getPrimaryGuide(issueId) ? 'Solution Available' : 'Guide Needed';
export const saveIssues = (issues: Issue[]) => writeKnowledge({ ...readKnowledge(), issues });
export const saveGuides = (guides: Guide[]) => {
  const data = readKnowledge();
  // Bulk replacement must not bypass version creation or erase history.
  for (const guide of guides) {
    if (!data.issues.some(i => i.id === guide.issueId)) throw new Error('Select an existing Related Issue.');
  }
  if (JSON.stringify(guides) !== JSON.stringify(data.guides)) throw new Error('Use Publish Update to change a Guide while retaining version history.');
};
export const getGuideVersions = (guideId: string) => readKnowledge().guideVersions.filter(v => v.guideId === guideId).sort((a, b) => b.versionNumber - a.versionNumber);
export const getGuideVersion = (guideId: string, versionId: string) => getGuideVersions(guideId).find(v => v.id === versionId);

// These mutation boundaries can receive authenticated actors/permissions later.
export const getGuideEditorName = () => 'Tarik Deniz';
function appendGuideVersion(guideId: string, content: GuideContent, expectedVersionId: string, summary: string, restoredFromVersionId?: string): VersionedGuide {
  const data = readKnowledge();
  const current = data.guides.find(g => g.id === guideId);
  if (!current) throw new Error('Guide not found.');
  if (current.currentVersionId !== expectedVersionId) throw new Error('This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.');
  const snapshot = guideContent(content);
  if (!snapshot.title.trim() || !snapshot.summary.trim() || !snapshot.steps.length || snapshot.steps.some(s => !s.title.trim() || !s.description.trim())) throw new Error('Add a Guide title, summary, and complete solution steps.');
  if (!restoredFromVersionId && JSON.stringify(snapshot) === JSON.stringify(guideContent(current))) throw new Error('No content changes to publish.');
  const number = current.versionNumber + 1;
  const createdAt = new Date().toISOString();
  const createdBy = getGuideEditorName();
  const version: GuideVersion = { ...snapshot, id: `${guideId}:v${number}`, guideId, versionNumber: number, createdAt, createdBy, changeSummary: summary.trim() || 'Guide updated', ...(restoredFromVersionId ? { restoredFromVersionId } : {}) };
  const next: VersionedGuide = { ...current, ...snapshot, currentVersionId: version.id, versionNumber: number, updatedAt: createdAt, updatedBy: createdBy };
  writeKnowledge({ ...data, guides: data.guides.map(g => g.id === guideId ? next : g), guideVersions: [...data.guideVersions, version] });
  return JSON.parse(JSON.stringify(next));
}
export const publishGuideUpdate = (guideId: string, content: GuideContent, expectedVersionId: string, summary = '') => appendGuideVersion(guideId, content, expectedVersionId, summary);
export const restoreGuideVersion = (guideId: string, versionId: string, expectedVersionId: string) => {
  const old = getGuideVersion(guideId, versionId);
  if (!old) throw new Error('Historical version not found.');
  if (versionId === expectedVersionId) throw new Error('This version is already current.');
  return appendGuideVersion(guideId, old, expectedVersionId, `Restored from version ${formatGuideVersion(old.versionNumber)}`, versionId);
};

// Helpers to add data
export const addPlaybook = (p: Omit<Playbook, 'issueCount' | 'guideCount' | 'sopCount' | 'updatedAt'>) => {
  const list = getPlaybooks();
  const newPlaybook: Playbook = {
    ...p,
    issueCount: 0,
    guideCount: 0,
    sopCount: 0,
    updatedAt: 'Just now'
  };
  list.push(newPlaybook);
  savePlaybooks(list);
  return newPlaybook;
};

export const addIssue = (issue: Omit<Issue, 'id' | 'createdAt' | 'updatedAt' | 'author'>) => {
  const data = readKnowledge();
  const playbook = getPlaybooks().find(p => p.id === issue.playbookId);
  if (!playbook || !issue.title.trim() || !issue.summary.trim()) throw new Error('Playbook, Issue title and problem summary are required.');
  const now = new Date().toISOString();
  const newIssue: Issue = { ...issue, id: nextCode(data.issues.map(i => i.id), `${playbook.code}-`, 3), createdAt: now, updatedAt: now, author: 'Tarik Deniz' };
  writeKnowledge({ ...data, issues: [...data.issues, newIssue] });
  return newIssue;
};

export const addGuide = (guide: Omit<Guide, 'id' | 'updatedAt' | 'author'>) => {
  const data = readKnowledge();
  const issue = data.issues.find(i => i.id === guide.issueId);
  if (!issue) throw new Error('Select an existing Related Issue.');
  if (guide.playbookId !== issue.playbookId) throw new Error('The Guide must use its Issue’s Playbook.');
  if (data.guides.some(g => g.issueId === issue.id)) throw new Error('This Issue already has a primary Guide. Open the existing Guide.');
  if (!guide.title.trim() || !guide.summary.trim() || !guide.steps.length || guide.steps.some(s => !s.title.trim() || !s.description.trim())) throw new Error('Add a Guide title, summary, and complete solution steps.');
  const playbook = getPlaybooks().find(p => p.id === issue.playbookId);
  if (!playbook) throw new Error('The selected Issue’s Playbook is unavailable.');
  const newGuide: Guide = { ...guide, playbookId: issue.playbookId, id: nextCode(data.guides.map(g => g.id), `${playbook.code}-G`, 2), updatedAt: new Date().toISOString(), author: 'Tarik Deniz' };
  const versioned = initialIdentity(newGuide);
  writeKnowledge({ ...data, guides: [...data.guides, versioned], guideVersions: [...data.guideVersions, initialVersion(newGuide)] });
  return versioned;
};

export const addSOP = (sop: Omit<SOP, 'id' | 'updatedAt' | 'owner'>) => {
  const list = getSOPs();
  const playbooks = getPlaybooks();

  const playbook = playbooks.find(p => p.id === sop.playbookId);
  const prefix = playbook ? playbook.code : 'SOP';
  
  const samePlaybookSOPs = list.filter(s => s.playbookId === sop.playbookId);
  const nextNum = samePlaybookSOPs.length + 1;
  const formattedCode = `${prefix}-SOP${String(nextNum).padStart(2, '0')}`;

  const newSOP: SOP = {
    ...sop,
    id: formattedCode,
    updatedAt: new Date().toISOString().split('T')[0],
    owner: 'Support Team'
  };

  list.push(newSOP);
  saveSOPs(list);

  // Update count in playbook
  if (playbook) {
    playbook.sopCount += 1;
    playbook.updatedAt = 'Just now';
    savePlaybooks(playbooks);
  }

  return newSOP;
};
