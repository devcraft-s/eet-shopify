import EETProductFilter from './module/csvParseAndFilter.js';
import logger from './module/logger.js';
import ShopifyClient from './module/shopify.js';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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

    logger.info('CONFIG', 'Shopify configuration loaded', {
      environment: production,
      shopDomain: shopDomain.replace(/\.myshopify\.com$/, ''),
      hasAccessToken: !!accessToken
    });

    return config;
  } catch (error) {
    logger.error('CONFIG', 'Failed to load Shopify config', {
      error: error.message,
      production: process.env.PRODUCTION
    });
    throw new Error(`Shopify configuration error: ${error.message}`);
  }
}

/**
 * Upload products to Shopify
 * @param {Array} products - Array of EET products
 */
async function uploadProductsToShopify(products) {
  try {
    logger.info('SHOPIFY', 'Starting Shopify upload process', {
      productCount: products.length
    });

    // Load Shopify configuration
    const shopifyConfig = loadShopifyConfig();
    const shopifyClient = new ShopifyClient(shopifyConfig);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each product
    for (const product of products) {
      try {
        logger.info('SHOPIFY', 'Processing product', {
          sku: product.varenr,
          title: product.beskrivelse
        });

        const result = await shopifyClient.uploadProduct(product);
        successCount++;
        
        logger.info('SHOPIFY', 'Product processed successfully', {
          sku: product.varenr,
          productId: result.id,
          title: product.beskrivelse,
          brand: product.maerke_navn,
          price: product.pris,
          stock: product.lagerbeholdning,
          category: product.web_category_name,
          action: 'uploaded'
        });

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errorCount++;
        errors.push({
          sku: product.varenr,
          error: error.message
        });
        
        logger.error('SHOPIFY', 'Product upload failed', {
          sku: product.varenr,
          title: product.beskrivelse,
          brand: product.maerke_navn,
          price: product.pris,
          error: error.message
        });
      }
    }

    // Log final results
    logger.info('SHOPIFY', 'Shopify upload process completed', {
      totalProducts: products.length,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

    console.log('\n🛒 Shopify Upload Results:');
    console.log(`✅ Successfully processed: ${successCount} products`);
    console.log(`❌ Failed: ${errorCount} products`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.forEach(error => {
        console.log(`  - ${error.sku}: ${error.error}`);
      });
    }

  } catch (error) {
    logger.error('SHOPIFY', 'Shopify upload process failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Main application entry point
 * Runs CSV parsing and filtering for EET products
 */
async function main() {
  try {
    // Log application start
    logger.logAppStart();
    
    // Log environment configuration
    const production = process.env.PRODUCTION || 'development';
    const language = process.env.LANGUAGE || 'EN';
    const eetPriceFile = process.env.EET_PRICE || 'eet_prices.txt';
    
    logger.info('CONFIG', 'Environment configuration loaded', {
      production,
      language,
      eetPriceFile
    });
    
    console.log('🚀 Starting EET Product Filter Application');
    console.log('═'.repeat(60));
    console.log(`🌍 Environment: ${production}`);
    console.log(`🗣️  Language: ${language}`);
    console.log(`📁 EET Price File: ${eetPriceFile}`);
    console.log('');
    logger.info('APP', 'Application UI started');
    
    // Create filter instance
    const filter = new EETProductFilter();
    logger.info('FILTER', 'Filter instance created');
    
    // Run the filter with the EET prices file and get JSON data
    const jsonData = await filter.run(eetPriceFile);
    
    console.log('\n🎉 Application completed successfully!');
    console.log(`📊 Found ${jsonData.metadata.totalProducts} products matching your criteria`);
    console.log(`📈 Original products: ${jsonData.metadata.originalCount}`);
    console.log(`🔍 Filter applied: ${jsonData.metadata.filterDate}`);
    
    // Log filter results
    logger.logFilterProcess({
      totalProducts: jsonData.metadata.totalProducts,
      originalCount: jsonData.metadata.originalCount,
      filterDate: jsonData.metadata.filterDate,
      limit: jsonData.metadata.filterConfig.include_products_limit
    });
    
    // Log all filtered products (real data)
    logger.info('FILTER', 'All filtered products', {
      totalCount: jsonData.products.length,
      products: jsonData.products.map(p => ({
        varenr: p.varenr,
        beskrivelse: p.beskrivelse,
        maerke_navn: p.maerke_navn,
        pris: p.pris,
        lagerbeholdning: p.lagerbeholdning,
        web_category_name: p.web_category_name
      }))
    });
    
    // Upload products to Shopify
    await uploadProductsToShopify(jsonData.products);
    
    // Log application completion
    logger.logAppEnd({
      totalProducts: jsonData.metadata.totalProducts,
      originalCount: jsonData.metadata.originalCount,
      logFile: logger.getCurrentLogFile()
    });
    
    // Return the JSON data for further processing
    return jsonData;
    
  } catch (error) {
    logger.error('APP', 'Application failed', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Application failed:', error.message);
    process.exit(1);
  }
}

// Run the application
main().then(jsonData => {
  // You can now use jsonData.products for further processing
  // For example, send to Shopify API, process in batches, etc.
  console.log('\n💡 JSON data is ready for further processing!');
  console.log(`📦 Products array contains ${jsonData.products.length} items`);
}).catch(console.error);

