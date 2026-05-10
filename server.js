/**
 * Codex Nexus — 主入口
 * 同时提供：
 *   1. Nexus API 服务 (默认端口 5800) — 给 Codex CLI/IDE/App 使用
 *   2. Web 配置界面 (默认端口 5801) — 用浏览器配置所有参数
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createNexus } = require('./nexus');

// Load providers
function loadProviders() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'providers.json'), 'utf8'));
  } catch (e) {
    console.error('[providers] Load failed:', e.message);
    return {};
  }
}

let providers = loadProviders();
config.load();

// Create nexus
const nexus = createNexus(() => config.get(), () => providers);
let nexusServer = null;
let nexusPort = null;

// Start nexus server
function startNexus() {
  return new Promise((resolve, reject) => {
    const cfg = config.get();
    const port = cfg.port || 5800;
    const host = cfg.host || '0.0.0.0';

    if (nexusServer) {
      try { nexusServer.close(); } catch {}
      nexusServer = null;
    }

    nexusServer = nexus.createServer();
    nexusServer.listen(port, host, () => {
      nexusPort = port;
      console.log(`[nexus] Codex Nexus 运行中: http://${host}:${port}`);
      console.log(`[nexus] API 端点: http://127.0.0.1:${port}/v1`);
      console.log(`[nexus] 兼容: Codex CLI, Codex IDE, Codex App`);
      resolve();
    });
    nexusServer.on('error', (e) => {
      console.error(`[nexus] 启动失败:`, e.message);
      nexusServer = null;
      reject(e);
    });
  });
}

// Stop nexus server
function stopNexus() {
  return new Promise((resolve) => {
    if (nexusServer) {
      nexusServer.close(() => resolve());
      nexusServer = null;
      nexusPort = null;
    } else {
      resolve();
    }
  });
}

// Restart nexus server
async function restartNexus() {
  await stopNexus();
  await startNexus();
}

// Fetch upstream models
async function fetchUpstreamModels(upstreamUrl, apiKey) {
  if (!upstreamUrl) {
    const cfg = config.get();
    const pid = cfg.provider || 'deepseek';
    const prov = pid === 'custom'
      ? { upstream: cfg.custom_upstream || '' }
      : providers[pid] || { upstream: '' };
    upstreamUrl = prov.upstream;
    if (!apiKey) apiKey = cfg.api_key;
  }

  if (!upstreamUrl) return { error: '未配置上游地址' };

  let url;
  try {
    url = new URL(upstreamUrl.replace(/\/+$/, '') + '/models');
  } catch (e) {
    return { error: '无效的上游 URL: ' + e.message };
  }
  const transport = url.protocol === 'https:' ? require('https') : require('http');

  return new Promise((resolve) => {
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeout: 15000,
    };
    const r = transport.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (parsed.error) resolve({ error: typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || 'API 错误') });
          else resolve({ models: (parsed.data || []).map(m => m.id) });
        } catch {
          if (d.trimStart().startsWith('<')) {
            resolve({ error: '该上游不支持 /models 接口（返回了 HTML 页面）。请手动输入模型名。' });
          } else {
            resolve({ error: '解析响应失败，上游返回: ' + d.substring(0, 150) });
          }
        }
      });
    });
    r.on('timeout', () => { r.destroy(); resolve({ error: '请求超时 (15s)' }); });
    r.on('error', (e) => resolve({ error: '网络错误: ' + e.message }));
    r.end();
  });
}

// Web config server
function createConfigServer() {
  const configPort = (config.get().port || 5800) + 1;

  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // API routes
    if (req.url === '/nexus-ctrl/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config: config.get(), providers }));
      return;
    }

    if (req.url === '/nexus-ctrl/config' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { config: newCfg, restart, updateCodex } = JSON.parse(body);
          config.save(newCfg);
          if (updateCodex) {
            try { config.updateCodexConfig(); } catch (e) { console.warn('[codex] Config update failed:', e.message); }
          }
          if (restart) {
            try { await restartNexus(); } catch (e) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: e.message }));
              return;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (req.url === '/nexus-ctrl/config/reset' && req.method === 'POST') {
      config.save({
        provider: 'deepseek', api_key: '', provider_api_keys: {},
        custom_upstream: '', model_overrides: {}, model_routes: {},
        port: 5800, host: '0.0.0.0',
        autostart_nexus: true, codex_config_auto: true,
        codex_config_switch_default: false,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/nexus-ctrl/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: !!nexusServer, port: nexusPort }));
      return;
    }

    if (req.url === '/nexus-ctrl/models' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { upstream, api_key } = JSON.parse(body);
          const result = await fetchUpstreamModels(upstream, api_key);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.url === '/nexus-ctrl/codex-models' && req.method === 'GET') {
      const cfg = config.get();
      const modelSet = new Set(['gpt-4.1', 'gpt-4o', 'o3', 'o4-mini']);
      for (const p of Object.values(providers)) {
        for (const m of Object.keys(p.models || {})) modelSet.add(m);
      }
      for (const providerModels of Object.values(cfg.model_overrides || {})) {
        for (const m of Object.keys(providerModels || {})) modelSet.add(m);
      }
      for (const m of Object.keys(cfg.model_routes || {})) modelSet.add(m);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, models: [...modelSet].sort().map(id => ({ id })) }));
      return;
    }

    if (req.url === '/nexus-ctrl/shutdown' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '所有服务正在关闭...' }));
      console.log('\n[shutdown] 收到网页端关闭请求，正在停止所有服务...');
      setTimeout(async () => {
        await stopNexus();
        server.close();
        process.exit(0);
      }, 500);
      return;
    }

    // Serve static files (with path traversal protection)
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';
    const publicDir = path.join(__dirname, 'public');
    const filePath = path.resolve(publicDir, '.' + urlPath);

    // Prevent path traversal attacks
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    const contentType = mimeTypes[ext] || 'text/plain';

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const headers = { 'Content-Type': contentType + '; charset=utf-8' };
        if (ext === '.html') {
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
          headers['Pragma'] = 'no-cache';
        }
        res.writeHead(200, headers);
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch {
      res.writeHead(500);
      res.end('Server Error');
    }
  });

  return { server, port: configPort };
}

// Main
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║        Codex Nexus v1.1.0                     ║');
  console.log('║  支持 Codex CLI / IDE / App                     ║');
  console.log('║  使用任何兼容 OpenAI 的模型                     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Start nexus
  try {
    await startNexus();
  } catch (e) {
    console.error('[nexus] 启动失败，请检查端口是否被占用:', e.message);
  }

  // Start config web UI
  const { server: configServer, port: configPort } = createConfigServer();
  configServer.listen(configPort, '127.0.0.1', () => {
    console.log('');
    console.log(`[web] 配置界面: http://127.0.0.1:${configPort}`);
    console.log(`[web] 在浏览器中打开上面的地址来配置 Nexus`);
    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log('  按 Ctrl+C 停止所有服务');
    console.log('─────────────────────────────────────────────');
  });
  configServer.on('error', (e) => {
    console.error(`[web] 配置界面启动失败 (端口 ${configPort}):`, e.message);
    // Try next port
    const altPort = configPort + 1;
    configServer.listen(altPort, '127.0.0.1', () => {
      console.log(`[web] 配置界面 (备用端口): http://127.0.0.1:${altPort}`);
    });
  });

  // Auto-update codex config on first run (no need for api_key — local models don't require one)
  const cfg = config.get();
  if (cfg.codex_config_auto) {
    try {
      config.updateCodexConfig();
      console.log('[codex] 已自动更新 ~/.codex/config.toml');
    } catch {}
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[shutdown] 正在停止...');
    await stopNexus();
    configServer.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await stopNexus();
    configServer.close();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('启动错误:', e);
  process.exit(1);
});
