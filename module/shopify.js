import logger from './logger.js';
import fetch from 'node-fetch';

/**
 * Shopify API Client using GraphQL
 * Handles product operations: check existence, create, update
 */
class ShopifyClient {
  constructor(config) {
    this.shopDomain = config.shopDomain;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || '2024-01';
    this.baseUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Make GraphQL request to Shopify
   * @param {string} query - GraphQL query/mutation
   * @param {Object} variables - Query variables
   * @returns {Promise<Object>} GraphQL response
   */
  async makeRequest(query, variables = {}) {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
        },
        body: JSON.stringify({
          query,
          variables
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors && data.errors.length > 0) {
        throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
      }

      return data.data;
    } catch (error) {
      logger.error('SHOPIFY', 'GraphQL request failed', {
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
    const query = `
      query getProductBySku($query: String!) {
        products(first: 1, query: $query) {
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              status
              tags
              variants(first: 10) {
                edges {
                  node {
                    id
                    sku
                    price
                    inventoryQuantity
                    barcode
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      logger.info('SHOPIFY', 'Checking if product exists', { sku });
      
      const data = await this.makeRequest(query, { 
        query: `sku:${sku}` 
      });

      const products = data.products.edges;
      
      if (products.length > 0) {
        const product = products[0].node;
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

  /**
   * Create a new product
   * @param {Object} productData - Product data
   * @returns {Promise<Object>} Created product
   */
  async createProduct(productData) {
    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
            vendor
            productType
            status
            tags
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryQuantity
                  barcode
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

    try {
      logger.info('SHOPIFY', 'Creating new product', {
        title: productData.product.title,
        sku: productData.product.variants[0]?.sku
      });

      const data = await this.makeRequest(mutation, { 
        input: productData.product 
      });

      if (data.productCreate.userErrors.length > 0) {
        const errors = data.productCreate.userErrors.map(e => e.message).join(', ');
        logger.error('SHOPIFY', 'Product creation failed', {
          errors,
          productData: productData.product
        });
        throw new Error(`Product creation failed: ${errors}`);
      }

      const createdProduct = data.productCreate.product;
      logger.info('SHOPIFY', 'Product created successfully', {
        productId: createdProduct.id,
        title: createdProduct.title,
        sku: createdProduct.variants.edges[0]?.node.sku
      });

      return createdProduct;
    } catch (error) {
      logger.error('SHOPIFY', 'Failed to create product', {
        error: error.message,
        productData: productData.product
      });
      throw error;
    }
  }

  /**
   * Update an existing product
   * @param {string} productId - Shopify product ID
   * @param {Object} productData - Updated product data
   * @returns {Promise<Object>} Updated product
   */
  async updateProduct(productId, productData) {
    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            handle
            vendor
            productType
            status
            tags
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryQuantity
                  barcode
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

    try {
      logger.info('SHOPIFY', 'Updating product', {
        productId,
        title: productData.product.title
      });

      const input = {
        ...productData.product,
        id: productId
      };

      const data = await this.makeRequest(mutation, { input });

      if (data.productUpdate.userErrors.length > 0) {
        const errors = data.productUpdate.userErrors.map(e => e.message).join(', ');
        logger.error('SHOPIFY', 'Product update failed', {
          productId,
          errors
        });
        throw new Error(`Product update failed: ${errors}`);
      }

      const updatedProduct = data.productUpdate.product;
      logger.info('SHOPIFY', 'Product updated successfully', {
        productId: updatedProduct.id,
        title: updatedProduct.title
      });

      return updatedProduct;
    } catch (error) {
      logger.error('SHOPIFY', 'Failed to update product', {
        productId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Convert EET product to Shopify product format
   * @param {Object} eetProduct - EET product data
   * @returns {Object} Shopify product format
   */
  convertToShopifyProduct(eetProduct) {
    const shopifyProduct = {
      product: {
        title: this.generateProductTitle(eetProduct),
        body_html: this.generateProductDescription(eetProduct),
        vendor: eetProduct.maerke_navn || 'EET Group',
        product_type: 'Electronics',
        status: 'active',
        tags: this.generateTags(eetProduct),
        variants: [this.createVariant(eetProduct)],
        images: this.createImages(eetProduct),
        options: this.createOptions(eetProduct),
        metafields: this.createMetafields(eetProduct)
      }
    };

    return shopifyProduct;
  }

  /**
   * Generate product title
   * @param {Object} eetProduct - EET product data
   * @returns {String} Product title
   */
  generateProductTitle(eetProduct) {
    const parts = [];
    
    if (eetProduct.maerke_navn) {
      parts.push(eetProduct.maerke_navn);
    }
    
    parts.push(eetProduct.beskrivelse);
    
    if (eetProduct.manufacturer_part_no) {
      parts.push(`(${eetProduct.manufacturer_part_no})`);
    }

    return parts.join(' ').substring(0, 255); // Shopify title limit
  }

  /**
   * Generate product description
   * @param {Object} eetProduct - EET product data
   * @returns {String} HTML description
   */
  generateProductDescription(eetProduct) {
    let description = `<p><strong>${eetProduct.beskrivelse}</strong></p>`;
    
    if (eetProduct.beskrivelse_2) {
      description += `<p>${eetProduct.beskrivelse_2}</p>`;
    }
    
    if (eetProduct.beskrivelse_3) {
      description += `<p>${eetProduct.beskrivelse_3}</p>`;
    }

    // Add specifications
    const specs = [];
    if (eetProduct.ean_upc) {
      specs.push(`<strong>EAN/UPC:</strong> ${eetProduct.ean_upc}`);
    }
    if (eetProduct.manufacturer_part_no) {
      specs.push(`<strong>Part Number:</strong> ${eetProduct.manufacturer_part_no}`);
    }
    if (eetProduct.bruttovaegt > 0) {
      specs.push(`<strong>Gross Weight:</strong> ${eetProduct.bruttovaegt} kg`);
    }
    if (eetProduct.nettovaegt > 0) {
      specs.push(`<strong>Net Weight:</strong> ${eetProduct.nettovaegt} kg`);
    }
    if (eetProduct.forventet_levering) {
      specs.push(`<strong>Expected Delivery:</strong> ${eetProduct.forventet_levering}`);
    }

    if (specs.length > 0) {
      description += '<h3>Specifications</h3><ul>';
      specs.forEach(spec => {
        description += `<li>${spec}</li>`;
      });
      description += '</ul>';
    }

    // Add external link if available
    if (eetProduct.item_product_link) {
      description += `<p><a href="${eetProduct.item_product_link}" target="_blank">View on EET Group Website</a></p>`;
    }

    return description;
  }

  /**
   * Generate product tags
   * @param {Object} eetProduct - EET product data
   * @returns {Array} Array of tags
   */
  generateTags(eetProduct) {
    const tags = [];
    
    if (eetProduct.maerke_navn) {
      tags.push(eetProduct.maerke_navn.toLowerCase().replace(/\s+/g, '-'));
    }
    
    if (eetProduct.web_category_name) {
      tags.push(eetProduct.web_category_name.toLowerCase().replace(/\s+/g, '-'));
    }
    
    tags.push('eet-group');
    tags.push('electronics');
    
    if (eetProduct.lagerbeholdning > 0) {
      tags.push('in-stock');
    } else {
      tags.push('out-of-stock');
    }

    return tags;
  }

  /**
   * Create product variant
   * @param {Object} eetProduct - EET product data
   * @returns {Object} Shopify variant object
   */
  createVariant(eetProduct) {
    return {
      title: 'Default Title',
      price: eetProduct.pris.toString(),
      sku: eetProduct.varenr,
      inventory_quantity: Math.max(0, Math.floor(eetProduct.lagerbeholdning)),
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      weight: eetProduct.nettovaegt,
      weight_unit: 'kg',
      barcode: eetProduct.ean_upc || undefined,
      requires_shipping: true,
      taxable: true,
      fulfillment_service: 'manual'
    };
  }

  /**
   * Create product images
   * @param {Object} eetProduct - EET product data
   * @returns {Array} Array of image objects
   */
  createImages(eetProduct) {
    const images = [];
    
    if (eetProduct.web_picture_url) {
      images.push({
        src: eetProduct.web_picture_url,
        alt: eetProduct.beskrivelse
      });
    }

    return images;
  }

  /**
   * Create product options
   * @param {Object} eetProduct - EET product data
   * @returns {Array} Array of option objects
   */
  createOptions(eetProduct) {
    return [
      {
        name: 'Title',
        values: ['Default Title']
      }
    ];
  }

  /**
   * Create metafields for additional product data
   * @param {Object} eetProduct - EET product data
   * @returns {Array} Array of metafield objects
   */
  createMetafields(eetProduct) {
    const metafields = [];

    // EET specific data
    metafields.push({
      namespace: 'eet',
      key: 'varenr',
      value: eetProduct.varenr,
      type: 'single_line_text_field'
    });

    if (eetProduct.manufacturer_part_no) {
      metafields.push({
        namespace: 'eet',
        key: 'manufacturer_part_no',
        value: eetProduct.manufacturer_part_no,
        type: 'single_line_text_field'
      });
    }

    if (eetProduct.web_category_id) {
      metafields.push({
        namespace: 'eet',
        key: 'category_id',
        value: eetProduct.web_category_id,
        type: 'single_line_text_field'
      });
    }

    if (eetProduct.item_product_link) {
      metafields.push({
        namespace: 'eet',
        key: 'product_link',
        value: eetProduct.item_product_link,
        type: 'url'
      });
    }

    return metafields;
  }

  /**
   * Upload product to Shopify (check existence and create if needed)
   * @param {Object} eetProduct - EET product data
   * @returns {Promise<Object>} Shopify product (existing or created)
   */
  async uploadProduct(eetProduct) {
    try {
      logger.info('SHOPIFY', 'Starting product upload process', {
        sku: eetProduct.varenr,
        title: eetProduct.beskrivelse
      });

      // Check if product exists
      const existingProduct = await this.checkProductExists(eetProduct.varenr);
      
      if (existingProduct) {
        logger.info('SHOPIFY', 'Product already exists, skipping creation', {
          sku: eetProduct.varenr,
          productId: existingProduct.id
        });
        return existingProduct;
      }

      // Convert to Shopify format and create
      const shopifyProductData = this.convertToShopifyProduct(eetProduct);
      const createdProduct = await this.createProduct(shopifyProductData);

      logger.info('SHOPIFY', 'Product upload completed successfully', {
        sku: eetProduct.varenr,
        productId: createdProduct.id,
        action: 'created'
      });

      return createdProduct;
    } catch (error) {
      logger.error('SHOPIFY', 'Product upload failed', {
        sku: eetProduct.varenr,
        error: error.message
      });
      throw error;
    }
  }
}

export default ShopifyClient;
