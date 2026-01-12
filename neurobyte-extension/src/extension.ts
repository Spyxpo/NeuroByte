import * as vscode from 'vscode';
import { NeuroByteCoreService } from './services/coreService';
import { OllamaService } from './services/ollamaService';
import { ChatViewProvider } from './providers/chatViewProvider';
import { PlanViewProvider } from './providers/planViewProvider';
import { ModelsViewProvider } from './providers/modelsViewProvider';
import { registerCommands } from './commands';

let coreService: NeuroByteCoreService;
let ollamaService: OllamaService;

export async function activate(context: vscode.ExtensionContext) {
    console.log('NeuroByte is activating...');

    // Initialize services
    coreService = new NeuroByteCoreService(context);
    ollamaService = new OllamaService(context);

    // Start the core service
    try {
        await coreService.start();
    } catch (error) {
        vscode.window.showWarningMessage(
            `NeuroByte Core failed to start: ${error}. Some features may be limited.`
        );
    }

    // Check Ollama status and setup if needed
    const ollamaStatus = await ollamaService.checkStatus();
    if (!ollamaStatus.running) {
        const action = await vscode.window.showInformationMessage(
            'Ollama is not running. Would you like to set it up?',
            'Setup Ollama',
            'Later'
        );
        if (action === 'Setup Ollama') {
            vscode.commands.executeCommand('neurobyte.setupOllama');
        }
    } else {
        // Check if we have a model
        const models = await ollamaService.listModels();
        if (models.length === 0) {
            const recommendation = await ollamaService.getRecommendedModel();
            const action = await vscode.window.showInformationMessage(
                `No models found. Would you like to download ${recommendation.recommended_model}? (${recommendation.reason})`,
                'Download',
                'Later'
            );
            if (action === 'Download') {
                await vscode.commands.executeCommand('neurobyte.pullModel', recommendation.recommended_model);
            }
        }
    }

    // Register view providers
    const chatViewProvider = new ChatViewProvider(context, coreService, ollamaService);
    const planViewProvider = new PlanViewProvider(context, coreService);
    const modelsViewProvider = new ModelsViewProvider(context, ollamaService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('neurobyte.chatView', chatViewProvider),
        vscode.window.registerTreeDataProvider('neurobyte.planView', planViewProvider),
        vscode.window.registerTreeDataProvider('neurobyte.modelsView', modelsViewProvider)
    );

    // Register commands
    registerCommands(context, coreService, ollamaService, chatViewProvider, planViewProvider, modelsViewProvider);

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'neurobyte.openChat';
    statusBarItem.text = '$(hubot) NeuroByte';
    statusBarItem.tooltip = 'Open NeuroByte Chat';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('neurobyte')) {
                ollamaService.reloadConfig();
            }
        })
    );

    console.log('NeuroByte activated successfully!');
}

export function deactivate() {
    if (coreService) {
        coreService.stop();
    }
}
