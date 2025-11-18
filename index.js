import EETProductFilter from './module/csvParseAndFilter.js';
import logger from './module/logger.js';
import ShopifyClient from './module/shopify.js';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if logging is disabled
const isLoggingEnabled = process.env.LOGGING !== 'false';

/**
 * Load Shopify configuration from environment variables
 * @returns {Object} Shopify configuration
 */
function loadShopifyConfig() {
  try {
    const production = process.env.PRODUCTION || 'development';
    
    let shopDomain, accessToken;
    
    if (production === 'development') {
      shopDomain = process.env.SHOPIFY_TEST_STORE_ADMIN_URL;
      accessToken = process.env.SHOPIFY_TEST_STORE_ADMIN_API;
    } else {
      // For production, you can add production environment variables here
      shopDomain = process.env.SHOPIFY_PRODUCTION_STORE_ADMIN_URL;
      accessToken = process.env.SHOPIFY_PRODUCTION_STORE_ADMIN_API;
    }

    if (!shopDomain || !accessToken) {
      throw new Error(`Missing Shopify configuration for ${production} environment`);
    }

    const config = {
      shopDomain,
      accessToken,
      apiVersion: '2024-01'
    };

    if (isLoggingEnabled) {
      logger.info('CONFIG', 'Shopify configuration loaded', {
        environment: production,
        shopDomain: shopDomain.replace(/\.myshopify\.com$/, ''),
        hasAccessToken: !!accessToken
      });
    }

    return config;
  } catch (error) {
    if (isLoggingEnabled) {
      logger.error('CONFIG', 'Failed to load Shopify config', {
        error: error.message,
        production: process.env.PRODUCTION
      });
    }
    throw new Error(`Shopify configuration error: ${error.message}`);
  }
}

/**
 * Main application entry point
 * First gets all Shopify products, then runs CSV parsing and filtering for EET products
 */
async function main() {
  try {
    // Log application start
    if (isLoggingEnabled) {
      logger.logAppStart();
    }
    
    // Log environment configuration
    const production = process.env.PRODUCTION || 'development';
    const language = process.env.LANGUAGE || 'EN';
    const eetPriceFile = process.env.EET_PRICE || 'eet_prices.txt';
    const priceStock = parseFloat(process.env.PRICE_STOCK) || 0;
    
    if (isLoggingEnabled) {
      logger.info('CONFIG', 'Environment configuration loaded', {
        production,
        language,
        eetPriceFile
      });
      
      logger.info('APP', 'Application UI started');
    }
    
    // STEP 1: Get all Shopify products first
    if (isLoggingEnabled) {
      logger.info('SHOPIFY', 'Starting to fetch all Shopify products');
    }
    
    // Load Shopify configuration
    const shopifyConfig = loadShopifyConfig();
    const shopifyClient = new ShopifyClient(shopifyConfig);
    
    // STEP 0: Get online channel ID
    if (isLoggingEnabled) {
      logger.info('SHOPIFY', 'Getting online channel ID');
    }
    const onlineChannelId = await shopifyClient.getOnlineChannelId();
    
    if (isLoggingEnabled) {
      if (onlineChannelId) {
        logger.info('SHOPIFY', 'Online channel ID retrieved successfully', {
          channelId: onlineChannelId
        });
      } else {
        logger.warn('SHOPIFY', 'Online channel ID not found');
      }
    }
    
    // Get all products from Shopify
    const shopifyProducts = await shopifyClient.getAllProducts();
    
    if (isLoggingEnabled) {
      logger.info('SHOPIFY', 'All Shopify products fetched successfully', {
        totalCount: shopifyProducts.length
      });
    }
    
    // Create filter instance
    const filter = new EETProductFilter();
    if (isLoggingEnabled) {
      logger.info('FILTER', 'Filter instance created');
    }
    
    // STEP 2: Run the filter with the EET prices file and get JSON data
    const jsonData = await filter.run(eetPriceFile);
    
    // Log filter results
    if (isLoggingEnabled) {
      logger.logFilterProcess({
        totalProducts: jsonData.metadata.totalProducts,
        originalCount: jsonData.metadata.originalCount,
        filterDate: jsonData.metadata.filterDate,
        limit: jsonData.metadata.filterConfig.include_products_limit
      });
      
      // Log all filtered products (real data)
      logger.info('FILTER', 'All filtered products', {
        totalCount: jsonData.products.length
      });
    }
    
    // // STEP 3: Test the EET to Shopify mapping with first product
    // if (jsonData.products.length > 0) {
    //   const firstEETProduct = jsonData.products[0];
    //   const mappedProduct = await shopifyClient.mapEETToShopifyProduct(firstEETProduct);
      
    //   if (isLoggingEnabled) {
    //     logger.info('MAPPING_TEST', 'EET to Shopify mapping test completed', {
    //       originalEET: {
    //         varenr: firstEETProduct.varenr,
    //         beskrivelse: firstEETProduct.beskrivelse,
    //         maerke_navn: firstEETProduct.maerke_navn,
    //         pris: firstEETProduct.pris,
    //         lagerbeholdning: firstEETProduct.lagerbeholdning
    //       },
    //       mappedShopify: {
    //         title: mappedProduct.title,
    //         vendor: mappedProduct.vendor,
    //         productType: mappedProduct.productType,
    //         sku: mappedProduct.variants[0].sku,
    //         price: mappedProduct.variants[0].price,
    //         inventoryQuantity: mappedProduct.variants[0].inventoryQuantity,
    //         metafieldsCount: mappedProduct.metafields.length,
    //         hasImage: mappedProduct.images.length > 0
    //       }
    //     });
    //   }
    // }
    
    // STEP 4: Extract the list of products not registered in Shopify from eetData
    const unregisteredProducts = [];
    const registeredProducts = [];
    
    for (const eetProduct of jsonData.products) {
      const mappedProduct = await shopifyClient.mapEETToShopifyProduct(eetProduct);
      const existingProduct = shopifyClient.findProductBySKU(mappedProduct.variants[0].sku, shopifyProducts);
      
      if (existingProduct) {
        registeredProducts.push({
          mappedProduct,
          shopifyProduct: existingProduct
        });
      } else {
        unregisteredProducts.push(mappedProduct);
      }
    }
    
    if (isLoggingEnabled) {
      logger.info('PRODUCT_COMPARISON', 'Product comparison completed', {
        totalEETProducts: jsonData.products.length,
        registeredInShopify: registeredProducts.length,
        notRegisteredInShopify: unregisteredProducts.length,
        shopifyProductsTotal: shopifyProducts.length
      });
      
      // Log sample of unregistered products
      if (unregisteredProducts.length > 0) {
        logger.info('UNREGISTERED_PRODUCTS', 'Sample of unregistered products', {
          count: unregisteredProducts.length,
          sample: unregisteredProducts.slice(0, 5).map(p => ({
            title: p.title,
            vendor: p.vendor,
            sku: p.variants[0].sku,
            price: p.variants[0].price,
            inventoryQuantity: p.variants[0].inventoryQuantity,
            productType: p.productType
          }))
        });
      }
      
      // Log sample of registered products
      if (registeredProducts.length > 0) {
        logger.info('REGISTERED_PRODUCTS', 'Sample of registered products', {
          count: registeredProducts.length,
          sample: registeredProducts.slice(0, 5).map(rp => ({
            title: rp.mappedProduct.title,
            vendor: rp.mappedProduct.vendor,
            sku: rp.mappedProduct.variants[0].sku,
            price: rp.mappedProduct.variants[0].price,
            shopifyId: rp.shopifyProduct.id,
            shopifyTitle: rp.shopifyProduct.title
          }))
        });
      }
    }
    
    // STEP 5: Register unregistered products in Shopify
    if (unregisteredProducts.length > 0) {
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_REGISTER', 'Starting to register unregistered products', {
          count: unregisteredProducts.length
        });
      }
      
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      for (const product of unregisteredProducts) {
        try {
          const createdProduct = await shopifyClient.createProduct(product);
          successCount++;
          
          if (isLoggingEnabled) {
            logger.info('SHOPIFY_REGISTER', 'Product registered successfully', {
              sku: product.variants[0].sku,
              title: product.title,
              productId: createdProduct.id,
              vendor: product.vendor,
              price: product.variants[0].price
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          console.log("Error creating product:", product.variants[0].sku, error.message);
          errorCount++;
          errors.push({
            sku: product.variants[0].sku,
            title: product.title,
            error: error.message
          });
          
          if (isLoggingEnabled) {
            logger.error('SHOPIFY_REGISTER', 'Product registration failed', {
              sku: product.variants[0].sku,
              title: product.title,
              vendor: product.vendor,
              price: product.variants[0].price,
              error: error.message
            });
          }
        }
      }
      
      if (isLoggingEnabled) {
        logger.info('SHOPIFY_REGISTER', 'Product registration completed', {
          totalProducts: unregisteredProducts.length,
          successCount,
          errorCount,
          errors: errors.length > 0 ? errors : undefined
        });
      }
    }

    // STEP 6: Make Shopify products that are not on the EET list into drafts
    const draftResults = await shopifyClient.makeOrphanedProductsDraft(shopifyProducts, jsonData.products);

    // STEP 7: Update price with EET data
    const EETClient = (await import('./module/eet.js')).default;
    const eetClient = new EETClient();
    
    const loginResult = await eetClient.login();

    if (loginResult.success) {
      const eetPriceAndStock = await eetClient.getAllProductsPriceAndStock(jsonData.products);
      
      if (eetPriceAndStock && eetPriceAndStock.length > 0) {
        let successCount = 0;
        let errorCount = 0;

        const shopifyProducts = await shopifyClient.getAllProducts();
        
        for (const eetItem of eetPriceAndStock) {
          try {
            const sku = eetItem.ItemId;
            const product = shopifyClient.findProductBySKU(sku, shopifyProducts);

            // Find the EET product to get brand name
            const eetProduct = jsonData.products.find(p => p.varenr === sku);
            const brandName = eetProduct?.maerke_navn || '';

            // if eetItem.Price is not empty
            // price = eetItem.Price.Price + eetItem.Price.VatAmount
            let price = null;
            if (eetItem.Price) {
              price = parseFloat(eetItem.Price.Price) + parseFloat(eetItem.Price.VatAmount);
            }
            const cost = parseFloat(eetItem.Price.Price);

            if (price !== null) {
              const result = await shopifyClient.updateProductPrice(sku, price, product, cost);

              if (result.success) {
                successCount++;
              } else {
                errorCount++;
                console.log(`❌ Failed ${sku}: ${result.error}`);
              }
            }

            // update quantity
            let stockObject = null;
            if (eetItem.Stock) {
              stockObject = eetItem.Stock;
            }
            if (stockObject.length > 0) {
              let localStock = 0;
              let remoteStock = 0;
              let incomingStock = 0;
              stockObject.forEach(stock => {
                if (stock.StockTypeName === "Local") {
                  localStock = stock.Quantity;
                } else if (stock.StockTypeName === "Remote") {
                  remoteStock = stock.Quantity;
                } else if (stock.StockTypeName === "Incoming") {
                  incomingStock = stock.Quantity;
                }
              });
              const quantityResult = await shopifyClient.updateProductQuantity(sku, parseInt(localStock) + parseInt(remoteStock), product);
              const saveStockObject = await shopifyClient.updateStockObject(sku, eetItem.Stock, product);
              await shopifyClient.makeProductActive(product);
            } else {
              // make product draft
              if (product) {
                await shopifyClient.makeProductDraft(product);
              }
            }

            // Add brand tag to the product
            if (product && brandName) {
              try {
                await shopifyClient.addProductTags(product.id, [brandName]);
              } catch (tagError) {
                // Log but don't fail update if tag addition fails
                if (isLoggingEnabled) {
                  logger.warn('EET_UPDATE', 'Failed to add brand tag', {
                    sku,
                    brandName,
                    error: tagError.message
                  });
                }
              }
            }

            await new Promise(resolve => setTimeout(resolve, 200));

          } catch (error) {
            errorCount++;
            console.log(`❌ Error updating ${eetItem.ItemId}: ${error.message}`);
          }
        }
        
        if (isLoggingEnabled) {
          logger.info('EET_UPDATE', 'Price update process completed', {
            processedCount: eetPriceAndStock.length,
            successCount,
            errorCount
          });
        }
      }
    } else {
      console.log('❌ EET login failed:', loginResult.error);
    }
    
    // Log application completion
    if (isLoggingEnabled) {
      logger.logAppEnd({
        totalProducts: jsonData.metadata.totalProducts,
        originalCount: jsonData.metadata.originalCount,
        shopifyProductsCount: shopifyProducts.length,
        logFile: logger.getCurrentLogFile()
      });
    }

    // Return the JSON data for further processing
    return {
      shopifyProducts,
      eetData: jsonData,
      unregisteredProducts,
      registeredProducts
    };
    
  } catch (error) {
    if (isLoggingEnabled) {
      logger.error('APP', 'Application failed', {
        error: error.message,
        stack: error.stack
      });
    }
    console.error('❌ Application failed:', error.message);
    process.exit(1);
  }
}

/**
 * Schedule the main process to run every 12 hours
 */
function scheduleProcess() {
  const runProcess = async () => {
    const startTime = new Date();
    console.log(`\n🕐 Starting scheduled process at ${startTime.toISOString()}`);
    console.log('═'.repeat(80));
    
    try {
      await main();
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);
      console.log(`\n✅ Process completed successfully at ${endTime.toISOString()}`);
      console.log(`⏱️  Duration: ${duration} seconds`);
    } catch (error) {
      const endTime = new Date();
      console.error(`\n❌ Process failed at ${endTime.toISOString()}:`, error.message);
    }
    
    // Schedule next run in 12 hours
    const nextRun = new Date(Date.now() + 12 * 60 * 60 * 1000);
    console.log(`\n⏰ Next scheduled run: ${nextRun.toISOString()}`);
    console.log('═'.repeat(80));
    
    setTimeout(runProcess, 12 * 60 * 60 * 1000); // 12 hours = 12 * 60 * 60 * 1000 ms
  };
  
  // Start the first run immediately
  runProcess();
}

// Check if we should run in scheduled mode or single run
const isScheduledMode = process.env.SCHEDULED_MODE === 'true';

if (isScheduledMode) {
  console.log('🔄 Starting in scheduled mode - will run every 12 hours');
  scheduleProcess();
} else {
  console.log('🚀 Starting in single-run mode');
  // Run the application once
  main().then(result => {
    console.log("END!");
  }).catch(console.error);
}
