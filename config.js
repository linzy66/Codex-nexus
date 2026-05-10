const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.codex-nexus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  provider: 'deepseek',
  api_key: '',
  provider_api_keys: {},
  custom_upstream: '',
  model_overrides: {},
  model_routes: {},
  port: 5800,
  host: '0.0.0.0',
  autostart_nexus: true,
  codex_config_auto: true,
  codex_config_switch_default: false,
};

let config = { ...DEFAULT_CONFIG };

function ensureDir() {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
}

function load() {
  ensureDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } else {
      config = { ...DEFAULT_CONFIG };
      save();
    }
  } catch (e) {
    console.warn('[config] Load failed, using defaults:', e.message);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

function save(newCfg) {
  if (newCfg) config = { ...config, ...newCfg };
  ensureDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] Save failed:', e.message);
  }
  return config;
}

function get() {
  return config;
}

function getConfigPath() {
  return CONFIG_FILE;
}

// Get the first model name from current mappings
function getFirstModelName() {
  const pid = config.provider || 'deepseek';
  const overrides = (config.model_overrides && config.model_overrides[pid]) || {};
  const keys = Object.keys(overrides);
  if (keys.length) return keys[0];
  return 'gpt-4.1';
}

// Write CODEX_NEXUS_KEY into ~/.codex/auth.json
function ensureNexusAuthKey() {
  const codexDir = path.join(os.homedir(), '.codex');
  const authPath = path.join(codexDir, 'auth.json');

  try { fs.mkdirSync(codexDir, { recursive: true }); } catch {}

  let authData = {};
  try {
    if (fs.existsSync(authPath)) {
      authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    }
  } catch {}

  // Add or update the nexus key
  authData['CODEX_NEXUS_KEY'] = 'sk-codex-nexus-local';

  try {
    fs.writeFileSync(authPath, JSON.stringify(authData, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] Failed to write auth.json:', e.message);
  }
}

// Update ~/.codex/config.toml with the nexus provider
function updateCodexConfig() {
  const codexDir = path.join(os.homedir(), '.codex');
  const codexCfg = path.join(codexDir, 'config.toml');
  const port = config.port || 5800;
  const modelName = getFirstModelName();

  try { fs.mkdirSync(codexDir, { recursive: true }); } catch {}

  const nexusBlock = `
[model_providers.codex-nexus]
name = "Codex Nexus"
base_url = "http://127.0.0.1:${port}/v1"
env_key = "CODEX_NEXUS_KEY"
wire_api = "responses"
`;

  const shouldSwitchDefault = config.codex_config_switch_default === true;

  if (fs.existsSync(codexCfg)) {
    let content = fs.readFileSync(codexCfg, 'utf8');
    // Remove existing nexus block if present
    content = content.replace(/\[model_providers\.codex-nexus\][\s\S]*?(?=\n\[|$)/, '');
    if (shouldSwitchDefault) {
      // Update or add model
      if (/^\s*model\s*=/m.test(content)) {
        content = content.replace(/^(\s*model\s*=\s*).*$/m, `$1"${modelName}"`);
      } else {
        content = `model = "${modelName}"\n` + content;
      }
      // Update or add model_provider
      if (/^\s*model_provider\s*=/m.test(content)) {
        content = content.replace(/^(\s*model_provider\s*=\s*).*$/m, `$1"codex-nexus"`);
      } else {
        content = `model_provider = "codex-nexus"\n` + content;
      }
    }
    content = content.trimEnd() + '\n' + nexusBlock;
    fs.writeFileSync(codexCfg, content, 'utf8');
  } else {
    const content = shouldSwitchDefault
      ? `model = "${modelName}"\nmodel_provider = "codex-nexus"\n` + nexusBlock
      : nexusBlock.trimStart();
    fs.writeFileSync(codexCfg, content, 'utf8');
  }

  // Write nexus key to ~/.codex/auth.json
  ensureNexusAuthKey();
}

module.exports = { load, save, get, getConfigPath, updateCodexConfig, CONFIG_DIR };
