/**
 * tests/m2/d7-representation.test.mjs
 *
 * Production-backed M2 D7 representation validation.
 * Uses actual classifyPayload() to exercise production detector implementations.
 * Does NOT copy detector logic into tests.
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m2/d7-representation.test.mjs
 */

import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

const { classifyPayload } = await import('../../services/controlPlane/classifier.ts');

// ── Fake private key material for testing ────────────────────────────────
// Never real, only for pattern matching validation

const FAKE_RSA_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abcdefghijklmnop
qrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/==
-----END RSA PRIVATE KEY-----`;

const FAKE_EC_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIGlh4GlUELh4g3g4g3g4g3g4g3g4g
3g4g3g4g3g4g3g4goAoGCCqGSM49AwEHoUQDQgAE
-----END EC PRIVATE KEY-----`;

const FAKE_DSA_KEY = `-----BEGIN DSA PRIVATE KEY-----
MIIBvAIBAAKBgQDa4g3g4g3g4g3g4g3g4g3g4g3
g4g3g4g3g4g3g4g3g4g3g4g3g4g3g4g3g4g3QIV
-----END DSA PRIVATE KEY-----`;

const FAKE_OPENSSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUtbm9u
ZS1ub25lAAAAI3Blcm1pdC1wb3J0LWZvcndh
-----END OPENSSH PRIVATE KEY-----`;

const FAKE_PLAIN_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwgg
SkAgEAAoIBAQC4g3g4g3g4g3g4g3g4g3g4g3g4
-----END PRIVATE KEY-----`;

// ── Credential fetcher test double ──────────────────────────────
const createFetchCredential = (credentials = {}) => {
  return async (type, key) => {
    return credentials[key] ?? null;
  };
};

// ────────────────────────────────────────────────────────────────
// PRIVATE-KEY-BLOCK PATTERN TESTS
// ────────────────────────────────────────────────────────────────

describe('M2 D7 Representation — Private-Key-Block Pattern (Production)', () => {

  describe('Single block detection — all five supported formats', () => {

    test('RSA PRIVATE KEY format is detected and span includes complete block', async () => {
      const classification = await classifyPayload({
        currentText: FAKE_RSA_KEY,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected, 'RSA key must be protected');
      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan, 'private_key_block detector must fire');
      assert.equal(pkSpan.segment, 'current_text');
      assert.equal(pkSpan.offset, 0, 'offset at BEGIN marker');
      assert.equal(pkSpan.length, FAKE_RSA_KEY.length, 'length covers entire block');
      assert.equal(FAKE_RSA_KEY.slice(pkSpan.offset, pkSpan.offset + pkSpan.length), FAKE_RSA_KEY);
    });

    test('EC PRIVATE KEY format is detected with complete span', async () => {
      const classification = await classifyPayload({
        currentText: FAKE_EC_KEY,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.length, FAKE_EC_KEY.length);
      assert.equal(FAKE_EC_KEY.slice(pkSpan.offset, pkSpan.offset + pkSpan.length), FAKE_EC_KEY);
    });

    test('DSA PRIVATE KEY format is detected with complete span', async () => {
      const classification = await classifyPayload({
        currentText: FAKE_DSA_KEY,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.length, FAKE_DSA_KEY.length);
    });

    test('OPENSSH PRIVATE KEY format is detected with complete span', async () => {
      const classification = await classifyPayload({
        currentText: FAKE_OPENSSH_KEY,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.length, FAKE_OPENSSH_KEY.length);
    });

    test('PRIVATE KEY (no type specifier) is detected with complete span', async () => {
      const classification = await classifyPayload({
        currentText: FAKE_PLAIN_KEY,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.length, FAKE_PLAIN_KEY.length);
    });
  });

  describe('Span boundaries and offsets', () => {

    test('prefix before key: offset points at BEGIN marker', async () => {
      const prefix = 'Here is my secret key:\n';
      const text = prefix + FAKE_RSA_KEY;
      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.offset, prefix.length, 'offset at BEGIN marker');
      assert.equal(text.slice(pkSpan.offset, pkSpan.offset + pkSpan.length), FAKE_RSA_KEY);
    });

    test('suffix after key: suffix is outside span', async () => {
      const suffix = '\n\nEnd of transmission.';
      const text = FAKE_RSA_KEY + suffix;
      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      const pkSpan = classification.protectedSpans.find(s => s.detector === 'private_key_block');
      assert.ok(pkSpan);
      assert.equal(pkSpan.length, FAKE_RSA_KEY.length, 'length does not include suffix');
      assert.equal(text.slice(pkSpan.offset + pkSpan.length), suffix);
    });
  });

  describe('Multiple blocks — independent spans', () => {

    test('two adjacent RSA blocks produce two independent spans', async () => {
      const text = FAKE_RSA_KEY + '\n' + FAKE_RSA_KEY;
      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      const pkSpans = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(pkSpans.length, 2, 'two independent private-key-block spans');

      const [span1, span2] = pkSpans;
      assert.equal(span1.offset, 0);
      assert.equal(span1.length, FAKE_RSA_KEY.length);
      assert.equal(span2.offset, FAKE_RSA_KEY.length + 1, 'second span offset accounts for newline');
      assert.equal(span2.length, FAKE_RSA_KEY.length);
      // Verify no merge
      assert.notEqual(span1.offset, span2.offset);
    });

    test('two different key types separated by text produce two spans', async () => {
      const separator = '\n\nNow here is an EC key:\n';
      const text = FAKE_RSA_KEY + separator + FAKE_EC_KEY;
      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      const pkSpans = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(pkSpans.length, 2, 'two independent spans for different key types');

      const [span1, span2] = pkSpans;
      assert.equal(text.slice(span1.offset, span1.offset + span1.length), FAKE_RSA_KEY);
      assert.equal(text.slice(span2.offset, span2.offset + span2.length), FAKE_EC_KEY);
    });
  });

  describe('Boundary cases: overlapping/nested BEGIN/END markers', () => {

    test('truncated same-type followed by complete same-type: both protected, sanitizability distinguished', async () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
TRUNCATED_FIRST

ordinary text

-----BEGIN RSA PRIVATE KEY-----
SECOND_COMPLETE
-----END RSA PRIVATE KEY-----`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpans = classification.protectedSpans.filter(s => s.detector?.includes('private_key'));
      assert.equal(pkSpans.length, 2, 'two private-key spans: one incomplete, one complete');

      const incomplete = pkSpans.find(s => s.detector === 'private_key_incomplete');
      const complete = pkSpans.find(s => s.detector === 'private_key_block');

      assert.ok(incomplete, 'first truncated RSA detected as incomplete');
      assert.ok(complete, 'second RSA detected as complete');
      assert.ok(incomplete.offset < complete.offset, 'incomplete before complete');
    });

    test('truncated RSA followed by complete EC: independently recognized', async () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
TRUNCATED_RSA

ordinary text

-----BEGIN EC PRIVATE KEY-----
VALID_EC
-----END EC PRIVATE KEY-----`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpans = classification.protectedSpans.filter(s => s.detector?.includes('private_key'));
      assert.equal(pkSpans.length, 2, 'RSA incomplete + EC complete');

      const incomplete = pkSpans.find(s => s.detector === 'private_key_incomplete');
      const complete = pkSpans.find(s => s.detector === 'private_key_block');

      assert.ok(incomplete, 'truncated RSA detected');
      assert.ok(complete, 'complete EC detected independently');
    });

    test('complete RSA followed by truncated RSA: both detected independently', async () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
COMPLETE_RSA
-----END RSA PRIVATE KEY-----

separator

-----BEGIN RSA PRIVATE KEY-----
TRUNCATED_RSA`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const pkSpans = classification.protectedSpans.filter(s => s.detector?.includes('private_key'));
      assert.equal(pkSpans.length, 2, 'complete then incomplete');

      const [first, second] = pkSpans;
      assert.equal(first.detector, 'private_key_block', 'first is complete');
      assert.equal(second.detector, 'private_key_incomplete', 'second is incomplete');
    });

    test('two complete RSA blocks: independent complete spans, no merge', async () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
FIRST_COMPLETE
-----END RSA PRIVATE KEY-----

separator

-----BEGIN RSA PRIVATE KEY-----
SECOND_COMPLETE
-----END RSA PRIVATE KEY-----`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      const pkSpans = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(pkSpans.length, 2, 'two independent complete blocks');

      assert(pkSpans[0].offset < pkSpans[1].offset, 'first before second');
      // Verify no overlap/merge
      const firstEnd = pkSpans[0].offset + pkSpans[0].length;
      const secondStart = pkSpans[1].offset;
      assert.ok(firstEnd < secondStart, 'blocks do not merge or overlap');
    });
  });

  describe('Mismatched key labels and incomplete blocks (fail-closed validation)', () => {

    test('BEGIN RSA / END EC: protected but NOT sanitizable (incomplete detector)', async () => {
      const mismatchedBlock = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890
-----END EC PRIVATE KEY-----`;

      const classification = await classifyPayload({
        currentText: mismatchedBlock,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      // Mismatched labels: protected but NOT a complete_key_block
      assert.ok(classification.isProtected, 'mismatched labels still protected (fail-closed)');
      const completeBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(completeBlocks.length, 0, 'mismatched BEGIN/END not treated as complete block');
      const incompleteBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_incomplete');
      assert.equal(incompleteBlocks.length, 1, 'mismatched labels detected as incomplete');
    });

    test('BEGIN RSA with no END: protected but NOT sanitizable (incomplete detector)', async () => {
      const incompleteBlock = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890`;

      const classification = await classifyPayload({
        currentText: incompleteBlock,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      // BEGIN without END: protected but NOT a complete_key_block
      assert.ok(classification.isProtected, 'incomplete key still protected (fail-closed)');
      const completeBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(completeBlocks.length, 0, 'incomplete key not treated as complete block');
      const incompleteBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_incomplete');
      assert.equal(incompleteBlocks.length, 1, 'incomplete key detected');
    });

    test('correctly matched RSA / RSA: sanitizable (complete detector only)', async () => {
      const correctBlock = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----`;

      const classification = await classifyPayload({
        currentText: correctBlock,
        messages: [],
        fetchCredential: createFetchCredential(),
      });

      assert.ok(classification.isProtected);
      const completeBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_block');
      assert.equal(completeBlocks.length, 1, 'correctly matched block detected as complete (D7-sanitizable)');
      const incompleteBlocks = classification.protectedSpans.filter(s => s.detector === 'private_key_incomplete');
      assert.equal(incompleteBlocks.length, 0, 'no incomplete detector match for complete block');
    });
  });
});

// ────────────────────────────────────────────────────────────────
// STORED-CREDENTIAL DETECTION TESTS
// ────────────────────────────────────────────────────────────────

describe('M2 D7 Representation — Stored-Credential Detection (Production)', () => {

  describe('Single occurrence', () => {

    test('one occurrence of app_brave_key is detected', async () => {
      const credential = 'BSA_test_fake_key_12345';
      const text = `Using search token: ${credential} for queries`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      assert.ok(classification.isProtected, 'text with stored brave key must be protected');
      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 1, 'one app_brave_key span');
      assert.equal(text.slice(credSpans[0].offset, credSpans[0].offset + credSpans[0].length), credential);
    });

    test('one occurrence of app_gateway_token is detected', async () => {
      const credential = 'gateway_token_secret_xyz789';
      const text = `Authorization token: ${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'providerGatewayToken_v1': credential }),
      });

      assert.ok(classification.isProtected);
      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_gateway_token');
      assert.equal(credSpans.length, 1, 'one app_gateway_token span');
    });

    test('absent credential yields no stored-credential spans', async () => {
      const text = 'This text has no credentials';

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': 'different_key' }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 0);
    });

    test('null credential fetch yields no spans', async () => {
      const text = 'No credentials here';

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({}), // returns null for any key
      });

      const credSpans = classification.protectedSpans.filter(
        s => s.detector === 'app_brave_key' || s.detector === 'app_gateway_token'
      );
      assert.equal(credSpans.length, 0);
    });
  });

  describe('Multiple occurrences — all found', () => {

    test('two separated occurrences of same credential both found', async () => {
      const credential = 'token_xyz';
      const text = `First: ${credential}\nMiddle section\nSecond: ${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 2, 'both occurrences found');
      assert.equal(text.slice(credSpans[0].offset, credSpans[0].offset + credSpans[0].length), credential);
      assert.equal(text.slice(credSpans[1].offset, credSpans[1].offset + credSpans[1].length), credential);
      assert(credSpans[0].offset < credSpans[1].offset, 'first offset before second');
    });

    test('three occurrences all found', async () => {
      const credential = 'key123';
      const text = `${credential}--${credential}--${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 3, 'all three occurrences found');
      for (let i = 0; i < 3; i++) {
        const sliced = text.slice(credSpans[i].offset, credSpans[i].offset + credSpans[i].length);
        assert.equal(sliced, credential, `occurrence ${i + 1} matches`);
      }
    });

    test('adjacent occurrences (no separator) produce independent spans', async () => {
      const credential = 'pwd';
      const text = `${credential}${credential}${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 3, 'three adjacent occurrences all found');
      assert.equal(credSpans[0].offset, 0);
      assert.equal(credSpans[1].offset, credential.length);
      assert.equal(credSpans[2].offset, 2 * credential.length);
    });
  });

  describe('Regex special characters treated literally', () => {

    test('credential with dots and asterisks matched literally', async () => {
      const credential = 'token.with*special^chars';
      const text = `Token is: ${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 1, 'credential with regex chars matched literally');
      assert.equal(text.slice(credSpans[0].offset, credSpans[0].offset + credSpans[0].length), credential);
    });

    test('credential with brackets matched literally', async () => {
      const credential = 'key[0][secret]';
      const text = `Config: ${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 1);
      assert.equal(text.slice(credSpans[0].offset, credSpans[0].offset + credSpans[0].length), credential);
    });

    test('multiple occurrences of credential with special chars all found', async () => {
      const credential = 'key+value*pattern';
      const text = `First: ${credential}\nSecond: ${credential}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
      });

      const credSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      assert.equal(credSpans.length, 2, 'both occurrences of special-char credential found');
      for (const span of credSpans) {
        assert.equal(text.slice(span.offset, span.offset + span.length), credential);
      }
    });
  });

  describe('Both stored credential sources tested', () => {

    test('both app_brave_key and app_gateway_token can be detected in same text', async () => {
      const braveKey = 'brave_secret_123';
      const gatewayToken = 'gateway_secret_456';
      const text = `Brave: ${braveKey}\nGateway: ${gatewayToken}`;

      const classification = await classifyPayload({
        currentText: text,
        messages: [],
        fetchCredential: createFetchCredential({
          'brave_search_api_key_v1': braveKey,
          'providerGatewayToken_v1': gatewayToken,
        }),
      });

      const braveSpans = classification.protectedSpans.filter(s => s.detector === 'app_brave_key');
      const gatewaySpans = classification.protectedSpans.filter(s => s.detector === 'app_gateway_token');
      assert.equal(braveSpans.length, 1, 'brave key found');
      assert.equal(gatewaySpans.length, 1, 'gateway token found');
      assert.ok(classification.isProtected, 'text with both credentials is protected');
    });
  });
});

// ────────────────────────────────────────────────────────────────
// MULTI-SEGMENT PRODUCTION TEST
// ────────────────────────────────────────────────────────────────

describe('M2 D7 Representation — Multi-Segment Protection (Production)', () => {

  test('protected material in current_text is correctly classified and spanned', async () => {
    const classification = await classifyPayload({
      currentText: FAKE_RSA_KEY,
      messages: [],
      fetchCredential: createFetchCredential(),
    });

    const pkSpans = classification.segments
      .filter(s => s.segment === 'current_text')
      .flatMap(s => s.protectedSpans.filter(ps => ps.detector === 'private_key_block'));

    assert.equal(pkSpans.length, 1, 'private key in current_text detected');
    assert.equal(pkSpans[0].segment, 'current_text');
    assert.ok(!('index' in pkSpans[0]) || pkSpans[0].index === undefined, 'current_text has no index');
  });

  test('protected material in history is correctly spanned with segment index', async () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: FAKE_EC_KEY },
    ];

    const classification = await classifyPayload({
      currentText: 'how are you',
      messages,
      fetchCredential: createFetchCredential(),
    });

    const historySeg = classification.segments.find(s => s.segment === 'history' && s.index === 2);
    assert.ok(historySeg, 'history segment index 2 found');
    const pkSpans = historySeg.protectedSpans.filter(s => s.detector === 'private_key_block');
    assert.equal(pkSpans.length, 1, 'private key in history detected');
    assert.equal(pkSpans[0].index, 2, 'span carries correct history index');
    assert.equal(pkSpans[0].segment, 'history');
  });

  test('protected material in tool_context is correctly spanned', async () => {
    const classification = await classifyPayload({
      currentText: 'test',
      messages: [],
      toolContext: `Tool output: ${FAKE_DSA_KEY}`,
      fetchCredential: createFetchCredential(),
    });

    const toolSeg = classification.segments.find(s => s.segment === 'tool_context');
    assert.ok(toolSeg, 'tool_context segment found');
    const pkSpans = toolSeg.protectedSpans.filter(s => s.detector === 'private_key_block');
    assert.equal(pkSpans.length, 1);
    assert.equal(pkSpans[0].segment, 'tool_context');
  });

  test('protected material in search_query is correctly spanned', async () => {
    const query = FAKE_OPENSSH_KEY;
    const classification = await classifyPayload({
      currentText: 'search',
      messages: [],
      searchQuery: query,
      fetchCredential: createFetchCredential(),
    });

    const searchSeg = classification.segments.find(s => s.segment === 'search_query');
    assert.ok(searchSeg, 'search_query segment found');
    const pkSpans = searchSeg.protectedSpans.filter(s => s.detector === 'private_key_block');
    assert.equal(pkSpans.length, 1);
    assert.equal(pkSpans[0].segment, 'search_query');
  });

  test('protected material in summarize_transcript is correctly spanned', async () => {
    const transcript = `Conversation log:\n${FAKE_PLAIN_KEY}`;
    const classification = await classifyPayload({
      currentText: 'summarize',
      messages: [],
      summarizeTranscript: transcript,
      fetchCredential: createFetchCredential(),
    });

    const summarizeSeg = classification.segments.find(s => s.segment === 'summarize_transcript');
    assert.ok(summarizeSeg, 'summarize_transcript segment found');
    const pkSpans = summarizeSeg.protectedSpans.filter(s => s.detector === 'private_key_block');
    assert.equal(pkSpans.length, 1);
    assert.equal(pkSpans[0].segment, 'summarize_transcript');
  });

  test('offsets are local to each segment (not absolute to concatenated payload)', async () => {
    const fakeCredential = 'secret_xyz';
    const prefix = 'PREFIX_';
    const historyContent = `${prefix}${fakeCredential}`;

    const classification = await classifyPayload({
      currentText: 'normal text',
      messages: [{ role: 'user', content: historyContent }],
      fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': fakeCredential }),
    });

    const historySeg = classification.segments.find(s => s.segment === 'history' && s.index === 0);
    const credSpan = historySeg.protectedSpans.find(s => s.detector === 'app_brave_key');
    assert.ok(credSpan, 'credential found in history');
    assert.equal(credSpan.offset, prefix.length, 'offset is local to history segment, not absolute');
    assert.equal(historyContent.slice(credSpan.offset, credSpan.offset + credSpan.length), fakeCredential);
  });
});

// ────────────────────────────────────────────────────────────────
// OVERLAP / DUPLICATE AUDIT
// ────────────────────────────────────────────────────────────────

describe('M2 D7 Representation — Overlap and Duplicate Audit', () => {

  test('no duplicate identical spans occur for same protected material', async () => {
    const credential = 'token123';
    const key = FAKE_RSA_KEY;
    const text = `Cred: ${credential}\nKey: ${key}`;

    const classification = await classifyPayload({
      currentText: text,
      messages: [],
      fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
    });

    // Check for duplicates: same detector, segment, offset, length
    const spanMap = new Map();
    for (const span of classification.protectedSpans) {
      const key = `${span.detector}|${span.segment}|${span.index ?? ''}|${span.offset}|${span.length}`;
      if (spanMap.has(key)) {
        throw new Error(`Duplicate span found: ${key}`);
      }
      spanMap.set(key, span);
    }

    // Different detectors, different segments, no duplicates
    assert.equal(spanMap.size, classification.protectedSpans.length);
  });

  test('realistic overlap: password_assignment overlaps stored credential (normalizable)', async () => {
    const text = 'password="SuperSecret123!"';

    const classification = await classifyPayload({
      currentText: text,
      messages: [],
      fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': 'SuperSecret123!' }),
    });

    assert.ok(classification.isProtected);
    const spans = classification.protectedSpans.filter(s => s.segment === 'current_text');
    assert.equal(spans.length, 2, 'two detectors fire: password_assignment + app_brave_key');

    const pwdAssign = spans.find(s => s.detector === 'password_assignment');
    const credSpan = spans.find(s => s.detector === 'app_brave_key');

    assert.ok(pwdAssign, 'password_assignment detected');
    assert.ok(credSpan, 'app_brave_key detected');

    // Check overlap
    const pwdEnd = pwdAssign.offset + pwdAssign.length;
    const credEnd = credSpan.offset + credSpan.length;
    const overlaps = !(pwdEnd <= credSpan.offset || credEnd <= pwdAssign.offset);
    assert.ok(overlaps, 'spans overlap (expected)');

    // Verify overlap region is the credential itself
    const overlapStart = Math.max(pwdAssign.offset, credSpan.offset);
    const overlapEnd = Math.min(pwdEnd, credEnd);
    const overlapMaterial = text.slice(overlapStart, overlapEnd);
    assert.equal(overlapMaterial, 'SuperSecret123!', 'overlap is the credential value');

    // Verify normalization is possible: all in same segment with numeric boundaries
    assert.equal(pwdAssign.segment, credSpan.segment, 'both in same segment');
    assert.equal(pwdAssign.offset, 0, 'first span offset numeric');
    assert.equal(credSpan.offset, 10, 'second span offset numeric');
  });

  test('D7 sanitizability distinguishable: complete vs incomplete keys', async () => {
    const completeKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----`;

    const incompleteKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890`;

    const r1 = await classifyPayload({
      currentText: completeKey,
      messages: [],
      fetchCredential: createFetchCredential(),
    });

    const r2 = await classifyPayload({
      currentText: incompleteKey,
      messages: [],
      fetchCredential: createFetchCredential(),
    });

    // Both are protected
    assert.ok(r1.isProtected, 'complete key protected');
    assert.ok(r2.isProtected, 'incomplete key protected');

    // Complete key: has sanitizable private_key_block, no incomplete marker
    const completeBlock = r1.protectedSpans.find(s => s.detector === 'private_key_block');
    const completeIncomplete = r1.protectedSpans.find(s => s.detector === 'private_key_incomplete');
    assert.ok(completeBlock, 'complete key has private_key_block (D7-sanitizable)');
    assert.ok(!completeIncomplete, 'complete key has no private_key_incomplete');

    // Incomplete key: no sanitizable block, has incomplete marker (protected but not sanitizable)
    const incompleteBlock = r2.protectedSpans.find(s => s.detector === 'private_key_block');
    const incompleteMarker = r2.protectedSpans.find(s => s.detector === 'private_key_incomplete');
    assert.ok(!incompleteBlock, 'incomplete key has no private_key_block');
    assert.ok(incompleteMarker, 'incomplete key has private_key_incomplete (protected, not sanitizable)');

    // M6 can distinguish: use private_key_block spans for D7, refuse private_key_incomplete spans
  });

  test('representation audit: each span has required fields', async () => {
    const credential = 'token_abc';
    const classification = await classifyPayload({
      currentText: `Token: ${credential}`,
      messages: [{ role: 'user', content: FAKE_RSA_KEY }],
      fetchCredential: createFetchCredential({ 'brave_search_api_key_v1': credential }),
    });

    for (const span of classification.protectedSpans) {
      assert.ok(span.segment, 'segment required');
      assert.ok(typeof span.detector === 'string', 'detector required and string');
      assert.equal(typeof span.offset, 'number', 'offset required and number');
      assert.ok(span.offset >= 0, 'offset non-negative');
      assert.equal(typeof span.length, 'number', 'length required and number');
      assert.ok(span.length > 0, 'length positive');
      // index is optional for segments other than history
      if (span.segment === 'history') {
        assert.ok(typeof span.index === 'number', 'history segment must have index');
      }
    }
  });
});
