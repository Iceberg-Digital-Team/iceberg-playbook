import type { GuideVersion, Issue, Playbook, SOP, VersionedGuide } from './data';

// Sample content shown on a fresh install. Plain records in the current (v3) storage
// format, one array per entity and linked by id, so they can also be imported into a database.

export const samplePlaybooks: Playbook[] = [
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

export const sampleIssues: Issue[] = [
  {
    id: 'WA-001',
    playbookId: 'whatsapp',
    title: 'Phone Number Already Registered',
    summary: 'Occurs when a customer attempts to verify a WhatsApp phone number that is already associated with an existing WhatsApp account (either personal, business, or another BSP). This blocks embedded signup and requires manual API/deletion interventions.',
    symptoms: ['Phone Number Already Registered'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: [
      'Business Portfolio ID (Meta BM)',
      'Phone Number (unlocked, ready to receive SMS/voice)',
      'WhatsApp Business Account (WABA) Admin access',
      'Approved Display Name in Meta BM'
    ],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    author: 'Tarik Deniz',
    createdAt: '2026-08-24',
    updatedAt: '2026-08-24'
  },
  {
    id: 'WA-002',
    playbookId: 'whatsapp',
    title: 'OTP Not Received',
    summary: 'Support agents and customers failing to receive the 6-digit OTP code via SMS or voice when verifying a new WhatsApp Business profile.',
    symptoms: ['OTP Not Received'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: ['Phone number active', 'WABA onboarding access'],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    author: 'Support Team',
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25'
  },
  {
    id: 'WA-003',
    playbookId: 'whatsapp',
    title: 'Embedded Signup Failed',
    summary: 'The WhatsApp Embedded Signup pop-up fails to complete, closing abruptly or rendering a blank window after selecting a Facebook Business account.',
    symptoms: ['Embedded Signup Failed', 'Popup closes abruptly', 'Blank window displays'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: ['Admin permission on Facebook BM', 'Ad blocker disabled'],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Advanced',
    estimatedTime: '20 min',
    author: 'Support Team',
    createdAt: '2026-08-22',
    updatedAt: '2026-08-22'
  },
  {
    id: 'META-006',
    playbookId: 'meta-business',
    title: 'Business Verification Failed',
    summary: 'Occurs when Meta rejects the official documentation submitted for Business Portfolio verification. This prevents approval of WhatsApp numbers and system links.',
    symptoms: ['Business Verification Failed', 'Document rejected'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: ['Official trade license or utility bills', 'Matching Business Name and Address'],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    author: 'Support Team',
    createdAt: '2026-08-20',
    updatedAt: '2026-08-20'
  },
  {
    id: 'ZOOM-002',
    playbookId: 'zoom',
    title: 'Zoom Meeting Not Starting',
    summary: 'The automated CRM integration fails to launch a Zoom meeting when a client schedules an appointment.',
    symptoms: ['Zoom Meeting Not Starting'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: ['Zoom Account Connected', 'API Keys refreshed'],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    author: 'Support Team',
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25'
  },
  {
    id: 'WA-004',
    playbookId: 'whatsapp',
    title: 'WhatsApp BSP Migration Required',
    summary: 'The customer’s WhatsApp Business number is hosted with another BSP and needs to move to Iceberg Digital.',
    symptoms: [],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: [],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '',
    author: 'Tarik Deniz',
    createdAt: '2026-08-21',
    updatedAt: '2026-08-21'
  },
  {
    id: 'WA-005',
    playbookId: 'whatsapp',
    title: 'New WhatsApp Number Not Configured',
    summary: 'A new customer phone number has not yet been configured for the WhatsApp Business API.',
    symptoms: [],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: [],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '',
    author: 'Support Team',
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25'
  },
  {
    id: 'LIFE-003',
    playbookId: 'lifesycle',
    title: 'Property Matching Issue',
    summary: 'Property listings fail to match with leads in the Lifesycle integration.',
    symptoms: [],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: [],
    attachments: [],
    internalNotes: '',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '',
    author: 'Support Team',
    createdAt: '2026-08-15',
    updatedAt: '2026-08-15'
  }
];

export const sampleGuides: VersionedGuide[] = [
  {
    id: 'WA-G03',
    issueId: 'WA-001',
    playbookId: 'whatsapp',
    title: 'How to Resolve a Registered WhatsApp Number',
    summary: 'Follow the documented solution for Phone Number Already Registered.',
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
    ],
    currentVersionId: 'WA-G03:v1',
    versionNumber: 1,
    createdAt: '2026-08-24',
    createdBy: 'Tarik Deniz',
    updatedBy: 'Tarik Deniz'
  },
  {
    id: 'WA-G04',
    issueId: 'WA-002',
    playbookId: 'whatsapp',
    title: 'How to resolve: OTP Not Received',
    summary: 'Follow the documented solution for OTP Not Received.',
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
    revisionHistory: [],
    currentVersionId: 'WA-G04:v1',
    versionNumber: 1,
    createdAt: '2026-08-25',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
  },
  {
    id: 'WA-G05',
    issueId: 'WA-003',
    playbookId: 'whatsapp',
    title: 'How to resolve: Embedded Signup Failed',
    summary: 'Follow the documented solution for Embedded Signup Failed.',
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
    revisionHistory: [],
    currentVersionId: 'WA-G05:v1',
    versionNumber: 1,
    createdAt: '2026-08-22',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
  },
  {
    id: 'META-G01',
    issueId: 'META-006',
    playbookId: 'meta-business',
    title: 'How to resolve: Business Verification Failed',
    summary: 'Follow the documented solution for Business Verification Failed.',
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
    revisionHistory: [],
    currentVersionId: 'META-G01:v1',
    versionNumber: 1,
    createdAt: '2026-08-20',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
  },
  {
    id: 'ZOOM-G01',
    issueId: 'ZOOM-002',
    playbookId: 'zoom',
    title: 'How to resolve: Zoom Meeting Not Starting',
    summary: 'Follow the documented solution for Zoom Meeting Not Starting.',
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
    revisionHistory: [],
    currentVersionId: 'ZOOM-G01:v1',
    versionNumber: 1,
    createdAt: '2026-08-25',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
  },
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
    beforeYouStart: [
      'Check if source BSP has any contract locks.',
      'Disable any active auto-reply bots on the source number.'
    ],
    importantInformation: 'No message history will be migrated. Template messages must be recreated on the new WABA.',
    video: 'https://assets.icebergplaybook.test/videos/whatsapp-bsp-migration.mp4#whatsapp-bsp-migration.mp4',
    pdf: 'https://assets.icebergplaybook.test/docs/whatsapp-bsp-migration-guide.pdf#whatsapp-bsp-migration-guide.pdf',
    steps: [
      {
        number: 1,
        title: 'Obtain migration consent',
        description: 'Verify client has signed off and owns the number. Get source WABA ID.',
        estimatedTime: '5 min',
        screenshot: 'https://assets.icebergplaybook.test/screenshots/migration-consent.png#migration-consent.png',
        successIndicator: 'Migration consent documented.'
      },
      {
        number: 2,
        title: 'Initiate migration in WhatsApp Manager',
        description: 'Navigate to WhatsApp Manager -> Phone Numbers -> Migrate. Enter the phone number and source WABA ID.',
        estimatedTime: '10 min',
        screenshot: 'https://assets.icebergplaybook.test/screenshots/whatsapp-manager-migrate.png#whatsapp-manager-migrate.png',
        successIndicator: 'Migration status pending OTP verification.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: ['WA-001'],
    internalNotes: 'Ensure the customer understands templates do not migrate.',
    revisionHistory: [],
    issueId: 'WA-004',
    currentVersionId: 'WA-G01:v1',
    versionNumber: 1,
    createdAt: '2026-08-21',
    createdBy: 'Tarik Deniz',
    updatedBy: 'Tarik Deniz'
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
    revisionHistory: [],
    issueId: 'WA-005',
    currentVersionId: 'WA-G02:v1',
    versionNumber: 1,
    createdAt: '2026-08-25',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
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
    revisionHistory: [],
    issueId: 'LIFE-003',
    currentVersionId: 'LIFE-G01:v1',
    versionNumber: 1,
    createdAt: '2026-08-15',
    createdBy: 'Support Team',
    updatedBy: 'Support Team'
  }
];

export const sampleGuideVersions: GuideVersion[] = [
  {
    title: 'How to Resolve a Registered WhatsApp Number',
    summary: 'Follow the documented solution for Phone Number Already Registered.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
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
    video: '',
    pdf: '',
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
    id: 'WA-G03:v1',
    guideId: 'WA-G03',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-24',
    createdBy: 'Tarik Deniz'
  },
  {
    title: 'How to resolve: OTP Not Received',
    summary: 'Follow the documented solution for OTP Not Received.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    requirements: ['Phone number active', 'WABA onboarding access'],
    beforeYouStart: ['Verify phone signal strength', 'Ensure landline can receive direct dial calls if using landline'],
    importantInformation: 'Do not click "Resend SMS" repeatedly. Meta blocks OTP triggers for 24 hours after 3 failed consecutive attempts.',
    video: '',
    pdf: '',
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
    id: 'WA-G04:v1',
    guideId: 'WA-G04',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-25',
    createdBy: 'Support Team'
  },
  {
    title: 'How to resolve: Embedded Signup Failed',
    summary: 'Follow the documented solution for Embedded Signup Failed.',
    status: 'Verified',
    difficulty: 'Advanced',
    estimatedTime: '20 min',
    requirements: ['Admin permission on Facebook BM', 'Ad blocker disabled'],
    beforeYouStart: ['Disable all browser extensions and ad blockers.', 'Clear cookies and cache for facebook.com.'],
    importantInformation: 'This is usually caused by browser policy issues or Meta service downtime.',
    video: '',
    pdf: '',
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
    id: 'WA-G05:v1',
    guideId: 'WA-G05',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-22',
    createdBy: 'Support Team'
  },
  {
    title: 'How to resolve: Business Verification Failed',
    summary: 'Follow the documented solution for Business Verification Failed.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    requirements: ['Official trade license or utility bills', 'Matching Business Name and Address'],
    beforeYouStart: ['Verify that name on invoice matches the Meta Business Portfolio name exactly.'],
    importantInformation: 'Documents must be in supported languages or accompanied by official English translations.',
    video: '',
    pdf: '',
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
    id: 'META-G01:v1',
    guideId: 'META-G01',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-20',
    createdBy: 'Support Team'
  },
  {
    title: 'How to resolve: Zoom Meeting Not Starting',
    summary: 'Follow the documented solution for Zoom Meeting Not Starting.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '5 min',
    requirements: ['Zoom Account Connected', 'API Keys refreshed'],
    beforeYouStart: ['Check if integration is toggled on in Settings.'],
    importantInformation: 'The customer may need to re-authorize the OAuth connection.',
    video: '',
    pdf: '',
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
    id: 'ZOOM-G01:v1',
    guideId: 'ZOOM-G01',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-25',
    createdBy: 'Support Team'
  },
  {
    title: 'How to migrate WhatsApp Business from another BSP',
    summary: 'Detailed instructions explaining how to transfer a WhatsApp Business phone number from an external BSP (Business Solution Provider) like Twilio or Wati to Iceberg Digital\'s Meta Business account.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '20 min',
    requirements: ['Phone number active', 'Access to source BSP', 'WABA Admin Access on target WABA'],
    beforeYouStart: [
      'Check if source BSP has any contract locks.',
      'Disable any active auto-reply bots on the source number.'
    ],
    importantInformation: 'No message history will be migrated. Template messages must be recreated on the new WABA.',
    video: 'https://assets.icebergplaybook.test/videos/whatsapp-bsp-migration.mp4#whatsapp-bsp-migration.mp4',
    pdf: 'https://assets.icebergplaybook.test/docs/whatsapp-bsp-migration-guide.pdf#whatsapp-bsp-migration-guide.pdf',
    steps: [
      {
        number: 1,
        title: 'Obtain migration consent',
        description: 'Verify client has signed off and owns the number. Get source WABA ID.',
        estimatedTime: '5 min',
        screenshot: 'https://assets.icebergplaybook.test/screenshots/migration-consent.png#migration-consent.png',
        successIndicator: 'Migration consent documented.'
      },
      {
        number: 2,
        title: 'Initiate migration in WhatsApp Manager',
        description: 'Navigate to WhatsApp Manager -> Phone Numbers -> Migrate. Enter the phone number and source WABA ID.',
        estimatedTime: '10 min',
        screenshot: 'https://assets.icebergplaybook.test/screenshots/whatsapp-manager-migrate.png#whatsapp-manager-migrate.png',
        successIndicator: 'Migration status pending OTP verification.'
      }
    ],
    commonProblems: [],
    faq: [],
    relatedItems: ['WA-001'],
    internalNotes: 'Ensure the customer understands templates do not migrate.',
    id: 'WA-G01:v1',
    guideId: 'WA-G01',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-21',
    createdBy: 'Tarik Deniz'
  },
  {
    title: 'How to configure a new WhatsApp number',
    summary: 'Standard onboarding workflow for setting up a brand new, clean phone number for a customer\'s WhatsApp Business API.',
    status: 'Verified',
    difficulty: 'Easy',
    estimatedTime: '10 min',
    requirements: ['Brand new number', 'WABA Admin Access'],
    beforeYouStart: ['Ensure the number can receive external SMS.'],
    importantInformation: 'Do not use a number that is currently used on a mobile phone.',
    video: '',
    pdf: '',
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
    id: 'WA-G02:v1',
    guideId: 'WA-G02',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-25',
    createdBy: 'Support Team'
  },
  {
    title: 'Property matching issue configuration',
    summary: 'Guide for diagnosing why certain property listings fail to match with leads in the Lifesycle integration.',
    status: 'Verified',
    difficulty: 'Medium',
    estimatedTime: '15 min',
    requirements: ['Lifesycle Admin permissions', 'Lead criteria log'],
    beforeYouStart: ['Obtain the ID of the property and lead that failed to match.'],
    importantInformation: 'Check budget buffer sizes in Lifesycle settings.',
    video: '',
    pdf: '',
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
    id: 'LIFE-G01:v1',
    guideId: 'LIFE-G01',
    versionNumber: 1,
    changeSummary: 'Existing Guide captured as initial version.',
    createdAt: '2026-08-15',
    createdBy: 'Support Team'
  }
];

export const sampleSOPs: SOP[] = [
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
    requirements: [
      'Meta Business Manager Admin permissions',
      'Verified customer email address',
      'Credit card for Meta billing (if high volume)'
    ],
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
