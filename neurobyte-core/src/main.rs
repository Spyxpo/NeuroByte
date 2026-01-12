use axum::{
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod device;
mod file_ops;
mod indexer;
mod ollama;
mod plan;
mod types;

use config::Config;
use types::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "neurobyte_core=debug,info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting NeuroByte Core Server...");

    // Detect device capabilities and configure
    let device_info = device::detect_device_capabilities();
    tracing::info!("Device capabilities detected: {:?}", device_info);

    // Load or create config
    let config = Config::load_or_create().await?;

    // Create app state
    let state = Arc::new(AppState::new(config, device_info));

    // Build router
    let app = Router::new()
        // Health and status
        .route("/health", get(health_check))
        .route("/device-info", get(get_device_info))
        // Ollama management
        .route("/ollama/status", get(ollama::check_ollama_status))
        .route("/ollama/models", get(ollama::list_models))
        .route("/ollama/pull", post(ollama::pull_model))
        .route("/ollama/recommend", get(ollama::recommend_model))
        // Chat and completion
        .route("/chat", post(ollama::chat))
        .route("/chat/stream", get(ollama::chat_stream_ws))
        // File operations
        .route("/files/read", post(file_ops::read_file))
        .route("/files/write", post(file_ops::write_file))
        .route("/files/edit", post(file_ops::edit_file))
        .route("/files/search", post(file_ops::search_files))
        .route("/files/glob", post(file_ops::glob_files))
        // Project indexing
        .route("/index/project", post(indexer::index_project))
        .route("/index/status", get(indexer::index_status))
        .route("/index/search", post(indexer::search_index))
        // Plan mode
        .route("/plan/create", post(plan::create_plan))
        .route("/plan/execute", post(plan::execute_plan))
        .route("/plan/status", get(plan::get_plan_status))
        // Config
        .route("/config", get(get_config))
        .route("/config", post(update_config))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    let port = std::env::var("NEUROBYTE_PORT")
        .unwrap_or_else(|_| "19285".to_string())
        .parse::<u16>()
        .unwrap_or(19285);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    tracing::info!("NeuroByte Core listening on http://127.0.0.1:{}", port);

    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn get_device_info(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(&state.device_info)
}

async fn get_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let config = state.config.read().await;
    Json(config.clone())
}

async fn update_config(
    State(state): State<Arc<AppState>>,
    Json(new_config): Json<Config>,
) -> impl IntoResponse {
    let mut config = state.config.write().await;
    *config = new_config.clone();
    if let Err(e) = config.save().await {
        tracing::error!("Failed to save config: {}", e);
    }
    Json(serde_json::json!({"status": "updated"}))
}
