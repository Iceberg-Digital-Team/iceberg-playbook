import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { importTs } from './helpers/transpile.mjs';

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

async function loadTs(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const samples = await importTs('src/sampleData.ts', 'search-samples');
const core = await loadTs('../src/search/searchCore.ts');
const { getRowJiraCode, resolveSearchType } = core;
const { parseHash } = await importTs('src/router.ts', 'router-search-quick');

const playbooks = [{ id: 'pb-a', name: 'Alphaplatform' }, { id: 'pb-b', name: 'Betaplatform' }];
const issue = o => ({ playbookId: 'pb-a', title: '', summary: '', symptoms: [], errorMessage: '', ...o });
const guide = o => ({ playbookId: 'pb-a', issueId: '', title: '', summary: '', steps: [], commonProblems: [], ...o });
const sop = o => ({ playbookId: 'pb-a', title: '', purpose: '', owner: 'Ops', ...o });
const ids = (query, set, options = {}) =>
    core.searchKnowledge(query, { issues: [], guides: [], sops: [], playbooks, ...set }, options).map(x => x.id);
const realData = () => ({
    issues: samples.sampleIssues,
    guides: samples.sampleGuides,
    sops: samples.sampleSOPs,
    playbooks: samples.samplePlaybooks
});

const issueInput = { playbookId: 'whatsapp', title: 'QA problem', summary: 'Customer cannot complete signup.', status: 'Draft', difficulty: 'Medium', estimatedTime: '10 min', symptoms: ['Blank screen'], errorMessage: 'E-QA', context: 'During signup', affectedArea: 'Signup', informationToCollect: ['WABA ID'], attachments: [], internalNotes: 'Investigate' };

test('exact Issue code ranks first above title and summary mentions, in any case and with surrounding spaces', () => {
    const set = {
        issues: [
            issue({ id: 'ISS-002', title: 'Follow-up to ISS-001' }),
            issue({ id: 'ISS-003', summary: 'see iss-001 for details' }),
            issue({ id: 'ISS-001', title: 'Webhook failure' }),
        ]
    };
    for (const q of ['ISS-001', 'iss-001', '  ISS-001  ']) {
        assert.deepEqual(ids(q, set), ['ISS-001', 'ISS-002', 'ISS-003']);
    }
});

test('exact Guide and SOP codes rank first above records that mention them', () => {
    const set = {
        issues: [issue({ id: 'I-1', title: 'Regression of G-001' })],
        guides: [guide({ id: 'G-002', summary: 'replaces g-001' }), guide({ id: 'G-001', title: 'Restart' })],
        sops: [sop({ id: 'SOP-002', title: 'Supersedes SOP-001' }), sop({ id: 'SOP-001', title: 'Audit' })],
    };
    assert.deepEqual(ids('G-001', set), ['G-001', 'I-1', 'G-002']);
    assert.deepEqual(ids('g-001', set), ['G-001', 'I-1', 'G-002']);
    assert.deepEqual(ids('SOP-001', set), ['SOP-001', 'SOP-002']);
    assert.deepEqual(ids('sop-001?', set), ['SOP-001', 'SOP-002']);

    assert.equal(core.searchKnowledge('WA-G02', realData(), {})[0].id, 'WA-G02');
    const sopId = samples.sampleSOPs[0].id;
    assert.equal(core.searchKnowledge(sopId, realData(), {})[0].id, sopId);
});

test('hyphenated code is one token and does not match its parts scattered in text', () => {
    assert.deepEqual(core.tokenize('WA-001'), ['wa-001']);
    const set = { issues: [issue({ id: 'ISS-010', title: 'iss tracker 001' }), issue({ id: 'ISS-001', title: 'Target' })] };
    assert.deepEqual(ids('ISS-001', set), ['ISS-001']);
});

test('uppercase query matches lowercase text', () => {
    const set = { issues: [issue({ id: 'T-1', title: 'invoice import broken' })] };
    assert.deepEqual(ids('INVOICE IMPORT', set), ['T-1']);
    assert.deepEqual(ids('Invoice', set), ['T-1']);
});

test('regex-special characters never throw and edge punctuation is ignored', () => {
    const set = { issues: [issue({ id: 'T-1', title: 'webhook retry' })] };
    for (const q of ['(', '*', '[', '\\', 'a(b', 'web[hook', '.*+?', '$^', '[*]']) {
        assert.doesNotThrow(() => ids(q, set), `query ${q}`);
        assert.ok(Array.isArray(ids(q, set)));
    }
    assert.deepEqual(ids('(webhook)', set), ids('webhook', set));
    assert.deepEqual(ids('(webhook)', set), ['T-1']);
});

test('empty, whitespace-only and punctuation-only queries list every valid record in input order', () => {
    const set = {
        issues: [issue({ id: 'I-1' }), issue({ id: 'I-ORPHAN', playbookId: 'ghost' })],
        guides: [guide({ id: 'G-1', playbookId: 'pb-b' })],
        sops: [sop({ id: 'S-1' })],
    };
    for (const q of ['', '   ', '\t \n', '()*[]', '\\']) {
        assert.deepEqual(ids(q, set), ['I-1', 'G-1', 'S-1'], `query ${JSON.stringify(q)}`);
    }
});

test('equal scores keep input order (stable sort)', () => {
    const x = issue({ id: 'X', title: 'omega one' });
    const y = issue({ id: 'Y', title: 'omega two' });
    assert.deepEqual(ids('omega', { issues: [x, y] }), ['X', 'Y']);
    assert.deepEqual(ids('omega', { issues: [y, x] }), ['Y', 'X']);
});

test('multi-word query ignores word order and requires every word (AND)', () => {
    const set = {
        issues: [
            issue({ id: 'BOTH', title: 'Webhook timeout', summary: 'property sync stalls' }),
            issue({ id: 'ONLY-WEBHOOK', title: 'Webhook signature' }),
            issue({ id: 'ONLY-PROPERTY', title: 'Property mapping' }),
        ]
    };
    assert.deepEqual(ids('webhook property', set), ['BOTH']);
    assert.deepEqual(ids('property webhook', set), ['BOTH']);
    assert.deepEqual(ids('webhook nonexistentword', set), []);
});

test('field weights: title > symptoms > summary > guide content, regardless of input order', () => {
    const set = {
        issues: [
            issue({ id: 'SUMMARY', summary: 'zeta in summary' }),
            issue({ id: 'SYMPTOM', symptoms: ['zeta symptom'] }),
            issue({ id: 'TITLE', title: 'zeta title' }),
        ],
        guides: [guide({ id: 'STEP', steps: [{ number: 1, title: 'Check', description: 'zeta in step' }] })],
    };
    assert.deepEqual(ids('zeta', set), ['TITLE', 'SYMPTOM', 'SUMMARY', 'STEP']);
});

test('errorMessage match ranks above summary match', () => {
    const set = { issues: [issue({ id: 'SUMMARY', summary: 'zeta mentioned' }), issue({ id: 'ERROR', errorMessage: 'ZETA_FAIL' })] };
    assert.deepEqual(ids('zeta', set), ['ERROR', 'SUMMARY']);
});

test('real data: Issue is found by a term that exists only in its symptoms or errorMessage', () => {
    const created = { ...issueInput, id: 'WA-TEST-01', symptoms: ['Quxlantic spinner freeze'], errorMessage: 'ERR_ZORBLAX_42' };
    const dataset = { ...realData(), issues: [...realData().issues, created] };
    const found = q => core.searchKnowledge(q, dataset, {}).map(x => x.id);
    assert.deepEqual(found('quxlantic'), [created.id]);
    assert.deepEqual(found('ERR_ZORBLAX_42'), [created.id]);
    assert.deepEqual(found('err_zorblax_42'), [created.id]);
});

test('real data (R-02): Issue code returns the Issue first and its Guide too', () => {
    const guideId = samples.sampleGuides.find(g => g.issueId === 'WA-001').id;
    for (const q of ['WA-001', 'wa-001']) {
        const found = core.searchKnowledge(q, realData(), {}).map(x => x.id);
        assert.equal(found[0], 'WA-001');
        assert.ok(found.includes(guideId), `Guide ${guideId} missing for ${q}`);
    }
    const linkedTitle = samples.sampleIssues.find(i => i.id === 'WA-001').title;
    assert.ok(core.searchKnowledge(linkedTitle, realData(), {}).some(x => x.id === guideId));
});

test('Guide is found by its linked Issue title and code even when its own text does not mention them', () => {
    const set = {
        issues: [issue({ id: 'ISS-9', title: 'Frobnicator stall' })],
        guides: [guide({ id: 'G-9', issueId: 'ISS-9', title: 'Restart service' })],
    };
    assert.deepEqual(ids('frobnicator', set), ['ISS-9', 'G-9']);
    assert.ok(ids('iss-9', set).includes('G-9'));
});

test('Guide steps and commonProblems fields, and SOP purpose, are searchable', () => {
    const set = {
        guides: [guide({
            id: 'G-1',
            steps: [{ number: 1, title: 'plonk', description: 'wibble' }],
            commonProblems: [{ problem: 'glorp', cause: 'snarf', solution: 'blat' }],
        })],
        sops: [sop({ id: 'S-1', title: 'Audit', purpose: 'quarterly vorpal review' })],
    };
    for (const q of ['plonk', 'wibble', 'glorp', 'snarf', 'blat']) assert.deepEqual(ids(q, set), ['G-1'], q);
    assert.deepEqual(ids('vorpal', set), ['S-1']);
});

test('Playbook name returns only that Playbook; Type and Playbook filters restrict results', () => {
    const set = {
        issues: [issue({ id: 'IA' }), issue({ id: 'IB', playbookId: 'pb-b' })],
        guides: [guide({ id: 'GA' }), guide({ id: 'GB', playbookId: 'pb-b' })],
        sops: [sop({ id: 'SA' }), sop({ id: 'SB', playbookId: 'pb-b' })],
    };
    assert.deepEqual(ids('betaplatform', set), ['IB', 'GB', 'SB']);
    assert.deepEqual(ids('', set, { type: 'Guides' }), ['GA', 'GB']);
    assert.deepEqual(ids('', set, { type: 'SOPs' }), ['SA', 'SB']);
    assert.deepEqual(ids('', set, { type: 'Issues' }), ['IA', 'IB']);
    assert.deepEqual(ids('', set, { playbookId: 'pb-b' }), ['IB', 'GB', 'SB']);
    assert.deepEqual(ids('alphaplatform', set, { type: 'Guides', playbookId: 'pb-a' }), ['GA']);
    assert.deepEqual(ids('alphaplatform', set, { playbookId: 'pb-b' }), []);
});

test('no match returns empty; orphan records never appear even when their text matches', () => {
    const set = {
        issues: [issue({ id: 'OK', title: 'normal' }), issue({ id: 'ORPHAN', playbookId: 'ghost', title: 'phantomword' })],
        guides: [guide({ id: 'G-ORPHAN', playbookId: 'ghost', title: 'phantomword' })],
    };
    assert.deepEqual(ids('nothingmatchesthis', set), []);
    assert.deepEqual(ids('phantomword', set), []);
    assert.ok(!ids('', set).includes('ORPHAN'));
    assert.ok(!ids('', set).includes('G-ORPHAN'));
});

test('real data (R-07): Guide results are unique and come only from current getGuides() records', () => {
    const d = realData();
    const results = core.searchKnowledge('', d, { type: 'Guides' });
    const resultIds = results.map(x => x.id);
    assert.equal(new Set(resultIds).size, resultIds.length);
    const validPb = new Set(d.playbooks.map(p => p.id));
    const expected = d.guides.filter(g => validPb.has(g.playbookId)).map(g => g.id);
    assert.deepEqual(resultIds, expected);
});

test('Troubleshooting route is removed from router and falls back to root', async () => {
    const { parseHash } = await importTs('src/router.ts', 'router-test');
    const route = parseHash('#/troubleshooting');
    assert.equal(route.path, '/', 'navigating to #/troubleshooting should fall back to root');
    assert.deepEqual(route.params, {});
});

test('no resolveTroubleshooting or matchTroubleshootingIssue runtime exports exist', async () => {
    assert.equal(typeof core.matchTroubleshootingIssue, 'undefined', 'matchTroubleshootingIssue must be removed from searchCore');
    assert.equal(typeof core.TROUBLESHOOTING_STOPWORDS, 'undefined', 'TROUBLESHOOTING_STOPWORDS must be removed from searchCore');

    const searchService = await importTs('src/search/searchService.ts', 'search-service-legacy');
    assert.equal(typeof searchService.resolveTroubleshooting, 'undefined', 'resolveTroubleshooting must be removed from searchService');
});

test('sidebar navigation does not contain troubleshooting entry or dead links', () => {
    const sidebarSource = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
    assert.ok(!sidebarSource.includes('/troubleshooting'), 'Sidebar must not contain /troubleshooting route');
    assert.ok(!sidebarSource.includes('Troubleshooting'), 'Sidebar must not contain Troubleshooting label');
    assert.ok(!sidebarSource.includes('HelpCircle'), 'Sidebar must not import HelpCircle');
});

test('Search domains strictly remain Playbook, Issue, Guide, and SOP only', () => {
    const d = realData();
    const results = core.searchKnowledge('', d);
    const validDomains = new Set(['Playbook', 'Issue', 'Guide', 'SOP']);
    for (const item of results) {
        let domain = 'Playbook';
        if ('symptoms' in item) domain = 'Issue';
        else if ('steps' in item && 'currentVersionId' in item) domain = 'Guide';
        else if ('purpose' in item) domain = 'SOP';
        assert.ok(validDomains.has(domain), `Search result ${item.id} has invalid domain ${domain}`);
    }
});

test('Issue with Jira Code is discoverable and exact Jira Code matches rank first', () => {
    const set = {
        issues: [
            issue({ id: 'ISS-10', title: 'Payment timeout', jiraCode: 'NEW-001' }),
            issue({ id: 'ISS-11', title: 'Mentioning new-001 in title' }),
        ],
    };
    for (const q of ['NEW-001', 'new-001', '  NEW-001  ']) {
        const found = ids(q, set);
        assert.equal(found[0], 'ISS-10');
        assert.ok(found.includes('ISS-11'));
    }
});

test('Guide linked to Issue is discoverable by Jira Code without duplicating Jira Code in Guide', () => {
    const set = {
        issues: [
            issue({ id: 'ISS-20', title: 'Auth loop', jiraCode: 'SEC-404' }),
            issue({ id: 'ISS-21', title: 'Unrelated issue' }),
        ],
        guides: [
            guide({ id: 'G-20', issueId: 'ISS-20', title: 'Resolve Auth Loop' }),
            guide({ id: 'G-21', issueId: 'ISS-21', title: 'Other Guide' }),
        ],
    };

    // Guide does not store jiraCode
    assert.equal('jiraCode' in set.guides[0], false);
    assert.equal('jira_code' in set.guides[0], false);

    // Searching Jira Code returns Issue first, and its linked Guide as well
    const found = ids('SEC-404', set);
    assert.equal(found[0], 'ISS-20');
    assert.ok(found.includes('G-20'));
    assert.ok(!found.includes('G-21'));
    assert.ok(!found.includes('ISS-21'));
});

test('Issue result exposes Jira Code for rendering and omits when absent', () => {
    const withCode = issue({ id: 'ISS-30', title: 'Issue with Jira', jiraCode: 'NEW-001' });
    assert.equal(getRowJiraCode(withCode), 'NEW-001');

    const withoutCode = issue({ id: 'ISS-31', title: 'Issue without Jira', jiraCode: undefined });
    assert.equal(getRowJiraCode(withoutCode), undefined);

    const withEmptyCode = issue({ id: 'ISS-32', title: 'Issue empty Jira', jiraCode: '   ' });
    assert.equal(getRowJiraCode(withEmptyCode), undefined);
});

test('Guide result derives Jira Code from linked Issue without duplicating in Guide persistence', () => {
    const linkedIssueWithJira = issue({ id: 'ISS-40', title: 'Parent Issue', jiraCode: 'NEW-002' });
    const linkedIssueNoJira = issue({ id: 'ISS-41', title: 'Parent Issue No Jira' });
    const guideItem = guide({ id: 'G-40', issueId: 'ISS-40', title: 'Guide Title' });

    // Derives from linked Issue with Jira
    assert.equal(getRowJiraCode(guideItem, linkedIssueWithJira), 'NEW-002');

    // Returns undefined when linked Issue has no Jira code
    assert.equal(getRowJiraCode(guideItem, linkedIssueNoJira), undefined);

    // Returns undefined when linked Issue is not provided
    assert.equal(getRowJiraCode(guideItem), undefined);

    // Guide object itself never holds jiraCode / jira_code
    assert.equal('jiraCode' in guideItem, false);
    assert.equal('jira_code' in guideItem, false);
});

test('Playbook and SOP results do NOT receive Jira labels even if extra fields present', () => {
    const playbookItem = { id: 'pb-1', slug: 'pb-1', name: 'PB 1', code: 'PB', jiraCode: 'NEW-003' };
    const sopItem = sop({ id: 'SOP-50', title: 'SOP Title', jiraCode: 'NEW-003' });

    assert.equal(getRowJiraCode(playbookItem), undefined);
    assert.equal(getRowJiraCode(sopItem), undefined);
});

test('Home Quick Access card routes parse cleanly and preserve existing Search routing', () => {
    // Issues card route
    const issuesRoute = parseHash('#/search?type=Issues');
    assert.equal(issuesRoute.path, '/search');
    assert.equal(issuesRoute.params.type, 'Issues');

    // Guides card route
    const guidesRoute = parseHash('#/search?type=Guides');
    assert.equal(guidesRoute.path, '/search');
    assert.equal(guidesRoute.params.type, 'Guides');

    // SOPs card route
    const sopsRoute = parseHash('#/search?type=SOPs');
    assert.equal(sopsRoute.path, '/search');
    assert.equal(sopsRoute.params.type, 'SOPs');

    // Existing Search route without query parameters
    const baseRoute = parseHash('#/search');
    assert.equal(baseRoute.path, '/search');
    assert.deepEqual(baseRoute.params, {});
});

test('Search initializes domain filter from type query parameter and handles case-insensitivity', () => {
    assert.equal(resolveSearchType('Issues'), 'Issues');
    assert.equal(resolveSearchType('issues'), 'Issues');
    assert.equal(resolveSearchType('Guides'), 'Guides');
    assert.equal(resolveSearchType('guides'), 'Guides');
    assert.equal(resolveSearchType('SOPs'), 'SOPs');
    assert.equal(resolveSearchType('sops'), 'SOPs');
    assert.equal(resolveSearchType('Playbooks'), 'Playbooks');
    assert.equal(resolveSearchType('playbooks'), 'Playbooks');
});

test('Search defaults invalid or missing type query parameter to All', () => {
    assert.equal(resolveSearchType('All'), 'All');
    assert.equal(resolveSearchType('invalid'), 'All');
    assert.equal(resolveSearchType('unknown-domain'), 'All');
    assert.equal(resolveSearchType(''), 'All');
    assert.equal(resolveSearchType('   '), 'All');
    assert.equal(resolveSearchType(undefined), 'All');
    assert.equal(resolveSearchType(null), 'All');
});

