#!/bin/bash
# NeuroByte Installer - Install via curl: curl -fsSL https://neurobyte.dev/install.sh | bash

set -e

NEUROBYTE_VERSION="${NEUROBYTE_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.neurobyte}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "  _   _                      ____        _       "
    echo " | \ | | ___ _   _ _ __ ___ | __ ) _   _| |_ ___ "
    echo " |  \| |/ _ \ | | | '__/ _ \|  _ \| | | | __/ _ \\"
    echo " | |\  |  __/ |_| | | | (_) | |_) | |_| | ||  __/"
    echo " |_| \_|\___|\__,_|_|  \___/|____/ \__, |\__\___|"
    echo "                                   |___/         "
    echo -e "${NC}"
    echo "  AI-Powered Local Coding Assistant"
    echo ""
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

detect_os() {
    case "$(uname -s)" in
        Linux*)     OS=linux;;
        Darwin*)    OS=darwin;;
        MINGW*|MSYS*|CYGWIN*) OS=windows;;
        *)          error "Unsupported operating system: $(uname -s)";;
    esac
    echo $OS
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   ARCH=x86_64;;
        arm64|aarch64)  ARCH=aarch64;;
        armv7l)         ARCH=armv7;;
        *)              error "Unsupported architecture: $(uname -m)";;
    esac
    echo $ARCH
}

detect_device_tier() {
    # Get total memory in GB
    if [[ "$OS" == "darwin" ]]; then
        TOTAL_MEM=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024/1024)}')
    else
        TOTAL_MEM=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024/1024)}')
    fi

    if [[ $TOTAL_MEM -ge 32 ]]; then
        echo "ultra"
    elif [[ $TOTAL_MEM -ge 16 ]]; then
        echo "high"
    elif [[ $TOTAL_MEM -ge 8 ]]; then
        echo "medium"
    else
        echo "low"
    fi
}

get_recommended_model() {
    local tier=$1
    case $tier in
        ultra)  echo "qwen2.5:14b";;
        high)   echo "qwen2.5:7b";;
        medium) echo "qwen2.5:3b";;
        low)    echo "qwen2.5:0.5b";;
        *)      echo "qwen2.5:3b";;
    esac
}

check_ollama() {
    if command -v ollama &> /dev/null; then
        return 0
    else
        return 1
    fi
}

install_ollama() {
    info "Installing Ollama..."

    if [[ "$OS" == "darwin" ]]; then
        # Check if brew is available
        if command -v brew &> /dev/null; then
            info "Installing Ollama via Homebrew..."
            brew install ollama
        else
            info "Installing Ollama via official script..."
            curl -fsSL https://ollama.com/install.sh | sh
        fi
    elif [[ "$OS" == "linux" ]]; then
        info "Installing Ollama via official script..."
        curl -fsSL https://ollama.com/install.sh | sh
    elif [[ "$OS" == "windows" ]]; then
        warn "Please download Ollama from https://ollama.com/download and install manually"
        echo "After installation, run this script again."
        exit 0
    fi

    if check_ollama; then
        success "Ollama installed successfully!"
    else
        error "Failed to install Ollama"
    fi
}

start_ollama() {
    info "Starting Ollama service..."

    if [[ "$OS" == "darwin" ]]; then
        # On macOS, start as a background service
        nohup ollama serve > /dev/null 2>&1 &
    elif [[ "$OS" == "linux" ]]; then
        # Check if systemd is available
        if command -v systemctl &> /dev/null; then
            sudo systemctl start ollama 2>/dev/null || nohup ollama serve > /dev/null 2>&1 &
        else
            nohup ollama serve > /dev/null 2>&1 &
        fi
    fi

    # Wait for Ollama to start
    info "Waiting for Ollama to start..."
    for i in {1..30}; do
        if curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
            success "Ollama is running!"
            return 0
        fi
        sleep 1
    done

    warn "Ollama may not be running. You can start it manually with: ollama serve"
}

pull_model() {
    local model=$1
    info "Pulling model: $model (this may take a while)..."
    ollama pull "$model"
    success "Model $model pulled successfully!"
}

install_neurobyte_core() {
    info "Installing NeuroByte Core..."

    mkdir -p "$INSTALL_DIR/bin"
    mkdir -p "$BIN_DIR"

    # Download the appropriate binary
    local BINARY_NAME="neurobyte-server"
    if [[ "$OS" == "windows" ]]; then
        BINARY_NAME="neurobyte-server.exe"
    fi

    local DOWNLOAD_URL="https://github.com/neurobyte/neurobyte/releases/download/${NEUROBYTE_VERSION}/${OS}-${ARCH}/${BINARY_NAME}"

    info "Downloading NeuroByte Core from $DOWNLOAD_URL..."

    # For now, we'll build from source if binary not available
    if ! curl -fsSL -o "$INSTALL_DIR/bin/$BINARY_NAME" "$DOWNLOAD_URL" 2>/dev/null; then
        warn "Pre-built binary not available. Building from source..."
        build_from_source
    else
        chmod +x "$INSTALL_DIR/bin/$BINARY_NAME"
    fi

    # Create symlink
    ln -sf "$INSTALL_DIR/bin/$BINARY_NAME" "$BIN_DIR/neurobyte-server"

    success "NeuroByte Core installed to $INSTALL_DIR"
}

build_from_source() {
    info "Building NeuroByte Core from source..."

    # Check for Rust
    if ! command -v cargo &> /dev/null; then
        info "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    fi

    # Clone and build
    local TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    info "Cloning NeuroByte repository..."
    git clone --depth 1 https://github.com/neurobyte/neurobyte.git
    cd neurobyte/neurobyte-core

    info "Building (this may take a few minutes)..."
    cargo build --release

    cp target/release/neurobyte-server "$INSTALL_DIR/bin/"

    cd "$HOME"
    rm -rf "$TEMP_DIR"

    success "Built from source successfully!"
}

install_vscode_extension() {
    info "Installing NeuroByte VS Code extension..."

    if command -v code &> /dev/null; then
        # Install from marketplace or local VSIX
        code --install-extension neurobyte.neurobyte 2>/dev/null || {
            warn "Could not install from marketplace. The extension will be installed when available."
        }
    else
        warn "VS Code CLI not found. Please install the NeuroByte extension manually from VS Code."
    fi
}

setup_shell() {
    local SHELL_RC=""

    case "$SHELL" in
        */bash)
            SHELL_RC="$HOME/.bashrc"
            ;;
        */zsh)
            SHELL_RC="$HOME/.zshrc"
            ;;
        */fish)
            SHELL_RC="$HOME/.config/fish/config.fish"
            ;;
    esac

    if [[ -n "$SHELL_RC" ]]; then
        # Add bin directory to PATH if not already there
        if ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
            echo "" >> "$SHELL_RC"
            echo "# NeuroByte" >> "$SHELL_RC"
            echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
            info "Added $BIN_DIR to PATH in $SHELL_RC"
        fi
    fi
}

create_config() {
    local tier=$1
    local model=$2

    mkdir -p "$HOME/.neurobyte"

    cat > "$HOME/.neurobyte/config.json" << EOF
{
    "ollama_url": "http://127.0.0.1:11434",
    "default_model": "$model",
    "auto_start_ollama": true,
    "auto_pull_model": true,
    "max_context_length": 8192,
    "temperature": 0.7,
    "top_p": 0.9,
    "streaming": true,
    "device_tier": "$tier"
}
EOF

    success "Configuration saved to $HOME/.neurobyte/config.json"
}

main() {
    print_banner

    OS=$(detect_os)
    ARCH=$(detect_arch)
    TIER=$(detect_device_tier)
    MODEL=$(get_recommended_model "$TIER")

    info "Detected: $OS/$ARCH (Device tier: $TIER)"
    info "Recommended model: $MODEL"
    echo ""

    # Step 1: Check and install Ollama
    if check_ollama; then
        success "Ollama is already installed"
    else
        read -p "Ollama is not installed. Install it now? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_ollama
        fi
    fi

    # Step 2: Start Ollama if not running
    if ! curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
        start_ollama
    fi

    # Step 3: Pull recommended model
    if check_ollama && curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
        # Check if model exists
        if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
            read -p "Would you like to download the recommended model ($MODEL)? [Y/n] " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                pull_model "$MODEL"
            fi
        else
            success "Model $MODEL is already available"
        fi
    fi

    # Step 4: Install NeuroByte Core
    install_neurobyte_core

    # Step 5: Setup shell
    setup_shell

    # Step 6: Create config
    create_config "$TIER" "$MODEL"

    # Step 7: Install VS Code extension
    read -p "Install VS Code extension? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        install_vscode_extension
    fi

    echo ""
    success "NeuroByte installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Open VS Code and look for NeuroByte in the sidebar"
    echo "  2. Start chatting with your local AI assistant!"
    echo ""
    echo "To start the NeuroByte server manually:"
    echo "  neurobyte-server"
    echo ""
    echo "Enjoy coding with NeuroByte!"
}

main "$@"
