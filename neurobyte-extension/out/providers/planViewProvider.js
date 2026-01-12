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
exports.PlanViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class PlanViewProvider {
    context;
    coreService;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    currentPlan = null;
    constructor(context, coreService) {
        this.context = context;
        this.coreService = coreService;
        this.refresh();
    }
    async refresh() {
        try {
            const status = await this.coreService.getPlanStatus();
            this.currentPlan = status.has_plan ? status.plan : null;
        }
        catch {
            this.currentPlan = null;
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!this.currentPlan) {
            return Promise.resolve([
                new PlanTreeItem('No active plan', 'Use "Enter Plan Mode" to create a plan', vscode.TreeItemCollapsibleState.None, 'info')
            ]);
        }
        if (!element) {
            // Root level - show plan info and steps
            const items = [
                new PlanTreeItem(this.currentPlan.title, this.currentPlan.description, vscode.TreeItemCollapsibleState.Expanded, 'plan', this.currentPlan)
            ];
            return Promise.resolve(items);
        }
        if (element.type === 'plan') {
            // Show steps
            return Promise.resolve(this.currentPlan.steps.map(step => {
                const icon = this.getStepIcon(step.status);
                return new PlanTreeItem(`${step.id + 1}. ${step.title}`, step.description, vscode.TreeItemCollapsibleState.None, 'step', step, icon);
            }));
        }
        return Promise.resolve([]);
    }
    getStepIcon(status) {
        switch (status) {
            case 'completed':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case 'in_progress':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('progressBar.background'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'skipped':
                return new vscode.ThemeIcon('debug-step-over');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
    getCurrentPlan() {
        return this.currentPlan;
    }
    async createPlan(title, description, steps) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders?.[0]?.uri.fsPath;
        const result = await this.coreService.createPlan({
            title,
            description,
            steps,
            workspace_path: workspacePath
        });
        if (result.success) {
            this.currentPlan = result.plan;
            this._onDidChangeTreeData.fire();
        }
        else {
            throw new Error(result.error || 'Failed to create plan');
        }
    }
    async executePlan(stepIndex, autoContinue) {
        const result = await this.coreService.executePlan(stepIndex, autoContinue);
        if (result.plan) {
            this.currentPlan = result.plan;
            this._onDidChangeTreeData.fire();
        }
        return result;
    }
}
exports.PlanViewProvider = PlanViewProvider;
class PlanTreeItem extends vscode.TreeItem {
    label;
    description;
    collapsibleState;
    type;
    data;
    constructor(label, description, collapsibleState, type, data, iconOverride) {
        super(label, collapsibleState);
        this.label = label;
        this.description = description;
        this.collapsibleState = collapsibleState;
        this.type = type;
        this.data = data;
        this.tooltip = description;
        this.description = description.length > 50 ? description.substring(0, 50) + '...' : description;
        if (iconOverride) {
            this.iconPath = iconOverride;
        }
        else {
            switch (type) {
                case 'plan':
                    this.iconPath = new vscode.ThemeIcon('tasklist');
                    break;
                case 'info':
                    this.iconPath = new vscode.ThemeIcon('info');
                    break;
            }
        }
        if (type === 'step' && data) {
            this.contextValue = `step-${data.status}`;
            if (data.status === 'pending') {
                this.command = {
                    command: 'neurobyte.executeStep',
                    title: 'Execute Step',
                    arguments: [data.id]
                };
            }
        }
    }
}
//# sourceMappingURL=planViewProvider.js.map