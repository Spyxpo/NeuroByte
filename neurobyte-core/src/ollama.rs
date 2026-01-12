use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
    Json,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio_stream::wrappers::ReceiverStream;

use crate::device::{get_recommended_models, DeviceTier};
use crate::types::{
    AppState, ChatMessage, ChatRequest, ChatResponse, ModelRecommendation,
    OllamaModel, PullModelRequest,
};

/// Check if Ollama is running and accessible
pub async fn check_ollama_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let config = state.config.read().await;
    let url = format!("{}/api/version", config.ollama_url);

    match reqwest::get(&url).await {
        Ok(resp) if resp.status().is_success() => {
            let version: serde_json::Value = resp.json().await.unwrap_or_default();
            Json(serde_json::json!({
                "running": true,
                "version": version.get("version").and_then(|v| v.as_str()).unwrap_or("unknown"),
                "url": config.ollama_url
            }))
        }
        _ => {
            // Try to start Ollama if configured
            if config.auto_start_ollama {
                if let Ok(_) = try_start_ollama().await {
                    // Wait a bit and check again
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    if let Ok(resp) = reqwest::get(&url).await {
                        if resp.status().is_success() {
                            return Json(serde_json::json!({
                                "running": true,
                                "version": "started",
                                "url": config.ollama_url,
                                "auto_started": true
                            }));
                        }
                    }
                }
            }

            Json(serde_json::json!({
                "running": false,
                "error": "Ollama is not running",
                "url": config.ollama_url
            }))
        }
    }
}

/// Try to start Ollama service
async fn try_start_ollama() -> anyhow::Result<()> {
    use std::process::Command;

    // Check if ollama binary exists
    if which::which("ollama").is_err() {
        return Err(anyhow::anyhow!("Ollama not installed"));
    }

    // Start ollama serve in background
    #[cfg(target_os = "macos")]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()?;
    }

    Ok(())
}

/// List available Ollama models
pub async fn list_models(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let config = state.config.read().await;
    let url = format!("{}/api/tags", config.ollama_url);

    match reqwest::get(&url).await {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct TagsResponse {
                models: Vec<OllamaModel>,
            }

            match resp.json::<TagsResponse>().await {
                Ok(tags) => Json(serde_json::json!({
                    "success": true,
                    "models": tags.models
                })),
                Err(e) => Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse response: {}", e)
                })),
            }
        }
        Ok(resp) => Json(serde_json::json!({
            "success": false,
            "error": format!("Ollama returned status: {}", resp.status())
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to connect to Ollama: {}", e)
        })),
    }
}

/// Recommend a model based on device capabilities
pub async fn recommend_model(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let device_info = &state.device_info;
    let tier = device_info.device_tier;

    let recommended_models = get_recommended_models(tier);
    let primary_model = recommended_models.first().unwrap_or(&"qwen2.5:3b");

    let reason = match tier {
        DeviceTier::Low => format!(
            "Your device has {:.1}GB RAM. Recommending lightweight models for smooth performance.",
            device_info.total_memory_gb
        ),
        DeviceTier::Medium => format!(
            "Your device has {:.1}GB RAM. Recommending balanced models for good performance.",
            device_info.total_memory_gb
        ),
        DeviceTier::High => format!(
            "Your device has {:.1}GB RAM{}. Recommending capable models for excellent performance.",
            device_info.total_memory_gb,
            device_info.gpu_info.as_ref()
                .map(|g| format!(" and {} GPU", g.name))
                .unwrap_or_default()
        ),
        DeviceTier::Ultra => format!(
            "Your device has {:.1}GB RAM{}. Recommending powerful models for maximum capability.",
            device_info.total_memory_gb,
            device_info.gpu_info.as_ref()
                .map(|g| format!(" and {} GPU", g.name))
                .unwrap_or_default()
        ),
    };

    Json(ModelRecommendation {
        recommended_model: primary_model.to_string(),
        reason,
        alternatives: recommended_models.iter().skip(1).map(|s| s.to_string()).collect(),
        device_tier: tier.as_str().to_string(),
    })
}

/// Pull a model from Ollama
pub async fn pull_model(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PullModelRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;
    let url = format!("{}/api/pull", config.ollama_url);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "name": req.model,
            "stream": false
        }))
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            Json(serde_json::json!({
                "success": true,
                "message": format!("Model '{}' pulled successfully", req.model)
            }))
        }
        Ok(resp) => {
            let error = resp.text().await.unwrap_or_default();
            Json(serde_json::json!({
                "success": false,
                "error": error
            }))
        }
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to pull model: {}", e)
        })),
    }
}

/// Non-streaming chat completion
pub async fn chat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;
    let model = req.model.unwrap_or_else(|| config.default_model.clone());
    let url = format!("{}/api/chat", config.ollama_url);

    // Build messages with system prompt
    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": config.system_prompt
    })];

    for msg in &req.messages {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": false,
            "options": {
                "temperature": config.temperature,
                "top_p": config.top_p,
                "num_ctx": config.max_context_length
            }
        }))
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct OllamaResponse {
                message: OllamaMessage,
                model: String,
                done: bool,
            }

            #[derive(Deserialize)]
            struct OllamaMessage {
                role: String,
                content: String,
            }

            match resp.json::<OllamaResponse>().await {
                Ok(ollama_resp) => {
                    // Parse tool calls from response if any
                    let tool_calls = parse_tool_calls(&ollama_resp.message.content);

                    Json(serde_json::json!({
                        "success": true,
                        "response": ChatResponse {
                            message: ChatMessage {
                                role: ollama_resp.message.role,
                                content: ollama_resp.message.content,
                            },
                            model: ollama_resp.model,
                            done: ollama_resp.done,
                            tool_calls,
                        }
                    }))
                }
                Err(e) => Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse response: {}", e)
                })),
            }
        }
        Ok(resp) => {
            let error = resp.text().await.unwrap_or_default();
            Json(serde_json::json!({
                "success": false,
                "error": error
            }))
        }
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": format!("Failed to connect to Ollama: {}", e)
        })),
    }
}

/// WebSocket endpoint for streaming chat
pub async fn chat_stream_ws(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_chat_stream(socket, state))
}

async fn handle_chat_stream(mut socket: WebSocket, state: Arc<AppState>) {
    while let Some(msg) = socket.recv().await {
        if let Ok(Message::Text(text)) = msg {
            // Parse the chat request
            let req: ChatRequest = match serde_json::from_str(&text) {
                Ok(r) => r,
                Err(e) => {
                    let _ = socket
                        .send(Message::Text(
                            serde_json::json!({"error": e.to_string()}).to_string(),
                        ))
                        .await;
                    continue;
                }
            };

            // Stream the response
            if let Err(e) = stream_chat_response(&mut socket, &state, req).await {
                let _ = socket
                    .send(Message::Text(
                        serde_json::json!({"error": e.to_string()}).to_string(),
                    ))
                    .await;
            }
        }
    }
}

async fn stream_chat_response(
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    req: ChatRequest,
) -> anyhow::Result<()> {
    let config = state.config.read().await;
    let model = req.model.unwrap_or_else(|| config.default_model.clone());
    let url = format!("{}/api/chat", config.ollama_url);

    // Build messages with system prompt
    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": config.system_prompt
    })];

    for msg in &req.messages {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    let client = reqwest::Client::new();
    let mut response = client
        .post(&url)
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "options": {
                "temperature": config.temperature,
                "top_p": config.top_p,
                "num_ctx": config.max_context_length
            }
        }))
        .send()
        .await?;

    let mut full_content = String::new();

    while let Some(chunk) = response.chunk().await? {
        let text = String::from_utf8_lossy(&chunk);

        for line in text.lines() {
            if line.is_empty() {
                continue;
            }

            #[derive(Deserialize)]
            struct StreamChunk {
                message: Option<StreamMessage>,
                done: bool,
            }

            #[derive(Deserialize)]
            struct StreamMessage {
                content: String,
            }

            if let Ok(chunk) = serde_json::from_str::<StreamChunk>(line) {
                if let Some(msg) = chunk.message {
                    full_content.push_str(&msg.content);
                    socket
                        .send(Message::Text(
                            serde_json::json!({
                                "type": "chunk",
                                "content": msg.content,
                                "done": chunk.done
                            })
                            .to_string(),
                        ))
                        .await?;
                }

                if chunk.done {
                    // Parse any tool calls from the complete response
                    let tool_calls = parse_tool_calls(&full_content);
                    socket
                        .send(Message::Text(
                            serde_json::json!({
                                "type": "done",
                                "full_content": full_content,
                                "tool_calls": tool_calls
                            })
                            .to_string(),
                        ))
                        .await?;
                }
            }
        }
    }

    Ok(())
}

/// Parse tool calls from LLM response
fn parse_tool_calls(content: &str) -> Option<Vec<crate::types::ToolCall>> {
    use regex::Regex;

    let re = Regex::new(r#"<tool name="(\w+)">\s*(\{[\s\S]*?\})\s*</tool>"#).ok()?;
    let mut calls = Vec::new();

    for cap in re.captures_iter(content) {
        let name = cap.get(1)?.as_str().to_string();
        let args_str = cap.get(2)?.as_str();

        if let Ok(arguments) = serde_json::from_str(args_str) {
            calls.push(crate::types::ToolCall { name, arguments });
        }
    }

    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

/// Ensure Ollama and a model are ready
pub async fn ensure_ready(state: &Arc<AppState>) -> anyhow::Result<String> {
    let config = state.config.read().await;

    // Check if Ollama is running
    let url = format!("{}/api/version", config.ollama_url);
    if reqwest::get(&url).await.is_err() {
        if config.auto_start_ollama {
            try_start_ollama().await?;
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        } else {
            return Err(anyhow::anyhow!("Ollama is not running"));
        }
    }

    // Check if the default model is available
    let tags_url = format!("{}/api/tags", config.ollama_url);
    let resp = reqwest::get(&tags_url).await?;

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<OllamaModel>,
    }

    let tags: TagsResponse = resp.json().await?;
    let model_available = tags
        .models
        .iter()
        .any(|m| m.name == config.default_model || m.name.starts_with(&config.default_model));

    if !model_available {
        if config.auto_pull_model {
            // Pull the model
            let pull_url = format!("{}/api/pull", config.ollama_url);
            let client = reqwest::Client::new();
            client
                .post(&pull_url)
                .json(&serde_json::json!({
                    "name": config.default_model,
                    "stream": false
                }))
                .send()
                .await?;

            return Ok(format!(
                "Model '{}' pulled successfully",
                config.default_model
            ));
        } else {
            return Err(anyhow::anyhow!(
                "Model '{}' is not available",
                config.default_model
            ));
        }
    }

    Ok(format!("Ready with model '{}'", config.default_model))
}
