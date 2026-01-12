import * as vscode from 'vscode';
import { NeuroByteCoreService } from '../services/coreService';
import { OllamaService, ChatMessage } from '../services/ollamaService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'neurobyte.chatView';

    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private isStreaming = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly coreService: NeuroByteCoreService,
        private readonly ollamaService: OllamaService
    ) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage(async (message) => {
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
            }
        });
    }

    private async handleUserMessage(content: string): Promise<void> {
        if (this.isStreaming) return;

        // Add user message
        this.messages.push({ role: 'user', content });
        this.postMessage({ type: 'userMessage', content });

        // Get context
        const context = await this.gatherContext();

        // Stream the response
        this.isStreaming = true;
        this.postMessage({ type: 'startStreaming' });

        try {
            let fullResponse = '';
            const stream = this.ollamaService.chatStream({
                messages: this.messages,
                context
            });

            for await (const chunk of stream) {
                fullResponse += chunk;
                this.postMessage({ type: 'streamChunk', content: chunk });
            }

            // Add assistant message
            this.messages.push({ role: 'assistant', content: fullResponse });

            // Parse and handle tool calls
            const toolCalls = this.parseToolCalls(fullResponse);
            if (toolCalls.length > 0) {
                this.postMessage({ type: 'toolCalls', calls: toolCalls });
            }

        } catch (error: any) {
            this.postMessage({ type: 'error', message: error.message });
        } finally {
            this.isStreaming = false;
            this.postMessage({ type: 'endStreaming' });
        }
    }

    private async gatherContext(): Promise<any> {
        const editor = vscode.window.activeTextEditor;
        const workspaceFolders = vscode.workspace.workspaceFolders;

        const context: any = {};

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

    private parseToolCalls(content: string): any[] {
        const toolCallRegex = /<tool name="(\w+)">\s*([\s\S]*?)\s*<\/tool>/g;
        const calls: any[] = [];
        let match;

        while ((match = toolCallRegex.exec(content)) !== null) {
            try {
                const args = JSON.parse(match[2]);
                calls.push({
                    name: match[1],
                    args
                });
            } catch { }
        }

        return calls;
    }

    private async executeToolCall(tool: string, args: any): Promise<void> {
        try {
            let result: any;

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
                    // Execute in terminal
                    const terminal = vscode.window.createTerminal('NeuroByte');
                    terminal.sendText(args.command);
                    terminal.show();
                    result = { success: true, message: 'Command sent to terminal' };
                    break;
                default:
                    result = { success: false, error: `Unknown tool: ${tool}` };
            }

            this.postMessage({
                type: 'toolResult',
                tool,
                result
            });

            // Add tool result to context for next message
            if (result.success) {
                this.messages.push({
                    role: 'user',
                    content: `[Tool Result for ${tool}]: ${JSON.stringify(result)}`
                });
            }

        } catch (error: any) {
            this.postMessage({
                type: 'toolResult',
                tool,
                result: { success: false, error: error.message }
            });
        }
    }

    public postMessage(message: any): void {
        this._view?.webview.postMessage(message);
    }

    public addContextMessage(content: string): void {
        this.messages.push({ role: 'user', content });
        this.postMessage({ type: 'userMessage', content });
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeuroByte Chat</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header h3 {
            font-size: 13px;
            font-weight: 600;
        }

        .header-actions button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            font-size: 12px;
            opacity: 0.7;
        }

        .header-actions button:hover {
            opacity: 1;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .message {
            margin-bottom: 16px;
            padding: 10px 12px;
            border-radius: 8px;
            max-width: 95%;
        }

        .message.user {
            background: var(--vscode-input-background);
            margin-left: auto;
        }

        .message.assistant {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
        }

        .message-role {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 6px;
            opacity: 0.7;
        }

        .message-content {
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.5;
        }

        .message-content code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .message-content pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .message-content pre code {
            padding: 0;
            background: none;
        }

        .tool-call {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 8px 12px;
            border-radius: 6px;
            margin: 8px 0;
            border-left: 3px solid var(--vscode-activityBarBadge-background);
        }

        .tool-call-header {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .tool-call-actions {
            margin-top: 8px;
        }

        .tool-call-actions button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-right: 8px;
        }

        .tool-call-actions button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .input-area {
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .input-container {
            display: flex;
            gap: 8px;
        }

        textarea {
            flex: 1;
            min-height: 60px;
            max-height: 200px;
            resize: vertical;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .send-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            align-self: flex-end;
        }

        .send-button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .typing-indicator {
            display: none;
            padding: 10px 12px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .typing-indicator.active {
            display: block;
        }

        .typing-indicator::after {
            content: '';
            animation: dots 1.5s infinite;
        }

        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h4 {
            margin-bottom: 8px;
        }

        .quick-actions {
            margin-top: 16px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
        }

        .quick-action {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }

        .quick-action:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h3>NeuroByte Chat</h3>
        <div class="header-actions">
            <button onclick="enterPlanMode()">Plan Mode</button>
            <button onclick="clearChat()">Clear</button>
        </div>
    </div>

    <div class="messages" id="messages">
        <div class="empty-state" id="emptyState">
            <h4>Welcome to NeuroByte</h4>
            <p>Your local AI coding assistant</p>
            <div class="quick-actions">
                <button class="quick-action" onclick="quickAction('Explain the current file')">Explain Code</button>
                <button class="quick-action" onclick="quickAction('Find bugs in this code')">Find Bugs</button>
                <button class="quick-action" onclick="quickAction('Suggest improvements')">Improve</button>
                <button class="quick-action" onclick="quickAction('Write tests for this')">Write Tests</button>
            </div>
        </div>
    </div>

    <div class="typing-indicator" id="typingIndicator">NeuroByte is thinking</div>

    <div class="input-area">
        <div class="input-container">
            <textarea
                id="userInput"
                placeholder="Ask NeuroByte anything... (Shift+Enter for new line)"
                onkeydown="handleKeyDown(event)"
            ></textarea>
            <button class="send-button" id="sendButton" onclick="sendMessage()">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isStreaming = false;
        let currentStreamDiv = null;

        function sendMessage() {
            const input = document.getElementById('userInput');
            const content = input.value.trim();
            if (!content || isStreaming) return;

            input.value = '';
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

        function enterPlanMode() {
            vscode.postMessage({ type: 'enterPlanMode' });
        }

        function quickAction(action) {
            document.getElementById('userInput').value = action;
            sendMessage();
        }

        function executeToolCall(tool, args) {
            vscode.postMessage({ type: 'executeToolCall', tool, args });
        }

        function addMessage(role, content) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;
            messageDiv.innerHTML = \`
                <div class="message-role">\${role === 'user' ? 'You' : 'NeuroByte'}</div>
                <div class="message-content">\${formatContent(content)}</div>
            \`;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            return messageDiv;
        }

        function formatContent(content) {
            // Basic markdown-like formatting
            let formatted = content
                .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\n/g, '<br>');
            return formatted;
        }

        function showToolCalls(calls) {
            const messagesDiv = document.getElementById('messages');
            for (const call of calls) {
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-call';
                toolDiv.innerHTML = \`
                    <div class="tool-call-header">Tool: \${call.name}</div>
                    <pre><code>\${JSON.stringify(call.args, null, 2)}</code></pre>
                    <div class="tool-call-actions">
                        <button onclick='executeToolCall("\${call.name}", \${JSON.stringify(call.args)})'>Execute</button>
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
                    addMessage('user', message.content);
                    break;

                case 'startStreaming':
                    isStreaming = true;
                    document.getElementById('sendButton').disabled = true;
                    document.getElementById('typingIndicator').classList.add('active');
                    currentStreamDiv = addMessage('assistant', '');
                    break;

                case 'streamChunk':
                    if (currentStreamDiv) {
                        const contentDiv = currentStreamDiv.querySelector('.message-content');
                        contentDiv.innerHTML = formatContent(contentDiv.textContent + message.content);
                        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
                    }
                    break;

                case 'endStreaming':
                    isStreaming = false;
                    document.getElementById('sendButton').disabled = false;
                    document.getElementById('typingIndicator').classList.remove('active');
                    currentStreamDiv = null;
                    break;

                case 'toolCalls':
                    showToolCalls(message.calls);
                    break;

                case 'toolResult':
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'tool-call';
                    resultDiv.innerHTML = \`
                        <div class="tool-call-header">Result: \${message.tool}</div>
                        <pre><code>\${JSON.stringify(message.result, null, 2)}</code></pre>
                    \`;
                    document.getElementById('messages').appendChild(resultDiv);
                    break;

                case 'chatCleared':
                    document.getElementById('messages').innerHTML = \`
                        <div class="empty-state" id="emptyState">
                            <h4>Welcome to NeuroByte</h4>
                            <p>Your local AI coding assistant</p>
                            <div class="quick-actions">
                                <button class="quick-action" onclick="quickAction('Explain the current file')">Explain Code</button>
                                <button class="quick-action" onclick="quickAction('Find bugs in this code')">Find Bugs</button>
                                <button class="quick-action" onclick="quickAction('Suggest improvements')">Improve</button>
                                <button class="quick-action" onclick="quickAction('Write tests for this')">Write Tests</button>
                            </div>
                        </div>
                    \`;
                    break;

                case 'error':
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'message assistant';
                    errorDiv.innerHTML = \`
                        <div class="message-role">Error</div>
                        <div class="message-content" style="color: var(--vscode-errorForeground);">\${message.message}</div>
                    \`;
                    document.getElementById('messages').appendChild(errorDiv);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
