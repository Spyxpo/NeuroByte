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
exports.ModelsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class ModelsViewProvider {
    context;
    ollamaService;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    models = [];
    defaultModel = '';
    constructor(context, ollamaService) {
        this.context = context;
        this.ollamaService = ollamaService;
        this.refresh();
    }
    async refresh() {
        try {
            this.models = await this.ollamaService.listModels();
            this.defaultModel = await this.ollamaService.getDefaultModel();
        }
        catch {
            this.models = [];
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            // Root level
            const status = await this.ollamaService.checkStatus();
            if (!status.running) {
                return [
                    new ModelTreeItem('Ollama not running', 'Click to start Ollama', vscode.TreeItemCollapsibleState.None, 'error', undefined, {
                        command: 'neurobyte.setupOllama',
                        title: 'Setup Ollama'
                    })
                ];
            }
            if (this.models.length === 0) {
                return [
                    new ModelTreeItem('No models installed', 'Click to download a model', vscode.TreeItemCollapsibleState.None, 'info', undefined, {
                        command: 'neurobyte.pullModel',
                        title: 'Pull Model'
                    })
                ];
            }
            return this.models.map(model => {
                const isDefault = model.name === this.defaultModel || model.name.startsWith(this.defaultModel);
                const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(2);
                return new ModelTreeItem(model.name, `${sizeGB} GB`, vscode.TreeItemCollapsibleState.None, isDefault ? 'default' : 'model', model, {
                    command: 'neurobyte.selectModel',
                    title: 'Select Model',
                    arguments: [model.name]
                });
            });
        }
        return [];
    }
    getModels() {
        return this.models;
    }
}
exports.ModelsViewProvider = ModelsViewProvider;
class ModelTreeItem extends vscode.TreeItem {
    label;
    description;
    collapsibleState;
    type;
    model;
    constructor(label, description, collapsibleState, type, model, command) {
        super(label, collapsibleState);
        this.label = label;
        this.description = description;
        this.collapsibleState = collapsibleState;
        this.type = type;
        this.model = model;
        this.tooltip = model ? `${model.name}\nSize: ${description}\nModified: ${model.modified_at}` : description;
        this.command = command;
        switch (type) {
            case 'default':
                this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
                this.contextValue = 'model-default';
                break;
            case 'model':
                this.iconPath = new vscode.ThemeIcon('package');
                this.contextValue = 'model';
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
                break;
        }
    }
}
//# sourceMappingURL=modelsViewProvider.js.map