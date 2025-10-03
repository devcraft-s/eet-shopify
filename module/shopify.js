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
  async getAllProducts(limit = 50, cursor = null) {
    try {
      logger.info('SHOPIFY', 'Getting all products', { limit, hasCursor: !!cursor });

      const query = `
        query getAllProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                vendor
                productType
                status
                createdAt
                updatedAt
                variants(first: 10) {
                  edges {
                    node {
                      id
                      sku
                      title
                      price
                      inventoryQuantity
                      inventoryPolicy
                    }
                  }
                }
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
}

export default ShopifyClient;