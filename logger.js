// logger.js
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class Logger {
    constructor(options = {}) {
        this.logLevel = options.logLevel || 'info';
        this.logFile = options.logFile || path.join(os.homedir(), '.ai-agent.log');
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3,
            none: 4
        };
    }

    shouldLog(level) {
        return this.levels[level] >= this.levels[this.logLevel];
    }

    async _writeToFile(level, message) {
        try {
            const formattedMessage = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
            await fs.appendFile(this.logFile, formattedMessage);
        } catch (error) {
            console.error(chalk.red('Failed to write to log file:'), error.message);
        }
    }

    debug(message, ...args) {
        if (this.shouldLog('debug')) {
            console.log(chalk.gray('[DEBUG]'), message, ...args);
            this._writeToFile('debug', `${message} ${args.join(' ')}`);
        }
    }

    info(message, ...args) {
        if (this.shouldLog('info')) {
            console.log(chalk.blue('[INFO]'), message, ...args);
            this._writeToFile('info', `${message} ${args.join(' ')}`);
        }
    }

    warn(message, ...args) {
        if (this.shouldLog('warn')) {
            console.log(chalk.yellow('[WARN]'), message, ...args);
            this._writeToFile('warn', `${message} ${args.join(' ')}`);
        }
    }

    error(message, ...args) {
        if (this.shouldLog('error')) {
            console.error(chalk.red('[ERROR]'), message, ...args);
            this._writeToFile('error', `${message} ${args.join(' ')}`);
        }
    }

    setLogLevel(level) {
        if (this.levels[level] !== undefined) {
            this.logLevel = level;
            this.info(`Log level set to ${level}`);
        } else {
            this.warn(`Invalid log level: ${level}. Using current level: ${this.logLevel}`);
        }
    }

    async getLogHistory(lines = 10) {
        try {
            const data = await fs.readFile(this.logFile, 'utf8');
            return data.split('\n').filter(Boolean).slice(-lines);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
}

module.exports = Logger;