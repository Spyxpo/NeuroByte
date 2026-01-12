use serde::{Deserialize, Serialize};
use sysinfo::System;

/// Device capability information for model selection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub total_memory_gb: f64,
    pub available_memory_gb: f64,
    pub cpu_cores: usize,
    pub cpu_brand: String,
    pub os: String,
    pub arch: String,
    pub has_gpu: bool,
    pub gpu_info: Option<GpuInfo>,
    pub device_tier: DeviceTier,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram_gb: Option<f64>,
    pub vendor: String,
}

/// Device tier for model recommendation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeviceTier {
    /// Low-end: < 8GB RAM, no dedicated GPU
    /// Recommended: qwen2.5:0.5b, tinyllama, phi3:mini
    Low,

    /// Medium: 8-16GB RAM, integrated GPU or entry-level discrete
    /// Recommended: qwen2.5:3b, phi3, llama3.2:3b, codellama:7b
    Medium,

    /// High: 16-32GB RAM, decent GPU (4-8GB VRAM)
    /// Recommended: qwen2.5:7b, llama3.1:8b, codellama:13b, deepseek-coder:6.7b
    High,

    /// Ultra: 32GB+ RAM, powerful GPU (8GB+ VRAM)
    /// Recommended: qwen2.5:14b, llama3.1:70b, codellama:34b, deepseek-coder:33b
    Ultra,
}

impl DeviceTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeviceTier::Low => "low",
            DeviceTier::Medium => "medium",
            DeviceTier::High => "high",
            DeviceTier::Ultra => "ultra",
        }
    }
}

/// Detect device capabilities
pub fn detect_device_capabilities() -> DeviceInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_memory_gb = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let available_memory_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let cpu_cores = sys.cpus().len();
    let cpu_brand = sys.cpus().first()
        .map(|cpu| cpu.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    // Try to detect GPU
    let (has_gpu, gpu_info) = detect_gpu(&os);

    // Determine device tier
    let device_tier = determine_tier(total_memory_gb, &gpu_info);

    DeviceInfo {
        total_memory_gb,
        available_memory_gb,
        cpu_cores,
        cpu_brand,
        os,
        arch,
        has_gpu,
        gpu_info,
        device_tier,
    }
}

fn detect_gpu(os: &str) -> (bool, Option<GpuInfo>) {
    match os {
        "macos" => detect_gpu_macos(),
        "linux" => detect_gpu_linux(),
        "windows" => detect_gpu_windows(),
        _ => (false, None),
    }
}

fn detect_gpu_macos() -> (bool, Option<GpuInfo>) {
    // On macOS, check for Apple Silicon or discrete GPU
    use std::process::Command;

    if let Ok(output) = Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
    {
        if let Ok(json_str) = String::from_utf8(output.stdout) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(displays) = json.get("SPDisplaysDataType").and_then(|v| v.as_array()) {
                    for display in displays {
                        if let Some(name) = display.get("sppci_model").and_then(|v| v.as_str()) {
                            let vendor = if name.contains("Apple") {
                                "Apple"
                            } else if name.contains("AMD") || name.contains("Radeon") {
                                "AMD"
                            } else if name.contains("NVIDIA") {
                                "NVIDIA"
                            } else if name.contains("Intel") {
                                "Intel"
                            } else {
                                "Unknown"
                            };

                            // Estimate VRAM for Apple Silicon (shared memory)
                            let vram_gb = if name.contains("Apple") {
                                None // Unified memory
                            } else {
                                display.get("sppci_vram")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| {
                                        s.split_whitespace()
                                            .next()
                                            .and_then(|n| n.parse::<f64>().ok())
                                    })
                            };

                            return (true, Some(GpuInfo {
                                name: name.to_string(),
                                vram_gb,
                                vendor: vendor.to_string(),
                            }));
                        }
                    }
                }
            }
        }
    }

    // Fallback: Check for Apple Silicon
    if std::env::consts::ARCH == "aarch64" {
        return (true, Some(GpuInfo {
            name: "Apple Silicon GPU".to_string(),
            vram_gb: None, // Unified memory
            vendor: "Apple".to_string(),
        }));
    }

    (false, None)
}

fn detect_gpu_linux() -> (bool, Option<GpuInfo>) {
    use std::process::Command;

    // Try nvidia-smi first
    if let Ok(output) = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                let parts: Vec<&str> = stdout.trim().split(',').collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: f64 = parts[1].trim().parse().unwrap_or(0.0);
                    return (true, Some(GpuInfo {
                        name,
                        vram_gb: Some(vram_mb / 1024.0),
                        vendor: "NVIDIA".to_string(),
                    }));
                }
            }
        }
    }

    // Try lspci for AMD/Intel
    if let Ok(output) = Command::new("lspci").output() {
        if let Ok(stdout) = String::from_utf8(output.stdout) {
            for line in stdout.lines() {
                if line.contains("VGA") || line.contains("3D") {
                    let vendor = if line.contains("AMD") || line.contains("ATI") {
                        "AMD"
                    } else if line.contains("Intel") {
                        "Intel"
                    } else if line.contains("NVIDIA") {
                        "NVIDIA"
                    } else {
                        continue;
                    };

                    return (true, Some(GpuInfo {
                        name: line.split(':').last().unwrap_or("Unknown GPU").trim().to_string(),
                        vram_gb: None,
                        vendor: vendor.to_string(),
                    }));
                }
            }
        }
    }

    (false, None)
}

fn detect_gpu_windows() -> (bool, Option<GpuInfo>) {
    use std::process::Command;

    // Use WMIC to query GPU info
    if let Ok(output) = Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "name,AdapterRAM", "/format:csv"])
        .output()
    {
        if let Ok(stdout) = String::from_utf8(output.stdout) {
            for line in stdout.lines().skip(1) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 3 {
                    let name = parts[2].trim().to_string();
                    if name.is_empty() {
                        continue;
                    }

                    let vram_bytes: u64 = parts[1].trim().parse().unwrap_or(0);
                    let vram_gb = if vram_bytes > 0 {
                        Some(vram_bytes as f64 / 1024.0 / 1024.0 / 1024.0)
                    } else {
                        None
                    };

                    let vendor = if name.contains("NVIDIA") {
                        "NVIDIA"
                    } else if name.contains("AMD") || name.contains("Radeon") {
                        "AMD"
                    } else if name.contains("Intel") {
                        "Intel"
                    } else {
                        "Unknown"
                    };

                    return (true, Some(GpuInfo {
                        name,
                        vram_gb,
                        vendor: vendor.to_string(),
                    }));
                }
            }
        }
    }

    (false, None)
}

fn determine_tier(total_memory_gb: f64, gpu_info: &Option<GpuInfo>) -> DeviceTier {
    let vram_gb = gpu_info.as_ref()
        .and_then(|g| g.vram_gb)
        .unwrap_or(0.0);

    let is_apple_silicon = gpu_info.as_ref()
        .map(|g| g.vendor == "Apple")
        .unwrap_or(false);

    // Apple Silicon uses unified memory effectively
    if is_apple_silicon {
        if total_memory_gb >= 32.0 {
            return DeviceTier::Ultra;
        } else if total_memory_gb >= 16.0 {
            return DeviceTier::High;
        } else if total_memory_gb >= 8.0 {
            return DeviceTier::Medium;
        } else {
            return DeviceTier::Low;
        }
    }

    // For discrete GPU systems
    if vram_gb >= 8.0 && total_memory_gb >= 32.0 {
        DeviceTier::Ultra
    } else if (vram_gb >= 4.0 || total_memory_gb >= 16.0) && total_memory_gb >= 16.0 {
        DeviceTier::High
    } else if total_memory_gb >= 8.0 {
        DeviceTier::Medium
    } else {
        DeviceTier::Low
    }
}

/// Get recommended models for a device tier
pub fn get_recommended_models(tier: DeviceTier) -> Vec<&'static str> {
    match tier {
        DeviceTier::Low => vec![
            "qwen2.5:0.5b",
            "qwen2.5:1.5b",
            "tinyllama",
            "phi3:mini",
            "codegemma:2b",
        ],
        DeviceTier::Medium => vec![
            "qwen2.5:3b",
            "qwen2.5:7b",
            "phi3",
            "llama3.2:3b",
            "codellama:7b",
            "deepseek-coder:1.3b",
            "codegemma:7b",
        ],
        DeviceTier::High => vec![
            "qwen2.5:7b",
            "qwen2.5:14b",
            "llama3.1:8b",
            "codellama:13b",
            "deepseek-coder:6.7b",
            "codegemma:7b",
            "mistral",
        ],
        DeviceTier::Ultra => vec![
            "qwen2.5:14b",
            "qwen2.5:32b",
            "llama3.1:70b",
            "codellama:34b",
            "deepseek-coder:33b",
            "mixtral",
        ],
    }
}
