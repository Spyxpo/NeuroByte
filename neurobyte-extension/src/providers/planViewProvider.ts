import * as vscode from 'vscode';
import { NeuroByteCoreService } from '../services/coreService';

interface PlanStep {
    id: number;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

interface Plan {
    id: string;
    title: string;
    description: string;
    steps: PlanStep[];
    current_step: number;
    status: string;
}

export class PlanViewProvider implements vscode.TreeDataProvider<PlanTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PlanTreeItem | undefined | null | void> =
        new vscode.EventEmitter<PlanTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PlanTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private currentPlan: Plan | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly coreService: NeuroByteCoreService
    ) {
        this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            const status = await this.coreService.getPlanStatus();
            this.currentPlan = status.has_plan ? status.plan : null;
        } catch {
            this.currentPlan = null;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PlanTreeItem): Thenable<PlanTreeItem[]> {
        if (!this.currentPlan) {
            return Promise.resolve([
                new PlanTreeItem(
                    'No active plan',
                    'Use "Enter Plan Mode" to create a plan',
                    vscode.TreeItemCollapsibleState.None,
                    'info'
                )
            ]);
        }

        if (!element) {
            // Root level - show plan info and steps
            const items: PlanTreeItem[] = [
                new PlanTreeItem(
                    this.currentPlan.title,
                    this.currentPlan.description,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'plan',
                    this.currentPlan
                )
            ];
            return Promise.resolve(items);
        }

        if (element.type === 'plan') {
            // Show steps
            return Promise.resolve(
                this.currentPlan.steps.map(step => {
                    const icon = this.getStepIcon(step.status);
                    return new PlanTreeItem(
                        `${step.id + 1}. ${step.title}`,
                        step.description,
                        vscode.TreeItemCollapsibleState.None,
                        'step',
                        step,
                        icon
                    );
                })
            );
        }

        return Promise.resolve([]);
    }

    private getStepIcon(status: string): vscode.ThemeIcon {
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

    getCurrentPlan(): Plan | null {
        return this.currentPlan;
    }

    async createPlan(title: string, description: string, steps: any[]): Promise<void> {
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
        } else {
            throw new Error(result.error || 'Failed to create plan');
        }
    }

    async executePlan(stepIndex?: number, autoContinue?: boolean): Promise<any> {
        const result = await this.coreService.executePlan(stepIndex, autoContinue);
        if (result.plan) {
            this.currentPlan = result.plan;
            this._onDidChangeTreeData.fire();
        }
        return result;
    }
}

class PlanTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'plan' | 'step' | 'info',
        public readonly data?: any,
        iconOverride?: vscode.ThemeIcon
    ) {
        super(label, collapsibleState);
        this.tooltip = description;
        this.description = description.length > 50 ? description.substring(0, 50) + '...' : description;

        if (iconOverride) {
            this.iconPath = iconOverride;
        } else {
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
