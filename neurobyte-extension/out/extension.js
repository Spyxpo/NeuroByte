"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const coreService_1 = require("./services/coreService");
const ollamaService_1 = require("./services/ollamaService");
const chatViewProvider_1 = require("./providers/chatViewProvider");
const chatPanelProvider_1 = require("./providers/chatPanelProvider");
const planViewProvider_1 = require("./providers/planViewProvider");
const modelsViewProvider_1 = require("./providers/modelsViewProvider");
const commands_1 = require("./commands");
let coreService;
let ollamaService;
async function activate(context) {
    console.log('NeuroByte is activating...');
    // Initialize services
    coreService = new coreService_1.NeuroByteCoreService(context);
    ollamaService = new ollamaService_1.OllamaService(context);
    // Start the core service
    try {
        await coreService.start();
    }
    catch (error) {
        vscode.window.showWarningMessage(`NeuroByte Core failed to start: ${error}. Some features may be limited.`);
    }
    // Check Ollama status and auto-start if needed
    let ollamaStatus = await ollamaService.checkStatus();
    if (!ollamaStatus.running) {
        // Try to auto-start Ollama in the background
        console.log('Ollama not running, attempting to start...');
        const started = await ollamaService.startOllama();
        if (started) {
            console.log('Ollama started successfully');
            ollamaStatus = { running: true };
        }
        else {
            // Only prompt user if auto-start failed
            const action = await vscode.window.showInformationMessage('Ollama is not running and could not be started automatically. Would you like to set it up?', 'Setup Ollama', 'Later');
            if (action === 'Setup Ollama') {
                vscode.commands.executeCommand('neurobyte.setupOllama');
            }
        }
    }
    if (ollamaStatus.running) {
        // Check if we have a model
        const models = await ollamaService.listModels();
        if (models.length === 0) {
            const recommendation = await ollamaService.getRecommendedModel();
            const action = await vscode.window.showInformationMessage(`No models found. Would you like to download ${recommendation.recommended_model}? (${recommendation.reason})`, 'Download', 'Later');
            if (action === 'Download') {
                await vscode.commands.executeCommand('neurobyte.pullModel', recommendation.recommended_model);
            }
        }
    }
    // Register view providers
    const chatViewProvider = new chatViewProvider_1.ChatViewProvider(context, coreService, ollamaService);
    const planViewProvider = new planViewProvider_1.PlanViewProvider(context, coreService);
    const modelsViewProvider = new modelsViewProvider_1.ModelsViewProvider(context, ollamaService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('neurobyte.chatView', chatViewProvider), vscode.window.registerTreeDataProvider('neurobyte.planView', planViewProvider), vscode.window.registerTreeDataProvider('neurobyte.modelsView', modelsViewProvider));
    // Register commands
    (0, commands_1.registerCommands)(context, coreService, ollamaService, chatViewProvider, planViewProvider, modelsViewProvider);
    // Register command to open chat panel in editor area
    context.subscriptions.push(vscode.commands.registerCommand('neurobyte.openChatPanel', () => {
        chatPanelProvider_1.ChatPanelProvider.createOrShow(context, coreService, ollamaService);
    }));
    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'neurobyte.openChatPanel';
    statusBarItem.text = '$(hubot) NeuroByte';
    statusBarItem.tooltip = 'Open NeuroByte Chat';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('neurobyte')) {
            ollamaService.reloadConfig();
        }
    }));
    console.log('NeuroByte activated successfully!');
}
function deactivate() {
    if (coreService) {
        coreService.stop();
    }
}
//# sourceMappingURL=extension.js.map