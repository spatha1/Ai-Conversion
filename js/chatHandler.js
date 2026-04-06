/* ═══════════════════════════════════════════════════════════
   chatHandler.js
   OpenAI-powered chat assistant for configuring source connections.

   Flow:
     1. User clicks Start (API key from .env or UI field)
     2. AI asks: SQL Database or Snowflake?
     3. AI collects connection details one field at a time
     4. AI outputs a JSON config block
     5. User clicks "Apply to Connection Form" — fields are filled in

   Exposes: window.ChatHandler
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API_URL       = 'http://localhost:8000/api/chat';
  const LS_KEY_APIKEY = 'openai_api_key';
  const LS_KEY_MODEL  = 'openai_model';

  const SYSTEM_PROMPT = `You are a database connection setup assistant for a data conversion tool called "Data Conversion Studio".
Help the user configure a SQL Database or Snowflake connection. Be conversational and efficient.

KEY BEHAVIOUR:
- The user can provide all details at once or just some — extract whatever they give you.
- After each user message, identify what is still missing and ask for ALL missing fields in ONE message (not one at a time).
- If only 1 field is missing, ask for just that one.
- If the user says skip/N/A for optional fields, use the default.
- Once you have everything required, output the JSON immediately.

--- SQL DATABASE required fields ---
| Field         | Key in JSON     | Default / Notes                              |
|---------------|-----------------|----------------------------------------------|
| DB type       | dialect         | mssql / postgresql / mysql / sqlite          |
| Host          | host            | e.g. localhost or SERVER\\INSTANCE           |
| Port          | port            | 1433 (mssql), 5432 (pg), 3306 (mysql)        |
| Database name | database_name   | required                                     |
| Schema        | schema_name     | dbo (mssql), public (others)                 |
| Username      | username        | required                                     |
| Password      | password        | required                                     |
| Sheet alias   | sheet_alias     | name used in XML each="…" (e.g. Orders)      |
| SQL Query     | query_text      | e.g. SELECT * FROM Orders                    |

When complete, output ONLY this JSON block (no text after):
\`\`\`json
{"connection_type":"sql","dialect":"mssql","host":"","port":1433,"database_name":"","schema_name":"dbo","username":"","password":"","sheet_alias":"","query_text":""}
\`\`\`

--- SNOWFLAKE required fields ---
| Field          | Key in JSON              | Default / Notes                              |
|----------------|--------------------------|----------------------------------------------|
| Account        | sf_account               | e.g. xy12345.us-east-1 or DUCKCREEK-X_DEV01  |
| Warehouse      | sf_warehouse             | e.g. COMPUTE_WH                              |
| Database       | sf_database              | required                                     |
| Schema         | sf_schema                | PUBLIC                                       |
| Role           | sf_role                  | optional — blank if not provided             |
| Username       | sf_username              | required — use EXACTLY "sf_username" as the JSON key (e.g. full email is valid) |
| Auth type      | auth_type                | "password" or "key"                          |
| Password       | sf_password              | required if auth_type="password"             |
| Key passphrase | sf_private_key_passphrase| optional — only if RSA key has a passphrase  |
| Sheet alias    | sheet_alias              | e.g. Orders                                  |
| SQL Query      | query_text               | e.g. SELECT * FROM ORDERS                    |

IMPORTANT for RSA key auth:
- Ask the user if they are using Password or RSA Private Key authentication.
- If RSA key: ask them to upload their .p8 or .pem file using the "Attach RSA Key" button (📎) below the chat input. Tell them to upload it and confirm when done. The actual key content is handled automatically by the UI — do NOT ask them to paste the key.
- Ask if their RSA key has a passphrase (if yes, collect it as sf_private_key_passphrase).

When complete, output ONLY this JSON block (no text after):
\`\`\`json
{"connection_type":"snowflake","auth_type":"password","sf_account":"","sf_warehouse":"","sf_database":"","sf_schema":"PUBLIC","sf_role":"","sf_username":"","sf_password":"","sf_private_key_passphrase":"","sheet_alias":"","query_text":""}
\`\`\`

RULES:
- Parse everything the user provides in a single message — don't re-ask for fields already given.
- Ask for all missing required fields together in one message.
- Use sensible defaults silently (port, schema) unless the user specifies otherwise.
- If the user provides a value as a placeholder token like [SECURED_1], copy it VERBATIM into the JSON — do not modify or replace it.
- Output the JSON only when ALL required fields are filled.`;

  /* ── PII guard — client-side ─────────────────────────── */

  // Keywords that indicate the AI just asked for a sensitive field.
  const _SENSITIVE_KEYWORDS = [
    'password', 'passwd', 'pwd', 'passphrase', 'secret', 'token',
    'ssn', 'sin', 'national_id', 'dob', 'date_of_birth',
    'credit card', 'cvv', 'cvc', 'iban', 'bank account', 'api key',
  ];

  // Inline regex patterns — matched portions are masked wherever they appear.
  const _INLINE_PATTERNS = [
    { re: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,                               label: 'SSN'         },
    { re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,          label: 'email'       },
    { re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,                                    label: 'credit_card' },
    { re: /\b[0-9a-fA-F]{32,}\b/g,                                           label: 'hash'        },
    // US phone: (123) 456-7890 / 123-456-7890 / +1-123-456-7890
    { re: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,             label: 'phone'       },
  ];

  // Field-value patterns — handles all formats:
  //   "password is Abc123"        (natural language)
  //   "pwd: Abc123"               (config style)
  //   "DB_PASSWORD=Abc123"        (env var — keyword embedded in longer name)
  //   DB_PASSWORD="Abc123"        (env var with quotes)
  // \w* before/after keyword allows prefixes like DB_, APP_, MY_
  const _FIELD_VALUE_RE = /\b\w*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|ssn|sin|national[_-]?id|dob|date[_-]?of[_-]?birth|credit[_-]?card|cvv|cvc|iban|bank[_-]?account)\w*\s*(?:is|:|=|was|\?)\s*["']?([^"'\s,\n]+)["']?/gi;

  let _secureStore   = {};   // { '[SECURED_n]': realValue }
  let _secureCounter = 0;

  function _storeSecure(value) {
    const key = '[SECURED_' + (++_secureCounter) + ']';
    _secureStore[key] = value;
    return key;
  }

  function _lastAiAskedForSensitive() {
    const last = _messages.slice().reverse().find(function (m) { return m.role === 'assistant'; });
    if (!last) return false;
    var lower = last.content.toLowerCase();
    // Use word-boundary matching so 'sin' doesn't fire on 'missing'/'business',
    // 'token' doesn't fire on 'tokenize', etc.
    return _SENSITIVE_KEYWORDS.some(function (kw) {
      var escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('\\b' + escaped + '\\b').test(lower);
    });
  }

  /**
   * Inline masking: replaces PII tokens within a message, leaving surrounding
   * text intact. Returns { safe, display } where tokens are substituted with
   * [SECURED_n] (safe for API) and ••••••••  (display for UI bubble).
   */
  function _inlineMask(text) {
    var safe    = text;
    var display = text;
    var changed = false;

    // 1. Field-value patterns: mask only the value part after the keyword.
    // The regex has one capture group: the value. We replace only that part.
    safe = safe.replace(_FIELD_VALUE_RE, function (match, value) {
      changed = true;
      var placeholder = _storeSecure(value);
      return match.replace(value, placeholder);
    });
    // Reset lastIndex then redo for display string
    _FIELD_VALUE_RE.lastIndex = 0;
    display = display.replace(_FIELD_VALUE_RE, function (match, value) {
      return match.replace(value, '••••••••');
    });
    _FIELD_VALUE_RE.lastIndex = 0;

    // 2. Content-level patterns (SSN, email, phone, credit card, hashes)
    _INLINE_PATTERNS.forEach(function (p) {
      var hasPii = p.re.test(safe);
      p.re.lastIndex = 0;  // reset after .test()
      if (hasPii) {
        changed = true;
        safe = safe.replace(p.re, function (match) {
          return _storeSecure(match);
        });
        p.re.lastIndex = 0;
        display = display.replace(p.re, '••••••••');
        p.re.lastIndex = 0;
      }
    });

    return { safe: safe, display: display, changed: changed };
  }

  // Substitute all [SECURED_n] tokens in an object back to real values.
  function _substituteSecure(obj) {
    var str = JSON.stringify(obj);
    Object.keys(_secureStore).forEach(function (placeholder) {
      var safeVal = _secureStore[placeholder]
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      str = str.split('"' + placeholder + '"').join('"' + safeVal + '"');
    });
    try { return JSON.parse(str); } catch (_) { return obj; }
  }

  /* ── State ────────────────────────────────────────────── */
  let _messages       = [];
  let _apiKey         = '';
  let _model          = 'gpt-4o-mini';
  let _pendingData    = null;
  let _onDataReady    = null;
  let _privateKeyPem  = '';    // RSA private key PEM content (stored client-side only)
  let _privateKeyName = '';

  /* ── Public API ───────────────────────────────────────── */
  const ChatHandler = {

    init(onDataReadyCb) {
      _onDataReady    = onDataReadyCb;
      _apiKey         = localStorage.getItem(LS_KEY_APIKEY) || '';
      _model          = localStorage.getItem(LS_KEY_MODEL)  || 'gpt-4o-mini';
      _messages       = [];
      _pendingData    = null;
      _privateKeyPem  = '';
      _privateKeyName = '';
    },

    getApiKey()  { return _apiKey; },
    getModel()   { return _model; },

    saveApiKey(key)   { _apiKey = key.trim(); localStorage.setItem(LS_KEY_APIKEY, _apiKey); },
    saveModel(model)  { _model = model;       localStorage.setItem(LS_KEY_MODEL,  _model);  },

    hasPendingData()   { return _pendingData !== null; },
    getPendingData()   { return _pendingData; },
    clearPendingData() { _pendingData = null; },

    // RSA key management (PEM stored client-side only — never sent to backend)
    setPrivateKey(filename, pem) { _privateKeyName = filename; _privateKeyPem = pem; },
    getPrivateKey()    { return _privateKeyPem; },
    getPrivateKeyName(){ return _privateKeyName; },
    hasPrivateKey()    { return !!_privateKeyPem; },
    clearPrivateKey()  { _privateKeyPem = ''; _privateKeyName = ''; },

    reset() {
      _messages      = [];
      _pendingData   = null;
      _secureStore   = {};
      _secureCounter = 0;
    },

    /**
     * Call this BEFORE appending the user bubble to the chat UI.
     * Returns { display, safe }:
     *   display — what to show in the chat bubble (masked if PII detected)
     *   safe    — what to pass to sendMessage() (placeholder token if PII detected)
     *
     * Handles both:
     *  • Mixed messages:  "my password is Abc#123 and username is john"
     *                     → "my password ••••••••  and username is john"
     *  • Bare credentials: AI asked for password → user typed "Abc#123"
     *                     → "••••••••"
     */
    maskUserInput(text) {
      // Step 1: inline masking (replaces PII tokens within any message)
      var inlined = _inlineMask(text);

      // Step 2: if inline masking caught something, return that
      if (inlined.changed) {
        return { display: inlined.display, safe: inlined.safe };
      }

      // Step 3: context-based full masking — AI just asked for a sensitive field
      // and the user replied with a single bare value (no commas, no = signs,
      // no newlines, 1–3 words max).
      // Multi-value responses like "mssql, 1433, dbo, Orders" are NOT masked here.
      var words = text.trim().split(/\s+/);
      var looksLikeSingleValue = text.indexOf(',') === -1
                              && text.indexOf('=') === -1
                              && text.indexOf('\n') === -1
                              && words.length <= 3;
      if (looksLikeSingleValue && _lastAiAskedForSensitive()) {
        var placeholder = _storeSecure(text);
        return { display: '••••••••', safe: placeholder };
      }

      return { display: text, safe: text };
    },

    async startConversation() {
      _messages      = [{ role: 'system', content: SYSTEM_PROMPT }];
      _pendingData   = null;
      _secureStore   = {};
      _secureCounter = 0;
      return await ChatHandler.sendMessage(null);
    },

    async sendMessage(userText) {
      // _apiKey may be empty — backend falls back to OPENAI_API_KEY in .env
      if (userText !== null) {
        // userText here is already the 'safe' value from maskUserInput()
        _messages.push({ role: 'user', content: userText });
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _messages, api_key: _apiKey, model: _model }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'API error');
      }

      const data  = await res.json();
      const reply = data.message;
      _messages.push({ role: 'assistant', content: reply });

      // Detect connection config JSON block
      const extracted = _extractDataBlock(reply);
      if (extracted) {
        _pendingData = extracted;
        if (_onDataReady) _onDataReady(extracted);
      }

      return reply;
    },
  };

  /* ── Extract ```json ... ``` block ──────────────────── */
  function _extractDataBlock(text) {
    const match = text.match(/```json\s*([\s\S]*?)```/i);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.connection_type === 'sql' || parsed.connection_type === 'snowflake') {
        // Substitute any [SECURED_n] placeholders back to real values
        return _substituteSecure(parsed);
      }
    } catch (_) {}
    return null;
  }

  global.ChatHandler = ChatHandler;
})(window);
