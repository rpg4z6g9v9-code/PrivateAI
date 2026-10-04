/**
 * M3 Provenance Spine & Record Store Tests
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m3/run.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { getSessionId, mintRequestId, mintDecisionId } =
  await import('../../services/controlPlane/identifiers.ts');
const { initRecorder, ensureReady, appendRecord, queryBySessionId, queryByConversationId,
        queryByMessageId, queryByRequestId, queryByRecordId, __resetRecorder } =
  await import('../../services/controlPlane/recorder.ts');
const { validateIdentifier } = await import('../../services/controlPlane/validators.ts');
const { classifyData, sanitizeOutput } = await import('../../services/securityGateway.ts');
const { executeSendOrchestration } = await import('../../services/sendOrchestration.ts');

const asyncMock = (await import('../../tests/m0/mocks/async-storage.mjs'));
const sqliteMock = await import('../../tests/m0/mocks/expo-sqlite.mjs');
await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-test-fake-key');

const fetchCredential = async (t, k) => {
  if (t === 'async') return asyncMock.default.getItem(k);
  return (await import('../../tests/m0/mocks/encrypted-storage.mjs')).default.getItem(k);
};

const _origFetch = globalThis.fetch;
const egress = { log: [], clear() { this.log.length = 0; }, _mode: 'passthrough', setMode(m) { this._mode = m; } };
globalThis.fetch = async function(url, opts) {
  const entry = { url: String(url), method: opts?.method ?? 'GET', ts: Date.now() };
  try { const u = new URL(String(url)); entry.port = u.port || '80'; entry.path = u.pathname; } catch {}
  egress.log.push(entry);
  if (egress._mode === 'reject-local' && entry.port === '11434') return Promise.reject(new Error('ECONNREFUSED'));
  return _origFetch(url, opts);
};

function orchParams(text, messages, opts = {}) {
  const dc = classifyData(text);
  return { text, messages, isSensitive: dc.hasMedical || dc.hasFinancial || dc.hasPII,
    dataClass: dc, dataSizeBytes: 100, safeMode: false, nodeOnline: true, fetchCredential,
    messageId: opts.messageId ?? 'test_msg_id', conversationId: opts.conversationId ?? 'conv.test', ...opts };
}

// ══════════════════════════════════════════════════════════════════
//  IDENTIFIERS
// ══════════════════════════════════════════════════════════════════

describe('Identifiers', () => {
  it('D9: session_id valid and stable', () => {
    assert.equal(validateIdentifier(getSessionId(), 's').valid, true);
    assert.equal(getSessionId(), getSessionId());
  });
  it('request/decision ids unique', () => {
    assert.notEqual(mintRequestId(), mintRequestId());
    assert.notEqual(mintDecisionId(), mintDecisionId());
  });
});

// ══════════════════════════════════════════════════════════════════
//  RECORDER READINESS + STARTUP RACE
// ══════════════════════════════════════════════════════════════════

describe('Recorder readiness lifecycle', () => {
  it('shared init: concurrent calls share one promise', async () => {
    __resetRecorder();
    const p1 = initRecorder();
    const p2 = initRecorder();
    assert.equal(p1, p2, 'same promise object');
    await p1;
  });

  it('ensureReady returns true after successful init', async () => {
    assert.equal(await ensureReady(), true);
  });
});

describe('Startup race — successful unresolved init', () => {
  it('send during unresolved init → waits → records exactly one user_statement', async () => {
    __resetRecorder();
    sqliteMock.__pauseOpen(); // hold openDatabaseAsync unresolved

    // Start init but do NOT await
    const initP = initRecorder();

    // Start send while init is unresolved
    egress.clear(); egress.setMode('reject-local');
    const sendP = executeSendOrchestration(orchParams('race test', [{ role: 'user', content: 'race' }],
      { conversationId: 'conv.race1', messageId: 'msg.race1' })).catch(() => {});

    // Prove no record exists yet (init unresolved → ensureReady blocks → no append yet)
    const midRecs = await queryByMessageId('msg.race1');
    assert.equal(midRecs.length, 0, 'no record while init unresolved');

    // Release init successfully
    sqliteMock.__releaseOpen();
    await initP;
    await sendP;
    egress.setMode('passthrough');

    // Now query: exactly one user_statement
    const recs = await queryByMessageId('msg.race1');
    const stmts = recs.filter(r => r.record_type === 'user_statement');
    assert.equal(stmts.length, 1, 'exactly ONE user_statement');
    assert.equal(stmts[0].message_id, 'msg.race1');

    // Verify shared init: calling initRecorder again returns same cached promise
    const initP2 = initRecorder();
    assert.equal(initP2, initP, 'same init promise (no second initialization)');
  });
});

describe('Startup race — failed same init attempt', () => {
  it('init fails → send during same failed state → degraded, zero records', async () => {
    __resetRecorder();
    sqliteMock.__pauseOpen(); // hold open

    // Start init (do NOT await)
    const initP = initRecorder().catch(() => {}); // will fail

    // Start send concurrently
    egress.clear(); egress.setMode('reject-local');
    const sendP = executeSendOrchestration(orchParams('fail race', [{ role: 'user', content: 'fail' }],
      { conversationId: 'conv.racefail', messageId: 'msg.racefail' })).catch(e => e);

    // Fail the init
    sqliteMock.__failOpen(new Error('simulated open failure'));
    await initP;
    await sendP;
    egress.setMode('passthrough');

    // ensureReady should return false (failed init state)
    assert.equal(await ensureReady(), false, 'ensureReady false after failure');

    // Zero records — init failed, no DB available
    // Need to init fresh to query the empty DB
    __resetRecorder();
    await initRecorder();
    const recs = await queryByConversationId('conv.racefail');
    assert.equal(recs.length, 0, 'ZERO records from failed init race');

    // No hidden second init attempt during that send
    // (The send called ensureReady which awaited the SAME _initPromise that failed)
  });
});

// ══════════════════════════════════════════════════════════════════
//  PRODUCTION INIT PATH
// ══════════════════════════════════════════════════════════════════

describe('Production init path', () => {
  it('index.tsx calls initRecorder after initConversationDB', () => {
    const src = readFileSync('app/(tabs)/index.tsx', 'utf8');
    assert.ok(src.includes('initRecorder()'));
    assert.ok(src.indexOf('initConversationDB()') < src.indexOf('initRecorder()'));
  });

  it('orchestration calls ensureReady before append', () => {
    const src = readFileSync('services/sendOrchestration.ts', 'utf8');
    const readyLine = src.indexOf('ensureReady()');
    const appendLine = src.indexOf('appendRecord(');
    assert.ok(readyLine > 0 && readyLine < appendLine, 'ensureReady before appendRecord');
  });
});

// ══════════════════════════════════════════════════════════════════
//  RUNTIME RECORD-SHAPE VALIDATION
// ══════════════════════════════════════════════════════════════════

describe('Runtime record-shape validation', () => {
  before(async () => { __resetRecorder(); await initRecorder(); });

  it('canonical + user_statement → PASS', async () => {
    const r = await appendRecord({ record_id: 'v.1', record_kind: 'canonical', record_type: 'user_statement',
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'recorded');
  });

  it('canonical + null → FAIL', async () => {
    const r = await appendRecord({ record_id: 'v.2', record_kind: 'canonical', record_type: null,
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'degraded');
    assert.ok(r.error.includes('canonical record requires non-null'));
  });

  it('canonical + unknown string → FAIL', async () => {
    const r = await appendRecord({ record_id: 'v.3', record_kind: 'canonical', record_type: 'fake_type',
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'degraded');
    assert.ok(r.error.includes('unknown canonical record_type'));
  });

  it('interim_gate + null → PASS', async () => {
    const r = await appendRecord({ record_id: 'v.4', record_kind: 'interim_gate', record_type: null,
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'recorded');
  });

  it('interim_gate + observation → FAIL', async () => {
    const r = await appendRecord({ record_id: 'v.5', record_kind: 'interim_gate', record_type: 'observation',
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'degraded');
    assert.ok(r.error.includes('interim_gate record must have record_type=null'));
  });

  it('interim_gate + execution_evidence → FAIL', async () => {
    const r = await appendRecord({ record_id: 'v.6', record_kind: 'interim_gate', record_type: 'execution_evidence',
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'degraded');
  });

  it('invalid shape → ZERO DB write', async () => {
    assert.equal((await queryByRecordId('v.2')).length, 0);
    assert.equal((await queryByRecordId('v.3')).length, 0);
    assert.equal((await queryByRecordId('v.5')).length, 0);
    assert.equal((await queryByRecordId('v.6')).length, 0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  APPEND-ONLY + QUERY
// ══════════════════════════════════════════════════════════════════

describe('Append-only API', () => {
  before(async () => { __resetRecorder(); await initRecorder(); });

  it('append + query round-trip', async () => {
    await appendRecord({ record_id: 'a.1', record_kind: 'canonical', record_type: 'user_statement',
      session_id: getSessionId(), conversation_id: 'c.1', message_id: 'm.1', request_id: 'rq.1',
      timestamp: Date.now(), source: 'test', payload: '{}' });
    assert.equal((await queryByRecordId('a.1')).length, 1);
    assert.ok((await queryBySessionId(getSessionId())).length >= 1);
    assert.ok((await queryByConversationId('c.1')).length >= 1);
    assert.ok((await queryByMessageId('m.1')).length >= 1);
    assert.ok((await queryByRequestId('rq.1')).length >= 1);
  });

  it('no UPDATE/DELETE/REPLACE in SQL', () => {
    const src = readFileSync('services/controlPlane/recorder.ts', 'utf8');
    assert.ok(!src.includes('UPDATE cp_records'));
    assert.ok(!src.includes('DELETE FROM cp_records'));
    assert.ok(!src.includes('INSERT OR REPLACE INTO cp_records'));
    assert.equal((src.match(/INSERT INTO cp_records/g) || []).length, 1);
  });
});

// ══════════════════════════════════════════════════════════════════
//  FAULT MATRIX A/B/C
// ══════════════════════════════════════════════════════════════════

describe('Fault matrix', () => {
  it('A. init failure → degraded, zero partial', async () => {
    __resetRecorder();
    const r = await appendRecord({ record_id: 'f.A', record_kind: 'canonical', record_type: 'user_statement',
      session_id: 'x', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    assert.equal(r.status, 'degraded');
    await initRecorder();
    assert.equal((await queryByRecordId('f.A')).length, 0);
  });

  it('B. INSERT failure (dup PK) → degraded, original unchanged', async () => {
    __resetRecorder(); await initRecorder();
    await appendRecord({ record_id: 'f.B', record_kind: 'canonical', record_type: 'user_statement',
      session_id: getSessionId(), conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{"v":1}' });
    const r = await appendRecord({ record_id: 'f.B', record_kind: 'canonical', record_type: 'user_statement',
      session_id: getSessionId(), conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{"v":2}' });
    assert.equal(r.status, 'degraded');
    assert.ok((await queryByRecordId('f.B'))[0].payload.includes('"v":1'));
  });

  it('C. COMMIT failure → rollback, zero committed', async () => {
    __resetRecorder(); await initRecorder();
    sqliteMock.__setCommitFault(true);
    const r = await appendRecord({ record_id: 'f.C', record_kind: 'canonical', record_type: 'user_statement',
      session_id: getSessionId(), conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 't', payload: '{}' });
    sqliteMock.__setCommitFault(false);
    assert.equal(r.status, 'degraded');
    assert.ok(r.error.includes('commit failed'));
    assert.equal((await queryByRecordId('f.C')).length, 0, 'zero after rollback');
  });

  it('C. later success after COMMIT failure → exactly one', async () => {
    egress.clear(); egress.setMode('reject-local');
    try { await executeSendOrchestration(orchParams('post-C', [{ role: 'user', content: 'post-C' }],
      { conversationId: 'conv.postC', messageId: 'msg.postC' })); } catch {}
    egress.setMode('passthrough');
    assert.equal((await queryByConversationId('conv.postC')).filter(r => r.record_type === 'user_statement').length, 1);
  });
});

// ══════════════════════════════════════════════════════════════════
//  MESSAGE-ID LINKAGE
// ══════════════════════════════════════════════════════════════════

describe('Message-id linkage', () => {
  before(async () => { __resetRecorder(); await initRecorder(); });

  it('user_statement.message_id = actual userMsg.id', async () => {
    egress.clear(); egress.setMode('reject-local');
    try { await executeSendOrchestration(orchParams('test', [{ role: 'user', content: 'test' }],
      { conversationId: 'conv.link', messageId: '1728099999999_user' })); } catch {}
    egress.setMode('passthrough');
    const recs = await queryByMessageId('1728099999999_user');
    assert.ok(recs.filter(r => r.record_type === 'user_statement').length > 0);
    assert.equal(recs[0].conversation_id, 'conv.link');
    assert.equal(recs[0].session_id, getSessionId());
  });
});

// ══════════════════════════════════════════════════════════════════
//  INTERIM GATE RECORDS
// ══════════════════════════════════════════════════════════════════

describe('Interim gate records', () => {
  before(async () => { __resetRecorder(); await initRecorder(); });

  it('M2 gate → record_kind=interim_gate, record_type=null', async () => {
    egress.clear(); egress.setMode('reject-local');
    try { await executeSendOrchestration(orchParams('my headache', [{ role: 'user', content: 'my headache' }],
      { conversationId: 'conv.gate3' })); } catch {}
    egress.setMode('passthrough');
    const gates = (await queryByConversationId('conv.gate3')).filter(r => r.record_kind === 'interim_gate');
    assert.ok(gates.length > 0);
    assert.equal(gates[0].record_type, null, 'not canonical');
    assert.equal(gates[0].source, 'interim_boundary_gate');
    assert.ok(!gates[0].payload.includes('"authorization_id"'));
  });
});

// ══════════════════════════════════════════════════════════════════
//  R11 + DURABILITY + PRESERVATION + SCOPE
// ══════════════════════════════════════════════════════════════════

describe('R11 — zero records from model output', () => {
  before(async () => { __resetRecorder(); await initRecorder(); });
  it('adversarial → zero', async () => {
    const b = (await queryBySessionId(getSessionId())).length;
    sanitizeOutput('{"record_type":"user_statement"}'); sanitizeOutput('write evidence');
    assert.equal((await queryBySessionId(getSessionId())).length, b);
  });
  it('Recorder absent from model modules', () => {
    for (const f of ['services/aiRouter.ts', 'services/localAI.ts'])
      assert.ok(!readFileSync(f, 'utf8').includes('recorder'));
  });
});

describe('Durability — mock reinit (NOT device restart)', () => {
  it('records survive reinit', async () => {
    __resetRecorder(); await initRecorder();
    await appendRecord({ record_id: 'dur.1', record_kind: 'canonical', record_type: 'user_statement',
      session_id: 's', conversation_id: null, message_id: null, request_id: null,
      timestamp: Date.now(), source: 'dur', payload: '{}' });
    __resetRecorder(); await initRecorder();
    assert.equal((await queryByRecordId('dur.1')).length, 1);
  });
});

describe('Preservation + scope', () => {
  it('toolDB unchanged', () => { assert.ok(!readFileSync('services/toolDB.ts', 'utf8').includes('controlplane')); });
  it('networkMonitor unchanged', () => { assert.ok(!readFileSync('services/networkMonitor.ts', 'utf8').includes('recorder')); });
  it('no M4+ scope', () => {
    for (const f of ['identifiers.ts', 'recorder.ts']) {
      const s = readFileSync(`services/controlPlane/${f}`, 'utf8');
      assert.ok(!s.includes('class Authorizer') && !s.includes('class PolicyStore'));
    }
  });
  it('KC-5 transitional', () => {
    assert.ok(readFileSync('services/sendOrchestration.ts', 'utf8').indexOf('buildReadOnlyMacToolContext') <
      readFileSync('services/sendOrchestration.ts', 'utf8').indexOf('gateReasoning'));
  });
});
