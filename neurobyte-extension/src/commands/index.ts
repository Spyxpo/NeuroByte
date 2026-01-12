import * as vscode from 'vscode';
import { NeuroByteCoreService } from '../services/coreService';
import { OllamaService } from '../services/ollamaService';
import { ChatViewProvider } from '../providers/chatViewProvider';
import { PlanViewProvider } from '../providers/planViewProvider';
import { ModelsViewProvider } from '../providers/modelsViewProvider';

export function registerCommands(
    context: vscode.ExtensionContext,
    coreService: NeuroByteCoreService,
    ollamaService: OllamaService,
    chatViewProvider: ChatViewProvider,
    planViewProvider: PlanViewProvider,
    modelsViewProvider: ModelsViewProvider
): void {

    // Open Chat
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.openChat', () => {
            vscode.commands.executeCommand('neurobyte.chatView.focus');
        })
    );

    // Ask About Selection
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.askAboutSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('No text selected');
                return;
            }

            const selectedText = editor.document.getText(selection);
            const question = await vscode.window.showInputBox({
                prompt: 'What would you like to know about this code?',
                placeHolder: 'e.g., What does this function do?'
            });

            if (question) {
                vscode.commands.executeCommand('neurobyte.chatView.focus');
                chatViewProvider.addContextMessage(
                    `About this code:\n\`\`\`\n${selectedText}\n\`\`\`\n\n${question}`
                );
            }
        })
    );

    // Explain Code
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.explainCode', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Please select some code first');
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            vscode.commands.executeCommand('neurobyte.chatView.focus');
            chatViewProvider.addContextMessage(
                `Please explain this code in detail:\n\`\`\`\n${selectedText}\n\`\`\``
            );
        })
    );

    // Fix Code
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.fixCode', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Please select some code first');
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            vscode.commands.executeCommand('neurobyte.chatView.focus');
            chatViewProvider.addContextMessage(
                `Please identify and fix any issues in this code:\n\`\`\`\n${selectedText}\n\`\`\``
            );
        })
    );

    // Refactor Code
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.refactorCode', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Please select some code first');
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            vscode.commands.executeCommand('neurobyte.chatView.focus');
            chatViewProvider.addContextMessage(
                `Please refactor this code to improve its quality and maintainability:\n\`\`\`\n${selectedText}\n\`\`\``
            );
        })
    );

    // Generate Tests
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.generateTests', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Please select some code first');
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            const fileName = editor.document.fileName;
            vscode.commands.executeCommand('neurobyte.chatView.focus');
            chatViewProvider.addContextMessage(
                `Please generate unit tests for this code from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``
            );
        })
    );

    // Add Documentation
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.addDocumentation', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('Please select some code first');
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            vscode.commands.executeCommand('neurobyte.chatView.focus');
            chatViewProvider.addContextMessage(
                `Please add comprehensive documentation/comments to this code:\n\`\`\`\n${selectedText}\n\`\`\``
            );
        })
    );

    // Enter Plan Mode
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.enterPlanMode', async () => {
            const title = await vscode.window.showInputBox({
                prompt: 'Enter a title for your plan',
                placeHolder: 'e.g., Implement user authentication'
            });

            if (!title) return;

            const description = await vscode.window.showInputBox({
                prompt: 'Describe what you want to accomplish',
                placeHolder: 'e.g., Add login, logout, and session management'
            });

            if (!description) return;

            // Ask LLM to generate a plan
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Creating plan...',
                cancellable: false
            }, async () => {
                try {
                    const response = await ollamaService.chat({
                        messages: [{
                            role: 'user',
                            content: `Create a detailed implementation plan for: "${title}"\n\nDescription: ${description}\n\nProvide a step-by-step plan in this JSON format:\n{\n  "steps": [\n    {\n      "title": "Step title",\n      "description": "What this step accomplishes",\n      "actions": []\n    }\n  ]\n}\n\nOnly output the JSON, no other text.`
                        }]
                    });

                    if (response.success) {
                        const jsonMatch = response.message.content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const planData = JSON.parse(jsonMatch[0]);
                            await planViewProvider.createPlan(title, description, planData.steps);
                            vscode.window.showInformationMessage('Plan created! Review it in the Plan panel.');
                        }
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to create plan: ${error.message}`);
                }
            });
        })
    );

    // Approve Plan
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.approvePlan', async () => {
            const plan = planViewProvider.getCurrentPlan();
            if (!plan) {
                vscode.window.showWarningMessage('No active plan to approve');
                return;
            }

            const action = await vscode.window.showInformationMessage(
                `Approve plan: "${plan.title}"?`,
                'Approve & Execute',
                'Approve Only',
                'Cancel'
            );

            if (action === 'Approve & Execute') {
                await planViewProvider.executePlan(undefined, true);
            } else if (action === 'Approve Only') {
                // Just update the status
                vscode.window.showInformationMessage('Plan approved. Execute steps manually.');
            }
        })
    );

    // Select Model
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.selectModel', async (modelName?: string) => {
            if (!modelName) {
                const models = modelsViewProvider.getModels();
                if (models.length === 0) {
                    vscode.window.showWarningMessage('No models available. Pull a model first.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    models.map(m => ({
                        label: m.name,
                        description: `${(m.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
                        detail: m.details?.parameter_size || ''
                    })),
                    { placeHolder: 'Select a model' }
                );

                if (selected) {
                    modelName = selected.label;
                }
            }

            if (modelName) {
                const config = vscode.workspace.getConfiguration('neurobyte');
                await config.update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Default model set to: ${modelName}`);
                modelsViewProvider.refresh();
            }
        })
    );

    // Pull Model
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.pullModel', async (modelName?: string) => {
            if (!modelName) {
                const recommendation = await ollamaService.getRecommendedModel();
                const allModels = [
                    recommendation.recommended_model,
                    ...recommendation.alternatives
                ];

                const selected = await vscode.window.showQuickPick(
                    [
                        ...allModels.map((m, i) => ({
                            label: m,
                            description: i === 0 ? '(Recommended)' : '',
                            detail: recommendation.reason
                        })),
                        { label: 'Other...', description: '', detail: 'Enter a custom model name' }
                    ],
                    { placeHolder: 'Select a model to download' }
                );

                if (!selected) return;

                if (selected.label === 'Other...') {
                    modelName = await vscode.window.showInputBox({
                        prompt: 'Enter model name (e.g., llama3.1:8b)',
                        placeHolder: 'model:tag'
                    });
                } else {
                    modelName = selected.label;
                }
            }

            if (!modelName) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Downloading ${modelName}`,
                cancellable: false
            }, async (progress) => {
                const success = await ollamaService.pullModel(modelName!, (status) => {
                    progress.report({ message: status });
                });

                if (success) {
                    vscode.window.showInformationMessage(`Model ${modelName} downloaded successfully!`);
                    modelsViewProvider.refresh();
                } else {
                    vscode.window.showErrorMessage(`Failed to download ${modelName}`);
                }
            });
        })
    );

    // Show Device Info
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.showDeviceInfo', async () => {
            try {
                const deviceInfo = await coreService.getDeviceInfo();
                const recommendation = await ollamaService.getRecommendedModel();

                const info = `
Device Information:
-------------------
RAM: ${deviceInfo.total_memory_gb.toFixed(1)} GB total, ${deviceInfo.available_memory_gb.toFixed(1)} GB available
CPU: ${deviceInfo.cpu_brand} (${deviceInfo.cpu_cores} cores)
GPU: ${deviceInfo.has_gpu ? deviceInfo.gpu_info?.name || 'Yes' : 'None detected'}
OS: ${deviceInfo.os} (${deviceInfo.arch})
Device Tier: ${deviceInfo.device_tier}

Recommended Model: ${recommendation.recommended_model}
Reason: ${recommendation.reason}
                `.trim();

                vscode.window.showInformationMessage(info, { modal: true });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to get device info: ${error.message}`);
            }
        })
    );

    // Index Project
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.indexProject', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing project...',
                cancellable: false
            }, async () => {
                try {
                    const result = await coreService.indexProject({
                        workspace_path: workspaceFolders[0].uri.fsPath
                    });

                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `Indexed ${result.stats.total_files} files (${result.stats.total_lines} lines)`
                        );
                    } else {
                        vscode.window.showErrorMessage(`Indexing failed: ${result.error}`);
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Indexing failed: ${error.message}`);
                }
            });
        })
    );

    // Setup Ollama
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.setupOllama', async () => {
            const status = await ollamaService.checkStatus();

            if (status.running) {
                const models = await ollamaService.listModels();
                if (models.length === 0) {
                    const action = await vscode.window.showInformationMessage(
                        'Ollama is running but no models are installed. Would you like to download a model?',
                        'Download Model',
                        'Cancel'
                    );
                    if (action === 'Download Model') {
                        vscode.commands.executeCommand('neurobyte.pullModel');
                    }
                } else {
                    vscode.window.showInformationMessage(
                        `Ollama is running with ${models.length} model(s) installed.`
                    );
                }
                return;
            }

            const action = await vscode.window.showInformationMessage(
                'Ollama is not running. What would you like to do?',
                'Install Ollama',
                'Start Ollama',
                'Cancel'
            );

            if (action === 'Install Ollama') {
                const success = await ollamaService.installOllama();
                if (success) {
                    // Try to start it
                    await ollamaService.startOllama();
                    modelsViewProvider.refresh();
                }
            } else if (action === 'Start Ollama') {
                const started = await ollamaService.startOllama();
                if (started) {
                    vscode.window.showInformationMessage('Ollama started successfully!');
                    modelsViewProvider.refresh();
                } else {
                    vscode.window.showErrorMessage('Failed to start Ollama. Is it installed?');
                }
            }
        })
    );

    // Open Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'neurobyte');
        })
    );

    // Execute Step (for plan view)
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.executeStep', async (stepIndex: number) => {
            try {
                const result = await planViewProvider.executePlan(stepIndex, false);
                if (result.success) {
                    vscode.window.showInformationMessage(`Step ${stepIndex + 1} completed!`);
                } else {
                    vscode.window.showErrorMessage(`Step ${stepIndex + 1} failed: ${result.error || 'Unknown error'}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to execute step: ${error.message}`);
            }
        })
    );

    // Refresh views
    context.subscriptions.push(
        vscode.commands.registerCommand('neurobyte.refreshPlan', () => {
            planViewProvider.refresh();
        }),
        vscode.commands.registerCommand('neurobyte.refreshModels', () => {
            modelsViewProvider.refresh();
        })
    );
}
