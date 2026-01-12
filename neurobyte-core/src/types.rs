use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::device::DeviceInfo;
use crate::indexer::ProjectIndex;
use crate::plan::PlanState;

/// Main application state shared across handlers
pub struct AppState {
    pub config: RwLock<Config>,
    pub device_info: DeviceInfo,
    pub project_index: RwLock<Option<ProjectIndex>>,
    pub plan_state: RwLock<Option<PlanState>>,
}

impl AppState {
    pub fn new(config: Config, device_info: DeviceInfo) -> Self {
        Self {
            config: RwLock::new(config),
            device_info,
            project_index: RwLock::new(None),
            plan_state: RwLock::new(None),
        }
    }
}

/// Chat message structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "user", "assistant", "system"
    pub content: String,
}

/// Chat request from extension
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
    pub stream: Option<bool>,
    pub context: Option<ChatContext>,
}

/// Additional context for chat
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContext {
    pub workspace_path: Option<String>,
    pub current_file: Option<String>,
    pub selected_text: Option<String>,
    pub file_contents: Option<HashMap<String, String>>,
}

/// Chat response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub message: ChatMessage,
    pub model: String,
    pub done: bool,
    pub tool_calls: Option<Vec<ToolCall>>,
}

/// Tool call from LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

/// File operation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReadRequest {
    pub path: String,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileWriteRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEditRequest {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub replace_all: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSearchRequest {
    pub pattern: String,
    pub path: Option<String>,
    pub file_pattern: Option<String>,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobRequest {
    pub pattern: String,
    pub path: Option<String>,
}

/// Search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub file: String,
    pub line: usize,
    pub content: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

/// Project indexing request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexRequest {
    pub workspace_path: String,
    pub exclude_patterns: Option<Vec<String>>,
}

/// Index search request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexSearchRequest {
    pub query: String,
    pub max_results: Option<usize>,
}

/// Ollama model info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub digest: String,
    pub modified_at: String,
    pub details: Option<ModelDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetails {
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

/// Model recommendation based on device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub recommended_model: String,
    pub reason: String,
    pub alternatives: Vec<String>,
    pub device_tier: String,
}

/// Pull model request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullModelRequest {
    pub model: String,
}
