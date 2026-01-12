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
exports.ChatPanelProvider = void 0;
const vscode = __importStar(require("vscode"));
class ChatPanelProvider {
    context;
    coreService;
    ollamaService;
    static currentPanel;
    panel;
    messages = [];
    isStreaming = false;
    disposables = [];
    constructor(panel, context, coreService, ollamaService) {
        this.context = context;
        this.coreService = coreService;
        this.ollamaService = ollamaService;
        this.panel = panel;
        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'sendMessage':
                    await this.handleUserMessage(message.content);
                    break;
                case 'clearChat':
                    this.messages = [];
                    this.postMessage({ type: 'chatCleared' });
                    break;
                case 'executeToolCall':
                    await this.executeToolCall(message.tool, message.args);
                    break;
                case 'enterPlanMode':
                    vscode.commands.executeCommand('neurobyte.enterPlanMode');
                    break;
                case 'stopGeneration':
                    this.isStreaming = false;
                    this.postMessage({ type: 'endStreaming' });
                    break;
                case 'copyCode':
                    vscode.env.clipboard.writeText(message.code);
                    vscode.window.showInformationMessage('Code copied to clipboard');
                    break;
                case 'insertCode':
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, message.code);
                        });
                    }
                    break;
                case 'newChat':
                    this.messages = [];
                    this.postMessage({ type: 'chatCleared' });
                    break;
            }
        }, null, this.disposables);
    }
    static createOrShow(context, coreService, ollamaService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ChatPanelProvider.currentPanel) {
            ChatPanelProvider.currentPanel.panel.reveal(column);
            return ChatPanelProvider.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel('neurobyteChat', 'NeuroByte', column || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        });
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
        ChatPanelProvider.currentPanel = new ChatPanelProvider(panel, context, coreService, ollamaService);
        return ChatPanelProvider.currentPanel;
    }
    async handleUserMessage(content) {
        if (this.isStreaming)
            return;
        this.messages.push({ role: 'user', content });
        this.postMessage({ type: 'userMessage', content });
        const context = await this.gatherContext();
        this.isStreaming = true;
        this.postMessage({ type: 'startStreaming' });
        try {
            let fullResponse = '';
            const stream = this.ollamaService.chatStream({
                messages: this.messages,
                context
            });
            for await (const chunk of stream) {
                if (!this.isStreaming)
                    break;
                fullResponse += chunk;
                this.postMessage({ type: 'streamChunk', content: chunk });
            }
            this.messages.push({ role: 'assistant', content: fullResponse });
            const toolCalls = this.parseToolCalls(fullResponse);
            if (toolCalls.length > 0) {
                this.postMessage({ type: 'toolCalls', calls: toolCalls });
            }
        }
        catch (error) {
            this.postMessage({ type: 'error', message: error.message });
        }
        finally {
            this.isStreaming = false;
            this.postMessage({ type: 'endStreaming' });
        }
    }
    async gatherContext() {
        const editor = vscode.window.activeTextEditor;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const context = {};
        if (workspaceFolders && workspaceFolders.length > 0) {
            context.workspace_path = workspaceFolders[0].uri.fsPath;
        }
        if (editor) {
            context.current_file = editor.document.uri.fsPath;
            const selection = editor.selection;
            if (!selection.isEmpty) {
                context.selected_text = editor.document.getText(selection);
            }
        }
        return context;
    }
    parseToolCalls(content) {
        const toolCallRegex = /<tool name="(\w+)">\s*([\s\S]*?)\s*<\/tool>/g;
        const calls = [];
        let match;
        while ((match = toolCallRegex.exec(content)) !== null) {
            try {
                const args = JSON.parse(match[2]);
                calls.push({ name: match[1], args });
            }
            catch { }
        }
        return calls;
    }
    async executeToolCall(tool, args) {
        try {
            let result;
            switch (tool) {
                case 'read_file':
                    result = await this.coreService.readFile({ path: args.path });
                    break;
                case 'write_file':
                    result = await this.coreService.writeFile({
                        path: args.path,
                        content: args.content
                    });
                    break;
                case 'edit_file':
                    result = await this.coreService.editFile({
                        path: args.path,
                        old_text: args.old_text,
                        new_text: args.new_text,
                        replace_all: args.replace_all
                    });
                    break;
                case 'search':
                    result = await this.coreService.searchFiles({
                        pattern: args.pattern,
                        path: args.path,
                        file_pattern: args.file_pattern
                    });
                    break;
                case 'glob':
                    result = await this.coreService.globFiles(args.pattern, args.path);
                    break;
                case 'run_command':
                    const terminal = vscode.window.createTerminal('NeuroByte');
                    terminal.sendText(args.command);
                    terminal.show();
                    result = { success: true, message: 'Command sent to terminal' };
                    break;
                default:
                    result = { success: false, error: `Unknown tool: ${tool}` };
            }
            this.postMessage({ type: 'toolResult', tool, result });
            if (result.success) {
                this.messages.push({
                    role: 'user',
                    content: `[Tool Result for ${tool}]: ${JSON.stringify(result)}`
                });
            }
        }
        catch (error) {
            this.postMessage({
                type: 'toolResult',
                tool,
                result: { success: false, error: error.message }
            });
        }
    }
    postMessage(message) {
        this.panel.webview.postMessage(message);
    }
    addContextMessage(content) {
        this.messages.push({ role: 'user', content });
        this.postMessage({ type: 'userMessage', content });
        // Automatically trigger the response
        this.handleUserMessage(content);
    }
    dispose() {
        ChatPanelProvider.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d)
                d.dispose();
        }
    }
    getHtmlContent() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeuroByte</title>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --bg-tertiary: var(--vscode-input-background);
            --text-primary: var(--vscode-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --text-muted: var(--vscode-disabledForeground);
            --border-color: var(--vscode-panel-border);
            --accent-color: var(--vscode-button-background);
            --accent-hover: var(--vscode-button-hoverBackground);
            --code-bg: var(--vscode-textCodeBlock-background);
            --success-color: var(--vscode-testing-iconPassed);
            --error-color: var(--vscode-errorForeground);
            --warning-color: var(--vscode-editorWarning-foreground);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            font-size: 14px;
            color: var(--text-primary);
            background: var(--bg-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            flex-shrink: 0;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            font-size: 15px;
        }

        .logo-icon {
            width: 24px;
            height: 24px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
            font-weight: bold;
        }

        .model-selector {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            font-size: 12px;
            color: var(--text-secondary);
            cursor: pointer;
        }

        .model-selector:hover {
            background: var(--bg-primary);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .icon-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background: transparent;
            border: none;
            border-radius: 6px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .icon-btn:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }

        .icon-btn svg {
            width: 18px;
            height: 18px;
        }

        /* Main Content */
        .main-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            max-width: 900px;
            width: 100%;
            margin: 0 auto;
        }

        /* Messages Container */
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            scroll-behavior: smooth;
        }

        .messages::-webkit-scrollbar {
            width: 8px;
        }

        .messages::-webkit-scrollbar-track {
            background: transparent;
        }

        .messages::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 4px;
        }

        .messages::-webkit-scrollbar-thumb:hover {
            background: var(--text-muted);
        }

        /* Message Styles */
        .message {
            margin-bottom: 24px;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .message-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }

        .avatar {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
        }

        .avatar.user {
            background: var(--accent-color);
            color: white;
        }

        .avatar.assistant {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
        }

        .message-role {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .message-time {
            font-size: 11px;
            color: var(--text-muted);
        }

        .message-content {
            padding-left: 38px;
            line-height: 1.6;
            color: var(--text-primary);
        }

        .message-content p {
            margin-bottom: 12px;
        }

        .message-content p:last-child {
            margin-bottom: 0;
        }

        /* Code Blocks */
        .code-block {
            position: relative;
            margin: 12px 0;
            border-radius: 8px;
            overflow: hidden;
            background: var(--code-bg);
            border: 1px solid var(--border-color);
        }

        .code-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid var(--border-color);
        }

        .code-lang {
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .code-actions {
            display: flex;
            gap: 4px;
        }

        .code-action-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background: transparent;
            border: none;
            border-radius: 4px;
            color: var(--text-secondary);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .code-action-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
        }

        .code-action-btn svg {
            width: 14px;
            height: 14px;
        }

        pre {
            margin: 0;
            padding: 16px;
            overflow-x: auto;
            font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
            font-size: 13px;
            line-height: 1.5;
        }

        pre code {
            background: none;
            padding: 0;
            border-radius: 0;
        }

        code {
            font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
            font-size: 13px;
            background: var(--code-bg);
            padding: 2px 6px;
            border-radius: 4px;
        }

        /* Tool Calls */
        .tool-call {
            margin: 12px 0;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            overflow: hidden;
            background: var(--bg-secondary);
        }

        .tool-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            background: rgba(99, 102, 241, 0.1);
            border-bottom: 1px solid var(--border-color);
        }

        .tool-icon {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            background: var(--accent-color);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 10px;
        }

        .tool-name {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .tool-status {
            margin-left: auto;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 4px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
        }

        .tool-status.success {
            background: rgba(34, 197, 94, 0.15);
            color: var(--success-color);
        }

        .tool-status.pending {
            background: rgba(234, 179, 8, 0.15);
            color: var(--warning-color);
        }

        .tool-content {
            padding: 12px 14px;
        }

        .tool-actions {
            display: flex;
            gap: 8px;
            padding: 10px 14px;
            border-top: 1px solid var(--border-color);
            background: var(--bg-tertiary);
        }

        .tool-btn {
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .tool-btn.primary {
            background: var(--accent-color);
            color: white;
            border: none;
        }

        .tool-btn.primary:hover {
            background: var(--accent-hover);
        }

        .tool-btn.secondary {
            background: transparent;
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
        }

        .tool-btn.secondary:hover {
            background: var(--bg-primary);
            color: var(--text-primary);
        }

        /* Thinking Indicator */
        .thinking {
            display: none;
            padding: 16px 20px;
            padding-left: 58px;
        }

        .thinking.active {
            display: block;
        }

        .thinking-content {
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--text-secondary);
            font-size: 13px;
        }

        .thinking-dots {
            display: flex;
            gap: 4px;
        }

        .thinking-dots span {
            width: 6px;
            height: 6px;
            background: var(--text-muted);
            border-radius: 50%;
            animation: pulse 1.4s infinite ease-in-out;
        }

        .thinking-dots span:nth-child(1) { animation-delay: 0s; }
        .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes pulse {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }

        /* Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            text-align: center;
        }

        .empty-icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }

        .empty-icon svg {
            width: 32px;
            height: 32px;
            color: white;
        }

        .empty-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-primary);
        }

        .empty-subtitle {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 24px;
            max-width: 400px;
        }

        .quick-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
            max-width: 500px;
        }

        .quick-action {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .quick-action:hover {
            background: var(--bg-tertiary);
            border-color: var(--accent-color);
        }

        .quick-action svg {
            width: 16px;
            height: 16px;
            color: var(--text-secondary);
        }

        /* Input Area */
        .input-area {
            padding: 16px 20px 20px;
            background: var(--bg-primary);
            border-top: 1px solid var(--border-color);
            flex-shrink: 0;
        }

        .input-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 12px;
            transition: border-color 0.15s ease;
        }

        .input-container:focus-within {
            border-color: var(--accent-color);
        }

        .input-wrapper {
            display: flex;
            gap: 12px;
        }

        textarea {
            flex: 1;
            min-height: 24px;
            max-height: 200px;
            resize: none;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 14px;
            line-height: 1.5;
        }

        textarea:focus {
            outline: none;
        }

        textarea::placeholder {
            color: var(--text-muted);
        }

        .input-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .input-actions-left {
            display: flex;
            gap: 4px;
        }

        .input-actions-right {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .char-count {
            font-size: 11px;
            color: var(--text-muted);
        }

        .send-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            background: var(--accent-color);
            border: none;
            border-radius: 8px;
            color: white;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .send-btn:hover:not(:disabled) {
            background: var(--accent-hover);
            transform: scale(1.05);
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .send-btn svg {
            width: 18px;
            height: 18px;
        }

        .stop-btn {
            display: none;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: var(--error-color);
            border: none;
            border-radius: 8px;
            color: white;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
        }

        .stop-btn.active {
            display: flex;
        }

        .stop-btn svg {
            width: 14px;
            height: 14px;
        }

        /* Keyboard Hint */
        .keyboard-hint {
            font-size: 11px;
            color: var(--text-muted);
        }

        kbd {
            padding: 2px 6px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-family: inherit;
            font-size: 10px;
        }

        /* Error Message */
        .error-message {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px 16px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 8px;
            margin: 12px 0;
        }

        .error-icon {
            width: 20px;
            height: 20px;
            color: var(--error-color);
            flex-shrink: 0;
        }

        .error-text {
            font-size: 13px;
            color: var(--error-color);
        }

        /* Responsive */
        @media (max-width: 600px) {
            .header {
                padding: 10px 16px;
            }

            .messages {
                padding: 16px;
            }

            .message-content {
                padding-left: 0;
            }

            .quick-actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="logo">
                <div class="logo-icon">N</div>
                <span>NeuroByte</span>
            </div>
            <div class="model-selector" onclick="selectModel()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                <span id="currentModel">Local Model</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
        </div>
        <div class="header-actions">
            <button class="icon-btn" onclick="newChat()" title="New Chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>
            <button class="icon-btn" onclick="enterPlanMode()" title="Plan Mode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6"/>
                    <path d="M9 16h6"/>
                </svg>
            </button>
            <button class="icon-btn" onclick="clearChat()" title="Clear Chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
            </button>
        </div>
    </div>

    <div class="main-container">
        <div class="messages" id="messages">
            <div class="empty-state" id="emptyState">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                </div>
                <h2 class="empty-title">How can I help you today?</h2>
                <p class="empty-subtitle">I'm your local AI coding assistant powered by Ollama. Ask me anything about your code or try one of these:</p>
                <div class="quick-actions">
                    <button class="quick-action" onclick="quickAction('Explain this codebase structure')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Explain codebase
                    </button>
                    <button class="quick-action" onclick="quickAction('Find potential bugs in the current file')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                            <path d="M12 8v4"/>
                            <path d="M12 16h.01"/>
                        </svg>
                        Find bugs
                    </button>
                    <button class="quick-action" onclick="quickAction('Suggest improvements for the selected code')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        Improve code
                    </button>
                    <button class="quick-action" onclick="quickAction('Generate unit tests for this code')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 11 12 14 22 4"/>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                        </svg>
                        Write tests
                    </button>
                </div>
            </div>
        </div>

        <div class="thinking" id="thinking">
            <div class="thinking-content">
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <span>NeuroByte is thinking...</span>
            </div>
        </div>

        <div class="input-area">
            <div class="input-container">
                <div class="input-wrapper">
                    <textarea
                        id="userInput"
                        placeholder="Ask NeuroByte anything..."
                        rows="1"
                        onkeydown="handleKeyDown(event)"
                        oninput="autoResize(this)"
                    ></textarea>
                </div>
                <div class="input-actions">
                    <div class="input-actions-left">
                        <span class="keyboard-hint"><kbd>Enter</kbd> to send, <kbd>Shift+Enter</kbd> for new line</span>
                    </div>
                    <div class="input-actions-right">
                        <button class="stop-btn" id="stopBtn" onclick="stopGeneration()">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2"/>
                            </svg>
                            Stop
                        </button>
                        <button class="send-btn" id="sendBtn" onclick="sendMessage()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"/>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isStreaming = false;
        let currentStreamDiv = null;

        function autoResize(textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        }

        function sendMessage() {
            const input = document.getElementById('userInput');
            const content = input.value.trim();
            if (!content || isStreaming) return;

            input.value = '';
            input.style.height = 'auto';
            document.getElementById('emptyState').style.display = 'none';

            vscode.postMessage({ type: 'sendMessage', content });
        }

        function handleKeyDown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }

        function clearChat() {
            vscode.postMessage({ type: 'clearChat' });
        }

        function newChat() {
            vscode.postMessage({ type: 'newChat' });
        }

        function enterPlanMode() {
            vscode.postMessage({ type: 'enterPlanMode' });
        }

        function selectModel() {
            vscode.postMessage({ type: 'selectModel' });
        }

        function stopGeneration() {
            vscode.postMessage({ type: 'stopGeneration' });
        }

        function quickAction(action) {
            document.getElementById('userInput').value = action;
            sendMessage();
        }

        function executeToolCall(tool, args) {
            vscode.postMessage({ type: 'executeToolCall', tool, args: JSON.parse(args) });
        }

        function copyCode(code) {
            vscode.postMessage({ type: 'copyCode', code });
        }

        function insertCode(code) {
            vscode.postMessage({ type: 'insertCode', code });
        }

        function formatTime() {
            const now = new Date();
            return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatContent(content) {
            // Parse code blocks
            let formatted = content.replace(/\`\`\`(\\w*)?\\n?([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
                const language = lang || 'plaintext';
                const escapedCode = escapeHtml(code.trim());
                const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
                return \`
                    <div class="code-block">
                        <div class="code-header">
                            <span class="code-lang">\${language}</span>
                            <div class="code-actions">
                                <button class="code-action-btn" onclick="copyCode(document.getElementById('\${codeId}').textContent)">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                    Copy
                                </button>
                                <button class="code-action-btn" onclick="insertCode(document.getElementById('\${codeId}').textContent)">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 5v14"/>
                                        <path d="M5 12h14"/>
                                    </svg>
                                    Insert
                                </button>
                            </div>
                        </div>
                        <pre><code id="\${codeId}">\${escapedCode}</code></pre>
                    </div>
                \`;
            });

            // Parse inline code
            formatted = formatted.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Parse paragraphs
            formatted = formatted.split('\\n\\n').map(p => {
                if (p.includes('<div class="code-block">') || p.includes('<div class="tool-call">')) {
                    return p;
                }
                return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
            }).join('');

            return formatted;
        }

        function addMessage(role, content) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message';

            const time = formatTime();
            const avatar = role === 'user' ? 'U' : 'N';
            const roleName = role === 'user' ? 'You' : 'NeuroByte';

            messageDiv.innerHTML = \`
                <div class="message-header">
                    <div class="avatar \${role}">\${avatar}</div>
                    <span class="message-role">\${roleName}</span>
                    <span class="message-time">\${time}</span>
                </div>
                <div class="message-content">\${formatContent(content)}</div>
            \`;

            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            return messageDiv;
        }

        function showToolCalls(calls) {
            const messagesDiv = document.getElementById('messages');
            for (const call of calls) {
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-call';
                toolDiv.innerHTML = \`
                    <div class="tool-header">
                        <div class="tool-icon">T</div>
                        <span class="tool-name">\${call.name}</span>
                        <span class="tool-status pending">Pending</span>
                    </div>
                    <div class="tool-content">
                        <pre><code>\${JSON.stringify(call.args, null, 2)}</code></pre>
                    </div>
                    <div class="tool-actions">
                        <button class="tool-btn primary" onclick='executeToolCall("\${call.name}", \${JSON.stringify(JSON.stringify(call.args))})'>Execute</button>
                        <button class="tool-btn secondary">Skip</button>
                    </div>
                \`;
                messagesDiv.appendChild(toolDiv);
            }
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'userMessage':
                    document.getElementById('emptyState').style.display = 'none';
                    addMessage('user', message.content);
                    break;

                case 'startStreaming':
                    isStreaming = true;
                    document.getElementById('sendBtn').style.display = 'none';
                    document.getElementById('stopBtn').classList.add('active');
                    document.getElementById('thinking').classList.add('active');
                    break;

                case 'streamChunk':
                    document.getElementById('thinking').classList.remove('active');
                    if (!currentStreamDiv) {
                        currentStreamDiv = addMessage('assistant', '');
                    }
                    const contentDiv = currentStreamDiv.querySelector('.message-content');
                    // Accumulate content and reformat
                    const currentText = contentDiv.getAttribute('data-raw') || '';
                    const newText = currentText + message.content;
                    contentDiv.setAttribute('data-raw', newText);
                    contentDiv.innerHTML = formatContent(newText);
                    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
                    break;

                case 'endStreaming':
                    isStreaming = false;
                    document.getElementById('sendBtn').style.display = 'flex';
                    document.getElementById('stopBtn').classList.remove('active');
                    document.getElementById('thinking').classList.remove('active');
                    currentStreamDiv = null;
                    break;

                case 'toolCalls':
                    showToolCalls(message.calls);
                    break;

                case 'toolResult':
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'tool-call';
                    const status = message.result.success ? 'success' : 'error';
                    resultDiv.innerHTML = \`
                        <div class="tool-header">
                            <div class="tool-icon">T</div>
                            <span class="tool-name">\${message.tool}</span>
                            <span class="tool-status \${status}">\${status === 'success' ? 'Completed' : 'Failed'}</span>
                        </div>
                        <div class="tool-content">
                            <pre><code>\${JSON.stringify(message.result, null, 2)}</code></pre>
                        </div>
                    \`;
                    document.getElementById('messages').appendChild(resultDiv);
                    break;

                case 'chatCleared':
                    document.getElementById('messages').innerHTML = \`
                        <div class="empty-state" id="emptyState">
                            <div class="empty-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                </svg>
                            </div>
                            <h2 class="empty-title">How can I help you today?</h2>
                            <p class="empty-subtitle">I'm your local AI coding assistant powered by Ollama. Ask me anything about your code or try one of these:</p>
                            <div class="quick-actions">
                                <button class="quick-action" onclick="quickAction('Explain this codebase structure')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                                    </svg>
                                    Explain codebase
                                </button>
                                <button class="quick-action" onclick="quickAction('Find potential bugs in the current file')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                                        <path d="M12 8v4"/>
                                        <path d="M12 16h.01"/>
                                    </svg>
                                    Find bugs
                                </button>
                                <button class="quick-action" onclick="quickAction('Suggest improvements for the selected code')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                    </svg>
                                    Improve code
                                </button>
                                <button class="quick-action" onclick="quickAction('Generate unit tests for this code')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9 11 12 14 22 4"/>
                                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                                    </svg>
                                    Write tests
                                </button>
                            </div>
                        </div>
                    \`;
                    break;

                case 'error':
                    document.getElementById('thinking').classList.remove('active');
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.innerHTML = \`
                        <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span class="error-text">\${message.message}</span>
                    \`;
                    document.getElementById('messages').appendChild(errorDiv);
                    break;
            }
        });

        // Auto-focus input
        document.getElementById('userInput').focus();
    </script>
</body>
</html>`;
    }
}
exports.ChatPanelProvider = ChatPanelProvider;
//# sourceMappingURL=chatPanelProvider.js.map