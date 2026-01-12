#!/bin/bash
# NeuroByte Build Script - Creates distributable packages for all platforms

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-0.1.0}"
BUILD_DIR="$PROJECT_ROOT/dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

TARGETS=(
    "x86_64-unknown-linux-gnu"
    "x86_64-unknown-linux-musl"
    "aarch64-unknown-linux-gnu"
    "x86_64-apple-darwin"
    "aarch64-apple-darwin"
    "x86_64-pc-windows-gnu"
)

check_deps() {
    info "Checking dependencies..."

    if ! command -v cargo &> /dev/null; then
        error "Rust/Cargo not found. Install from https://rustup.rs"
    fi

    if ! command -v npm &> /dev/null; then
        error "npm not found. Install Node.js from https://nodejs.org"
    fi

    # Install cross for cross-compilation
    if ! command -v cross &> /dev/null; then
        info "Installing cross for cross-compilation..."
        cargo install cross --git https://github.com/cross-rs/cross
    fi
}

build_core() {
    local target=$1
    info "Building neurobyte-core for $target..."

    cd "$PROJECT_ROOT/neurobyte-core"

    if [[ "$target" == *"$(uname -m)"* ]] || [[ "$target" == *"$(uname -s | tr '[:upper:]' '[:lower:]')"* ]]; then
        # Native build
        cargo build --release --target "$target" 2>/dev/null || cargo build --release
    else
        # Cross-compile
        cross build --release --target "$target" || {
            info "Cross-compilation failed for $target, skipping..."
            return 1
        }
    fi

    # Copy binary
    local binary_name="neurobyte-server"
    if [[ "$target" == *"windows"* ]]; then
        binary_name="neurobyte-server.exe"
    fi

    local target_dir="$BUILD_DIR/binaries/$target"
    mkdir -p "$target_dir"

    if [[ -f "target/$target/release/$binary_name" ]]; then
        cp "target/$target/release/$binary_name" "$target_dir/"
    elif [[ -f "target/release/$binary_name" ]]; then
        cp "target/release/$binary_name" "$target_dir/"
    fi

    success "Built for $target"
}

build_extension() {
    info "Building VS Code extension..."

    cd "$PROJECT_ROOT/neurobyte-extension"

    # Install dependencies
    npm install

    # Compile TypeScript
    npm run compile

    # Package extension
    if command -v vsce &> /dev/null; then
        vsce package -o "$BUILD_DIR/neurobyte-$VERSION.vsix"
        success "Extension packaged: $BUILD_DIR/neurobyte-$VERSION.vsix"
    else
        npm install -g @vscode/vsce
        vsce package -o "$BUILD_DIR/neurobyte-$VERSION.vsix"
        success "Extension packaged"
    fi
}

create_npm_package() {
    info "Creating npm package..."

    local npm_dir="$BUILD_DIR/npm"
    mkdir -p "$npm_dir"

    cat > "$npm_dir/package.json" << EOF
{
    "name": "neurobyte",
    "version": "$VERSION",
    "description": "NeuroByte - AI-powered local coding assistant using Ollama",
    "bin": {
        "neurobyte": "./bin/neurobyte"
    },
    "scripts": {
        "postinstall": "node scripts/postinstall.js"
    },
    "repository": {
        "type": "git",
        "url": "https://github.com/neurobyte/neurobyte"
    },
    "keywords": ["ai", "ollama", "coding", "assistant", "local", "llm"],
    "author": "NeuroByte Team",
    "license": "MIT",
    "engines": {
        "node": ">=16"
    }
}
EOF

    mkdir -p "$npm_dir/bin"
    cat > "$npm_dir/bin/neurobyte" << 'EOF'
#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const platform = os.platform();
const arch = os.arch();

let binaryName = 'neurobyte-server';
if (platform === 'win32') binaryName += '.exe';

const binaryPath = path.join(__dirname, '..', 'binaries', `${platform}-${arch}`, binaryName);

if (!fs.existsSync(binaryPath)) {
    console.error(`Binary not found for ${platform}-${arch}`);
    console.error('Please download manually from https://github.com/neurobyte/neurobyte/releases');
    process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
EOF
    chmod +x "$npm_dir/bin/neurobyte"

    mkdir -p "$npm_dir/scripts"
    cat > "$npm_dir/scripts/postinstall.js" << 'EOF'
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const platform = os.platform();
const arch = os.arch();

const platformMap = {
    'darwin': 'apple-darwin',
    'linux': 'unknown-linux-gnu',
    'win32': 'pc-windows-gnu'
};

const archMap = {
    'x64': 'x86_64',
    'arm64': 'aarch64'
};

const targetPlatform = platformMap[platform] || platform;
const targetArch = archMap[arch] || arch;
const target = `${targetArch}-${targetPlatform}`;

const binaryName = platform === 'win32' ? 'neurobyte-server.exe' : 'neurobyte-server';
const binaryDir = path.join(__dirname, '..', 'binaries', `${platform}-${arch}`);
const binaryPath = path.join(binaryDir, binaryName);

if (fs.existsSync(binaryPath)) {
    console.log('NeuroByte binary already exists');
    process.exit(0);
}

const version = require('../package.json').version;
const url = `https://github.com/neurobyte/neurobyte/releases/download/v${version}/${target}/${binaryName}`;

console.log(`Downloading NeuroByte binary for ${target}...`);

fs.mkdirSync(binaryDir, { recursive: true });

const file = fs.createWriteStream(binaryPath);
https.get(url, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                if (platform !== 'win32') {
                    fs.chmodSync(binaryPath, '755');
                }
                console.log('NeuroByte binary downloaded successfully!');
            });
        });
    } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            if (platform !== 'win32') {
                fs.chmodSync(binaryPath, '755');
            }
            console.log('NeuroByte binary downloaded successfully!');
        });
    } else {
        console.error(`Failed to download: ${response.statusCode}`);
        console.error('Please download manually from https://github.com/neurobyte/neurobyte/releases');
    }
}).on('error', (err) => {
    fs.unlinkSync(binaryPath);
    console.error('Download failed:', err.message);
});
EOF

    # Copy binaries
    if [[ -d "$BUILD_DIR/binaries" ]]; then
        cp -r "$BUILD_DIR/binaries" "$npm_dir/"
    fi

    success "npm package created at $npm_dir"
}

create_homebrew_formula() {
    info "Creating Homebrew formula..."

    mkdir -p "$BUILD_DIR/homebrew"

    cat > "$BUILD_DIR/homebrew/neurobyte.rb" << EOF
class Neurobyte < Formula
  desc "AI-powered local coding assistant using Ollama"
  homepage "https://github.com/neurobyte/neurobyte"
  version "$VERSION"
  license "MIT"

  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/neurobyte/neurobyte/releases/download/v#{version}/aarch64-apple-darwin/neurobyte-server"
      sha256 "PLACEHOLDER_SHA256_ARM64"
    else
      url "https://github.com/neurobyte/neurobyte/releases/download/v#{version}/x86_64-apple-darwin/neurobyte-server"
      sha256 "PLACEHOLDER_SHA256_X64"
    end
  elsif OS.linux?
    if Hardware::CPU.arm?
      url "https://github.com/neurobyte/neurobyte/releases/download/v#{version}/aarch64-unknown-linux-gnu/neurobyte-server"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    else
      url "https://github.com/neurobyte/neurobyte/releases/download/v#{version}/x86_64-unknown-linux-gnu/neurobyte-server"
      sha256 "PLACEHOLDER_SHA256_LINUX_X64"
    end
  end

  depends_on "ollama" => :recommended

  def install
    bin.install "neurobyte-server"
  end

  def caveats
    <<~EOS
      NeuroByte requires Ollama to be installed and running.
      Install Ollama with: brew install ollama
      Start Ollama with: ollama serve

      Then start NeuroByte with: neurobyte-server
    EOS
  end

  service do
    run [opt_bin/"neurobyte-server"]
    keep_alive true
    working_dir var
    log_path var/"log/neurobyte.log"
    error_log_path var/"log/neurobyte.error.log"
  end

  test do
    system "#{bin}/neurobyte-server", "--version"
  end
end
EOF

    success "Homebrew formula created"
}

create_archives() {
    info "Creating release archives..."

    cd "$BUILD_DIR/binaries"

    for target_dir in */; do
        target="${target_dir%/}"
        archive_name="neurobyte-$VERSION-$target"

        if [[ "$target" == *"windows"* ]]; then
            zip -j "$BUILD_DIR/$archive_name.zip" "$target_dir"*
        else
            tar -czvf "$BUILD_DIR/$archive_name.tar.gz" -C "$target_dir" .
        fi
    done

    success "Archives created in $BUILD_DIR"
}

main() {
    echo -e "${BLUE}"
    echo "  NeuroByte Build System"
    echo "  ======================"
    echo -e "${NC}"

    check_deps

    mkdir -p "$BUILD_DIR"

    # Parse arguments
    BUILD_ALL=true
    BUILD_CORE=false
    BUILD_EXT=false
    BUILD_NPM=false
    BUILD_BREW=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --core) BUILD_CORE=true; BUILD_ALL=false;;
            --extension) BUILD_EXT=true; BUILD_ALL=false;;
            --npm) BUILD_NPM=true; BUILD_ALL=false;;
            --brew) BUILD_BREW=true; BUILD_ALL=false;;
            --target) TARGETS=("$2"); shift;;
            --version) VERSION="$2"; shift;;
            *) error "Unknown option: $1";;
        esac
        shift
    done

    if $BUILD_ALL || $BUILD_CORE; then
        for target in "${TARGETS[@]}"; do
            build_core "$target" || true
        done
    fi

    if $BUILD_ALL || $BUILD_EXT; then
        build_extension
    fi

    if $BUILD_ALL || $BUILD_NPM; then
        create_npm_package
    fi

    if $BUILD_ALL || $BUILD_BREW; then
        create_homebrew_formula
    fi

    if $BUILD_ALL; then
        create_archives
    fi

    echo ""
    success "Build complete! Output in $BUILD_DIR"
    echo ""
    echo "Contents:"
    ls -la "$BUILD_DIR"
}

main "$@"
