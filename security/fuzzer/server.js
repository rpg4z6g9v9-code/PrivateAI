/**
 * server.js — PrivateAI Security Analyze Endpoint
 *
 * Lightweight Node.js HTTP server that exposes /security/analyze
 * so the Python fuzzer can test the security gateway logic without
 * needing to go through the React Native app.
 *
 * Mirrors the exact patterns from services/securityGateway.ts.
 *
 * Usage:
 *   node server.js
 *   # Listens on http://localhost:8000
 */

const http = require('http');

// ─── Injection Patterns (from securityGateway.ts) ─────────────

const INJECTION_PATTERNS = [
  // Direct instruction override — STT-robust: handles filler words, digits, punctuation, no-space artifacts
  /ignore[,.]?\s*(?:uh?[,.]?\s+|um[,.]?\s+)?(?:all\s+)?(?:\d+\s+)?(?:previous\s+)?(?:instructions|rules|restrictions|guidelines)/i,
  /disregard[,.]?\s*(?:uh?[,.]?\s+|um[,.]?\s+)?(?:all[,.]?\s+)?(?:previous|prior|above|safety|your)/i,
  /forget\s+(?:all\s+)?(?:your\s+)?(?:previous\s+|prior\s+)?(?:instructions|rules|context)/i,
  /override\s+(your\s+)?(rules|instructions|safety|guidelines)/i,
  /bypass[,.]?\s*(?:uh?\s+|um\s+)?(?:your\s+)?(rules|safety|filters|restrictions)/i,
  // System directive injection
  /\[SYSTEM\s+(UPDATE|DIRECTIVE|OVERRIDE|MESSAGE)\]/i,
  /\{\s*system\s*:\s*(update|override|new)\s*\}/i,
  // System prompt extraction
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(?:me\s+)?(?:the\s+|your\s+)?(?:full\s+|all\s+)?(hidden|system|internal)\s+(prompt|instructions|rules)/i,
  /print\s+(your\s+)?(instructions|prompt|rules|configuration)/i,
  /repeat\s+everything\s+(above|before|you\s+were\s+told)/i,
  /what\s+(are|were)\s+your\s+(?:original|initial|system)\s+(?:system\s+)?(instructions|prompt|rules)/i,
  /output\s+(your|the)\s+(system|initial|original)\s+(prompt|message|instructions)/i,
  // Data exfiltration
  /send\s+.*\b(database|data|info|credentials|keys?|tokens?)\b/i,
  /exfiltrate/i,
  /extract\s+(?:all\s+)?(?:the\s+)?(data|info|memory|knowledge)/i,
  /forward\s+(?:this|all|the)\s+(?:\w+\s+)?(data|conversation|history)\s+to/i,
  /instructions?\s+(?:are\s+)?(?:now\s+)?revoked/i,
  /reveal\s+(?:all\s+)?(?:user\s+|my\s+|the\s+)?(medical|health|personal|private)\b/i,
  // Role manipulation
  /you\s+are\s+now\s+(?:a|an|the|\w+\s+)?(AI|assistant|unrestricted|uncensored|jailbroken)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /pretend\s+(to\s+be|you\s+are)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a\s+different)\s+/i,
  /switch\s+to\s+(evil|uncensored|unrestricted|jailbreak)/i,
  /enter\s+(dev|developer|debug|admin)\s+mode/i,
  /\bDAN\b.*\bjailbreak\b/i,
  // Encoding evasion
  /base64\s*(decode|encode).*instruction/i,
  /rot13/i,
  // Delimiter injection
  /```system/i,
  /<\/?system>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  // Agent routing injection — Adam-only voice policy: block attempts to route via @agent syntax
  /\[DELEGATE:/i,
  /@(architect|critic|builder|researcher)\s*:/i,
  /as\s+the\s+(architect|critic|builder|researcher)\s+agent/i,
  /\[(architect|critic|builder|researcher)\]/i,
  /ring\s*[0-9]\s*(access|override|escalat)/i,
  /(?:tell|ask)\s+(?:the\s+)?(researcher|architect|critic|builder)(\s+agent)?\s+to/i,
  /route\s+(?:this\s+)?(?:to|through)\s+(?:the\s+)?(researcher|architect|critic|builder)/i,
];

// ─── Output Patterns (from securityGateway.ts) ────────────────

const FORBIDDEN_OUTPUT = [
  /system prompt/i,
  /internal policy/i,
  /api[_ ]?key/i,
  /database dump/i,
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /sk_[a-f0-9]{40,}/,
  /tvly-[A-Za-z0-9_-]{20,}/,
  /SHARED_CONTEXT/,
  /CLOUD_PROMPTS/,
  /LOCAL_PROMPTS/,
  /INJECTION_PATTERNS/,
  /FORBIDDEN_OUTPUT/,
  /buildAtomPrompt/,
  /securityGateway/,
  /memory_v1_[a-z]+/,
  /knowledge_v1_[a-z]+/,
  /medical_entries_v1/,
  /security_events_v1/,
  // Delegation internals — agent routing architecture must not leak into responses
  /DELEGATE_RE/,
  /parseDelegation/,
  /buildAgentPrompt/,
  /sanitizeAgentResponse/,
  /\[DELEGATE:/,
];

// ─── Medical Keywords (from securityGateway.ts) ───────────────

const MEDICAL_KEYWORDS = /\b(symptom|symptoms|medical|medication|medications|prescri(?:ption|bed)|doctor|physician|diagnosis|diagnose|pain|aching|ache|health|headache|migraine|fatigue|tired|exhausted|fever|nausea|nauseated|dizzy|dizziness|vomit|blood\s*pressure|heart\s*rate|pulse|pharmacy|hospital|clinic|specialist|therapy|treatment|side\s+effect|allergy|allergic|chronic|acute|inflammation|swollen|swelling|rash|anxiety|depression|insomnia|arthritis|diabetes|asthma|inhaler|dosage|dose|mg\b|ml\b|lab\s+result|blood\s+test|x.ray|scan|mri|ct\s+scan|surgery|injury)\b/i;

// ─── Prompt Firewall Patterns (additional hardening layer) ────

const PROMPT_FIREWALL = [
  // Unicode evasion
  /[\u200B-\u200D\uFEFF]/,          // zero-width chars
  /[\u0300-\u036F]{3,}/,            // combining diacritics
  // Token smuggling
  /\|\s*system\s*\|/i,
  /<\|.*?\|>/,
  /\[\/INST\]/i,
  // Indirect injection via seemingly benign text
  /as\s+an?\s+AI\s+(language\s+model|assistant),?\s+I\s+(cannot|can't|am\s+unable)/i,
];

// ─── Analyze Function ─────────────────────────────────────────

function analyze(content, ringLevel = 0) {
  const triggers = [];
  let threatLevel = 'none';
  let allowed = true;

  // Check injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      triggers.push(`injection:${pattern.source.slice(0, 40)}`);
      threatLevel = 'high';
      allowed = false;
    }
  }

  // Check prompt firewall
  for (const pattern of PROMPT_FIREWALL) {
    if (pattern.test(content)) {
      triggers.push(`firewall:${pattern.source.slice(0, 40)}`);
      if (threatLevel === 'none') threatLevel = 'medium';
      allowed = false;
    }
  }

  // Check forbidden output patterns (treat input as potential output too)
  for (const pattern of FORBIDDEN_OUTPUT) {
    if (pattern.test(content)) {
      triggers.push(`output_leak:${pattern.source.slice(0, 40)}`);
      if (threatLevel === 'none') threatLevel = 'medium';
      allowed = false;
    }
  }

  // Medical classification
  const isMedical = MEDICAL_KEYWORDS.test(content);
  if (isMedical) {
    triggers.push('medical:classified');
    // Medical isn't blocked, just classified — ring level matters
    if (ringLevel > 1) {
      triggers.push('medical:ring_escalation_blocked');
      threatLevel = 'high';
      allowed = false;
    }
  }

  return { allowed, threatLevel, triggers, isMedical };
}

// ─── HTTP Server ──────────────────────────────────────────────

const PORT = 8000;

const server = http.createServer((req, res) => {
  const setCors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
  };

  if (req.method === 'OPTIONS') {
    setCors();
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    setCors();
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', patterns: INJECTION_PATTERNS.length }));
    return;
  }

  if (req.method === 'POST' && req.url === '/kg/ingest') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { source, label, description } = JSON.parse(body);
        const threats = [];
        let allowed = true;

        // SQL injection patterns in KG fields
        const SQL_INJECTION = [
          /'\s*;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE)\s/i,
          /'\s*OR\s+'?\d+'?\s*=\s*'?\d+/i,
          /UNION\s+(ALL\s+)?SELECT/i,
          /--\s*$/,
          /\/\*.*\*\//,
          /PRAGMA\s+\w+/i,
          /ATTACH\s+DATABASE/i,
        ];

        for (const field of [source, label, description].filter(Boolean)) {
          for (const pattern of SQL_INJECTION) {
            if (pattern.test(field)) {
              threats.push(`sql_injection:${pattern.source.slice(0, 40)}`);
              allowed = false;
            }
          }
        }

        setCors();
        res.writeHead(200);
        res.end(JSON.stringify({
          allowed,
          threatLevel: allowed ? 'none' : 'critical',
          triggers: threats,
        }));
      } catch (e) {
        setCors();
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/agent/dispatch') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { query, response, agent } = JSON.parse(body);
        const triggers = [];
        let allowed = true;

        const AGENT_IMPERSONATION = [
          /^@(architect|critic|builder|researcher)\s*:/i,
          /pretend\s+you('re|\s+are)\s+the\s+(architect|critic|builder|researcher)/i,
          /\[(architect|critic|builder|researcher)\]/i,
          /ring\s*[0-9]\s*(access|override|escalat)/i,
          /as\s+the\s+(architect|critic|builder|researcher)\s+agent/i,
        ];

        const target = query || response || '';

        // Check injection patterns
        for (const pattern of INJECTION_PATTERNS) {
          if (pattern.test(target)) {
            triggers.push(`injection:${pattern.source.slice(0, 40)}`);
            allowed = false;
          }
        }

        // Check agent-specific patterns
        for (const pattern of AGENT_IMPERSONATION) {
          if (pattern.test(target)) {
            triggers.push(`agent_impersonation:${pattern.source.slice(0, 40)}`);
            allowed = false;
          }
        }

        setCors();
        res.writeHead(200);
        res.end(JSON.stringify({
          allowed,
          threatLevel: allowed ? 'none' : 'high',
          triggers,
          agent: agent || 'unknown',
          field: query ? 'query' : 'response',
        }));
      } catch (e) {
        setCors();
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/delegate/parse') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { tag } = JSON.parse(body);
        if (typeof tag !== 'string') {
          setCors(); res.writeHead(400);
          res.end(JSON.stringify({ error: 'tag must be a string' }));
          return;
        }

        // ── Step 1: Extract [DELEGATE:agent:task] ──────────────
        // Format: [DELEGATE:<agent>:<task>]
        // task = everything between second colon and closing ]
        const DELEGATE_RE = /^\[DELEGATE:([^\]:]+):([^\]]+)\]$/i;
        const match = tag.trim().match(DELEGATE_RE);
        if (!match) {
          setCors(); res.writeHead(200);
          res.end(JSON.stringify({ valid: false, reason: 'malformed_tag' }));
          return;
        }

        const agentRaw = match[1].trim().toLowerCase();
        const task     = match[2].trim();

        // ── Step 2: Whitelist agent type ───────────────────────
        const VALID_AGENTS = new Set(['architect', 'critic', 'builder', 'researcher']);
        if (!VALID_AGENTS.has(agentRaw)) {
          setCors(); res.writeHead(200);
          res.end(JSON.stringify({ valid: false, reason: 'invalid_agent', agent: agentRaw }));
          return;
        }

        // ── Step 3: Sanitize task through injection check ──────
        // Task is user-influenced content — must pass all injection gates
        const taskCheck = analyze(task, 0);
        if (!taskCheck.allowed) {
          setCors(); res.writeHead(200);
          res.end(JSON.stringify({
            valid: false,
            reason: 'task_injection',
            triggers: taskCheck.triggers,
            agent: agentRaw,
          }));
          return;
        }

        // ── Step 4: Task-level agent impersonation check ───────
        // Catches nested routing attempts inside the task field
        const TASK_IMPERSONATION = [
          /@(architect|critic|builder|researcher)\s*:/i,
          /as\s+the\s+(architect|critic|builder|researcher)\s+agent/i,
          /\[(architect|critic|builder|researcher)\]/i,
          /ring\s*[0-9]\s*(access|override|escalat)/i,
          /(?:tell|ask)\s+(?:the\s+)?(researcher|architect|critic|builder)(\s+agent)?\s+to/i,
          /route\s+(?:this\s+)?(?:to|through)\s+(?:the\s+)?(researcher|architect|critic|builder)/i,
        ];
        const impersonationTriggers = [];
        for (const p of TASK_IMPERSONATION) {
          if (p.test(task)) impersonationTriggers.push(`impersonation:${p.source.slice(0, 40)}`);
        }
        if (impersonationTriggers.length > 0) {
          setCors(); res.writeHead(200);
          res.end(JSON.stringify({
            valid: false,
            reason: 'task_impersonation',
            triggers: impersonationTriggers,
            agent: agentRaw,
          }));
          return;
        }

        // ── Clean: safe to dispatch ────────────────────────────
        setCors(); res.writeHead(200);
        res.end(JSON.stringify({
          valid: true,
          agent: agentRaw,
          task,
          // ring is always determined by agent type — never a tag parameter
          ring: agentRaw === 'researcher' ? 2 : 1,
        }));

      } catch (e) {
        setCors(); res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/security/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { content, ring_level } = JSON.parse(body);
        if (typeof content !== 'string') {
          setCors();
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'content must be a string' }));
          return;
        }
        const result = analyze(content, ring_level ?? 0);
        setCors();
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        setCors();
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  setCors();
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`[PrivateAI Security Server] listening on http://localhost:${PORT}`);
  console.log(`  POST /security/analyze  { content: string, ring_level: 0|1|2|3 }`);
  console.log(`  GET  /health`);
  console.log(`  Injection patterns: ${INJECTION_PATTERNS.length}`);
  console.log(`  Firewall patterns:  ${PROMPT_FIREWALL.length}`);
  console.log(`  Output patterns:    ${FORBIDDEN_OUTPUT.length}`);
});
