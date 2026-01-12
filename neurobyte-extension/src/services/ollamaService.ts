import * as vscode from 'vscode';
import axios from 'axios';
import { spawn, exec } from 'child_process';
import * as os from 'os';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    stream?: boolean;
    context?: {
        workspace_path?: string;
        current_file?: string;
        selected_text?: string;
        file_contents?: Record<string, string>;
    };
}

export interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    modified_at: string;
    details?: {
        format?: string;
        family?: string;
        parameter_size?: string;
        quantization_level?: string;
    };
}

export interface ModelRecommendation {
    recommended_model: string;
    reason: string;
    alternatives: string[];
    device_tier: string;
}

export class OllamaService {
    private context: vscode.ExtensionContext;
    private ollamaUrl: string;
    private coreUrl: string = 'http://127.0.0.1:19285';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.ollamaUrl = this.getOllamaUrl();
    }

    private getOllamaUrl(): string {
        const config = vscode.workspace.getConfiguration('neurobyte');
        return config.get('ollamaUrl', 'http://127.0.0.1:11434');
    }

    reloadConfig(): void {
        this.ollamaUrl = this.getOllamaUrl();
    }

    async checkStatus(): Promise<{ running: boolean; version?: string; error?: string }> {
        try {
            const response = await axios.get(`${this.coreUrl}/ollama/status`, { timeout: 5000 });
            return response.data;
        } catch {
            // Fallback to direct Ollama check
            try {
                const response = await axios.get(`${this.ollamaUrl}/api/version`, { timeout: 3000 });
                return { running: true, version: response.data.version };
            } catch {
                return { running: false, error: 'Ollama is not running' };
            }
        }
    }

    async listModels(): Promise<OllamaModel[]> {
        try {
            const response = await axios.get(`${this.coreUrl}/ollama/models`);
            if (response.data.success) {
                return response.data.models;
            }
            return [];
        } catch {
            // Fallback to direct Ollama
            try {
                const response = await axios.get(`${this.ollamaUrl}/api/tags`);
                return response.data.models || [];
            } catch {
                return [];
            }
        }
    }

    async getRecommendedModel(): Promise<ModelRecommendation> {
        try {
            const response = await axios.get(`${this.coreUrl}/ollama/recommend`);
            return response.data;
        } catch {
            // Fallback recommendation based on OS
            const totalMem = os.totalmem() / (1024 * 1024 * 1024);
            if (totalMem >= 32) {
                return {
                    recommended_model: 'qwen2.5:14b',
                    reason: `Your device has ${totalMem.toFixed(1)}GB RAM`,
                    alternatives: ['qwen2.5:7b', 'llama3.1:8b', 'codellama:13b'],
                    device_tier: 'high'
                };
            } else if (totalMem >= 16) {
                return {
                    recommended_model: 'qwen2.5:7b',
                    reason: `Your device has ${totalMem.toFixed(1)}GB RAM`,
                    alternatives: ['qwen2.5:3b', 'llama3.2:3b', 'codellama:7b'],
                    device_tier: 'medium'
                };
            } else if (totalMem >= 8) {
                return {
                    recommended_model: 'qwen2.5:3b',
                    reason: `Your device has ${totalMem.toFixed(1)}GB RAM`,
                    alternatives: ['phi3', 'tinyllama', 'codegemma:2b'],
                    device_tier: 'medium'
                };
            } else {
                return {
                    recommended_model: 'qwen2.5:0.5b',
                    reason: `Your device has ${totalMem.toFixed(1)}GB RAM - recommending lightweight model`,
                    alternatives: ['tinyllama', 'phi3:mini'],
                    device_tier: 'low'
                };
            }
        }
    }

    async pullModel(modelName: string, onProgress?: (status: string) => void): Promise<boolean> {
        return new Promise(async (resolve) => {
            try {
                onProgress?.(`Starting download of ${modelName}...`);

                const response = await axios.post(`${this.ollamaUrl}/api/pull`, {
                    name: modelName,
                    stream: true
                }, {
                    responseType: 'stream'
                });

                response.data.on('data', (chunk: Buffer) => {
                    try {
                        const lines = chunk.toString().split('\n').filter(Boolean);
                        for (const line of lines) {
                            const data = JSON.parse(line);
                            if (data.status) {
                                let status = data.status;
                                if (data.completed && data.total) {
                                    const percent = ((data.completed / data.total) * 100).toFixed(1);
                                    status = `${data.status} ${percent}%`;
                                }
                                onProgress?.(status);
                            }
                        }
                    } catch { }
                });

                response.data.on('end', () => {
                    onProgress?.(`${modelName} downloaded successfully!`);
                    resolve(true);
                });

                response.data.on('error', () => {
                    resolve(false);
                });

            } catch (error) {
                onProgress?.(`Failed to download: ${error}`);
                resolve(false);
            }
        });
    }

    async chat(request: ChatRequest): Promise<any> {
        const config = vscode.workspace.getConfiguration('neurobyte');
        const model = request.model || config.get('defaultModel', 'qwen2.5:7b');
        const temperature = config.get('temperature', 0.7);
        const maxContext = config.get('maxContextLength', 8192);

        // Build system prompt with context
        const systemPrompt = this.buildSystemPrompt(request.context);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...request.messages
        ];

        try {
            const response = await axios.post(`${this.ollamaUrl}/api/chat`, {
                model,
                messages,
                stream: false,
                options: {
                    temperature,
                    num_ctx: maxContext
                }
            });

            return {
                success: true,
                message: response.data.message,
                model: response.data.model
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async *chatStream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
        const config = vscode.workspace.getConfiguration('neurobyte');
        const model = request.model || config.get('defaultModel', 'qwen2.5:7b');
        const temperature = config.get('temperature', 0.7);
        const maxContext = config.get('maxContextLength', 8192);

        const systemPrompt = this.buildSystemPrompt(request.context);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...request.messages
        ];

        try {
            const response = await axios.post(`${this.ollamaUrl}/api/chat`, {
                model,
                messages,
                stream: true,
                options: {
                    temperature,
                    num_ctx: maxContext
                }
            }, {
                responseType: 'stream'
            });

            for await (const chunk of response.data) {
                const lines = chunk.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                    } catch { }
                }
            }
        } catch (error: any) {
            yield `Error: ${error.message}`;
        }
    }

    private buildSystemPrompt(context?: ChatRequest['context']): string {
        let prompt = `You are NeuroByte, an intelligent AI coding assistant. You help developers write, debug, and understand code.

You have access to the following tools:
- read_file: Read file contents
- write_file: Write/create files
- edit_file: Make precise edits (specify old_text and new_text)
- search: Search for patterns in files
- glob: Find files matching patterns
- run_command: Execute shell commands

When you need to use a tool, format it as:
<tool name="tool_name">
{"param": "value"}
</tool>

Guidelines:
- Always read files before modifying them
- Make minimal, focused changes
- Explain your reasoning
- Ask for clarification when needed
- Follow the project's existing patterns
`;

        if (context) {
            prompt += '\n\n--- Current Context ---\n';

            if (context.workspace_path) {
                prompt += `Workspace: ${context.workspace_path}\n`;
            }

            if (context.current_file) {
                prompt += `Current file: ${context.current_file}\n`;
            }

            if (context.selected_text) {
                prompt += `\nSelected code:\n\`\`\`\n${context.selected_text}\n\`\`\`\n`;
            }

            if (context.file_contents) {
                prompt += '\nRelevant files:\n';
                for (const [file, content] of Object.entries(context.file_contents)) {
                    prompt += `\n--- ${file} ---\n${content}\n`;
                }
            }
        }

        return prompt;
    }

    async installOllama(): Promise<boolean> {
        const platform = os.platform();

        return new Promise((resolve) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Installing Ollama...',
                cancellable: false
            }, async (progress) => {
                try {
                    if (platform === 'darwin') {
                        // macOS - use homebrew or curl
                        progress.report({ message: 'Downloading Ollama for macOS...' });
                        const result = await this.runCommand('curl -fsSL https://ollama.com/install.sh | sh');
                        resolve(result);
                    } else if (platform === 'linux') {
                        // Linux - use curl script
                        progress.report({ message: 'Downloading Ollama for Linux...' });
                        const result = await this.runCommand('curl -fsSL https://ollama.com/install.sh | sh');
                        resolve(result);
                    } else if (platform === 'win32') {
                        // Windows - open download page
                        progress.report({ message: 'Opening Ollama download page...' });
                        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
                        vscode.window.showInformationMessage(
                            'Please download and install Ollama from the opened page, then restart VS Code.'
                        );
                        resolve(true);
                    } else {
                        vscode.window.showErrorMessage(`Unsupported platform: ${platform}`);
                        resolve(false);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to install Ollama: ${error}`);
                    resolve(false);
                }
            });
        });
    }

    async startOllama(): Promise<boolean> {
        const platform = os.platform();

        try {
            if (platform === 'darwin' || platform === 'linux') {
                spawn('ollama', ['serve'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();

                // Wait for Ollama to start
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const status = await this.checkStatus();
                    if (status.running) {
                        return true;
                    }
                }
            } else if (platform === 'win32') {
                spawn('ollama', ['serve'], {
                    detached: true,
                    stdio: 'ignore',
                    shell: true
                }).unref();

                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const status = await this.checkStatus();
                    if (status.running) {
                        return true;
                    }
                }
            }
            return false;
        } catch {
            return false;
        }
    }

    private runCommand(command: string): Promise<boolean> {
        return new Promise((resolve) => {
            exec(command, (error) => {
                resolve(!error);
            });
        });
    }

    async getDefaultModel(): Promise<string> {
        const config = vscode.workspace.getConfiguration('neurobyte');
        const configuredModel = config.get<string>('defaultModel');

        if (configuredModel) {
            return configuredModel;
        }

        // Get recommendation based on device
        const recommendation = await this.getRecommendedModel();
        return recommendation.recommended_model;
    }
}
