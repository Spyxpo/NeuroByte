use axum::{extract::State, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

use crate::types::AppState;

/// Plan state for tracking multi-step operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanState {
    pub id: String,
    pub title: String,
    pub description: String,
    pub steps: Vec<PlanStep>,
    pub current_step: usize,
    pub status: PlanStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: usize,
    pub title: String,
    pub description: String,
    pub status: StepStatus,
    pub actions: Vec<PlanAction>,
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PlanStatus {
    Draft,
    AwaitingApproval,
    InProgress,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanAction {
    pub action_type: ActionType,
    pub target: String,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionType {
    ReadFile,
    WriteFile,
    EditFile,
    CreateFile,
    DeleteFile,
    RunCommand,
    Search,
    AskUser,
}

/// Request to create a new plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlanRequest {
    pub title: String,
    pub description: String,
    pub steps: Vec<CreatePlanStep>,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlanStep {
    pub title: String,
    pub description: String,
    pub actions: Vec<PlanAction>,
}

/// Request to execute a plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutePlanRequest {
    pub plan_id: Option<String>,
    pub step_index: Option<usize>,
    pub auto_continue: Option<bool>,
}

/// Create a new plan
pub async fn create_plan(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePlanRequest>,
) -> impl IntoResponse {
    let config = state.config.read().await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let plan_id = uuid::Uuid::new_v4().to_string();

    let steps: Vec<PlanStep> = req
        .steps
        .into_iter()
        .enumerate()
        .map(|(i, s)| PlanStep {
            id: i,
            title: s.title,
            description: s.description,
            status: StepStatus::Pending,
            actions: s.actions,
            result: None,
        })
        .collect();

    let plan = PlanState {
        id: plan_id.clone(),
        title: req.title.clone(),
        description: req.description.clone(),
        steps,
        current_step: 0,
        status: if config.plan_mode.require_approval {
            PlanStatus::AwaitingApproval
        } else {
            PlanStatus::Draft
        },
        created_at: now,
        updated_at: now,
    };

    // Save plan to file if configured
    if config.plan_mode.auto_save {
        if let Some(workspace_path) = &req.workspace_path {
            let plan_file = format!("{}/{}", workspace_path, config.plan_mode.plan_file);
            let plan_content = format_plan_markdown(&plan);

            if let Some(parent) = std::path::Path::new(&plan_file).parent() {
                let _ = fs::create_dir_all(parent).await;
            }

            let _ = fs::write(&plan_file, plan_content).await;
        }
    }

    // Store the plan in state
    {
        let mut plan_state = state.plan_state.write().await;
        *plan_state = Some(plan.clone());
    }

    Json(serde_json::json!({
        "success": true,
        "plan": plan
    }))
}

/// Execute a plan or specific step
pub async fn execute_plan(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExecutePlanRequest>,
) -> impl IntoResponse {
    let mut plan_lock = state.plan_state.write().await;

    let plan = match &mut *plan_lock {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "error": "No active plan. Create a plan first."
            }))
        }
    };

    // Check if plan is approved
    if matches!(plan.status, PlanStatus::AwaitingApproval) {
        return Json(serde_json::json!({
            "success": false,
            "error": "Plan is awaiting approval. Approve the plan first.",
            "plan": plan.clone()
        }));
    }

    plan.status = PlanStatus::InProgress;

    let step_index = req.step_index.unwrap_or(plan.current_step);

    if step_index >= plan.steps.len() {
        plan.status = PlanStatus::Completed;
        return Json(serde_json::json!({
            "success": true,
            "message": "All steps completed",
            "plan": plan.clone()
        }));
    }

    let step = &mut plan.steps[step_index];
    step.status = StepStatus::InProgress;

    // Execute each action in the step
    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut all_success = true;

    for action in &step.actions {
        let result = execute_action(action).await;
        let success = result
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if !success {
            all_success = false;
        }

        results.push(result);
    }

    if all_success {
        step.status = StepStatus::Completed;
        step.result = Some(serde_json::to_string_pretty(&results).unwrap_or_default());
        plan.current_step = step_index + 1;

        // Check if we should continue to next step
        if req.auto_continue.unwrap_or(false) && plan.current_step < plan.steps.len() {
            drop(plan_lock);
            // Recursive call for next step
            return execute_plan(
                State(state.clone()),
                Json(ExecutePlanRequest {
                    plan_id: req.plan_id,
                    step_index: None,
                    auto_continue: Some(true),
                }),
            )
            .await;
        }
    } else {
        step.status = StepStatus::Failed;
        step.result = Some(serde_json::to_string_pretty(&results).unwrap_or_default());
        plan.status = PlanStatus::Paused;
    }

    let plan_clone = plan.clone();

    Json(serde_json::json!({
        "success": all_success,
        "step_index": step_index,
        "results": results,
        "plan": plan_clone
    }))
}

/// Get current plan status
pub async fn get_plan_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let plan_state = state.plan_state.read().await;

    match &*plan_state {
        Some(plan) => Json(serde_json::json!({
            "has_plan": true,
            "plan": plan
        })),
        None => Json(serde_json::json!({
            "has_plan": false
        })),
    }
}

/// Execute a single action
async fn execute_action(action: &PlanAction) -> serde_json::Value {
    match action.action_type {
        ActionType::ReadFile => {
            let path = action.target.clone();
            match fs::read_to_string(&path).await {
                Ok(content) => serde_json::json!({
                    "success": true,
                    "action": "read_file",
                    "path": path,
                    "content": content
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "action": "read_file",
                    "error": e.to_string()
                }),
            }
        }
        ActionType::WriteFile | ActionType::CreateFile => {
            let path = action.target.clone();
            let content = action
                .details
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // Create parent directories
            if let Some(parent) = std::path::Path::new(&path).parent() {
                let _ = fs::create_dir_all(parent).await;
            }

            match fs::write(&path, content).await {
                Ok(_) => serde_json::json!({
                    "success": true,
                    "action": "write_file",
                    "path": path
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "action": "write_file",
                    "error": e.to_string()
                }),
            }
        }
        ActionType::EditFile => {
            let path = action.target.clone();
            let old_text = action
                .details
                .get("old_text")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let new_text = action
                .details
                .get("new_text")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match fs::read_to_string(&path).await {
                Ok(content) => {
                    if !content.contains(old_text) {
                        return serde_json::json!({
                            "success": false,
                            "action": "edit_file",
                            "error": "old_text not found in file"
                        });
                    }

                    let new_content = content.replacen(old_text, new_text, 1);
                    match fs::write(&path, new_content).await {
                        Ok(_) => serde_json::json!({
                            "success": true,
                            "action": "edit_file",
                            "path": path
                        }),
                        Err(e) => serde_json::json!({
                            "success": false,
                            "action": "edit_file",
                            "error": e.to_string()
                        }),
                    }
                }
                Err(e) => serde_json::json!({
                    "success": false,
                    "action": "edit_file",
                    "error": e.to_string()
                }),
            }
        }
        ActionType::DeleteFile => {
            let path = action.target.clone();
            match fs::remove_file(&path).await {
                Ok(_) => serde_json::json!({
                    "success": true,
                    "action": "delete_file",
                    "path": path
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "action": "delete_file",
                    "error": e.to_string()
                }),
            }
        }
        ActionType::RunCommand => {
            let command = action.target.clone();
            let cwd = action
                .details
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or(".");

            match tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&command)
                .current_dir(cwd)
                .output()
                .await
            {
                Ok(output) => serde_json::json!({
                    "success": output.status.success(),
                    "action": "run_command",
                    "command": command,
                    "stdout": String::from_utf8_lossy(&output.stdout),
                    "stderr": String::from_utf8_lossy(&output.stderr),
                    "exit_code": output.status.code()
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "action": "run_command",
                    "error": e.to_string()
                }),
            }
        }
        ActionType::Search | ActionType::AskUser => {
            // These require interaction with the extension
            serde_json::json!({
                "success": true,
                "action": format!("{:?}", action.action_type),
                "requires_interaction": true,
                "details": action.details
            })
        }
    }
}

/// Format plan as Markdown for saving
fn format_plan_markdown(plan: &PlanState) -> String {
    let mut md = String::new();

    md.push_str(&format!("# {}\n\n", plan.title));
    md.push_str(&format!("{}\n\n", plan.description));
    md.push_str(&format!("**Status:** {:?}\n\n", plan.status));
    md.push_str("---\n\n");
    md.push_str("## Steps\n\n");

    for step in &plan.steps {
        let status_icon = match step.status {
            StepStatus::Pending => "⏳",
            StepStatus::InProgress => "🔄",
            StepStatus::Completed => "✅",
            StepStatus::Failed => "❌",
            StepStatus::Skipped => "⏭️",
        };

        md.push_str(&format!(
            "### {} Step {}: {}\n\n",
            status_icon,
            step.id + 1,
            step.title
        ));
        md.push_str(&format!("{}\n\n", step.description));

        if !step.actions.is_empty() {
            md.push_str("**Actions:**\n");
            for action in &step.actions {
                md.push_str(&format!(
                    "- `{:?}` on `{}`\n",
                    action.action_type, action.target
                ));
            }
            md.push('\n');
        }

        if let Some(result) = &step.result {
            md.push_str("**Result:**\n```json\n");
            md.push_str(result);
            md.push_str("\n```\n\n");
        }
    }

    md
}
