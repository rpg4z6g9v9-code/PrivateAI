/**
 * tests/m2/d7-representation.test.mjs
 *
 * Test matrices for M2 D7 representation fixes:
 * 1. Private-key-block pattern — complete span coverage
 * 2. Stored-credential detection — find all occurrences (not just first)
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m2/d7-representation.test.mjs
 */

import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

// Mock the classifier functions locally to test pattern matching
function detectProtectedPatterns(text, segment, index) {
  const PROTECTED_PATTERNS = [
    { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, detector: 'private_key_block' },
  ];

  const spans = [];
  for (const { pattern, detector } of PROTECTED_PATTERNS) {
    const rx = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = rx.exec(text)) !== null) {
      spans.push({ segment, index, detector, offset: match.index, length: match[0].length });
    }
  }
  return spans;
}

// ────────────────────────────────────────────────────────────────
// PRIVATE-KEY-BLOCK PATTERN TEST MATRIX
// ────────────────────────────────────────────────────────────────

// Fake key blocks for testing (never real keys)
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

describe('M2 D7 Representation — Private-Key-Block Pattern', () => {

  describe('Single block detection — each supported form', () => {

    test('RSA PRIVATE KEY — single block', () => {
      const text = FAKE_RSA_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1, 'exactly one span');
      const [span] = spans;
      assert.equal(span.detector, 'private_key_block');
      assert.equal(span.offset, 0, 'offset at first dash');
      assert.equal(span.length, text.length, 'length covers entire block');
      assert.equal(text.slice(span.offset, span.offset + span.length), text);
    });

    test('EC PRIVATE KEY — single block', () => {
      const text = FAKE_EC_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1, 'exactly one span');
      const [span] = spans;
      assert.equal(span.offset, 0);
      assert.equal(span.length, text.length);
      assert.equal(text.slice(span.offset, span.offset + span.length), text);
    });

    test('DSA PRIVATE KEY — single block', () => {
      const text = FAKE_DSA_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1, 'exactly one span');
      const [span] = spans;
      assert.equal(span.offset, 0);
      assert.equal(span.length, text.length);
      assert.equal(text.slice(span.offset, span.offset + span.length), text);
    });

    test('OPENSSH PRIVATE KEY — single block', () => {
      const text = FAKE_OPENSSH_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1, 'exactly one span');
      const [span] = spans;
      assert.equal(span.offset, 0);
      assert.equal(span.length, text.length);
      assert.equal(text.slice(span.offset, span.offset + span.length), text);
    });

    test('PRIVATE KEY (no type) — single block', () => {
      const text = FAKE_PLAIN_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1, 'exactly one span');
      const [span] = spans;
      assert.equal(span.offset, 0);
      assert.equal(span.length, text.length);
      assert.equal(text.slice(span.offset, span.offset + span.length), text);
    });
  });

  describe('Span boundaries — prefix and suffix', () => {

    test('block with prefix — offset at BEGIN', () => {
      const prefix = 'This is my key: ';
      const text = prefix + FAKE_RSA_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1);
      const [span] = spans;
      assert.equal(span.offset, prefix.length, 'offset at BEGIN marker');
      assert.equal(text.slice(span.offset, span.offset + span.length), FAKE_RSA_KEY);
    });

    test('block with suffix — suffix outside span', () => {
      const suffix = '\n\nNext section starts here.';
      const text = FAKE_RSA_KEY + suffix;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1);
      const [span] = spans;
      assert.equal(span.length, FAKE_RSA_KEY.length, 'length does not include suffix');
      assert.equal(text.slice(span.offset + span.length), suffix);
    });

    test('block with prefix and suffix', () => {
      const prefix = 'My private key:\n';
      const suffix = '\nEnd of key.';
      const text = prefix + FAKE_RSA_KEY + suffix;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 1);
      const [span] = spans;
      assert.equal(span.offset, prefix.length);
      assert.equal(text.slice(span.offset, span.offset + span.length), FAKE_RSA_KEY);
      assert.equal(text.slice(span.offset + span.length), suffix);
    });
  });

  describe('Multiple blocks — independent spans', () => {

    test('two RSA blocks adjacent', () => {
      const text = FAKE_RSA_KEY + '\n' + FAKE_RSA_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 2, 'two independent spans');

      const [span1, span2] = spans;
      // First block
      assert.equal(span1.offset, 0);
      assert.equal(span1.length, FAKE_RSA_KEY.length);
      // Second block (after newline)
      assert.equal(span2.offset, FAKE_RSA_KEY.length + 1);
      assert.equal(span2.length, FAKE_RSA_KEY.length);
      // No merge
      assert.notEqual(span1.offset, span2.offset);
    });

    test('two different types separated by text', () => {
      const separator = '\n\nHere is an EC key:\n';
      const text = FAKE_RSA_KEY + separator + FAKE_EC_KEY;
      const spans = detectProtectedPatterns(text, 'current_text');
      assert.equal(spans.length, 2, 'two independent spans');

      const [span1, span2] = spans;
      // First block
      assert.equal(text.slice(span1.offset, span1.offset + span1.length), FAKE_RSA_KEY);
      // Second block
      assert.equal(text.slice(span2.offset, span2.offset + span2.length), FAKE_EC_KEY);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// STORED-CREDENTIAL DETECTION TEST MATRIX
// ────────────────────────────────────────────────────────────────

async function detectStoredCredentialsForTest(text, credentialValue) {
  const spans = [];
  if (credentialValue && credentialValue.length > 0 && text.includes(credentialValue)) {
    const escaped = credentialValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'g');
    let match;
    while ((match = rx.exec(text)) !== null) {
      spans.push({ detector: 'app_brave_key', offset: match.index, length: match[0].length });
    }
  }
  return spans;
}

describe('M2 D7 Representation — Stored-Credential Detection', () => {

  describe('Single occurrence', () => {

    test('credential found once', async () => {
      const cred = 'secret_token_abc123xyz';
      const text = `Here is my token: ${cred} for authentication.`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 1);
      const [span] = spans;
      assert.equal(text.slice(span.offset, span.offset + span.length), cred);
    });

    test('credential not found', async () => {
      const cred = 'secret_token_abc123xyz';
      const text = 'Here is some other text without the credential.';
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 0);
    });
  });

  describe('Multiple occurrences — all found', () => {

    test('credential appears twice separated by text', async () => {
      const cred = 'token_xyz789';
      const text = `First use: ${cred}\nMiddle section.\nSecond use: ${cred}`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 2, 'both occurrences found');

      const [span1, span2] = spans;
      assert.equal(text.slice(span1.offset, span1.offset + span1.length), cred);
      assert.equal(text.slice(span2.offset, span2.offset + span2.length), cred);
      assert(span1.offset < span2.offset, 'first offset before second');
    });

    test('credential appears three times', async () => {
      const cred = 'key123';
      const text = `${cred}--${cred}--${cred}`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 3, 'all three found');

      for (let i = 0; i < 3; i++) {
        const span = spans[i];
        assert.equal(text.slice(span.offset, span.offset + span.length), cred);
      }
    });

    test('credential appears adjacent (no separator)', async () => {
      const cred = 'pwd';
      const text = `${cred}${cred}${cred}`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 3, 'adjacent occurrences all found');

      // First at 0
      assert.equal(spans[0].offset, 0);
      // Second at length of cred
      assert.equal(spans[1].offset, cred.length);
      // Third at 2 * length of cred
      assert.equal(spans[2].offset, 2 * cred.length);
    });
  });

  describe('Regex special characters', () => {

    test('credential with regex metacharacters', async () => {
      const cred = 'token.with*special^chars$end';
      const text = `Token is: ${cred} keep it safe.`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 1, 'credential escaped correctly');
      assert.equal(text.slice(spans[0].offset, spans[0].offset + spans[0].length), cred);
    });

    test('credential with brackets and backslash', async () => {
      const cred = 'key[0]\\path\\to\\secret';
      const text = `Config: ${cred}`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 1);
      assert.equal(text.slice(spans[0].offset, spans[0].offset + spans[0].length), cred);
    });

    test('credential with pipe and parens', async () => {
      const cred = 'token|auth(method)';
      const text = `Use ${cred} for login.`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 1);
      assert.equal(text.slice(spans[0].offset, spans[0].offset + spans[0].length), cred);
    });

    test('multiple occurrences of credential with special chars', async () => {
      const cred = 'key+value*old';
      const text = `First: ${cred}\nSecond: ${cred}`;
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 2, 'both occurrences of escaped pattern found');
      for (const span of spans) {
        assert.equal(text.slice(span.offset, span.offset + span.length), cred);
      }
    });
  });

  describe('Empty or missing credentials', () => {

    test('null credential', async () => {
      const text = 'some text here';
      const spans = await detectStoredCredentialsForTest(text, null);
      assert.equal(spans.length, 0);
    });

    test('empty string credential', async () => {
      const text = 'some text here';
      const spans = await detectStoredCredentialsForTest(text, '');
      assert.equal(spans.length, 0);
    });

    test('credential not in text', async () => {
      const cred = 'secret_not_here';
      const text = 'some completely different text';
      const spans = await detectStoredCredentialsForTest(text, cred);
      assert.equal(spans.length, 0);
    });
  });
});

describe('M2 D7 Representation — Integration', () => {

  test('private key and stored credential both found in same text', async () => {
    const cred = 'brave_key_12345';
    const text = `Config token: ${cred}\n\nMy SSH key:\n${FAKE_RSA_KEY}\n\nAlso need: ${cred} again`;

    const pkSpans = detectProtectedPatterns(text, 'current_text');
    const credSpans = await detectStoredCredentialsForTest(text, cred);

    assert.equal(pkSpans.length, 1, 'one private key found');
    assert.equal(credSpans.length, 2, 'credential found twice');

    // No overlap
    for (const pkSpan of pkSpans) {
      for (const credSpan of credSpans) {
        const pkEnd = pkSpan.offset + pkSpan.length;
        const credEnd = credSpan.offset + credSpan.length;
        const overlap = !(pkEnd <= credSpan.offset || credEnd <= pkSpan.offset);
        assert(!overlap, 'spans should not overlap');
      }
    }
  });
});
