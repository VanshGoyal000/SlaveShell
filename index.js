#!/usr/bin/env node
const readline = require("readline-sync");
const { exec, spawn } = require("child_process");
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar'); // For file watching
const { GoogleGenerativeAI } = require("@google/generative-ai");
const chalk = require('chalk'); // For colored console output
const ora = require('ora'); // For spinners
const inquirer = require('inquirer'); // For interactive prompts
const os = require('os');
const mongoose = require('mongoose'); // For MongoDB operations
const logger = require('./logger.js')

// Configuration file
const configPath = path.join(os.homedir(), '.ai-agent-config.json');

// Project state management
const projectState = {
    currentDirectory: process.cwd(),
    runningProcesses: new Map(),
    history: [],
    fileWatchers: new Map(),
    databases: new Map(),
    config: {
        apiKey: '',
        defaultProjectsDir: path.join(os.homedir(), 'ai-projects'),
        language: 'hindi',
        logLevel: 'info',
        autoSave: true
    },
    logger: new logger()
};

// Initialize Google AI
let genAI;
let model;

async function initializeAI() {
    try {
        // Load config if exists
        try {
            const configData = await fs.readFile(configPath, 'utf8');
            Object.assign(projectState.config, JSON.parse(configData));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error("Error loading config:", error.message);
            }
        }

        // Ask for API key if not configured
        if (!projectState.config.apiKey) {
            const { apiKey } = await inquirer.prompt([{
                type: 'password',
                name: 'apiKey',
                message: 'Enter your Gemini API key:',
                validate: input => input.length > 0 ? true : 'API key cannot be empty'
            }]);
            projectState.config.apiKey = apiKey;
            await saveConfig();
        }

        // Initialize Gemini
        genAI = new GoogleGenerativeAI(projectState.config.apiKey);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        
        return true;
    } catch (error) {
        console.error(chalk.red("Failed to initialize AI:"), error.message);
        return false;
    }
}

async function saveConfig() {
    try {
        await fs.writeFile(configPath, JSON.stringify(projectState.config, null, 2), 'utf8');
    } catch (error) {
        console.error(chalk.red("Error saving config:"), error.message);
    }
}

// Utility to convert command paths to absolute paths
function resolveProjectPath(filePath) {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(projectState.currentDirectory, filePath);
}

// Execute shell commands with promise
function execPromise(command) {
    return new Promise((resolve, reject) => {
        const spinner = ora(`Executing: ${command}`).start();
        exec(command, { cwd: projectState.currentDirectory }, (error, stdout, stderr) => {
            if (error) {
                spinner.fail();
                reject(new Error(`${error.message}\n${stderr}`));
                return;
            }
            spinner.succeed();
            resolve(stdout.trim());
        });
    });
}

// Function to watch files
function watchFiles(dirPath, onChangeCallback) {
    if (projectState.fileWatchers.has(dirPath)) {
        return;
    }
    
    const watcher = chokidar.watch(dirPath, {
        ignored: /(^|[\/\\])\../, // Ignore dot files
        persistent: true
    });
    
    watcher.on('change', path => {
        console.log(chalk.cyan(`📂 File changed: ${path}`));
        if (onChangeCallback) onChangeCallback(path);
    });
    
    projectState.fileWatchers.set(dirPath, watcher);
    console.log(chalk.cyan(`👀 Watching directory: ${dirPath}`));
}

// Database operations
async function handleDatabaseOperation(operation) {
    try {
        switch(operation.dbType) {
            case 'mongodb':
                return await handleMongoDBOperation(operation);
            case 'mysql':
            case 'postgres':
            case 'sqlite':
                // Implement other database types
                console.log(chalk.yellow(`⚠️ ${operation.dbType} operations not yet implemented`));
                return null;
            default:
                throw new Error(`Unsupported database type: ${operation.dbType}`);
        }
    } catch (error) {
        console.error(chalk.red(`❌ Database error:`), error.message);
        throw error;
    }
}

async function handleMongoDBOperation(operation) {
    const { action, connectionString, database, collection, data, query } = operation;
    
    // Connect if not already connected
    if (!projectState.databases.has(connectionString)) {
        const connection = await mongoose.connect(connectionString, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        projectState.databases.set(connectionString, connection);
    }
    
    const db = mongoose.connection.db;
    
    switch(action) {
        case 'create-collection':
            await db.createCollection(collection);
            return { success: true, message: `Collection ${collection} created` };
            
        case 'insert':
            const result = await db.collection(collection).insertMany(data);
            return { success: true, inserted: result.insertedCount };
            
        case 'query':
            const docs = await db.collection(collection).find(query).toArray();
            return { success: true, data: docs };
            
        case 'drop-collection':
            await db.collection(collection).drop();
            return { success: true, message: `Collection ${collection} dropped` };
            
        default:
            throw new Error(`Unsupported MongoDB operation: ${action}`);
    }
}

// Git operations
async function handleGitOperation(operation) {
    try {
        const { action, repository, branch, message } = operation;
        
        switch(action) {
            case 'init':
                await execPromise('git init');
                return { success: true, message: 'Git repository initialized' };
                
            case 'clone':
                await execPromise(`git clone ${repository}`);
                return { success: true, message: `Repository cloned from ${repository}` };
                
            case 'add':
                await execPromise('git add .');
                return { success: true, message: 'Changes staged' };
                
            case 'commit':
                await execPromise(`git commit -m "${message || 'Commit by AI Agent'}"`);
                return { success: true, message: 'Changes committed' };
                
            case 'push':
                await execPromise(`git push origin ${branch || 'main'}`);
                return { success: true, message: `Pushed to ${branch || 'main'}` };
                
            case 'checkout':
                await execPromise(`git checkout ${branch}`);
                return { success: true, message: `Switched to branch ${branch}` };
                
            default:
                throw new Error(`Unsupported Git operation: ${action}`);
        }
    } catch (error) {
        console.error(chalk.red(`❌ Git error:`), error.message);
        throw error;
    }
}

// Package management
async function handlePackageOperation(operation) {
    try {
        const { manager, action, packages, options, directory } = operation;
        let command;
        
        // Change directory if specified
        if (directory) {
            process.chdir(resolveProjectPath(directory));
        }
        
        switch(manager) {
            case 'npm':
                switch(action) {
                    case 'install':
                        command = `npm install ${packages.join(' ')} ${options || ''}`;
                        break;
                    case 'uninstall':
                        command = `npm uninstall ${packages.join(' ')}`;
                        break;
                    case 'update':
                        command = `npm update ${packages.join(' ')}`;
                        break;
                    case 'init':
                        command = 'npm init -y';
                        break;
                    case 'run':
                        command = `npm run ${options}`;
                        break;
                    default:
                        throw new Error(`Unsupported NPM action: ${action}`);
                }
                break;
                
            case 'pip':
                switch(action) {
                    case 'install':
                        command = `pip install ${packages.join(' ')} ${options || ''}`;
                        break;
                    case 'uninstall':
                        command = `pip uninstall -y ${packages.join(' ')}`;
                        break;
                    case 'update':
                        command = `pip install --upgrade ${packages.join(' ')}`;
                        break;
                    default:
                        throw new Error(`Unsupported pip action: ${action}`);
                }
                break;
                
            default:
                throw new Error(`Unsupported package manager: ${manager}`);
        }
        
        const result = await execPromise(command);
        
        // Reset directory if changed
        if (directory) {
            process.chdir(projectState.currentDirectory);
        }
        
        return { success: true, output: result };
    } catch (error) {
        // Reset directory if an error occurred
        process.chdir(projectState.currentDirectory);
        console.error(chalk.red(`❌ Package management error:`), error.message);
        throw error;
    }
}

// Process management
async function startProcess(command, options = {}) {
    const { name, waitForExit = false, cwd = projectState.currentDirectory, logFile } = options;
    
    const processName = name || command.split(' ')[0];
    
    // Kill existing process with the same name if running
    if (projectState.runningProcesses.has(processName)) {
        await stopProcess(processName);
    }
    
    if (waitForExit) {
        const result = await execPromise(command);
        return { success: true, output: result };
    } else {
        const [cmd, ...args] = command.split(' ');
        
        const stdio = logFile 
            ? ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
            : 'inherit';
        
        const childProcess = spawn(cmd, args, {
            stdio,
            shell: true,
            cwd
        });
        
        projectState.runningProcesses.set(processName, {
            process: childProcess,
            command,
            startTime: new Date(),
            logFile
        });
        
        childProcess.on('exit', (code) => {
            console.log(chalk.yellow(`⏹️ Process ${processName} exited with code ${code}`));
            projectState.runningProcesses.delete(processName);
        });
        
        console.log(chalk.green(`▶️ Started process: ${processName}`));
        return { success: true, processName };
    }
}

async function stopProcess(processName) {
    if (!projectState.runningProcesses.has(processName)) {
        console.log(chalk.yellow(`⚠️ No running process named ${processName}`));
        return { success: false, message: `No running process named ${processName}` };
    }
    
    const { process } = projectState.runningProcesses.get(processName);
    
    try {
        process.kill();
        projectState.runningProcesses.delete(processName);
        console.log(chalk.green(`⏹️ Stopped process: ${processName}`));
        return { success: true, message: `Process ${processName} stopped` };
    } catch (error) {
        console.error(chalk.red(`❌ Error stopping process ${processName}:`), error.message);
        return { success: false, error: error.message };
    }
}

async function listProcesses() {
    const processList = [];
    
    for (const [name, details] of projectState.runningProcesses.entries()) {
        const { command, startTime, logFile } = details;
        const uptime = Math.floor((new Date() - startTime) / 1000);
        
        processList.push({
            name,
            command,
            uptime: `${uptime} seconds`,
            logFile: logFile || 'N/A'
        });
    }
    
    return processList;
}

// Advanced file operations
async function performFileOperation(operation) {
    try {
        const { action, path: filePath, content, newPath, options } = operation;
        const fullPath = resolveProjectPath(filePath);
        
        switch(action) {
            case 'read':
                const data = await fs.readFile(fullPath, 'utf8');
                return { success: true, content: data };
                
            case 'write':
                await fs.writeFile(fullPath, content, 'utf8');
                return { success: true, message: `File written: ${filePath}` };
                
            case 'append':
                await fs.appendFile(fullPath, content, 'utf8');
                return { success: true, message: `Content appended to: ${filePath}` };
                
            case 'delete':
                await fs.unlink(fullPath);
                return { success: true, message: `File deleted: ${filePath}` };
                
            case 'rename':
                await fs.rename(fullPath, resolveProjectPath(newPath));
                return { success: true, message: `File renamed from ${filePath} to ${newPath}` };
                
            case 'mkdir':
                await fs.mkdir(fullPath, { recursive: true });
                return { success: true, message: `Directory created: ${filePath}` };
                
            case 'rmdir':
                if (options && options.recursive) {
                    await fs.rm(fullPath, { recursive: true, force: true });
                } else {
                    await fs.rmdir(fullPath);
                }
                return { success: true, message: `Directory removed: ${filePath}` };
                
            case 'list':
                const files = await fs.readdir(fullPath);
                return { success: true, files };
                
            case 'watch':
                watchFiles(fullPath, operation.callback);
                return { success: true, message: `Watching: ${filePath}` };
                
            default:
                throw new Error(`Unsupported file operation: ${action}`);
        }
    } catch (error) {
        console.error(chalk.red(`❌ File operation error:`), error.message);
        throw error;
    }
}

async function executeAICommand(userCommand) {
    const spinner = ora('Parsing your command...').start();
    
    try {
        // More detailed prompt to handle complex operations
        const prompt = `
Parse this command in ${projectState.config.language}: "${userCommand}"

Respond with a detailed JSON execution plan:
{
    "type": "project|file|system|server|database|git|npm|python|deploy|composite",
    "actions": [
        {
            // For project creation/management
            "type": "project-setup",
            "projectType": "node|python|react|angular|vue|next|nest|django|flask|etc",
            "template": "basic|auth|fullstack|etc",
            "name": "project name",
            "path": "project path",
            "steps": [
                {
                    "type": "mkdir|write|exec|install|config|start|stop|git|database",
                    "details": { /* action-specific details */ }
                }
            ]
        },
        {
            // For file operations
            "type": "file-operation",
            "action": "read|write|append|delete|rename|mkdir|rmdir|list|watch",
            "path": "target path",
            "content": "file content if applicable",
            "newPath": "for rename operations",
            "options": { "recursive": true, "force": true } // For rmdir/other operations
        },
        {
            // For package management
            "type": "package-operation",
            "manager": "npm|pip|yarn|composer|etc",
            "action": "install|uninstall|update|init|run",
            "packages": ["package1", "package2"],
            "options": "additional flags",
            "directory": "working directory"
        },
        {
            // For process management
            "type": "process-operation",
            "action": "start|stop|list",
            "command": "command to run",
            "options": {
                "name": "process name",
                "waitForExit": false,
                "cwd": "working directory",
                "logFile": "path/to/log.txt"
            }
        },
        {
            // For database operations
            "type": "database-operation",
            "dbType": "mongodb|mysql|postgres|sqlite",
            "action": "create-collection|insert|query|drop-collection|etc",
            "connectionString": "database connection string",
            "database": "database name",
            "collection": "collection/table name",
            "data": [/* data objects */],
            "query": {/* query object */}
        },
        {
            // For git operations
            "type": "git-operation",
            "action": "init|clone|add|commit|push|checkout|etc",
            "repository": "repo URL for clone",
            "branch": "branch name",
            "message": "commit message"
        },
        {
            // For deployment
            "type": "deploy-operation",
            "platform": "firebase|heroku|netlify|vercel|aws|etc",
            "steps": [
                {
                    "type": "build|config|upload|invoke",
                    "command": "command to execute",
                    "path": "target path"
                }
            ]
        }
    ],
    "context": {
        "description": "human-readable description of what this plan does",
        "needsMonitoring": boolean,
        "estimated_time": "time estimate in minutes"
    }
        IMPORTANT: Return ONLY the JSON object with no additional text before or after it. Ensure that all comments are removed from the JSON response.

}
`;

        const response = await model.generateContent(prompt);
        const planText = response.response.text().trim();
        const cleanJson = planText
            .replace(/```json\s?/g, '')
            .replace(/```\s?/g, '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\/\/.+/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        let plan = JSON.parse(cleanJson);

        
        // Extract JSON if response contains explanatory text
        if (planText.includes('{') && planText.includes('}')) {
            const jsonStart = planText.indexOf('{');
            const jsonEnd = planText.lastIndexOf('}') + 1;
            const jsonStr = planText.substring(jsonStart, jsonEnd);
            plan = JSON.parse(jsonStr);
        } else {
            plan = JSON.parse(planText);
        }
        
        spinner.succeed(chalk.green(`✓ Command parsed: ${plan.context.description}`));
        
        // Record command in history
        projectState.history.push({
            command: userCommand,
            timestamp: new Date(),
            type: plan.type,
            description: plan.context.description
        });
        
        // Execute actions based on type
        for (const action of plan.actions) {
            switch (action.type) {
                case 'project-setup':
                    await handleProjectSetup(action);
                    break;
                    
                case 'file-operation':
                    const result = await performFileOperation(action);
                    if(result.success && result.content){
                        console.log(chalk.cyan('\n📄 File contents:'));
                        console.log(chalk.yellow('─'.repeat(50)));
                        console.log(result.content);
                        console.log(chalk.yellow('─'.repeat(50)));
                    }
                    break;
                    
                case 'package-operation':
                    await handlePackageOperation(action);
                    break;
                    
                case 'process-operation':
                    switch (action.action) {
                        case 'start':
                            await startProcess(action.command, action.options);
                            break;
                        case 'stop':
                            await stopProcess(action.options.name);
                            break;
                        case 'list':
                            const processes = await listProcesses();
                            console.table(processes);
                            break;
                    }
                    break;
                    
                case 'database-operation':
                    await handleDatabaseOperation(action);
                    break;
                    
                case 'git-operation':
                    await handleGitOperation(action);
                    break;
                    
                case 'deploy-operation':
                    await handleDeployment(action);
                    break;
                    
                default:
                    console.log(chalk.yellow(`⚠️ Unsupported action type: ${action.type}`));
            }
        }
        
        // Handle monitoring if needed
        if (plan.context.needsMonitoring) {
            console.log(chalk.cyan('👀 Setting up monitoring...'));
            // Implement appropriate monitoring based on plan type
        }
        
        return true;
    } catch (error) {
        spinner.fail(chalk.red(`❌ Error: ${error.message}`));
        return false;
    }
}

// Project setup handler
async function handleProjectSetup(setup) {
    console.log(chalk.blue(`🚀 Setting up ${setup.projectType} project: ${setup.name}`));
    
    try {
        // Create project directory
        const projectPath = resolveProjectPath(setup.path || setup.name);
        await fs.mkdir(projectPath, { recursive: true });
        
        // Navigate to project directory
        const originalDir = process.cwd();
        process.chdir(projectPath);
        projectState.currentDirectory = projectPath;
        
        // Execute setup steps
        for (const step of setup.steps) {
            switch(step.type) {
                case 'mkdir':
                    await fs.mkdir(step.details.path, { recursive: true });
                    console.log(chalk.green(`📁 Created directory: ${step.details.path}`));
                    break;
                    
                case 'write':
                    await fs.writeFile(step.details.path, step.details.content, 'utf8');
                    console.log(chalk.green(`📝 Created file: ${step.details.path}`));
                    break;
                    
                case 'exec':
                    await execPromise(step.details.command);
                    break;
                    
                case 'install':
                    await handlePackageOperation({
                        manager: step.details.manager,
                        action: 'install',
                        packages: step.details.packages,
                        options: step.details.options
                    });
                    break;
                    
                case 'start':
                    await startProcess(step.details.command, step.details.options);
                    break;
                    
                case 'git':
                    await handleGitOperation(step.details);
                    break;
                    
                case 'database':
                    await handleDatabaseOperation(step.details);
                    break;
                    
                default:
                    console.log(chalk.yellow(`⚠️ Unsupported setup step: ${step.type}`));
            }
        }
        
        console.log(chalk.green(`✅ Project setup complete: ${setup.name}`));
        
    } catch (error) {
        console.error(chalk.red(`❌ Project setup error:`), error.message);
        throw error;
    }
}

// Deployment handler
async function handleDeployment(deployment) {
    console.log(chalk.blue(`🚀 Deploying to ${deployment.platform}...`));
    
    try {
        for (const step of deployment.steps) {
            switch(step.type) {
                case 'build':
                    console.log(chalk.cyan(`🔨 Building for deployment...`));
                    await execPromise(step.command);
                    break;
                    
                case 'config':
                    console.log(chalk.cyan(`⚙️ Configuring deployment...`));
                    if (step.path && step.content) {
                        await fs.writeFile(step.path, step.content, 'utf8');
                    } else if (step.command) {
                        await execPromise(step.command);
                    }
                    break;
                    
                case 'upload':
                    console.log(chalk.cyan(`📤 Uploading to ${deployment.platform}...`));
                    await execPromise(step.command);
                    break;
                    
                case 'invoke':
                    console.log(chalk.cyan(`🔄 Invoking deployment command...`));
                    await execPromise(step.command);
                    break;
                    
                default:
                    console.log(chalk.yellow(`⚠️ Unsupported deployment step: ${step.type}`));
            }
        }
        
        console.log(chalk.green(`✅ Deployment to ${deployment.platform} complete!`));
        
    } catch (error) {
        console.error(chalk.red(`❌ Deployment error:`), error.message);
        throw error;
    }
}

// Main loop with improved command handling
async function main() {
    console.clear();
    console.log(chalk.cyan(`
    ╔═══════════════════════════════════════════╗
    ║           💪 SUPER AI AGENT 1.0           ║
    ╚═══════════════════════════════════════════╝
    `));
    
    // Initialize AI
    if (!await initializeAI()) {
        console.error(chalk.red("Failed to initialize AI. Exiting."));
        process.exit(1);
    }
    
    console.log(chalk.green(`
AI Agent initialized successfully! This agent can:
- Create complex projects (Node.js, Python, React, Full-stack apps)
- Manage running processes and servers
- Perform advanced file operations
- Handle package management (npm, pip)
- Execute database operations (MongoDB, MySQL)
- Manage git repositories
- Deploy applications to various platforms

Type ${chalk.yellow('help')} for examples, ${chalk.yellow('info')} for status, ${chalk.yellow('settings')} to configure, or ${chalk.yellow('exit')} to quit.`));

    while (true) {
        const command = readline.question(chalk.blue('\n>>: '));
        
        if (command.toLowerCase() === 'exit') {
            // Cleanup
            console.log(chalk.cyan('Cleaning up before exit...'));
            
            for (const [name, details] of projectState.runningProcesses.entries()) {
                console.log(chalk.yellow(`⏹️ Stopping process: ${name}`));
                await stopProcess(name);
            }
            
            for (const [path, watcher] of projectState.fileWatchers.entries()) {
                console.log(chalk.yellow(`👀 Stopping file watcher for: ${path}`));
                watcher.close();
            }
            
            for (const [connectionString, connection] of projectState.databases.entries()) {
                console.log(chalk.yellow(`🔌 Closing database connection: ${connectionString}`));
                await connection.close();
            }
            
            console.log(chalk.green('Thank you for using Super AI Agent! Goodbye.'));
            break;
        }
        
        if (command.toLowerCase() === 'help') {
            console.log(chalk.cyan(`
Examples of what you can do:

Project Creation:
- ek full stack MERN project banao authentication ke sath
- Python Flask ka API banao MongoDB connection ke sath
- ek responsive website banao Bootstrap se

Database Operations:
- mongodb setup karo aur users collection banao
- database me product table banao price aur name fields ke sath
- database backup file create karo

Deployment & CI/CD:
- production build banao aur firebase pe deploy karo
- docker image banao node application ka
- github actions setup karo automatic testing ke liye

Development Tasks:
- webpack se production build banao
- git repository initialize karo aur github pe push karo
- tests cases run karo aur code coverage report banao

System Operations:
- background me server chalao aur logs save karo
- cron job setup karo database backup ke liye
- memory usage monitor karo server ka

Type ${chalk.yellow('info')} to see current status and ${chalk.yellow('settings')} to configure the agent.
            `));
            continue;
        }
        
        if (command.toLowerCase() === 'info') {
            console.log(chalk.cyan(`
📊 Current Status:
Current directory: ${projectState.currentDirectory}
Running processes: ${projectState.runningProcesses.size}
File watchers: ${projectState.fileWatchers.size}
Database connections: ${projectState.databases.size}
Commands history: ${projectState.history.length}

Most recent commands:`));

            const recentCommands = projectState.history.slice(-5).reverse();
            for (const cmd of recentCommands) {
                const timeAgo = Math.floor((new Date() - cmd.timestamp) / 1000);
                console.log(chalk.gray(`${timeAgo}s ago: ${cmd.command}`));
            }
            
            continue;
        }
        
        if (command.toLowerCase() === 'settings') {
            const { action } = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: 'Select configuration option:',
                choices: [
                    'Change API key',
                    'Change default project directory',
                    'Change language (Hindi/English)',
                    'Change log level',
                    'Toggle auto-save',
                    'Back to main menu'
                ]
            }]);
            
            if (action === 'Back to main menu') continue;
            
            switch(action) {
                case 'Change API key':
                    const { apiKey } = await inquirer.prompt([{
                        type: 'password',
                        name: 'apiKey',
                        message: 'Enter new API key:',
                        validate: input => input.length > 0 ? true : 'API key cannot be empty'
                    }]);
                    projectState.config.apiKey = apiKey;
                    await saveConfig();
                    // Reinitialize AI with new key
                    await initializeAI();
                    break;
                
                case 'Change default project directory':
                    const { projectDir } = await inquirer.prompt([{
                        type: 'input',
                        name: 'projectDir',
                        message: 'Enter default projects directory:',
                        default: projectState.config.defaultProjectsDir
                    }]);
                    projectState.config.defaultProjectsDir = projectDir;
                    await saveConfig();
                    break;
                
                case 'Change language (Hindi/English)':
                    const { language } = await inquirer.prompt([{
                        type: 'list',
                        name: 'language',
                        message: 'Select language:',
                        choices: ['hindi', 'english']
                    }]);
                    projectState.config.language = language;
                    await saveConfig();
                    break;
                
                case 'Change log level':
                    const { logLevel } = await inquirer.prompt([{
                        type: 'list',
                        name: 'logLevel',
                        message: 'Select log level:',
                        choices: ['debug', 'info', 'warn', 'error']
                    }]);
                    projectState.config.logLevel = logLevel;
                    await saveConfig();
                    break;
                
                case 'Toggle auto-save':
                    projectState.config.autoSave = !projectState.config.autoSave;
                    await saveConfig();
                    console.log(chalk.green(`Auto-save: ${projectState.config.autoSave ? 'ON' : 'OFF'}`));
                    break;
            }
            
            continue;
        }
        
        await executeAICommand(command);
    }
}

// Start the application
if (require.main === module) {
    main().catch(err => {
        console.error('❌ Fatal error:', err);
        
        // Try to clean up any running processes
        const runningProcessNames = [...projectState.runningProcesses.keys()];
        if (runningProcessNames.length > 0) {
            console.log(chalk.yellow('Attempting to stop running processes before exit...'));
            runningProcessNames.forEach(name => {
                try {
                    const { process } = projectState.runningProcesses.get(name);
                    process.kill();
                    console.log(chalk.yellow(`⏹️ Stopped process: ${name}`));
                } catch (e) {
                    console.error(chalk.red(`Failed to stop process ${name}:`), e.message);
                }
            });
        }
        
        // Close watchers
        for (const [path, watcher] of projectState.fileWatchers.entries()) {
            try {
                watcher.close();
                console.log(chalk.yellow(`👀 Stopped file watcher for: ${path}`));
            } catch (e) {
                console.error(chalk.red(`Failed to close watcher for ${path}:`), e.message);
            }
        }
        
        // Close database connections
        for (const [connectionString, connection] of projectState.databases.entries()) {
            try {
                connection.close();
                console.log(chalk.yellow(`🔌 Closed database connection: ${connectionString}`));
            } catch (e) {
                console.error(chalk.red(`Failed to close database connection ${connectionString}:`), e.message);
            }
        }
        
        // Log error to file
        const errorLog = path.join(os.homedir(), '.ai-agent-errors.log');
        const errorMessage = `${new Date().toISOString()} - Fatal error: ${err.stack || err.message || err}\n`;
        
        try {
            fs.appendFile(errorLog, errorMessage);
        } catch (logError) {
            // Can't do much if we can't write to the log file
        }
        
        process.exit(1);
    });
}