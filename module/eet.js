import fetch from 'node-fetch';
import logger from './logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if logging is disabled
const isLoggingEnabled = process.env.LOGGING !== 'false';

/**
 * EET API Client for authentication and data operations
 */
class EETClient {
  constructor() {
    this.baseUrl = 'https://customerapi.eetgroup.com';
    this.sessionToken = null;
    this.isAuthenticated = false;
  }

  /**
   * Login to EET API
   * @returns {Promise<Object>} Login result with success status and token
   */
  async login() {
    try {
      if (isLoggingEnabled) {
        logger.info('EET_LOGIN', 'Starting EET login process');
      }

      const username = process.env.EET_USERNAME;
      const password = process.env.EET_PASSWORD;

      if (!username || !password) {
        throw new Error('EET_USERNAME and EET_PASSWORD environment variables are required');
      }
      const loginData = {
        UserName: username,
        Password: password
      };

      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(loginData)
      });

      if (response.status !== 200) {
        throw new Error('EET login failed');
      }

      const result = await response.json();
      
      return result;

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('EET_LOGIN', 'EET login failed', {
          error: error.message,
          stack: error.stack
        });
      }

      console.log(`❌ EET login failed: ${error.message}`);

      return {
        success: false,
        error: error.message,
        message: 'Login failed'
      };
    }
  }

  /**
   * Check if client is authenticated
   * @returns {boolean} Authentication status
   */
  isLoggedIn() {
    return this.isAuthenticated && !!this.sessionToken;
  }

  /**
   * Get authentication headers for API requests
   * @returns {Object} Headers with authentication
   */
  getAuthHeaders() {
    if (!this.isLoggedIn()) {
      throw new Error('Not authenticated. Please login first.');
    }

    return {
      'Authorization': `Bearer ${this.sessionToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Logout from EET API
   * @returns {Promise<Object>} Logout result
   */
  async logout() {
    try {
      if (!this.isLoggedIn()) {
        return {
          success: true,
          message: 'Already logged out'
        };
      }

      // If EET has a logout endpoint, call it here
      // For now, just clear local state
      this.sessionToken = null;
      this.isAuthenticated = false;

      if (isLoggingEnabled) {
        logger.info('EET_LOGOUT', 'EET logout successful');
      }

      console.log('✅ EET logout successful');

      return {
        success: true,
        message: 'Logout successful'
      };

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('EET_LOGOUT', 'EET logout failed', {
          error: error.message
        });
      }

      return {
        success: false,
        error: error.message,
        message: 'Logout failed'
      };
    }
  }
}

export default EETClient;