import fs from 'fs';
import path from 'path';

/**
 * Logger module for EET Shopify application
 * Handles file logging with daily rotation
 */
class Logger {
  constructor() {
    this.logDir = 'logs';
    this.ensureLogDirectory();
    this.currentLogFile = this.getLogFileName();
    this.setupDailyRotation();
  }

  /**
   * Ensure logs directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get log file name based on current date and time
   * @returns {string} Log file name
   */
  getLogFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const dateTimeStr = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
    return path.join(this.logDir, `eet-shopify-${dateTimeStr}.log`);
  }

  /**
   * Setup daily rotation at midnight
   */
  setupDailyRotation() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.rotateLogFile();
      // Set up interval for every 24 hours
      setInterval(() => {
        this.rotateLogFile();
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Rotate log file to new day
   */
  rotateLogFile() {
    this.currentLogFile = this.getLogFileName();
    this.info('Logger', 'Log file rotated for new day', {
      newLogFile: this.currentLogFile
    });
  }

  /**
   * Format log message with timestamp
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   * @returns {string} Formatted log message
   */
  formatMessage(level, module, message, data = null) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] [${module}] ${message}${dataStr}`;
  }

  /**
   * Write log message to file
   * @param {string} level - Log level
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  writeToFile(level, module, message, data = null) {
    const logMessage = this.formatMessage(level, module, message, data);
    
    try {
      fs.appendFileSync(this.currentLogFile, logMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Log info message
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  info(module, message, data = null) {
    const logMessage = this.formatMessage('INFO', module, message, data);
    // console.log(logMessage);
    this.writeToFile('INFO', module, message, data);
  }

  /**
   * Log warning message
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  warn(module, message, data = null) {
    const logMessage = this.formatMessage('WARN', module, message, data);
    console.warn(logMessage);
    this.writeToFile('WARN', module, message, data);
  }

  /**
   * Log error message
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  error(module, message, data = null) {
    const logMessage = this.formatMessage('ERROR', module, message, data);
    console.error(logMessage);
    this.writeToFile('ERROR', module, message, data);
  }

  /**
   * Log debug message
   * @param {string} module - Module name
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  debug(module, message, data = null) {
    const logMessage = this.formatMessage('DEBUG', module, message, data);
    // console.log(logMessage);
    this.writeToFile('DEBUG', module, message, data);
  }

  /**
   * Log application start
   */
  logAppStart() {
    this.info('APP', 'EET Shopify Application started', {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform
    });
  }

  /**
   * Log application end
   * @param {Object} stats - Application statistics
   */
  logAppEnd(stats = {}) {
    this.info('APP', 'EET Shopify Application completed', {
      timestamp: new Date().toISOString(),
      stats: stats
    });
  }

  /**
   * Log filter process
   * @param {Object} filterStats - Filter statistics
   */
  logFilterProcess(filterStats) {
    this.info('FILTER', 'Product filtering completed', {
      totalProducts: filterStats.totalProducts,
      originalCount: filterStats.originalCount,
      filterDate: filterStats.filterDate,
      limit: filterStats.limit
    });
  }

  /**
   * Log Shopify operations
   * @param {string} operation - Operation type
   * @param {Object} data - Operation data
   */
  logShopifyOperation(operation, data = {}) {
    this.info('SHOPIFY', `Shopify operation: ${operation}`, data);
  }

  /**
   * Get current log file path
   * @returns {string} Current log file path
   */
  getCurrentLogFile() {
    return this.currentLogFile;
  }

  /**
   * Get all log files
   * @returns {Array} Array of log file paths
   */
  getLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir);
      return files
        .filter(file => file.startsWith('eet-shopify-') && file.endsWith('.log'))
        .map(file => path.join(this.logDir, file))
        .sort();
    } catch (error) {
      this.error('LOGGER', 'Failed to read log directory', { error: error.message });
      return [];
    }
  }
}

// Create singleton instance
const logger = new Logger();

export default logger;
