import logger from './logger.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if logging is disabled
const isLoggingEnabled = process.env.LOGGING !== 'false';

/**
 * Shopify GraphQL Client
 * Simple implementation for basic operations
 */
class ShopifyClient {
  constructor(config) {
    this.shopDomain = config.shopDomain;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || '2025-10';
    this.apiUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
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
      if (eetProduct.beskrivelse_2) descriptions.push(eetProduct.beskrivelse_2);
      if (eetProduct.beskrivelse_3) descriptions.push(eetProduct.beskrivelse_3);
      
      const bodyHtml = descriptions.length > 0 
        ? `<ul>${descriptions.map(desc => `<li>${desc}</li>`).join('')}</ul>`
        : '';

      // Convert weight from kg to kg (keep original unit)
      let weightInKg = null;
      let weightUnit = 'KILOGRAMS';
      if (eetProduct.bruttovaegt && eetProduct.bruttovaegt > 0) {
        const weightStr = String(eetProduct.bruttovaegt);
        const cleanWeight = weightStr.replace(',', '.');
        const weight = parseFloat(cleanWeight);
        if (weight > 0) {
          weightInKg = weight;
          weightUnit = 'KILOGRAMS';
        }
      }

      // Parse price (remove commas and convert to cents)
      let priceInCents = null;
      if (eetProduct.pris) {
        const priceStr = String(eetProduct.pris);
        const cleanPrice = priceStr.replace(',', '.');
        priceInCents = Math.round(parseFloat(cleanPrice) * 100);
      }

      // Parse stock quantity
      let stockQuantity = 0;
      if (eetProduct.lagerbeholdning) {
        const stockStr = String(eetProduct.lagerbeholdning);
        const cleanStock = stockStr.replace(',', '.');
        stockQuantity = parseInt(parseFloat(cleanStock));
      }

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
          weight: weightInKg,
          weightUnit: weightUnit,
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
   * Find product by SKU in existing products
   * @param {string} sku - Product SKU to search for
   * @param {Array} existingProducts - Array of existing Shopify products
   * @returns {Object|null} Found product or null
   */
  findProductBySKU(sku, existingProducts) {
    try {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_FIND', 'Searching for product by SKU', { sku });
      }

      // Search through products with the updated structure
      for (const product of existingProducts) {
        if (product.variants && product.variants.nodes) {
          for (const variant of product.variants.nodes) {
            // Check both variant.sku and variant.inventoryItem.sku for compatibility
            if ((variant.inventoryItem && variant.inventoryItem.sku === sku)) {
              if (isLoggingEnabled) {
                logger.info('SHOPIFY_FIND', 'Product found by SKU', {
                  sku,
                  productId: product.id,
                  title: product.title,
                  variantPrice: variant.price,
                  variantBarcode: variant.barcode
                });
              }
              return product;
            }
          }
        }
      }

      if (isLoggingEnabled) {
        logger.info('SHOPIFY_FIND', 'Product not found by SKU', { sku });
      }
      return null;
    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_FIND', 'Failed to find product by SKU', {
          sku,
          error: error.message
        });
      }
      throw error;
    }
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
                title
                status
                variants(first: 10) {
                  nodes {
                    id
                    barcode
                    price
                    inventoryQuantity
                    inventoryItem {
                      id
                      sku
                      inventoryLevels(first: 10) {
                        nodes {
                          location {
                            id
                          }
                        }
                      }
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
   * Create a new product in Shopify
   * @param {Object} productData - Shopify product data
   * @returns {Promise<Object>} Created product
   */
  async createProduct(productData) {
    try {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_CREATE', 'Creating new product', {
          title: productData.title,
          sku: productData.variants[0]?.sku
        });
      }

      // Extract data from productData
      const title = productData.title || '';
      const vendor = productData.vendor || '';
      const descriptionHtml = productData.bodyHtml || '';
      const imageUrl = productData.images && productData.images.length > 0 ? productData.images[0].src : null;
      
      // Build metafields array
      const metafields = productData.metafields ? productData.metafields.map(mf => 
        `{
          key: "${mf.key}",
          namespace: "${mf.namespace}",
          value: "${mf.value}"
        }`
      ).join(',') : '';

      // create product mutation
      const mutation = `
        mutation {
          productCreate(
            ${imageUrl ? `media: { originalSource: "${imageUrl}", mediaContentType: IMAGE }` : ''}
            product: {
              title: "${title}",
              status: ACTIVE,
              vendor: "${vendor}",
              descriptionHtml: "${descriptionHtml}",
              ${metafields ? `metafields: [${metafields}]` : ''}
            }
          ) {
            userErrors {
              field
              message
            }
            product {
              id
              title
              variants(first: 50) {
                nodes {
                  id
                  price
                  inventoryQuantity
                  barcode
                  inventoryItem {
                    id
                    inventoryLevels(first: 10) {
                      nodes {
                        location {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await this.runGraphQL(mutation);
      console.log("response", response.data.productCreate.userErrors);

      if (response.data.productCreate.userErrors.length > 0) {
        const errors = response.data.productCreate.userErrors;
        if (isLoggingEnabled) {
          logger.error('SHOPIFY_CREATE', 'Product creation failed with user errors', {
            title: productData.title,
            errors
          });
        }
        throw new Error(`Product creation failed: ${errors.map(e => e.message).join(', ')}`);
      }

      const createdProduct = response.data.productCreate.product;

      // Update variant with SKU, barcode, and price, product weight, product weight unit
      if (createdProduct.variants.nodes.length > 0) {
        const variant = createdProduct.variants.nodes[0];
        const adjustedPrice = productData.variants[0].price;
        const barcode = productData.variants[0].barcode || '';
        const sku = productData.variants[0].sku || '';

        const updateMutation = `
          mutation {
            productVariantsBulkUpdate(
              productId: "${createdProduct.id}"
              variants: {
                price: "${adjustedPrice}",
                id: "${variant.id}",
                barcode: "${barcode}",
                inventoryItem: {
                  sku: "${sku}", 
                  tracked: true,
                  measurement: {
                    weight: {
                      value: ${productData.variants[0].weight},
                      unit: ${productData.variants[0].weightUnit}
                    }
                  }
                }
              }
            ) {
              userErrors {
                code
                field
                message
              }
              productVariants {
                price
                barcode
                id
              }
            }
          }
        `;

        try {
          const updateResponse = await this.runGraphQL(updateMutation);
          console.log("Variant update response:", updateResponse.data.productVariantsBulkUpdate.userErrors);

          if (updateResponse.data.productVariantsBulkUpdate.userErrors.length > 0) {
            const updateErrors = updateResponse.data.productVariantsBulkUpdate.userErrors;
            if (isLoggingEnabled) {
              logger.error('SHOPIFY_UPDATE', 'Variant update failed with user errors', {
                productId: createdProduct.id,
                sku: sku,
                errors: updateErrors
              });
            }
            console.log("Variant update errors:", updateErrors);
          } else {
            if (isLoggingEnabled) {
              logger.info('SHOPIFY_UPDATE', 'Variant updated successfully', {
                productId: createdProduct.id,
                sku: sku,
                price: adjustedPrice,
                barcode: barcode
              });
            }
          }
        } catch (updateError) {
          if (isLoggingEnabled) {
            logger.error('SHOPIFY_UPDATE', 'Failed to update variant', {
              productId: createdProduct.id,
              sku: sku,
              error: updateError.message
            });
          }
          console.log("Variant update error:", updateError.message);
        }
      }

      // Update inventory quantity
      if (createdProduct.variants.nodes.length > 0) {
        const variant = createdProduct.variants.nodes[0];
        const inventoryQuantity = productData.variants[0].inventoryQuantity || 0;

        if (variant.inventoryItem && variant.inventoryItem.inventoryLevels.nodes.length > 0) {
          const inventoryItemId = variant.inventoryItem.id;
          const locationId = variant.inventoryItem.inventoryLevels.nodes[0].location.id;

          const inventoryMutation = `
            mutation {
              inventoryAdjustQuantities(
                input: {
                  name: "available",
                  changes: {
                    delta: ${inventoryQuantity},
                    inventoryItemId: "${inventoryItemId}",
                    locationId: "${locationId}"
                  },
                  reason: "restock"
                }
              ) {
                userErrors {
                  code
                  field
                  message
                }
                inventoryAdjustmentGroup {
                  id
                }
              }
            }
          `;

          try {
            const inventoryResponse = await this.runGraphQL(inventoryMutation);
            console.log("Inventory update response:", inventoryResponse.data.inventoryAdjustQuantities.userErrors);

            if (inventoryResponse.data.inventoryAdjustQuantities.userErrors.length > 0) {
              const inventoryErrors = inventoryResponse.data.inventoryAdjustQuantities.userErrors;
              if (isLoggingEnabled) {
                logger.error('SHOPIFY_INVENTORY', 'Inventory update failed with user errors', {
                  productId: createdProduct.id,
                  sku: productData.variants[0].sku,
                  quantity: inventoryQuantity,
                  errors: inventoryErrors
                });
              }
              console.log("Inventory update errors:", inventoryErrors);
            } else {
              if (isLoggingEnabled) {
                logger.info('SHOPIFY_INVENTORY', 'Inventory updated successfully', {
                  productId: createdProduct.id,
                  sku: productData.variants[0].sku,
                  quantity: inventoryQuantity,
                  adjustmentGroupId: inventoryResponse.data.inventoryAdjustQuantities.inventoryAdjustmentGroup.id
                });
              }
            }
          } catch (inventoryError) {
            if (isLoggingEnabled) {
              logger.error('SHOPIFY_INVENTORY', 'Failed to update inventory', {
                productId: createdProduct.id,
                sku: productData.variants[0].sku,
                quantity: inventoryQuantity,
                error: inventoryError.message
              });
            }
            console.log("Inventory update error:", inventoryError.message);
          }
        } else {
          if (isLoggingEnabled) {
            logger.warn('SHOPIFY_INVENTORY', 'No inventory item or location found for variant', {
              productId: createdProduct.id,
              sku: productData.variants[0].sku,
              hasInventoryItem: !!variant.inventoryItem,
              hasInventoryLevels: variant.inventoryItem ? variant.inventoryItem.inventoryLevels.nodes.length > 0 : false
            });
          }
        }
      }
      
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_CREATE', 'Product created successfully', {
          productId: createdProduct.id,
          title: createdProduct.title,
          variantsCount: createdProduct.variants.nodes.length
        });
      }

      return createdProduct;
    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_CREATE', 'Failed to create product', {
          title: productData.title,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Make a single product draft
   * @param {Object} product - Shopify product to make draft
   * @returns {Promise<Object>} Draft result with success/error info
   */
  async makeProductDraft(product) {
    try {
      const firstSku = product.variants.nodes[0]?.sku || 'unknown';
      
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_DRAFT', 'Making product draft', {
          sku: firstSku,
          title: product.title,
          productId: product.id
        });
      }

      const draftMutation = `
        mutation {
          productUpdate(input: {
            id: "${product.id}",
            status: DRAFT
          }) {
            userErrors {
              field
              message
            }
            product {
              id
              title
              status
            }
          }
        }
      `;

      const draftResponse = await this.runGraphQL(draftMutation);

      if (draftResponse.data.productUpdate.userErrors.length > 0) {
        const errors = draftResponse.data.productUpdate.userErrors;
        
        if (isLoggingEnabled) {
          logger.error('SHOPIFY_DRAFT', 'Product draft failed with user errors', {
            sku: firstSku,
            title: product.title,
            errors
          });
        }

        return {
          success: false,
          sku: firstSku,
          title: product.title,
          error: errors.map(e => e.message).join(', ')
        };
      } else {
        if (isLoggingEnabled) {
          logger.info('SHOPIFY_DRAFT', 'Product made draft successfully', {
            sku: firstSku,
            title: product.title,
            productId: product.id
          });
        }

        return {
          success: true,
          sku: firstSku,
          title: product.title,
          productId: product.id
        };
      }

    } catch (error) {
      const firstSku = product.variants.nodes[0]?.sku || 'unknown';
      
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_DRAFT', 'Failed to make product draft', {
          sku: firstSku,
          title: product.title,
          error: error.message
        });
      }

      return {
        success: false,
        sku: firstSku,
        title: product.title,
        error: error.message
      };
    }
  }

  /**
   * Make Shopify products that are not in EET list into drafts
   * @param {Array} shopifyProducts - Array of all Shopify products
   * @param {Array} eetProducts - Array of EET products
   * @returns {Promise<Object>} Draft process results
   */
  async makeOrphanedProductsDraft(shopifyProducts, eetProducts) {
    try {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_DRAFT', 'Starting to identify orphaned products');
      }

      // Create EET SKU set for fast lookup
      const eetSkus = new Set(eetProducts.map(p => p.varenr));
      
      // Find Shopify products not in EET list (excluding already draft products)
      let alreadyDraftCount = 0;
      const shopifyProductsNotInEET = shopifyProducts.filter(shopifyProduct => {
        // Skip if product is already in draft status
        if (shopifyProduct.status === 'DRAFT') {
          alreadyDraftCount++;
          return false;
        }
        
        if (shopifyProduct.variants && shopifyProduct.variants.nodes) {
          return shopifyProduct.variants.nodes.some(variant => 
            variant.sku && !eetSkus.has(variant.sku)
          );
        }
        return false;
      });

      if (isLoggingEnabled) {
        if (alreadyDraftCount > 0) {
          logger.info('SHOPIFY_DRAFT', 'Skipped already draft products', {
            count: alreadyDraftCount
          });
        }
      }

      if (shopifyProductsNotInEET.length === 0) {
        return {
          totalProducts: 0,
          successCount: 0,
          errorCount: 0,
          errors: []
        };
      }
      
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_DRAFT', 'Starting to make products draft', {
          count: shopifyProductsNotInEET.length
        });
      }

      let draftSuccessCount = 0;
      let draftErrorCount = 0;
      const draftErrors = [];

      for (const product of shopifyProductsNotInEET) {
        const result = await this.makeProductDraft(product);

        if (result.success) {
          draftSuccessCount++;
        } else {
          draftErrorCount++;
          draftErrors.push({
            sku: result.sku,
            title: result.title,
            error: result.error
          });
          console.log(`❌ Failed to make draft: ${result.title} - ${result.error}`);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (isLoggingEnabled) {
        logger.info('SHOPIFY_DRAFT', 'Draft process completed', {
          totalProducts: shopifyProductsNotInEET.length,
          successCount: draftSuccessCount,
          errorCount: draftErrorCount,
          errors: draftErrors.length > 0 ? draftErrors : undefined
        });
      }


      return {
        totalProducts: shopifyProductsNotInEET.length,
        successCount: draftSuccessCount,
        errorCount: draftErrorCount,
        errors: draftErrors
      };

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_DRAFT', 'Draft process failed', {
          error: error.message,
          stack: error.stack
        });
      }
      throw error;
    }
  }

  /**
   * Update product inventory quantity only
   * @param {string} sku - Product SKU to update
   * @param {number} newQuantity - New inventory quantity
   * @param {Array} shopifyProducts - Array of all Shopify products
   * @returns {Promise<Object>} Update result
   */
  async updateProductQuantity(sku, newQuantity, shopifyProducts) {
    try {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_UPDATE_INVENTORY', 'Starting inventory update', {
          sku,
          newQuantity
        });
      }

      // Find the product by SKU
      const product = this.findProductBySKU(sku, shopifyProducts);
      
      if (!product) {
        const error = `Product with SKU ${sku} not found`;
        if (isLoggingEnabled) {
          logger.warn('SHOPIFY_UPDATE_INVENTORY', 'Product not found', { sku });
        }
        return { success: false, error };
      }

      const variant = product.variants.nodes[0];
      if (!variant) {
        const error = `No variants found for product ${sku}`;
        if (isLoggingEnabled) {
          logger.error('SHOPIFY_UPDATE_INVENTORY', 'No variants found', { sku, productId: product.id });
        }
        return { success: false, error };
      }

      // Update inventory if provided
      if (newQuantity !== null && newQuantity !== undefined && variant.inventoryItem) {
        try {
          if (variant.inventoryItem.inventoryLevels.nodes.length > 0) {
            // inventoryQuantity = old quantity - new quantity
            const oldQuantity = variant.inventoryQuantity;
            const inventoryQuantity = newQuantity - oldQuantity;

            console.log("inventoryQuantity", inventoryQuantity, "-------------------------", oldQuantity);

            const inventoryMutation = `
              mutation {
                inventoryAdjustQuantities(
                  input: {
                    name: "available",
                    changes: {
                      delta: ${inventoryQuantity},
                      inventoryItemId: "${variant.inventoryItem.id}",
                      locationId: "${variant.inventoryItem.inventoryLevels.nodes[0].location.id}"
                    },
                    reason: "restock"
                  }
                ) {
                  userErrors {
                    code
                    field
                    message
                  }
                  inventoryAdjustmentGroup {
                    id
                  }
                }
              }
            `;

            const inventoryResponse = await this.runGraphQL(inventoryMutation);

            if (inventoryResponse.data.inventoryAdjustQuantities.userErrors.length > 0) {
              const errors = inventoryResponse.data.inventoryAdjustQuantities.userErrors;
              const errorMessage = `Inventory update failed: ${errors.map(e => e.message).join(', ')}`;
              
              if (isLoggingEnabled) {
                logger.error('SHOPIFY_UPDATE_INVENTORY', 'Inventory update failed', {
                  sku,
                  productId: product.id,
                  quantity: newQuantity,
                  errors
                });
              }
              
              return { success: false, sku, error: errorMessage };
            } else {
              if (isLoggingEnabled) {
                logger.info('SHOPIFY_UPDATE_INVENTORY', 'Inventory updated successfully', {
                  sku,
                  productId: product.id,
                  quantity: newQuantity,
                  adjustmentGroupId: inventoryResponse.data.inventoryAdjustQuantities.inventoryAdjustmentGroup.id
                });
              }
              
              return {
                success: true,
                sku,
                productId: product.id,
                quantity: newQuantity,
                adjustmentGroupId: inventoryResponse.data.inventoryAdjustQuantities.inventoryAdjustmentGroup.id
              };
            }
          } else {
            const error = 'No inventory location found for product';
            
            if (isLoggingEnabled) {
              logger.warn('SHOPIFY_UPDATE_INVENTORY', 'No inventory location found', {
                sku,
                productId: product.id
              });
            }
            
            return { success: false, sku, error };
          }
        } catch (error) {
          const errorMessage = `Inventory update error: ${error.message}`;
          
          if (isLoggingEnabled) {
            logger.error('SHOPIFY_UPDATE_INVENTORY', 'Inventory update exception', {
              sku,
              productId: product.id,
              error: error.message
            });
          }
          
          return { success: false, sku, error: errorMessage };
        }
      } else {
        const error = 'No inventory item found or quantity not provided';
        
        if (isLoggingEnabled) {
          logger.warn('SHOPIFY_UPDATE_INVENTORY', 'No inventory item or quantity', {
            sku,
            productId: product.id,
            hasInventoryItem: !!variant.inventoryItem,
            quantity: newQuantity
          });
        }
        
        return { success: false, sku, error };
      }

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_UPDATE_INVENTORY', 'Update failed', {
          sku,
          error: error.message,
          stack: error.stack
        });
      }
      return {
        success: false,
        sku,
        error: error.message
      };
    }
  }

  /**
   * Update product price only
   * @param {string} sku - Product SKU to update
   * @param {number} newPrice - New price in cents (will be converted to decimal)
   * @param {Array} shopifyProducts - Array of all Shopify products
   * @returns {Promise<Object>} Update result
   */
  async updateProductPrice(sku, newPrice, shopifyProducts) {
    try {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_UPDATE_PRICE', 'Starting price update', {
          sku,
          newPrice
        });
      }

      // Find the product by SKU
      const product = this.findProductBySKU(sku, shopifyProducts);
      
      if (!product) {
        const error = `Product with SKU ${sku} not found`;
        if (isLoggingEnabled) {
          logger.warn('SHOPIFY_UPDATE_PRICE', 'Product not found', { sku });
        }
        return { success: false, error };
      }

      const variant = product.variants.nodes[0];
      if (!variant) {
        const error = `No variants found for product ${sku}`;
        if (isLoggingEnabled) {
          logger.error('SHOPIFY_UPDATE_PRICE', 'No variants found', { sku, productId: product.id });
        }
        return { success: false, error };
      }

      // Update price if provided
      if (newPrice !== null && newPrice !== undefined) {
        try {
          const priceInDecimal = (newPrice / 100).toFixed(2);
          
          const priceUpdateMutation = `
            mutation {
              productVariantsBulkUpdate(
                productId: "${product.id}"
                variants: {
                  id: "${variant.id}",
                  price: "${priceInDecimal}"
                }
              ) {
                userErrors {
                  code
                  field
                  message
                }
                productVariants {
                  id
                  price
                }
              }
            }
          `;

          const priceResponse = await this.runGraphQL(priceUpdateMutation);
          
          if (priceResponse.data.productVariantsBulkUpdate.userErrors.length > 0) {
            const errors = priceResponse.data.productVariantsBulkUpdate.userErrors;
            const errorMessage = `Price update failed: ${errors.map(e => e.message).join(', ')}`;
            
            if (isLoggingEnabled) {
              logger.error('SHOPIFY_UPDATE_PRICE', 'Price update failed', {
                sku,
                productId: product.id,
                errors
              });
            }
            
            return { success: false, sku, error: errorMessage };
          } else {
            if (isLoggingEnabled) {
              logger.info('SHOPIFY_UPDATE_PRICE', 'Price updated successfully', {
                sku,
                productId: product.id,
                oldPrice: variant.price,
                newPrice: priceInDecimal
              });
            }
            
            return {
              success: true,
              sku,
              productId: product.id,
              oldPrice: variant.price,
              newPrice: priceInDecimal
            };
          }
        } catch (error) {
          const errorMessage = `Price update error: ${error.message}`;
          
          if (isLoggingEnabled) {
            logger.error('SHOPIFY_UPDATE_PRICE', 'Price update exception', {
              sku,
              productId: product.id,
              error: error.message
            });
          }
          
          return { success: false, sku, error: errorMessage };
        }
      } else {
        const error = 'Price not provided';
        
        if (isLoggingEnabled) {
          logger.warn('SHOPIFY_UPDATE_PRICE', 'No price provided', {
            sku,
            productId: product.id,
            price: newPrice
          });
        }
        
        return { success: false, sku, error };
      }

    } catch (error) {
      if (isLoggingEnabled) {
        logger.error('SHOPIFY_UPDATE_PRICE', 'Update failed', {
          sku,
          error: error.message,
          stack: error.stack
        });
      }
      return {
        success: false,
        sku,
        error: error.message
      };
    }
  }
}

export default ShopifyClient;