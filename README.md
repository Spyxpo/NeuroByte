# NeuroByte

**AI-Powered Local Coding Assistant** - Like Claude Code, but runs entirely on your machine using Ollama.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

NeuroByte is a VS Code extension that provides Claude Code-like capabilities using local LLM models through Ollama. It offers full project access, plan mode, automatic file editing, and intelligent code assistance - all running privately on your device.

## Features

- **Chat Interface** - Conversational AI assistant integrated into VS Code
- **Plan Mode** - Create and execute multi-step implementation plans
- **Automatic File Editing** - AI can read, write, and edit files directly
- **Project Indexing** - Fast semantic search across your codebase
- **Context-Aware** - Understands your current file, selection, and project structure
- **Device-Optimized** - Automatically recommends models based on your hardware
- **Ollama Integration** - Auto-install, auto-start, and auto-pull models
- **Fully Local** - No data leaves your machine

## Quick Install

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/neurobyte/neurobyte/main/scripts/install.sh | bash
```

### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/neurobyte/neurobyte/main/scripts/install.ps1 | iex
```

### npm

```bash
npm install -g neurobyte
```

### Homebrew (macOS/Linux)

```bash
brew tap neurobyte/tap
brew install neurobyte
```

### VS Code Extension

Search for "NeuroByte" in the VS Code Extensions marketplace, or:

```bash
code --install-extension neurobyte.neurobyte
```

## Requirements

- **Ollama** - Local LLM runtime (auto-installed by the installer)
- **VS Code** 1.85.0 or later
- Recommended: 8GB+ RAM (works with less using smaller models)

## Model Recommendations

NeuroByte automatically detects your device capabilities and recommends appropriate models:

| Device Tier | RAM | Recommended Model | Alternatives |
|-------------|-----|-------------------| --------------|
| Low | < 8GB | qwen2.5:0.5b | tinyllama, phi3:mini |
| Medium | 8-16GB | qwen2.5:3b | phi3, llama3.2:3b, codellama:7b |
| High | 16-32GB | qwen2.5:7b | llama3.1:8b, codellama:13b |
| Ultra | 32GB+ | qwen2.5:14b | llama3.1:70b, codellama:34b |

## Usage

### Chat

1. Open the NeuroByte panel from the sidebar (brain icon)
2. Type your question or request
3. NeuroByte will respond and can execute actions on your codebase

### Quick Actions

- **Cmd/Ctrl + Shift + N** - Open NeuroByte chat
- **Cmd/Ctrl + Shift + A** - Ask about selected code
- Right-click context menu for code actions

### Plan Mode

1. Run "NeuroByte: Enter Plan Mode" from command palette
2. Describe what you want to accomplish
3. Review the generated plan
4. Approve to execute step by step

### Commands

| Command | Description |
|---------|-------------|
| `NeuroByte: Open Chat` | Open the chat panel |
| `NeuroByte: Ask About Selection` | Ask about selected code |
| `NeuroByte: Explain This Code` | Get explanation of selected code |
| `NeuroByte: Fix This Code` | Find and fix issues |
| `NeuroByte: Refactor This Code` | Improve code quality |
| `NeuroByte: Generate Tests` | Create unit tests |
| `NeuroByte: Enter Plan Mode` | Start planning mode |
| `NeuroByte: Select Model` | Choose a different model |
| `NeuroByte: Pull Model` | Download a new model |
| `NeuroByte: Index Project` | Index current workspace |
| `NeuroByte: Setup Ollama` | Install/start Ollama |

## Configuration

Settings can be configured in VS Code settings (`Cmd/Ctrl + ,`):

```json
{
  "neurobyte.ollamaUrl": "http://127.0.0.1:11434",
  "neurobyte.defaultModel": "qwen2.5:7b",
  "neurobyte.autoStartOllama": true,
  "neurobyte.autoPullModel": true,
  "neurobyte.streaming": true,
  "neurobyte.temperature": 0.7,
  "neurobyte.maxContextLength": 8192,
  "neurobyte.planMode.requireApproval": true,
  "neurobyte.excludePatterns": [
    "**/node_modules/**",
    "**/.git/**"
  ]
}
```

## Architecture

NeuroByte consists of two components:

1. **NeuroByte Core** (Rust) - Fast backend for file operations, indexing, and Ollama communication
2. **VS Code Extension** (TypeScript) - UI and editor integration

```txt
┌─────────────────────────────────────────────────────┐
│                    VS Code                          │
│  ┌─────────────────────────────────────────────┐    │
│  │           NeuroByte Extension               │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────┐   │    │
│  │  │  Chat   │ │  Plan   │ │   Models    │   │    │
│  │  │  View   │ │  View   │ │    View     │   │    │
│  │  └────┬────┘ └────┬────┘ └──────┬──────┘   │    │
│  └───────┼───────────┼─────────────┼──────────┘    │
│          └───────────┼─────────────┘               │
│                      ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │           NeuroByte Core (Rust)              │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────┐   │    │
│  │  │  File   │ │ Project │ │    Plan     │   │    │
│  │  │  Ops    │ │ Indexer │ │   Engine    │   │    │
│  │  └─────────┘ └─────────┘ └─────────────┘   │    │
│  └───────────────────┬──────────────────────────┘   │
│                      ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │                 Ollama                       │    │
│  │           (Local LLM Runtime)               │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Building from Source

### Prerequisites

- Rust 1.75+
- Node.js 18+
- npm or yarn

### Build

```bash
# Clone the repository
git clone https://github.com/spyxpo/neurobyte.git
cd neurobyte

# Build everything
./scripts/build.sh

# Or build components separately
./scripts/build.sh --core      # Build Rust backend
./scripts/build.sh --extension # Build VS Code extension
./scripts/build.sh --npm       # Create npm package
./scripts/build.sh --brew      # Create Homebrew formula
```

### Development

```bash
# Start the core server
cd neurobyte-core
cargo run

# In another terminal, watch the extension
cd neurobyte-extension
npm install
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

## Author

- [Mantresh Khurana](https://github.com/mantreshkhurana) - Creator and maintainer
