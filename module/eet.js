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
      
      // Check if we got a JWT token in the response
      if (result.Token || result.token || result.access_token || result.jwt) {
        this.sessionToken = result.Token || result.token || result.access_token || result.jwt;
        this.isAuthenticated = true;
        
        if (isLoggingEnabled) {
          logger.info('EET_LOGIN', 'EET login successful with token', {
            hasToken: !!this.sessionToken,
            tokenLength: this.sessionToken ? this.sessionToken.length : 0,
            expiration: result.Expiration || 'Not provided'
          });
        }
        
        console.log('✅ EET login successful');
        
        return {
          success: true,
          token: this.sessionToken,
          expiration: result.Expiration,
          message: 'Login successful'
        };
      } else {
        // If no token in response, check if it's a successful response anyway
        if (result.success !== false) {
          // Generate a placeholder token for APIs that don't return tokens
          this.sessionToken = `eet_session_${Date.now()}`;
          this.isAuthenticated = true;
          
          return {
            success: true,
            token: this.sessionToken,
            message: 'Login successful (no token in response)'
          };
        } else {
          throw new Error(`EET login failed: ${result.message || result.error || 'Unknown error'}`);
        }
      }

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
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.sessionToken}`
    };
  }

  /**
   * Get all products price and stock from EET API
   * @param {Array} eetProducts - Array of EET products with varenr (SKU)
   * @returns {Promise<Object>} API response with product data
   */
  async getAllProductsPriceAndStock(eetProducts) {
    try {
      if (!this.isLoggedIn()) {
        throw new Error('Not authenticated. Please login first.');
      }

      if (isLoggingEnabled) {
        logger.info('EET_PRODUCTS', 'Getting all products price and stock', {
          productCount: eetProducts.length
        });
      }

      // Extract SKUs from EET products
      const items = eetProducts.map(product => ({
        ItemId: product.varenr
      }));

      const requestBody = { Items: items };


      const response = await fetch(`${this.baseUrl}/product`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`EET products API failed with status: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Handle direct array response
      const productsArray = Array.isArray(result) ? result : (result.Items || []);

      if (isLoggingEnabled) {
        logger.info('EET_PRODUCTS', 'Products data retrieved successfully', {
          isArray: Array.isArray(result),
          responseKeys: Array.isArray(result) ? ['array'] : Object.keys(result),
          itemsCount: productsArray.length
        });
      }


      return productsArray;

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('EET_PRODUCTS', 'Failed to get products price and stock', {
          error: error.message,
          productCount: eetProducts.length
        });
      }

      console.log(`❌ Failed to get products data: ${error.message}`);

      return {
        success: false,
        error: error.message,
        message: 'Failed to get products data'
      };
    }
  }  
}

export default EETClient;