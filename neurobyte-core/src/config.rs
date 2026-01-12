use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

/// NeuroByte configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Ollama server URL
    pub ollama_url: String,

    /// Default model to use
    pub default_model: String,

    /// Auto-start Ollama if not running
    pub auto_start_ollama: bool,

    /// Auto-pull recommended model if not available
    pub auto_pull_model: bool,

    /// Maximum context length for chat
    pub max_context_length: usize,

    /// Temperature for generation
    pub temperature: f32,

    /// Top-p sampling
    pub top_p: f32,

    /// File patterns to exclude from indexing
    pub exclude_patterns: Vec<String>,

    /// Maximum file size to index (in bytes)
    pub max_file_size: usize,

    /// Enable streaming responses
    pub streaming: bool,

    /// Plan mode settings
    pub plan_mode: PlanModeConfig,

    /// System prompt for the assistant
    pub system_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanModeConfig {
    /// Auto-save plan to file
    pub auto_save: bool,

    /// Plan file name
    pub plan_file: String,

    /// Require user approval before execution
    pub require_approval: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            ollama_url: "http://127.0.0.1:11434".to_string(),
            default_model: "qwen2.5:7b".to_string(),
            auto_start_ollama: true,
            auto_pull_model: true,
            max_context_length: 8192,
            temperature: 0.7,
            top_p: 0.9,
            exclude_patterns: vec![
                "**/node_modules/**".to_string(),
                "**/.git/**".to_string(),
                "**/target/**".to_string(),
                "**/dist/**".to_string(),
                "**/build/**".to_string(),
                "**/__pycache__/**".to_string(),
                "**/.venv/**".to_string(),
                "**/venv/**".to_string(),
                "**/*.lock".to_string(),
                "**/package-lock.json".to_string(),
                "**/.DS_Store".to_string(),
            ],
            max_file_size: 1024 * 1024, // 1MB
            streaming: true,
            plan_mode: PlanModeConfig {
                auto_save: true,
                plan_file: ".neurobyte/plan.md".to_string(),
                require_approval: true,
            },
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

const DEFAULT_SYSTEM_PROMPT: &str = r#"You are NeuroByte, an intelligent AI coding assistant integrated into VS Code. You have full access to the user's project and can:

1. **Read files**: View any file in the project
2. **Edit files**: Make precise edits to existing files
3. **Write files**: Create new files when needed
4. **Search**: Search for patterns across the codebase
5. **Plan**: Create and execute multi-step plans

## Guidelines:
- Always read files before suggesting modifications
- Make minimal, focused changes
- Explain your reasoning
- Ask for clarification when requirements are ambiguous
- Use the project's existing patterns and conventions
- Be concise but thorough

## Tool Usage:
When you need to perform actions, use the following format:
<tool name="tool_name">
{json_arguments}
</tool>

Available tools:
- read_file: Read a file's contents
- write_file: Write/create a file
- edit_file: Make precise edits to a file
- search: Search for patterns in files
- glob: Find files matching a pattern
- run_command: Execute a shell command

Always think through your approach before taking action.
"#;

impl Config {
    /// Get the config file path
    fn config_path() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".neurobyte").join("config.json")
    }

    /// Load config from file or create default
    pub async fn load_or_create() -> anyhow::Result<Self> {
        let path = Self::config_path();

        if path.exists() {
            let content = fs::read_to_string(&path).await?;
            let config: Config = serde_json::from_str(&content)?;
            Ok(config)
        } else {
            let config = Config::default();
            config.save().await?;
            Ok(config)
        }
    }

    /// Save config to file
    pub async fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path();

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content).await?;
        Ok(())
    }
}

// Add dirs crate to Cargo.toml - for now, implement a simple fallback
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .ok()
            .map(PathBuf::from)
    }
}
