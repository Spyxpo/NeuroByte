import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';

export interface FileReadRequest {
    path: string;
    offset?: number;
    limit?: number;
}

export interface FileWriteRequest {
    path: string;
    content: string;
}

export interface FileEditRequest {
    path: string;
    old_text: string;
    new_text: string;
    replace_all?: boolean;
}

export interface SearchRequest {
    pattern: string;
    path?: string;
    file_pattern?: string;
    max_results?: number;
}

export interface IndexRequest {
    workspace_path: string;
    exclude_patterns?: string[];
}

export interface PlanRequest {
    title: string;
    description: string;
    steps: {
        title: string;
        description: string;
        actions: any[];
    }[];
    workspace_path?: string;
}

export class NeuroByteCoreService {
    private context: vscode.ExtensionContext;
    private coreProcess: ChildProcess | null = null;
    private baseUrl: string = 'http://127.0.0.1:19285';
    private isRunning: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async start(): Promise<void> {
        // Check if core binary exists
        const corePath = this.getCoreBinaryPath();

        if (!corePath || !fs.existsSync(corePath)) {
            console.log('Core binary not found, using HTTP API only mode');
            // In development, the core might be running separately
            this.isRunning = await this.checkHealth();
            return;
        }

        // Start the core process
        this.coreProcess = spawn(corePath, [], {
            env: {
                ...process.env,
                NEUROBYTE_PORT: '19285',
                RUST_LOG: 'neurobyte_core=info'
            }
        });

        this.coreProcess.stdout?.on('data', (data) => {
            console.log(`NeuroByte Core: ${data}`);
        });

        this.coreProcess.stderr?.on('data', (data) => {
            console.error(`NeuroByte Core Error: ${data}`);
        });

        this.coreProcess.on('close', (code) => {
            console.log(`NeuroByte Core exited with code ${code}`);
            this.isRunning = false;
        });

        // Wait for core to be ready
        await this.waitForReady();
        this.isRunning = true;
    }

    private getCoreBinaryPath(): string | null {
        const platform = process.platform;
        const arch = process.arch;

        let binaryName = 'neurobyte-server';
        if (platform === 'win32') {
            binaryName += '.exe';
        }

        // Check in extension's bin directory
        const binPath = path.join(this.context.extensionPath, 'bin', `${platform}-${arch}`, binaryName);
        if (fs.existsSync(binPath)) {
            return binPath;
        }

        // Check in development location
        const devPath = path.join(this.context.extensionPath, '..', 'neurobyte-core', 'target', 'release', binaryName);
        if (fs.existsSync(devPath)) {
            return devPath;
        }

        return null;
    }

    private async waitForReady(timeout: number = 10000): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (await this.checkHealth()) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Core service failed to start');
    }

    private async checkHealth(): Promise<boolean> {
        try {
            const response = await axios.get(`${this.baseUrl}/health`, { timeout: 1000 });
            return response.data?.status === 'healthy';
        } catch {
            return false;
        }
    }

    stop(): void {
        if (this.coreProcess) {
            this.coreProcess.kill();
            this.coreProcess = null;
        }
        this.isRunning = false;
    }

    async getDeviceInfo(): Promise<any> {
        const response = await axios.get(`${this.baseUrl}/device-info`);
        return response.data;
    }

    async readFile(request: FileReadRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/files/read`, request);
        return response.data;
    }

    async writeFile(request: FileWriteRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/files/write`, request);
        return response.data;
    }

    async editFile(request: FileEditRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/files/edit`, request);
        return response.data;
    }

    async searchFiles(request: SearchRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/files/search`, request);
        return response.data;
    }

    async globFiles(pattern: string, basePath?: string): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/files/glob`, {
            pattern,
            path: basePath
        });
        return response.data;
    }

    async indexProject(request: IndexRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/index/project`, request);
        return response.data;
    }

    async getIndexStatus(): Promise<any> {
        const response = await axios.get(`${this.baseUrl}/index/status`);
        return response.data;
    }

    async searchIndex(query: string, maxResults?: number): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/index/search`, {
            query,
            max_results: maxResults
        });
        return response.data;
    }

    async createPlan(request: PlanRequest): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/plan/create`, request);
        return response.data;
    }

    async executePlan(stepIndex?: number, autoContinue?: boolean): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/plan/execute`, {
            step_index: stepIndex,
            auto_continue: autoContinue
        });
        return response.data;
    }

    async getPlanStatus(): Promise<any> {
        const response = await axios.get(`${this.baseUrl}/plan/status`);
        return response.data;
    }

    async getConfig(): Promise<any> {
        const response = await axios.get(`${this.baseUrl}/config`);
        return response.data;
    }

    async updateConfig(config: any): Promise<any> {
        const response = await axios.post(`${this.baseUrl}/config`, config);
        return response.data;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    isReady(): boolean {
        return this.isRunning;
    }
}
