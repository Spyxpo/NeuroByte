import * as vscode from 'vscode';
import { OllamaService, OllamaModel } from '../services/ollamaService';

export class ModelsViewProvider implements vscode.TreeDataProvider<ModelTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ModelTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ModelTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ModelTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private models: OllamaModel[] = [];
    private defaultModel: string = '';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly ollamaService: OllamaService
    ) {
        this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            this.models = await this.ollamaService.listModels();
            this.defaultModel = await this.ollamaService.getDefaultModel();
        } catch {
            this.models = [];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ModelTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
        if (!element) {
            // Root level
            const status = await this.ollamaService.checkStatus();

            if (!status.running) {
                return [
                    new ModelTreeItem(
                        'Ollama not running',
                        'Click to start Ollama',
                        vscode.TreeItemCollapsibleState.None,
                        'error',
                        undefined,
                        {
                            command: 'neurobyte.setupOllama',
                            title: 'Setup Ollama'
                        }
                    )
                ];
            }

            if (this.models.length === 0) {
                return [
                    new ModelTreeItem(
                        'No models installed',
                        'Click to download a model',
                        vscode.TreeItemCollapsibleState.None,
                        'info',
                        undefined,
                        {
                            command: 'neurobyte.pullModel',
                            title: 'Pull Model'
                        }
                    )
                ];
            }

            return this.models.map(model => {
                const isDefault = model.name === this.defaultModel || model.name.startsWith(this.defaultModel);
                const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(2);

                return new ModelTreeItem(
                    model.name,
                    `${sizeGB} GB`,
                    vscode.TreeItemCollapsibleState.None,
                    isDefault ? 'default' : 'model',
                    model,
                    {
                        command: 'neurobyte.selectModel',
                        title: 'Select Model',
                        arguments: [model.name]
                    }
                );
            });
        }

        return [];
    }

    getModels(): OllamaModel[] {
        return this.models;
    }
}

class ModelTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'model' | 'default' | 'info' | 'error',
        public readonly model?: OllamaModel,
        command?: vscode.Command
    ) {
        super(label, collapsibleState);
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
