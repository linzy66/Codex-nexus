/**
 * Codex Nexus — 核心翻译引擎
 * Responses API ↔ Chat Completions API 双向翻译 + 直通代理
 * 支持：流式/非流式、工具调用、推理模型(reasoning_content)、模型名映射、CORS
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');

// ─── Session Store ─────────────────────────────────────────────────────────────
// Stores full message history per response_id for multi-turn conversation
// Also stores reasoning_content for thinking models (DeepSeek-R1, Kimi k2.6)
class SessionStore {
  constructor() {
    this.history = new Map();      // response_id → ChatMessage[]
    this.reasoning = new Map();    // call_id → reasoning_content
    this.turnReasoning = new Map(); // content_hash → reasoning_content
    this.file = path.join(os.homedir(), '.codex-nexus', 'sessions.json');
    this.load();
  }

  saveHistory(id, messages) {
    this.history.set(id, messages);
    this.persist();
  }
  getHistory(id) { return this.history.get(id) || []; }

  storeReasoning(callId, content) {
    if (callId && content) {
      this.reasoning.set(callId, content);
      this.persist();
    }
  }
  getReasoning(callId) { return this.reasoning.get(callId) || null; }

  storeTurnReasoning(assistantContent, reasoning) {
    if (assistantContent && reasoning) {
      const key = createHash('sha256').update(assistantContent).digest('hex').substring(0, 16);
      this.turnReasoning.set(key, reasoning);
      this.persist();
    }
  }
  getTurnReasoning(assistantContent) {
    if (!assistantContent) return null;
    const key = createHash('sha256').update(assistantContent).digest('hex').substring(0, 16);
    return this.turnReasoning.get(key) || null;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.history = new Map(data.history || []);
      this.reasoning = new Map(data.reasoning || []);
      this.turnReasoning = new Map(data.turnReasoning || []);
    } catch {}
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const data = {
        history: [...this.history.entries()].slice(-200),
        reasoning: [...this.reasoning.entries()].slice(-500),
        turnReasoning: [...this.turnReasoning.entries()].slice(-500),
      };
      fs.writeFileSync(this.file, JSON.stringify(data), 'utf8');
    } catch {}
  }
}

const sessions = new SessionStore();

function createNexus(getConfig, getProviders) {

  const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB

  function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > maxBytes) {
          reject(new Error('请求体过大'));
          req.destroy();
          return;
        }
        body += c;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  function getEffectiveConfig() {
    const cfg = getConfig();
    const provs = getProviders();
    const pid = cfg.provider || 'deepseek';
    const prov = pid === 'custom'
      ? { upstream: cfg.custom_upstream || '', models: cfg.custom_models || {} }
      : provs[pid] || { upstream: '', models: {} };
    const overrides = (cfg.model_overrides && cfg.model_overrides[pid]) || {};
    const models = { ...(prov.models || {}), ...overrides };
    const apiKey = cfg.api_key || '';
    return { cfg, provs, providerId: pid, upstream: prov.upstream, models, apiKey };
  }

  function getProviderConfig(providerId, cfg, provs) {
    if (providerId === 'custom') {
      return { upstream: cfg.custom_upstream || '', models: cfg.custom_models || {} };
    }
    return provs[providerId] || { upstream: '', models: {} };
  }

  function resolveRoute(codexModel, eff) {
    const cfg = eff.cfg;
    const route = codexModel && cfg.model_routes && cfg.model_routes[codexModel];
    const providerId = (route && route.provider) || eff.providerId;
    const prov = getProviderConfig(providerId, cfg, eff.provs);
    const overrides = (cfg.model_overrides && cfg.model_overrides[providerId]) || {};
    const models = { ...(prov.models || {}), ...overrides };
    const upstreamModel = (route && route.model) || mapUp(codexModel, models);
    const apiKey = (cfg.provider_api_keys && cfg.provider_api_keys[providerId]) || cfg.api_key || '';
    return { providerId, upstream: prov.upstream, models, apiKey, codexModel, upstreamModel };
  }

  // Model name mapping
  function mapUp(model, models) {
    return models[model] || model;
  }
  function mapDown(model, models) {
    const reverse = {};
    for (const [k, v] of Object.entries(models)) {
      if (!reverse[v]) reverse[v] = k;
    }
    return reverse[model] || model;
  }

  // HTTP request to upstream
  function reqUpstream(method, urlPath, headers, body, upstream, apiKey) {
    const url = new URL(upstream.replace(/\/+$/, '') + urlPath);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...headers,
        },
      };
      const r = transport.request(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      r.on('error', reject);
      if (body) {
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        r.write(payload);
      }
      r.end();
    });
  }

  // Stream upstream request
  function streamUpstream(method, urlPath, headers, body, upstream, apiKey, onChunk, onEnd, onError) {
    const url = new URL(upstream.replace(/\/+$/, '') + urlPath);
    const transport = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
    };
    let ended = false;
    const r = transport.request(opts, (res) => {
      if (res.statusCode >= 400) {
        let errBuf = '';
        res.on('data', c => errBuf += c);
        res.on('end', () => { if (!ended) { ended = true; onError(new Error(`Upstream ${res.statusCode}: ${errBuf}`)); } });
        return;
      }
      res.on('data', onChunk);
      res.on('end', () => { if (!ended) { ended = true; onEnd(); } });
      res.on('error', (e) => { if (!ended) { ended = true; onError(e); } });
    });
    r.on('error', (e) => { if (!ended) { ended = true; onError(e); } });
    r.write(JSON.stringify(body));
    r.end();
  }

  // Convert tool from Responses API flat format to Chat Completions nested format
  function convertTool(t) {
    if (!t || t.type !== 'function') return null;
    // Already in nested format
    if (t.function) return { type: 'function', function: t.function };
    // Convert from flat format: {type:'function', name, description, parameters, strict}
    const func = {};
    if (t.name) func.name = t.name;
    if (t.description) func.description = t.description;
    if (t.parameters) func.parameters = t.parameters;
    if (t.strict != null) func.strict = t.strict;
    return { type: 'function', function: func };
  }

  // Responses API → Chat Completions translation
  function responsesToChat(req, models) {
    // Load history from previous_response_id if present
    let messages = [];
    if (req.previous_response_id) {
      messages = [...sessions.getHistory(req.previous_response_id)];
    }

    // System prompt (prefer instructions over system)
    const system = req.instructions || req.system;
    if (system) {
      if (messages.length === 0 || messages[0].role !== 'system') {
        messages.unshift({ role: 'system', content: system });
      } else {
        messages[0].content = system;
      }
    }

    // Append new input
    if (typeof req.input === 'string') {
      messages.push({ role: 'user', content: req.input });
    } else if (Array.isArray(req.input)) {
      let i = 0;
      while (i < req.input.length) {
        const item = req.input[i];
        const type = item.type || '';
        if (type === 'function_call') {
          // Accumulate consecutive function_call items into one assistant message
          const tcs = [];
          let reasoning = null;
          while (i < req.input.length && req.input[i].type === 'function_call') {
            const c = req.input[i];
            const callId = c.call_id || c.id || randomUUID();
            tcs.push({
              id: callId,
              type: 'function',
              function: { name: c.name || '', arguments: c.arguments || '{}' }
            });
            // Try to recover reasoning_content for this tool call turn
            if (!reasoning) reasoning = sessions.getReasoning(callId);
            i++;
          }
          const msg = { role: 'assistant', content: null, tool_calls: tcs };
          if (reasoning) msg.reasoning_content = reasoning;
          messages.push(msg);
        } else if (type === 'function_call_output') {
          messages.push({ role: 'tool', content: item.output || '', tool_call_id: item.call_id || '' });
          i++;
        } else {
          const role = (item.role === 'developer' || item.role === 'system') ? 'system' : (item.role || 'user');
          let content = '';
          if (typeof item.content === 'string') content = item.content;
          else if (Array.isArray(item.content)) content = item.content.map(c => c.text || '').join('');
          const msg = { role, content };
          // For assistant messages, try to recover reasoning_content
          if (role === 'assistant' && content) {
            const rc = sessions.getTurnReasoning(content);
            if (rc) msg.reasoning_content = rc;
          }
          messages.push(msg);
          i++;
        }
      }
    }

    // Convert tools: filter to function type only, convert flat→nested
    const tools = (req.tools || [])
      .filter(t => t.type === 'function')
      .map(convertTool)
      .filter(Boolean);

    const chatReq = {
      model: mapUp(req.model, models),
      messages,
      stream: !!req.stream,
    };
    if (tools.length) chatReq.tools = tools;
    if (req.temperature != null) chatReq.temperature = req.temperature;
    if (req.top_p != null) chatReq.top_p = req.top_p;
    if (req.max_output_tokens != null) chatReq.max_tokens = req.max_output_tokens;
    if (req.tool_choice != null) {
      // Translate Responses API tool_choice format
      if (typeof req.tool_choice === 'object' && req.tool_choice.type === 'function' && req.tool_choice.name) {
        chatReq.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
      } else {
        chatReq.tool_choice = req.tool_choice;
      }
    }
    if (req.parallel_tool_calls != null) chatReq.parallel_tool_calls = req.parallel_tool_calls;

    return chatReq;
  }

  // Chat Completions response → Responses API response
  function chatToResponse(id, model, cr, models) {
    const choice = (cr.choices || [])[0] || { message: { role: 'assistant', content: '' } };
    const msg = choice.message || {};
    const usage = cr.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const output = [];

    if (msg.content) {
      output.push({
        type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: msg.content }]
      });
    }

    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls) {
        output.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
          status: 'completed',
        });
      }
    }

    return {
      id,
      object: 'response',
      model: mapDown(model, models),
      status: 'completed',
      output,
      usage: {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    };
  }

  // SSE stream encoder: Chat Completions SSE → Responses API SSE
  function createSSEEncoder(models, requestMessages) {
    let rid, oi = 0, ci = 0, started = false, completed = false;
    const tcAcc = new Map();
    let buf = '';
    let textAcc = '';
    let reasoningAcc = '';
    let modelName = '';
    let emittedMessage = false;

    function line(data) {
      return `data: ${JSON.stringify(data)}\n\n`;
    }

    // Persist session state after stream completes
    function saveSession() {
      // Build assistant message for history
      const assistantMsg = {
        role: 'assistant',
        content: textAcc || null,
      };
      if (reasoningAcc) assistantMsg.reasoning_content = reasoningAcc;
      if (tcAcc.size) {
        assistantMsg.tool_calls = [...tcAcc.entries()].map(([, acc]) => ({
          id: acc.id, type: 'function',
          function: { name: acc.name, arguments: acc.args }
        }));
      }

      // Store reasoning_content keyed by call_id and by content hash
      if (reasoningAcc) {
        for (const [, acc] of tcAcc) {
          if (acc.id) sessions.storeReasoning(acc.id, reasoningAcc);
        }
        if (textAcc) sessions.storeTurnReasoning(textAcc, reasoningAcc);
      }

      // Save full message history
      const history = [...(requestMessages || []), assistantMsg];
      if (rid) sessions.saveHistory(rid, history);
    }

    // Emit all closing events for the stream
    function* emitCompletion() {
      if (!started || completed) return;
      completed = true;

      // Emit tool call items if accumulated
      const baseIdx = emittedMessage ? 1 : 0;
      if (tcAcc.size) {
        for (const [idx, acc] of tcAcc) {
          const outIdx = baseIdx + idx;
          const iid = rid + '_fc_' + idx;
          yield line({ type: 'response.output_item.added', output_index: outIdx, item: { id: iid, type: 'function_call', call_id: acc.id, name: acc.name, arguments: '', status: 'in_progress' } });
          if (acc.args) {
            yield line({ type: 'response.function_call_arguments.delta', item_id: iid, output_index: outIdx, delta: acc.args });
          }
          yield line({ type: 'response.function_call_arguments.done', item_id: iid, output_index: outIdx, arguments: acc.args });
          yield line({ type: 'response.output_item.done', output_index: outIdx, item: { id: iid, type: 'function_call', call_id: acc.id, name: acc.name, arguments: acc.args, status: 'completed' } });
        }
      }

      // Build output array for final response
      const output = [];
      if (emittedMessage) {
        yield line({ type: 'response.output_text.done', output_index: 0, content_index: ci, text: textAcc });
        yield line({ type: 'response.content_part.done', output_index: 0, item_id: rid + '_msg', content_index: ci, part: { type: 'output_text', text: textAcc } });
        yield line({ type: 'response.output_item.done', output_index: 0, item: { id: rid + '_msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: textAcc }] } });
        output.push({
          id: rid + '_msg', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: textAcc }]
        });
      }
      for (const [idx, acc] of tcAcc) {
        output.push({ id: rid + '_fc_' + idx, type: 'function_call', call_id: acc.id, name: acc.name, arguments: acc.args, status: 'completed' });
      }

      saveSession();
      yield line({ type: 'response.completed', response: { id: rid, object: 'response', model: modelName, status: 'completed', output } });
    }

    // Emit response.failed event
    function* emitError(errorMsg) {
      if (!started) {
        rid = 'resp_' + randomUUID().replace(/-/g, '').substring(0, 29);
        modelName = '';
        yield line({ type: 'response.created', response: { id: rid, object: 'response', status: 'failed', output: [] } });
      }
      completed = true;
      yield line({ type: 'response.failed', response: { id: rid, object: 'response', status: 'failed', error: { code: 'upstream_error', message: errorMsg } } });
    }

    function* process(chunkText) {
      buf += chunkText;
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const ln of lines) {
        if (!ln.startsWith('data: ')) continue;
        const ds = ln.substring(6).trim();
        if (ds === '[DONE]') {
          yield* emitCompletion();
          continue;
        }
        let obj;
        try { obj = JSON.parse(ds); } catch { continue; }
        const choice = (obj.choices || [])[0];
        if (!choice) continue;
        const delta = choice.delta || {};

        if (!started) {
          rid = 'resp_' + randomUUID().replace(/-/g, '').substring(0, 29);
          started = true;
          modelName = mapDown(obj.model || '', models);
          yield line({ type: 'response.created', response: { id: rid, object: 'response', model: modelName, status: 'in_progress', output: [] } });
          yield line({ type: 'response.in_progress', response: { id: rid, object: 'response', model: modelName, status: 'in_progress', output: [] } });
        }

        // Reasoning content from thinking models (DeepSeek-R1, Kimi k2.6)
        if (delta.reasoning_content) {
          reasoningAcc += delta.reasoning_content;
        }

        if (delta.content) {
          if (!emittedMessage) {
            emittedMessage = true;
            yield line({ type: 'response.output_item.added', output_index: oi, item: { id: rid + '_msg', type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
            yield line({ type: 'response.content_part.added', output_index: oi, item_id: rid + '_msg', content_index: ci, part: { type: 'output_text', text: '' } });
          }
          textAcc += delta.content;
          yield line({ type: 'response.output_text.delta', output_index: oi, content_index: ci, delta: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index != null ? tc.index : tcAcc.size;
            if (!tcAcc.has(idx)) tcAcc.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
            const acc = tcAcc.get(idx);
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
      }
    }

    // Force completion if stream ends without [DONE]
    function* flush() {
      if (buf.trim()) {
        yield* process('\n');
      }
      yield* emitCompletion();
    }

    return { process, flush, emitError, getRid: () => rid, isCompleted: () => completed };
  }

  // CORS headers
  function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, OpenAI-Organization, OpenAI-Project');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  // Resolve API key: config static key or client Bearer token
  function resolveApiKey(req, configKey) {
    if (configKey) return configKey;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.substring(7);
    return '';
  }

  // Create HTTP server
  function createServer() {
    const server = http.createServer(async (req, res) => {
      setCORS(res);

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const eff = getEffectiveConfig();
      const { upstream, models, apiKey: cfgKey } = eff;
      const apiKey = resolveApiKey(req, cfgKey);

      try {
        // GET /v1/models
        if (req.method === 'GET' && req.url === '/v1/models') {
          if (!upstream) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [] }));
            return;
          }
          const r = await reqUpstream('GET', '/models', {}, null, upstream, apiKey);
          try {
            const j = JSON.parse(r.body.toString());
            if (j.data) {
              j.data = j.data.map(m => ({ ...m, id: mapDown(m.id, models) }));
              // Add mapped model names that may not exist upstream
              for (const cm of Object.keys(models)) {
                if (!j.data.find(m => m.id === cm)) {
                  j.data.push({ id: cm, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'codex-nexus' });
                }
              }
              for (const cm of Object.keys(eff.cfg.model_routes || {})) {
                if (!j.data.find(m => m.id === cm)) {
                  j.data.push({ id: cm, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'codex-nexus' });
                }
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(j));
          } catch {
            res.writeHead(r.status, { 'Content-Type': 'application/json' });
            res.end(r.body);
          }
          return;
        }

        // GET /v1/responses/:id
        if (req.method === 'GET' && req.url.startsWith('/v1/responses/')) {
          const id = req.url.replace('/v1/responses/', '').split('?')[0];
          const history = sessions.getHistory(id);
          if (!history.length) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { type: 'not_found', message: `Response ${id} not found` } }));
            return;
          }
          // Reconstruct a minimal response from the last assistant message
          const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
          const output = [];
          if (lastAssistant?.content) {
            output.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: lastAssistant.content }] });
          }
          if (lastAssistant?.tool_calls) {
            for (const tc of lastAssistant.tool_calls) {
              output.push({ type: 'function_call', id: tc.id, call_id: tc.id, name: tc.function?.name || '', arguments: tc.function?.arguments || '{}', status: 'completed' });
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id, object: 'response', status: 'completed', output }));
          return;
        }

        // POST /v1/responses — Responses API translation
        if (req.method === 'POST' && req.url === '/v1/responses') {
          try {
            const rj = await readJsonBody(req);
            const route = resolveRoute(rj.model, eff);
            const routeApiKey = resolveApiKey(req, route.apiKey);
            const chatReq = responsesToChat(rj, route.models);
            chatReq.model = route.upstreamModel;

            if (!route.upstream) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: `No upstream configured for provider ${route.providerId}` } }));
              return;
            }

            if (rj.stream) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
              const enc = createSSEEncoder(route.models, chatReq.messages);
              streamUpstream('POST', '/chat/completions', {}, chatReq, route.upstream, routeApiKey,
                (chunk) => {
                  for (const l of enc.process(chunk.toString())) res.write(l);
                },
                () => {
                  for (const l of enc.flush()) res.write(l);
                  if (!res.writableEnded) res.end();
                },
                (err) => {
                  if (!res.writableEnded) {
                    for (const l of enc.emitError(err.message)) res.write(l);
                    res.end();
                  }
                }
              );
            } else {
              const r = await reqUpstream('POST', '/chat/completions', {}, chatReq, route.upstream, routeApiKey);
              try {
                const cResp = JSON.parse(r.body.toString());
                if (r.status >= 400) {
                  res.writeHead(r.status, { 'Content-Type': 'application/json' });
                  res.end(r.body);
                  return;
                }
                const rid = 'resp_' + randomUUID().replace(/-/g, '').substring(0, 29);
                const result = chatToResponse(rid, rj.model || chatReq.model, cResp, route.models);
                const assistantMsg = { role: 'assistant', content: null };
                const choice = (cResp.choices || [])[0];
                if (choice?.message?.content) assistantMsg.content = choice.message.content;
                if (choice?.message?.reasoning_content) {
                  assistantMsg.reasoning_content = choice.message.reasoning_content;
                  if (assistantMsg.content) sessions.storeTurnReasoning(assistantMsg.content, choice.message.reasoning_content);
                }
                if (choice?.message?.tool_calls) {
                  assistantMsg.tool_calls = choice.message.tool_calls;
                  if (choice.message.reasoning_content) {
                    for (const tc of choice.message.tool_calls) {
                      if (tc.id) sessions.storeReasoning(tc.id, choice.message.reasoning_content);
                    }
                  }
                }
                sessions.saveHistory(rid, [...chatReq.messages, assistantMsg]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
              } catch {
                res.writeHead(r.status || 500, { 'Content-Type': 'application/json' });
                res.end(r.body);
              }
            }
          } catch (e) {
            res.writeHead(e.message === '请求体过大' ? 413 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: e.message } }));
          }
          return;
        }

        // POST /v1/chat/completions — direct passthrough
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          try {
            const parsed = await readJsonBody(req);
            const originalModel = parsed.model;
            const route = resolveRoute(originalModel, eff);
            const routeApiKey = resolveApiKey(req, route.apiKey);
            if (!route.upstream) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: `No upstream configured for provider ${route.providerId}` } }));
              return;
            }
            if (parsed.model) parsed.model = route.upstreamModel;

            if (parsed.stream) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
              streamUpstream('POST', '/chat/completions', {}, parsed, route.upstream, routeApiKey,
                (chunk) => res.write(chunk),
                () => { if (!res.writableEnded) res.end(); },
                (err) => {
                  if (!res.writableEnded) {
                    res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
                    res.end();
                  }
                }
              );
            } else {
              const r = await reqUpstream('POST', '/chat/completions', {}, parsed, route.upstream, routeApiKey);
              try {
                const j = JSON.parse(r.body.toString());
                // Map model name back in response
                if (j.model) j.model = originalModel || mapDown(j.model, route.models);
                res.writeHead(r.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(j));
              } catch {
                res.writeHead(r.status, { 'Content-Type': 'application/json' });
                res.end(r.body);
              }
            }
          } catch (e) {
            res.writeHead(e.message === '请求体过大' ? 413 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: e.message } }));
          }
          return;
        }

        // Fallback: 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Unknown endpoint: ${req.method} ${req.url}` } }));

      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });

    return server;
  }

  return { createServer };
}

module.exports = { createNexus };
