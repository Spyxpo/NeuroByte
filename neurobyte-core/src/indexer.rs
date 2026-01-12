use axum::{extract::State, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::fs;

use crate::types::{AppState, IndexRequest, IndexSearchRequest};

/// Project index for fast searching
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub workspace_path: String,
    pub files: Vec<IndexedFile>,
    pub symbols: Vec<Symbol>,
    pub file_tree: FileTree,
    pub stats: IndexStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedFile {
    pub path: String,
    pub relative_path: String,
    pub language: String,
    pub size: u64,
    pub lines: usize,
    pub last_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    pub file: String,
    pub line: usize,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SymbolKind {
    Function,
    Class,
    Interface,
    Variable,
    Constant,
    Module,
    Struct,
    Enum,
    Type,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTree {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileTree>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    pub total_files: usize,
    pub total_lines: usize,
    pub total_size: u64,
    pub languages: HashMap<String, usize>,
    pub indexed_at: u64,
}

/// Index a project
pub async fn index_project(
    State(state): State<Arc<AppState>>,
    Json(req): Json<IndexRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;
    let workspace_path = &req.workspace_path;

    if !Path::new(workspace_path).exists() {
        return Json(serde_json::json!({
            "success": false,
            "error": "Workspace path does not exist"
        }));
    }

    let exclude_patterns: Vec<String> = req
        .exclude_patterns
        .unwrap_or_else(|| config.exclude_patterns.clone());

    // Build the index
    let mut files: Vec<IndexedFile> = Vec::new();
    let mut symbols: Vec<Symbol> = Vec::new();
    let mut languages: HashMap<String, usize> = HashMap::new();
    let mut total_lines = 0;
    let mut total_size = 0u64;

    let walker = walkdir::WalkDir::new(workspace_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let path = e.path();
            let path_str = path.to_string_lossy();

            !exclude_patterns.iter().any(|p| {
                glob::Pattern::new(p)
                    .map(|pat| pat.matches(&path_str))
                    .unwrap_or(false)
            })
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Check file size
        let metadata = match path.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.len() as usize > config.max_file_size {
            continue;
        }

        let relative_path = path
            .strip_prefix(workspace_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let language = detect_language(path);
        *languages.entry(language.clone()).or_insert(0) += 1;

        let content = match fs::read_to_string(path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lines = content.lines().count();
        total_lines += lines;
        total_size += metadata.len();

        // Extract symbols from the file
        let file_symbols = extract_symbols(path, &content, &language);
        symbols.extend(file_symbols);

        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        files.push(IndexedFile {
            path: path.to_string_lossy().to_string(),
            relative_path,
            language,
            size: metadata.len(),
            lines,
            last_modified,
        });
    }

    // Build file tree
    let file_tree = build_file_tree(workspace_path, &exclude_patterns);

    let stats = IndexStats {
        total_files: files.len(),
        total_lines,
        total_size,
        languages,
        indexed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };

    let index = ProjectIndex {
        workspace_path: workspace_path.clone(),
        files,
        symbols,
        file_tree,
        stats: stats.clone(),
    };

    // Store the index
    {
        let mut project_index = state.project_index.write().await;
        *project_index = Some(index);
    }

    Json(serde_json::json!({
        "success": true,
        "stats": stats
    }))
}

/// Get indexing status
pub async fn index_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let project_index = state.project_index.read().await;

    match &*project_index {
        Some(index) => Json(serde_json::json!({
            "indexed": true,
            "workspace": index.workspace_path,
            "stats": index.stats
        })),
        None => Json(serde_json::json!({
            "indexed": false
        })),
    }
}

/// Search the project index
pub async fn search_index(
    State(state): State<Arc<AppState>>,
    Json(req): Json<IndexSearchRequest>,
) -> impl IntoResponse {
    let project_index = state.project_index.read().await;

    let index = match &*project_index {
        Some(i) => i,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "error": "Project not indexed. Call /index/project first."
            }))
        }
    };

    let query = req.query.to_lowercase();
    let max_results = req.max_results.unwrap_or(50);

    // Search files
    let matching_files: Vec<&IndexedFile> = index
        .files
        .iter()
        .filter(|f| f.relative_path.to_lowercase().contains(&query))
        .take(max_results)
        .collect();

    // Search symbols
    let matching_symbols: Vec<&Symbol> = index
        .symbols
        .iter()
        .filter(|s| s.name.to_lowercase().contains(&query))
        .take(max_results)
        .collect();

    Json(serde_json::json!({
        "success": true,
        "files": matching_files,
        "symbols": matching_symbols
    }))
}

/// Detect programming language from file extension
fn detect_language(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "cpp",
        "cs" => "csharp",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "scala" => "scala",
        "r" | "R" => "r",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        "ps1" => "powershell",
        "html" | "htm" => "html",
        "css" | "scss" | "sass" | "less" => "css",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "markdown" => "markdown",
        "vue" => "vue",
        "svelte" => "svelte",
        _ => "unknown",
    }
    .to_string()
}

/// Extract symbols from a file (basic implementation)
fn extract_symbols(path: &Path, content: &str, language: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let file_path = path.to_string_lossy().to_string();

    // Simple regex-based symbol extraction
    for (line_num, line) in content.lines().enumerate() {
        match language {
            "rust" => {
                extract_rust_symbols(line, line_num + 1, &file_path, &mut symbols);
            }
            "typescript" | "javascript" => {
                extract_js_symbols(line, line_num + 1, &file_path, &mut symbols);
            }
            "python" => {
                extract_python_symbols(line, line_num + 1, &file_path, &mut symbols);
            }
            "go" => {
                extract_go_symbols(line, line_num + 1, &file_path, &mut symbols);
            }
            _ => {}
        }
    }

    symbols
}

fn extract_rust_symbols(line: &str, line_num: usize, file: &str, symbols: &mut Vec<Symbol>) {
    let trimmed = line.trim();

    // Functions
    if let Some(cap) = regex::Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Function,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Structs
    if let Some(cap) = regex::Regex::new(r"^\s*(?:pub\s+)?struct\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Struct,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Enums
    if let Some(cap) = regex::Regex::new(r"^\s*(?:pub\s+)?enum\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Enum,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }
}

fn extract_js_symbols(line: &str, line_num: usize, file: &str, symbols: &mut Vec<Symbol>) {
    let trimmed = line.trim();

    // Functions
    if let Some(cap) = regex::Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Function,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Classes
    if let Some(cap) = regex::Regex::new(r"^\s*(?:export\s+)?class\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Class,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Interfaces (TypeScript)
    if let Some(cap) = regex::Regex::new(r"^\s*(?:export\s+)?interface\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Interface,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Arrow functions and const declarations
    if let Some(cap) = regex::Regex::new(r"^\s*(?:export\s+)?const\s+(\w+)\s*=")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Variable,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }
}

fn extract_python_symbols(line: &str, line_num: usize, file: &str, symbols: &mut Vec<Symbol>) {
    let trimmed = line.trim();

    // Functions
    if let Some(cap) = regex::Regex::new(r"^\s*(?:async\s+)?def\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Function,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Classes
    if let Some(cap) = regex::Regex::new(r"^\s*class\s+(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Class,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }
}

fn extract_go_symbols(line: &str, line_num: usize, file: &str, symbols: &mut Vec<Symbol>) {
    let trimmed = line.trim();

    // Functions
    if let Some(cap) = regex::Regex::new(r"^\s*func\s+(?:\([^)]+\)\s+)?(\w+)")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Function,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }

    // Types
    if let Some(cap) = regex::Regex::new(r"^\s*type\s+(\w+)\s+struct")
        .ok()
        .and_then(|re| re.captures(trimmed))
    {
        symbols.push(Symbol {
            name: cap[1].to_string(),
            kind: SymbolKind::Struct,
            file: file.to_string(),
            line: line_num,
            signature: Some(trimmed.to_string()),
        });
    }
}

/// Build a file tree structure
fn build_file_tree(root: &str, exclude_patterns: &[String]) -> FileTree {
    let root_path = Path::new(root);
    let name = root_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(root)
        .to_string();

    build_tree_recursive(root_path, &name, exclude_patterns)
}

fn build_tree_recursive(path: &Path, name: &str, exclude_patterns: &[String]) -> FileTree {
    let path_str = path.to_string_lossy().to_string();

    if path.is_file() {
        return FileTree {
            name: name.to_string(),
            path: path_str,
            is_dir: false,
            children: Vec::new(),
        };
    }

    let mut children: Vec<FileTree> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let entry_path = entry.path();
            let entry_name = entry
                .file_name()
                .to_str()
                .unwrap_or("unknown")
                .to_string();

            let entry_path_str = entry_path.to_string_lossy();

            // Check exclusions
            let excluded = exclude_patterns.iter().any(|p| {
                glob::Pattern::new(p)
                    .map(|pat| pat.matches(&entry_path_str))
                    .unwrap_or(false)
            });

            if excluded {
                continue;
            }

            children.push(build_tree_recursive(&entry_path, &entry_name, exclude_patterns));
        }
    }

    // Sort: directories first, then by name
    children.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    FileTree {
        name: name.to_string(),
        path: path_str,
        is_dir: true,
        children,
    }
}
