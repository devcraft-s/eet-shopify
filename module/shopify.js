import logger from './logger.js';
import fetch from 'node-fetch';

/**
 * Shopify GraphQL Client
 * Simple implementation for basic operations
 */
class ShopifyClient {
  constructor(config) {
    this.shopDomain = config.shopDomain;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || '2024-01';
    this.apiUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Run any GraphQL query/mutation
   * @param {string} query - GraphQL query or mutation
   * @param {Object} variables - Variables for the query
   * @returns {Promise<Object>} GraphQL response
   */
  async runGraphQL(query, variables = {}) {
    try {
      logger.info('SHOPIFY_GRAPHQL', 'Executing GraphQL query', {
        query: query.substring(0, 100) + '...',
        variables
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken
        },
        body: JSON.stringify({
          query,
          variables
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.errors) {
        logger.error('SHOPIFY_GRAPHQL', 'GraphQL errors', {
          errors: data.errors,
          query: query.substring(0, 100) + '...'
        });
        throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
      }

      logger.info('SHOPIFY_GRAPHQL', 'GraphQL query executed successfully', {
        hasData: !!data.data
      });

      return data;
    } catch (error) {
      logger.error('SHOPIFY_GRAPHQL', 'GraphQL execution failed', {
        error: error.message,
        query: query.substring(0, 100) + '...',
        variables
      });
      throw error;
    }
  }

  /**
   * Get all products from Shopify
   * @param {number} limit - Number of products to fetch (default: 50, max: 250)
   * @param {string} cursor - Pagination cursor for next page
   * @returns {Promise<Object>} Products data with pagination info
   */
  async getProducts(limit = 50, cursor = null) {
    try {
      logger.info('SHOPIFY', 'Getting all products', { limit, hasCursor: !!cursor });

      let variablesForQuery = `first: ${250}, after: ${cursor}`;

      const query = `
        query getProducts($first: Int!, $after: String) {
          products(${variablesForQuery}) {
            edges {
              node {
                id
              }
              cursor
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
          }
        }
      `;

      const variables = {
        first: Math.min(limit, 250), // Shopify max limit is 250
        after: cursor
      };

      const response = await this.runGraphQL(query, variables);
      
      const products = response.data.products.edges.map(edge => edge.node);
      const pageInfo = response.data.products.pageInfo;

      logger.info('SHOPIFY', 'Products retrieved successfully', {
        count: products.length,
        hasNextPage: pageInfo.hasNextPage,
        hasPreviousPage: pageInfo.hasPreviousPage
      });

      return {
        products,
        pageInfo,
        totalCount: products.length
      };
    } catch (error) {
      logger.error('SHOPIFY', 'Failed to get all products', {
        limit,
        cursor,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get ALL products from Shopify by repeatedly executing queries
   * This will fetch all products regardless of total count
   * @param {number} batchSize - Number of products per batch (default: 250, max: 250)
   * @returns {Promise<Array>} Array of all products
   */
  async getAllProducts(batchSize = 250) {
    try {
      logger.info('SHOPIFY', 'Starting complete product fetch', { batchSize });

      let allProducts = [];
      let cursor = null;
      let hasNextPage = true;
      let batchCount = 0;

      while (hasNextPage) {
        batchCount++;
        logger.info('SHOPIFY', `Fetching batch ${batchCount}`, { 
          batchNumber: batchCount,
          currentTotal: allProducts.length,
          hasCursor: !!cursor 
        });

        const result = await this.getProducts(batchSize, cursor);
        
        allProducts = allProducts.concat(result.products);
        hasNextPage = result.pageInfo.hasNextPage;
        cursor = result.pageInfo.endCursor;

        logger.info('SHOPIFY', `Batch ${batchCount} completed`, {
          batchProducts: result.products.length,
          totalProducts: allProducts.length,
          hasNextPage
        });

        // Add small delay to avoid rate limiting
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info('SHOPIFY', 'Complete product fetch finished', {
        totalBatches: batchCount,
        totalProducts: allProducts.length
      });

      return allProducts;
    } catch (error) {
      logger.error('SHOPIFY', 'Failed to get all products completely', {
        batchSize,
        error: error.message
      });
      throw error;
    }
  }
}

export default ShopifyClient;