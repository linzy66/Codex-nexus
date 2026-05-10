<div align="center">

# Codex Nexus

**让 [Codex CLI](https://github.com/openai/codex) / IDE / App 使用任何兼容 OpenAI 的 AI 模型**

**Use any OpenAI-compatible AI model with [Codex CLI](https://github.com/openai/codex) / IDE / App**

🔀 协议翻译 Protocol Translation · 🎛️ Web 配置 Web Config · 🔑 多密钥 Multi-Key · 🗺️ 智能路由 Smart Routing

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Zero_Deps-Pure_Node.js-brightgreen)](#)
[![License](https://img.shields.io/badge/License-Use--Only-red.svg)](LICENSE)

</div>

---

## 目录 / Table of Contents

- [为什么需要它 / Why You Need It](#为什么需要它--why-you-need-it)
- [核心特性 / Features](#核心特性--features)
- [支持的提供商 / Supported Providers](#支持的提供商--supported-providers)
- [快速开始 / Quick Start](#快速开始--quick-start)
- [工作原理 / How It Works](#工作原理--how-it-works)
- [API 端点 / API Endpoints](#api-端点--api-endpoints)
- [配置详解 / Configuration](#配置详解--configuration)
- [Web 配置界面 / Web Config UI](#web-配置界面--web-config-ui)
- [安全说明 / Security](#安全说明--security)
- [开发指南 / Development](#开发指南--development)
- [常见问题 / FAQ](#常见问题--faq)
- [卸载 / Uninstall](#卸载--uninstall)
- [许可证 / License](#许可证--license)

---

## 为什么需要它 / Why You Need It

OpenAI [Codex](https://github.com/openai/codex) 使用私有的 **Responses API** 协议，而 DeepSeek、Kimi、通义千问等绝大多数 AI 提供商只支持标准的 **Chat Completions API**。两者协议格式、事件流、工具调用结构完全不同。

OpenAI [Codex](https://github.com/openai/codex) uses a proprietary **Responses API** protocol, while most AI providers (DeepSeek, Kimi, Qwen, etc.) only support the standard **Chat Completions API**. The two protocols differ in format, event streams, and tool call structures.

**Codex Nexus** 充当智能协议翻译层 / acts as an intelligent protocol translation layer：

- 将 Codex 的 `Responses API` 请求实时翻译成 `Chat Completions API`
  Translates Codex `Responses API` requests into `Chat Completions API` in real-time
- 将上游的流式 SSE 响应精确映射回 Responses API 事件序列
  Maps upstream SSE responses back to Responses API event sequences
- 完整保留多轮对话历史、工具调用、推理内容
  Preserves multi-turn conversation history, tool calls, and reasoning content
- **无需修改 Codex 的任何代码**，零侵入
  **Zero modification** to Codex source code required

```
┌─────────────────┐      ┌─────────────────┐      ┌──────────────────┐
│  Codex CLI/IDE  │─────▶│   Codex Nexus   │─────▶│  DeepSeek / Kimi │
│  / Codex App    │◀─────│   :5800         │◀─────│  / Qwen / ...    │
└─────────────────┘      └─────────────────┘      └──────────────────┘
    Responses API          ↕ Translation            Chat Completions
                           Web Config :5801
```

---

## 核心特性 / Features

| 特性 Feature | 说明 Description |
|---|---|
| **零依赖 Zero Deps** | 纯 Node.js 原生模块，无需 `npm install`，复制即用。Pure Node.js, no `npm install` needed, copy and run. |
| **协议翻译 Protocol Translation** | Responses API ↔ Chat Completions API 完整双向翻译。Full bidirectional translation between the two API protocols. |
| **Web 配置界面 Web Config UI** | 内置 HUD 风格配置面板，浏览器中完成全部设置。Built-in HUD-style config panel, configure everything in browser. |
| **多提供商聚合 Multi-Provider** | 支持 10+ 主流提供商 + 任意自定义端点。10+ built-in providers + any custom OpenAI-compatible endpoint. |
| **模型智能路由 Smart Routing** | 按 Codex 模型名自动路由到不同提供商。Route different Codex model names to different providers automatically. |
| **多密钥管理 Multi-Key** | 每个提供商可配置独立 API Key。Independent API Key per provider via `provider_api_keys`. |
| **模型名映射 Model Mapping** | Codex 请求 `gpt-4.1` 自动映射为上游实际模型名。Maps `gpt-4.1` to the actual upstream model name. |
| **流式传输 Streaming** | 精确的 SSE 事件序列翻译，兼容所有 Codex 客户端。Precise SSE event translation, compatible with all Codex clients. |
| **多轮对话 Multi-Turn** | 完整的 `previous_response_id` 会话历史持久化。Full session history persistence via `previous_response_id`. |
| **工具调用 Tool Calls** | 支持 function calling、并行工具调用、tool_choice 转换。Supports function calling, parallel tool calls, and tool_choice. |
| **推理模型 Reasoning** | 支持 `reasoning_content` 回传（DeepSeek-R1、Kimi k2.6）。Supports `reasoning_content` passthrough for thinking models. |
| **CORS** | Codex App（Web 端）可直接跨域访问。Codex App (web) can access directly via CORS. |
| **密钥转发 Key Forwarding** | 未配置静态密钥时，自动透传客户端 Bearer Token。Auto-forwards client Bearer Token when no static key is configured. |
| **自动配置 Auto Config** | 启动时自动注入 `~/.codex/config.toml` + `~/.codex/auth.json`。Auto-injects Codex config files on startup. |
| **安全 Security** | 路径遍历防护、密钥仅本地存储、会话数据不离境。Path traversal protection, keys stored locally only, data never leaves. |

---

## 支持的提供商 / Supported Providers

| ID | 名称 Name | 上游地址 Upstream | 默认映射 Default Mapping |
|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `gpt-4.1` → `deepseek-chat` |
| `kimi` | Kimi (Moonshot) | `https://api.moonshot.cn/v1` | `gpt-4.1` → `kimi-k2.6` |
| `qwen` | 通义千问 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `gpt-4.1` → `qwen-plus` |
| `mistral` | Mistral AI | `https://api.mistral.ai/v1` | `gpt-4.1` → `mistral-large-latest` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `gpt-4.1` → `llama-3.3-70b-versatile` |
| `xai` | xAI (Grok) | `https://api.x.ai/v1` | `gpt-4.1` → `grok-3` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `gpt-4.1` → `deepseek/deepseek-chat` |
| `ollama` | Ollama (本地 Local) | `http://localhost:11434/v1` | 本地模型 Local models |
| `lmstudio` | LM Studio (本地 Local) | `http://localhost:1234/v1` | 本地模型 Local models |
| `custom` | 自定义 Custom | 用户填写 User-defined | 用户配置 User config |

> 所有商标均属于其各自所有者，本项目与上述任何公司无关联关系。
> All trademarks belong to their respective owners. This project is not affiliated with any of the above companies.

---

## 快速开始 / Quick Start

### 前置要求 / Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- 一个兼容 OpenAI 的 API Key（如 DeepSeek、Kimi 等）
  An OpenAI-compatible API Key (e.g. DeepSeek, Kimi)

### 1. 下载并启动 / Download & Start

```bash
# 克隆仓库 / Clone the repo
git clone https://github.com/linzy66/Codex-nexus.git
cd Codex-nexus

# 直接启动，零依赖 / Start directly, zero dependencies
node server.js
```

> **Windows 用户 / Windows Users**：双击 `start.cmd` 或运行 `start.ps1`。
> Double-click `start.cmd` or run `start.ps1`.

### 2. 打开 Web 配置界面 / Open Web Config

启动后会显示 / After startup you will see：

```
[nexus] Codex Nexus 运行中: http://0.0.0.0:5800
[web]  配置界面: http://127.0.0.1:5801
```

在浏览器中打开 / Open in browser: `http://127.0.0.1:5801`

### 3. 在浏览器中完成配置 / Configure in Browser

1. **核心链路配置 Core Config** → 选择提供商 Select provider（如 DeepSeek）
2. 填写 API Key / Enter your API Key
3. **模型路由配置 Model Routing** → 确认/修改模型映射 Confirm/edit model mappings
4. 点击 Click **「💾 保存当前部署图纸」** 或 or **「🔄 执行保存并热重启」**

完成！Codex 将自动通过 Nexus 使用你选择的模型。
Done! Codex will now automatically use your chosen model through Nexus.

---

## 工作原理 / How It Works

### 双服务架构 / Dual-Service Architecture

Codex Nexus 同时运行两个 HTTP 服务 / runs two HTTP services simultaneously：

| 服务 Service | 端口 Port | 用途 Purpose |
|---|---|---|
| **Nexus API** | `5800` (可配置 configurable) | Codex CLI/IDE/App 的 API 端点 API endpoint for Codex |
| **Web Config** | `Nexus port + 1` | 浏览器中的 HUD 配置面板 HUD config panel in browser |

### 协议翻译流程 / Protocol Translation Flow

```
┌─────────────┐    POST /v1/responses    ┌──────────────┐
│  Codex CLI  │─────────────────────────▶│  Codex Nexus │
│             │  {model, input,            │              │
│             │   previous_response_id,    │  1. resolveRoute()
│             │   tools, stream}           │  2. responsesToChat()
└─────────────┘                            │  3. reqUpstream()
                                           │      │
                                           │      ▼
                                           │  ┌──────────────┐
                                           │  │ DeepSeek API │
                                           │  │ /chat/comp.  │
                                           │  └──────────────┘
                                           │      │
                                           │  4. createSSEEncoder()
                                           │      │
┌─────────────┐    SSE stream              │      ▼
│  Codex CLI  │◀───────────────────────────│  Responses API
│             │  response.output_text.delta │  event sequence
│             │  response.completed          │
└─────────────┘                            └──────────────┘
```

### 请求生命周期 / Request Lifecycle

1. **路由解析 Route Resolution** (`resolveRoute`)：根据 Codex 模型名解析目标提供商、上游 URL、实际模型名、API Key。Resolves target provider, upstream URL, actual model name, and API Key based on the requested Codex model name.
2. **协议翻译 Protocol Translation** (`responsesToChat`)：将 Responses API 的 `input`、`tools`、`tool_choice` 转换为 Chat Completions 格式。Converts Responses API `input`, `tools`, `tool_choice` into Chat Completions format.
3. **上游请求 Upstream Request** (`reqUpstream`/`streamUpstream`)：转发到目标提供商。Forwards the request to the target provider.
4. **响应翻译 Response Translation** (`chatToResponse`/`createSSEEncoder`)：将上游 SSE 映射回 Responses API 事件序列。Maps upstream SSE back to Responses API event sequence.
5. **会话持久化 Session Persistence** (`SessionStore`)：保存多轮对话历史和 reasoning_content。Persists multi-turn conversation history and reasoning_content.

---

## API 端点 / API Endpoints

### Nexus API (端口 Port 5800)

| 方法 Method | 路径 Path | 说明 Description |
|---|---|---|
| `POST` | `/v1/responses` | **核心 Core**：Responses API → Chat Completions 翻译 translation |
| `GET` | `/v1/responses/:id` | 根据 `response_id` 检索历史响应 Retrieve response by ID |
| `POST` | `/v1/chat/completions` | 直通代理，带路由和映射 Passthrough proxy with routing & mapping |
| `GET` | `/v1/models` | 代理上游模型列表 Proxy upstream model list |

### Web Config API (端口 Port 5801)

| 方法 Method | 路径 Path | 说明 Description |
|---|---|---|
| `GET` | `/nexus-ctrl/config` | 获取配置 + 提供商列表 Get config + provider list |
| `POST` | `/nexus-ctrl/config` | 保存配置，可选热重启 Save config, optional hot restart |
| `POST` | `/nexus-ctrl/config/reset` | 恢复默认配置 Reset to defaults |
| `GET` | `/nexus-ctrl/status` | 获取运行状态 Get running status |
| `POST` | `/nexus-ctrl/models` | 探测上游模型列表 Probe upstream model list |
| `GET` | `/nexus-ctrl/codex-models` | 获取 Codex 模型补全列表 Get Codex model completion list |
| `POST` | `/nexus-ctrl/shutdown` | 安全停止所有服务 Gracefully stop all services |

---

## 配置详解 / Configuration

所有配置保存在 `~/.codex-nexus/config.json`，可通过 Web 界面或手动编辑。
All configs are stored in `~/.codex-nexus/config.json`. Edit via Web UI or manually.

### 基础配置 / Basic Config

```json
{
  "provider": "deepseek",
  "api_key": "sk-xxxxxxxxxxxxxxxx",
  "custom_upstream": "",
  "port": 5800,
  "host": "0.0.0.0",
  "autostart_nexus": true,
  "codex_config_auto": true,
  "codex_config_switch_default": false
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `provider` | `string` | 默认提供商 ID（`deepseek`、`kimi`、`qwen`...） |
| `api_key` | `string` | 默认 API Key，当提供商未配置独立密钥时使用 |
| `custom_upstream` | `string` | 自定义上游 URL（当 provider 为 `custom` 时生效） |
| `port` | `number` | Nexus API 端口（默认 5800） |
| `host` | `string` | 监听地址（默认 `0.0.0.0`） |
| `autostart_nexus` | `boolean` | 启动时自动启动 Nexus 服务 |
| `codex_config_auto` | `boolean` | 启动时自动注入 `~/.codex/config.toml` |
| `codex_config_switch_default` | `boolean` | 同时将 Codex 默认模型切换为 Nexus 代理 |

### 模型映射 (model_overrides)

为特定提供商覆盖默认模型映射：

```json
{
  "model_overrides": {
    "deepseek": {
      "gpt-4.1": "deepseek-chat",
      "gpt-4o": "deepseek-chat",
      "o3": "deepseek-reasoner"
    }
  }
}
```

当 Codex 请求 `gpt-4.1` 时，实际转发给 DeepSeek 的模型为 `deepseek-chat`。
When Codex requests `gpt-4.1`, Nexus forwards it as `deepseek-chat` to DeepSeek.

### 模型路由 / Model Routes (`model_routes`) ⭐

**按 Codex 模型名路由到不同提供商**。例如：让 `gpt-4.1` 走 DeepSeek，`o3` 走 Kimi。
**Route different Codex model names to different providers.** Example: send `gpt-4.1` to DeepSeek and `o3` to Kimi:

```json
{
  "model_routes": {
    "gpt-4.1": {
      "provider": "deepseek",
      "model": "deepseek-chat"
    },
    "o3": {
      "provider": "kimi",
      "model": "kimi-k2.6"
    },
    "o4-mini": {
      "provider": "qwen",
      "model": "qwen-max"
    }
  }
}
```

**路由优先级 / Priority**：`model_routes[model]` > `provider` default mapping.

### 提供商独立密钥 / Provider API Keys (`provider_api_keys`)

为不同提供商配置独立的 API Key。Configure independent API Keys for different providers:

```json
{
  "provider_api_keys": {
    "deepseek": "sk-deepseek-xxxx",
    "kimi": "sk-kimi-xxxx",
    "qwen": "sk-qwen-xxxx"
  }
}
```

**密钥优先级 / Key priority**：`provider_api_keys[provider]` > global `api_key` > client Bearer Token.

### 完整配置示例 / Full Config Example

```json
{
  "provider": "deepseek",
  "api_key": "sk-default-xxxx",
  "provider_api_keys": {
    "kimi": "sk-kimi-xxxx",
    "xai": "sk-xai-xxxx"
  },
  "model_overrides": {
    "deepseek": {
      "gpt-4.1": "deepseek-chat",
      "o3": "deepseek-reasoner"
    }
  },
  "model_routes": {
    "gpt-4.1": { "provider": "deepseek", "model": "deepseek-chat" },
    "o3": { "provider": "kimi", "model": "kimi-k2.6" }
  },
  "port": 5800,
  "host": "0.0.0.0",
  "codex_config_auto": true,
  "codex_config_switch_default": false
}
```

---

## Web 配置界面 / Web Config UI

Codex Nexus 内置了一套完整的 HUD 风格 Web 配置面板。
Codex Nexus includes a complete HUD-style Web configuration panel.

### 界面组成 / UI Sections

- **核心链路配置 / Core Config** — 选择提供商、填写 API Key、端口设置。Choose provider, enter API Key, set port.
- **模型路由配置 / Model Routing** — Codex 模型 → 提供商 → 上游模型 → 独立密钥。Codex model → provider → upstream model → key.
- **上游模型探测 / Upstream Model Probe** — 一键获取提供商可用模型列表。Fetch available upstream models with one click.
- **Codex 模型补全 / Codex Model Completion** — 自动补全本地已知模型名。Auto-complete known Codex model names.
- **实时预览 / Live Preview** — 实时显示将写入的 `config.toml` 内容。Preview generated `config.toml`.
- **系统状态监控 / Status Monitor** — 显示服务状态和端点地址。Show service status and endpoint URLs.

### 操作按钮 / Buttons

| 按钮 Button | 功能 Function |
|---|---|
| 💾 保存当前部署图纸 | 保存配置到 `~/.codex-nexus/config.json`。Save config. |
| 🔄 执行保存并热重启 | 保存并热重启 Nexus。Save and hot-restart Nexus. |
| 🔄 探测上游模型列表 | 获取上游可用模型。Fetch upstream models. |
| ➕ 新增模型映射 | 添加路由规则。Add routing rule. |
| 🗑️ 删除 | 删除映射规则。Delete mapping rule. |
| ⏹ 终止核心服务 | 安全停止服务。Gracefully stop services. |
| 🔃 初始化默认 | 恢复默认配置。Reset to defaults. |

---

## 安全说明 / Security

- **密钥存储 / Key Storage**：API Key 仅保存在本机配置文件和内存中。API Keys are stored only in local config and memory.
- **本地优先 / Local First**：配置和会话保存在 `~/.codex-nexus/`。Configs and sessions stay under `~/.codex-nexus/`.
- **路径防护 / Path Protection**：Web 静态文件服务阻止路径遍历。Static file serving blocks path traversal.
- **CORS**：Nexus API 支持跨域；Web 配置界面仅监听 `127.0.0.1`。API supports CORS; Web UI listens on localhost only.
- **请求限制 / Body Limit**：请求体最大 10MB。Request body limit is 10MB.
- **第三方责任 / Third-Party Responsibility**：用户需自行遵守各 API 提供商条款。Users must comply with third-party API terms.

---

## 开发指南 / Development

### 项目结构 / Project Structure

```
codex-nexus/
├── server.js          # 主入口 / Main entry
├── nexus.js           # 核心翻译引擎 / Core translation engine
├── config.js          # 配置管理 / Config manager
├── providers.json     # 提供商定义 / Provider definitions
├── public/
│   └── index.html     # Web 配置界面 / Web config UI
├── start.cmd          # Windows CMD 启动脚本 / CMD launcher
├── start.ps1          # PowerShell 启动脚本 / PowerShell launcher
├── package.json
└── README.md
```

### 核心模块 / Core Modules

| 文件 File | 职责 Responsibility |
|---|---|
| `nexus.js` | 协议翻译、会话存储、SSE 编码、模型路由。Protocol translation, sessions, SSE encoding, routing. |
| `server.js` | 启动 Nexus API + Web Config，管理热重启和关闭。Starts services, handles restart and shutdown. |
| `config.js` | 配置读写、Codex 配置注入、认证键写入。Config CRUD, Codex config injection, auth key writing. |

### 调试 / Debug

```bash
# 开发模式 / Development mode
node server.js --dev
```

---

## 常见问题 / FAQ

### Q: Codex 仍然调用 OpenAI 而不是 Nexus？
### Q: Codex still calls OpenAI instead of Nexus?

检查 `~/.codex/config.toml` 中是否包含 `[model_providers.codex-nexus]` 区块。确保启动时 `codex_config_auto: true`。
Check whether `~/.codex/config.toml` contains `[model_providers.codex-nexus]`. Make sure `codex_config_auto: true`.

### Q: 如何同时使用多个提供商？
### Q: How to use multiple providers at once?

配置 `model_routes`，为不同 Codex 模型指定不同的 `provider`。每个提供商可单独配置 `provider_api_keys`。
Use `model_routes` to assign different providers to different Codex model names. Use `provider_api_keys` for separate keys.

### Q: 本地模型（Ollama/LM Studio）需要 API Key 吗？
### Q: Do local models need an API Key?

不需要。本地模型通常无需认证，留空即可。
Usually no. Leave it empty for local Ollama/LM Studio endpoints.

### Q: 如何更新内置的提供商列表？
### Q: How to update built-in provider list?

直接编辑 `providers.json` 文件，添加新的提供商定义，然后重启服务。
Edit `providers.json`, add a new provider definition, then restart the service.

---

## 卸载 / Uninstall

1. 按 `Ctrl+C` 停止服务，或点击 Web 界面的 **「⏹ 终止核心服务」**。
   Stop the service with `Ctrl+C` or click **Stop Core Service** in Web UI.
2. 删除项目文件夹。Delete the project folder.
3. 删除配置目录：`rm -rf ~/.codex-nexus/`。Delete config directory.
4. 编辑 `~/.codex/config.toml`，移除 `[model_providers.codex-nexus]` 区块。
   Edit `~/.codex/config.toml` and remove `[model_providers.codex-nexus]`.

---

## 许可证 / License

本项目使用自定义 **Codex Nexus Use-Only License**。
This project uses a custom **Codex Nexus Use-Only License**.

请阅读 [LICENSE](LICENSE)。使用本项目即表示你同意其中的全部条款。
Please read [LICENSE](LICENSE). By using this project, you agree to all license terms.

重点摘要 / Key points:

- 允许个人非商业使用。Personal non-commercial use is allowed.
- 二次修改、发布修改版、集成到其他项目需获得作者书面授权。Modification, modified release, or integration requires written authorization from the author.
- 禁止商用、复制复刻、重新分发或冒充原创。Commercial use, copying/forking/redistribution, or claiming authorship is prohibited.
- 本项目与 OpenAI、DeepSeek、Kimi、Qwen 等第三方无官方关联。This project is not officially affiliated with OpenAI, DeepSeek, Kimi, Qwen, or other third parties.

---

<div align="center">

Codex Nexus — built as an independent compatibility idea.

独立构思，仅为个人非商业使用和协议兼容探索。

</div>

<p align="center">
    <a href="https://linux.do" alt="LINUX DO"><img src="https://shorturl.at/ggSqS" /></a>
</p>
