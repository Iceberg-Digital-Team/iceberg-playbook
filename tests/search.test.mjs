import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Search runs against isolated in-memory storage, never the user's records.
const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
};

async function loadTs(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const data = await loadTs('../src/data.ts');
const core = await loadTs('../src/search/searchCore.ts');

const playbooks = [{ id: 'pb-a', name: 'Alphaplatform' }, { id: 'pb-b', name: 'Betaplatform' }];
const issue = o => ({ playbookId: 'pb-a', title: '', summary: '', symptoms: [], errorMessage: '', ...o });
const guide = o => ({ playbookId: 'pb-a', issueId: '', title: '', summary: '', steps: [], commonProblems: [], ...o });
const sop = o => ({ playbookId: 'pb-a', title: '', purpose: '', owner: 'Ops', ...o });
const ids = (query, set, options = {}) =>
    core.searchKnowledge(query, { issues: [], guides: [], sops: [], playbooks, ...set }, options).map(x => x.id);
const realData = () => ({ issues: data.getIssues(), guides: data.getGuides(), sops: data.getSOPs(), playbooks: data.getPlaybooks() });

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
    storage.clear();
    const created = data.addIssue({ ...issueInput, symptoms: ['Quxlantic spinner freeze'], errorMessage: 'ERR_ZORBLAX_42' });
    const found = q => core.searchKnowledge(q, realData(), {}).map(x => x.id);
    assert.deepEqual(found('quxlantic'), [created.id]);
    assert.deepEqual(found('ERR_ZORBLAX_42'), [created.id]);
    assert.deepEqual(found('err_zorblax_42'), [created.id]);
});

test('real data (R-02): Issue code returns the Issue first and its Guide too', () => {
    storage.clear();
    const guideId = data.getPrimaryGuide('WA-001').id;
    for (const q of ['WA-001', 'wa-001']) {
        const found = core.searchKnowledge(q, realData(), {}).map(x => x.id);
        assert.equal(found[0], 'WA-001');
        assert.ok(found.includes(guideId), `Guide ${guideId} missing for ${q}`);
    }
    const linkedTitle = data.getIssues().find(i => i.id === 'WA-001').title;
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
    storage.clear();
    const d = realData();
    const results = core.searchKnowledge('', d, { type: 'Guides' });
    const resultIds = results.map(x => x.id);
    assert.equal(new Set(resultIds).size, resultIds.length);
    const validPb = new Set(d.playbooks.map(p => p.id));
    const expected = d.guides.filter(g => validPb.has(g.playbookId)).map(g => g.id);
    assert.deepEqual(resultIds, expected);
});