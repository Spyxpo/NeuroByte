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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeuroByteCoreService = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
class NeuroByteCoreService {
    context;
    coreProcess = null;
    baseUrl = 'http://127.0.0.1:19285';
    isRunning = false;
    constructor(context) {
        this.context = context;
    }
    async start() {
        // Check if core binary exists
        const corePath = this.getCoreBinaryPath();
        if (!corePath || !fs.existsSync(corePath)) {
            console.log('Core binary not found, using HTTP API only mode');
            // In development, the core might be running separately
            this.isRunning = await this.checkHealth();
            return;
        }
        // Start the core process
        this.coreProcess = (0, child_process_1.spawn)(corePath, [], {
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
    getCoreBinaryPath() {
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
    async waitForReady(timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (await this.checkHealth()) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Core service failed to start');
    }
    async checkHealth() {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/health`, { timeout: 1000 });
            return response.data?.status === 'healthy';
        }
        catch {
            return false;
        }
    }
    stop() {
        if (this.coreProcess) {
            this.coreProcess.kill();
            this.coreProcess = null;
        }
        this.isRunning = false;
    }
    async getDeviceInfo() {
        const response = await axios_1.default.get(`${this.baseUrl}/device-info`);
        return response.data;
    }
    async readFile(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/files/read`, request);
        return response.data;
    }
    async writeFile(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/files/write`, request);
        return response.data;
    }
    async editFile(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/files/edit`, request);
        return response.data;
    }
    async searchFiles(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/files/search`, request);
        return response.data;
    }
    async globFiles(pattern, basePath) {
        const response = await axios_1.default.post(`${this.baseUrl}/files/glob`, {
            pattern,
            path: basePath
        });
        return response.data;
    }
    async indexProject(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/index/project`, request);
        return response.data;
    }
    async getIndexStatus() {
        const response = await axios_1.default.get(`${this.baseUrl}/index/status`);
        return response.data;
    }
    async searchIndex(query, maxResults) {
        const response = await axios_1.default.post(`${this.baseUrl}/index/search`, {
            query,
            max_results: maxResults
        });
        return response.data;
    }
    async createPlan(request) {
        const response = await axios_1.default.post(`${this.baseUrl}/plan/create`, request);
        return response.data;
    }
    async executePlan(stepIndex, autoContinue) {
        const response = await axios_1.default.post(`${this.baseUrl}/plan/execute`, {
            step_index: stepIndex,
            auto_continue: autoContinue
        });
        return response.data;
    }
    async getPlanStatus() {
        const response = await axios_1.default.get(`${this.baseUrl}/plan/status`);
        return response.data;
    }
    async getConfig() {
        const response = await axios_1.default.get(`${this.baseUrl}/config`);
        return response.data;
    }
    async updateConfig(config) {
        const response = await axios_1.default.post(`${this.baseUrl}/config`, config);
        return response.data;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    isReady() {
        return this.isRunning;
    }
}
exports.NeuroByteCoreService = NeuroByteCoreService;
//# sourceMappingURL=coreService.js.map