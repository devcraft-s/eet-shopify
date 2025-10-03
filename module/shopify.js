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
   * Check if a product exists by SKU
   * @param {string} sku - Product SKU
   * @returns {Promise<Object|null>} Product if exists, null if not
   */
  async checkProductExists(sku) {
    try {
      logger.info('SHOPIFY', 'Checking if product exists', { sku });

      const query = `
        query getProductBySku($query: String!) {
          products(first: 1, query: $query) {
            edges {
              node {
                id
                title
                vendor
                variants(first: 1) {
                  edges {
                    node {
                      id
                      sku
                      price
                      inventoryQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        query: `sku:${sku}`
      };

      const response = await this.runGraphQL(query, variables);
      
      if (response.data.products.edges.length > 0) {
        const product = response.data.products.edges[0].node;
        logger.info('SHOPIFY', 'Product found', {
          sku,
          productId: product.id,
          title: product.title
        });
        return product;
      } else {
        logger.info('SHOPIFY', 'Product not found', { sku });
        return null;
      }
    } catch (error) {
      logger.error('SHOPIFY', 'Failed to check product existence', {
        sku,
        error: error.message
      });
      throw error;
    }
  }
}

export default ShopifyClient;