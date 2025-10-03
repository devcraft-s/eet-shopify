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
        query: query.substring(0, 200) + '...',
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

      const query = `
        query getProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
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

  /**
   * Map EET product data to Shopify product structure
   * @param {Object} eetProduct - EET product data
   * @returns {Object} Shopify product structure
   */
  mapEETToShopifyProduct(eetProduct) {
    try {
      logger.info('SHOPIFY_MAP', 'Mapping EET product to Shopify format', {
        varenr: eetProduct.varenr,
        beskrivelse: eetProduct.beskrivelse
      });

      // Combine descriptions for body HTML
      const descriptions = [];
      if (eetProduct.beskrivelse) descriptions.push(eetProduct.beskrivelse);
      if (eetProduct.beskrivelse_2) descriptions.push(eetProduct.beskrivelse_2);
      if (eetProduct.beskrivelse_3) descriptions.push(eetProduct.beskrivelse_3);
      
      const bodyHtml = descriptions.length > 0 
        ? `<ul>${descriptions.map(desc => `<li>${desc}</li>`).join('')}</ul>`
        : '';

      // Convert weight from kg to grams (assuming EET weights are in kg)
      const weightInGrams = eetProduct.bruttovægt ? parseFloat(eetProduct.bruttovægt) * 1000 : null;

      // Parse price (remove commas and convert to cents)
      const priceInCents = eetProduct.pris ? 
        Math.round(parseFloat(eetProduct.pris.replace(',', '.')) * 100) : null;

      // Parse stock quantity
      const stockQuantity = eetProduct.lagerbeholdning ? 
        parseInt(parseFloat(eetProduct.lagerbeholdning)) : 0;

      const shopifyProduct = {
        title: eetProduct.beskrivelse || `Product ${eetProduct.varenr}`,
        bodyHtml: bodyHtml,
        vendor: eetProduct.maerke_navn || '',
        productType: eetProduct.web_category_name || '',
        tags: [
          eetProduct.maerke_navn,
          eetProduct.web_category_name,
          eetProduct.varenr
        ].filter(Boolean).join(','),
        variants: [{
          sku: eetProduct.varenr,
          price: priceInCents ? (priceInCents / 100).toFixed(2) : '0.00',
          weight: weightInGrams,
          weightUnit: 'GRAMS',
          barcode: eetProduct.ean_upc || '',
          inventoryQuantity: stockQuantity,
          inventoryManagement: 'SHOPIFY'
        }],
        metafields: [
          {
            namespace: 'streamsupply',
            key: 'brand',
            value: eetProduct.maerke_navn || '',
            type: 'single_line_text_field'
          },
          {
            namespace: 'streamsupply',
            key: 'mpn',
            value: eetProduct.manufacturer_part_no || '',
            type: 'single_line_text_field'
          },
          {
            namespace: 'streamsupply',
            key: 'incoming_date',
            value: eetProduct.forventet_levering || '',
            type: 'date'
          },
          {
            namespace: 'streamsupply',
            key: 'category_id',
            value: eetProduct.web_category_id || '',
            type: 'single_line_text_field'
          },
          {
            namespace: 'streamsupply',
            key: 'docs',
            value: eetProduct.item_product_link_web || '',
            type: 'url'
          }
        ].filter(metafield => metafield.value), // Only include metafields with values
        images: eetProduct.web_picture_url ? [{
          src: eetProduct.web_picture_url,
          altText: eetProduct.beskrivelse || `Product ${eetProduct.varenr}`
        }] : []
      };

      logger.info('SHOPIFY_MAP', 'EET product mapped successfully', {
        varenr: eetProduct.varenr,
        title: shopifyProduct.title,
        vendor: shopifyProduct.vendor,
        price: shopifyProduct.variants[0].price,
        stock: shopifyProduct.variants[0].inventoryQuantity,
        metafieldsCount: shopifyProduct.metafields.length,
        hasImage: shopifyProduct.images.length > 0
      });

      return shopifyProduct;
    } catch (error) {
      logger.error('SHOPIFY_MAP', 'Failed to map EET product', {
        varenr: eetProduct.varenr,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a new product in Shopify
   * @param {Object} productData - Shopify product data
   * @returns {Promise<Object>} Created product
   */
  async createProduct(productData) {
    try {
      logger.info('SHOPIFY_CREATE', 'Creating new product', {
        title: productData.title,
        sku: productData.variants[0]?.sku
      });

      const mutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              title
              handle
              vendor
              productType
              tags
              bodyHtml
              variants(first: 10) {
                edges {
                  node {
                    id
                    sku
                    price
                    weight
                    weightUnit
                    barcode
                    inventoryQuantity
                  }
                }
              }
              images(first: 10) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
              metafields(first: 20) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await this.runGraphQL(mutation, { input: productData });

      if (response.data.productCreate.userErrors.length > 0) {
        const errors = response.data.productCreate.userErrors;
        logger.error('SHOPIFY_CREATE', 'Product creation failed with user errors', {
          title: productData.title,
          errors
        });
        throw new Error(`Product creation failed: ${errors.map(e => e.message).join(', ')}`);
      }

      const createdProduct = response.data.productCreate.product;
      
      logger.info('SHOPIFY_CREATE', 'Product created successfully', {
        productId: createdProduct.id,
        title: createdProduct.title,
        handle: createdProduct.handle,
        sku: createdProduct.variants.edges[0]?.node?.sku
      });

      return createdProduct;
    } catch (error) {
      logger.error('SHOPIFY_CREATE', 'Failed to create product', {
        title: productData.title,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update an existing product in Shopify
   * @param {string} productId - Shopify product ID
   * @param {Object} productData - Updated product data
   * @returns {Promise<Object>} Updated product
   */
  async updateProduct(productId, productData) {
    try {
      logger.info('SHOPIFY_UPDATE', 'Updating product', {
        productId,
        title: productData.title,
        sku: productData.variants[0]?.sku
      });

      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              handle
              vendor
              productType
              tags
              bodyHtml
              variants(first: 10) {
                edges {
                  node {
                    id
                    sku
                    price
                    weight
                    weightUnit
                    barcode
                    inventoryQuantity
                  }
                }
              }
              images(first: 10) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
              metafields(first: 20) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const inputData = {
        ...productData,
        id: productId
      };

      const response = await this.runGraphQL(mutation, { input: inputData });

      if (response.data.productUpdate.userErrors.length > 0) {
        const errors = response.data.productUpdate.userErrors;
        logger.error('SHOPIFY_UPDATE', 'Product update failed with user errors', {
          productId,
          title: productData.title,
          errors
        });
        throw new Error(`Product update failed: ${errors.map(e => e.message).join(', ')}`);
      }

      const updatedProduct = response.data.productUpdate.product;
      
      logger.info('SHOPIFY_UPDATE', 'Product updated successfully', {
        productId: updatedProduct.id,
        title: updatedProduct.title,
        handle: updatedProduct.handle,
        sku: updatedProduct.variants.edges[0]?.node?.sku
      });

      return updatedProduct;
    } catch (error) {
      logger.error('SHOPIFY_UPDATE', 'Failed to update product', {
        productId,
        title: productData.title,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Find product by SKU in existing products
   * @param {string} sku - Product SKU to search for
   * @param {Array} existingProducts - Array of existing Shopify products
   * @returns {Object|null} Found product or null
   */
  findProductBySKU(sku, existingProducts) {
    try {
      logger.info('SHOPIFY_FIND', 'Searching for product by SKU', { sku });

      // This is a simplified search - in a real implementation, you'd want to query Shopify
      // for products with specific SKUs using GraphQL
      for (const product of existingProducts) {
        if (product.variants && product.variants.edges) {
          for (const variant of product.variants.edges) {
            if (variant.node.sku === sku) {
              logger.info('SHOPIFY_FIND', 'Product found by SKU', {
                sku,
                productId: product.id,
                title: product.title
              });
              return product;
            }
          }
        }
      }

      logger.info('SHOPIFY_FIND', 'Product not found by SKU', { sku });
      return null;
    } catch (error) {
      logger.error('SHOPIFY_FIND', 'Failed to find product by SKU', {
        sku,
        error: error.message
      });
      throw error;
    }
  }
}

export default ShopifyClient;