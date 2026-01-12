use axum::{extract::State, response::IntoResponse, Json};
use std::path::Path;
use std::sync::Arc;
use tokio::fs;

use crate::types::{
    AppState, FileEditRequest, FileReadRequest, FileSearchRequest, FileWriteRequest,
    GlobRequest, SearchResult,
};

/// Read a file's contents
pub async fn read_file(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<FileReadRequest>,
) -> impl IntoResponse {
    let path = Path::new(&req.path);

    if !path.exists() {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("File not found: {}", req.path)
        }));
    }

    if !path.is_file() {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Not a file: {}", req.path)
        }));
    }

    match fs::read_to_string(path).await {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let total_lines = lines.len();

            let offset = req.offset.unwrap_or(0);
            let limit = req.limit.unwrap_or(2000);

            let selected_lines: Vec<String> = lines
                .iter()
                .skip(offset)
                .take(limit)
                .enumerate()
                .map(|(i, line)| format!("{:>6}\t{}", offset + i + 1, line))
                .collect();

            Json(serde_json::json!({
                "success": true,
                "content": selected_lines.join("\n"),
                "total_lines": total_lines,
                "offset": offset,
                "limit": limit
            }))
        }
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to read file: {}", e)
        })),
    }
}

/// Write content to a file
pub async fn write_file(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<FileWriteRequest>,
) -> impl IntoResponse {
    let path = Path::new(&req.path);

    // Create parent directories if needed
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent).await {
                return Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to create directory: {}", e)
                }));
            }
        }
    }

    match fs::write(path, &req.content).await {
        Ok(_) => Json(serde_json::json!({
            "success": true,
            "path": req.path,
            "bytes_written": req.content.len()
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to write file: {}", e)
        })),
    }
}

/// Edit a file by replacing text
pub async fn edit_file(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<FileEditRequest>,
) -> impl IntoResponse {
    let path = Path::new(&req.path);

    if !path.exists() {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("File not found: {}", req.path)
        }));
    }

    let content = match fs::read_to_string(path).await {
        Ok(c) => c,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to read file: {}", e)
            }))
        }
    };

    // Check if old_text exists in the file
    if !content.contains(&req.old_text) {
        return Json(serde_json::json!({
            "success": false,
            "error": "old_text not found in file"
        }));
    }

    // Check if old_text is unique (unless replace_all is true)
    let replace_all = req.replace_all.unwrap_or(false);
    if !replace_all {
        let count = content.matches(&req.old_text).count();
        if count > 1 {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("old_text appears {} times in file. Use replace_all=true or provide more context.", count)
            }));
        }
    }

    // Perform the replacement
    let new_content = if replace_all {
        content.replace(&req.old_text, &req.new_text)
    } else {
        content.replacen(&req.old_text, &req.new_text, 1)
    };

    // Generate diff for display
    let diff = generate_diff(&content, &new_content);

    match fs::write(path, &new_content).await {
        Ok(_) => Json(serde_json::json!({
            "success": true,
            "path": req.path,
            "diff": diff,
            "replacements": if replace_all { content.matches(&req.old_text).count() } else { 1 }
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to write file: {}", e)
        })),
    }
}

/// Generate a simple diff between two strings
fn generate_diff(old: &str, new: &str) -> String {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(old, new);
    let mut output = String::new();

    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        output.push_str(&format!("{}{}", sign, change));
    }

    output
}

/// Search for patterns in files
pub async fn search_files(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FileSearchRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;
    let base_path = req.path.as_deref().unwrap_or(".");
    let max_results = req.max_results.unwrap_or(100);

    let pattern = match regex::Regex::new(&req.pattern) {
        Ok(p) => p,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Invalid regex pattern: {}", e)
            }))
        }
    };

    let file_pattern = req.file_pattern.as_deref();
    let mut results: Vec<SearchResult> = Vec::new();

    // Walk the directory
    let walker = walkdir::WalkDir::new(base_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let path = e.path();
            let path_str = path.to_string_lossy();

            // Skip excluded patterns
            !config.exclude_patterns.iter().any(|p| {
                glob::Pattern::new(p)
                    .map(|pat| pat.matches(&path_str))
                    .unwrap_or(false)
            })
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if results.len() >= max_results {
            break;
        }

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Check file pattern if specified
        if let Some(fp) = file_pattern {
            if let Ok(pat) = glob::Pattern::new(fp) {
                if !pat.matches_path(path) {
                    continue;
                }
            }
        }

        // Check file size
        if let Ok(metadata) = path.metadata() {
            if metadata.len() as usize > config.max_file_size {
                continue;
            }
        }

        // Read and search the file
        if let Ok(content) = fs::read_to_string(path).await {
            let lines: Vec<&str> = content.lines().collect();

            for (line_num, line) in lines.iter().enumerate() {
                if pattern.is_match(line) {
                    let context_before: Vec<String> = lines
                        .iter()
                        .skip(line_num.saturating_sub(2))
                        .take(2.min(line_num))
                        .map(|s| s.to_string())
                        .collect();

                    let context_after: Vec<String> = lines
                        .iter()
                        .skip(line_num + 1)
                        .take(2)
                        .map(|s| s.to_string())
                        .collect();

                    results.push(SearchResult {
                        file: path.to_string_lossy().to_string(),
                        line: line_num + 1,
                        content: line.to_string(),
                        context_before,
                        context_after,
                    });

                    if results.len() >= max_results {
                        break;
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "success": true,
        "results": results,
        "total": results.len()
    }))
}

/// Find files matching a glob pattern
pub async fn glob_files(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GlobRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;
    let base_path = req.path.as_deref().unwrap_or(".");

    let pattern = match glob::Pattern::new(&req.pattern) {
        Ok(p) => p,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Invalid glob pattern: {}", e)
            }))
        }
    };

    let mut files: Vec<String> = Vec::new();

    let walker = walkdir::WalkDir::new(base_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let path = e.path();
            let path_str = path.to_string_lossy();

            !config.exclude_patterns.iter().any(|p| {
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

        let path_str = path.to_string_lossy();
        if pattern.matches(&path_str) {
            files.push(path_str.to_string());
        }
    }

    // Sort by modification time (newest first)
    files.sort_by(|a, b| {
        let a_time = std::fs::metadata(a)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let b_time = std::fs::metadata(b)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        b_time.cmp(&a_time)
    });

    Json(serde_json::json!({
        "success": true,
        "files": files,
        "total": files.len()
    }))
}
