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
 * Get all Shopify products first
 * @returns {Promise<Object>} Object containing products array and shopifyClient
 */
async function getAllShopifyProducts() {
  try {
    logger.info('SHOPIFY', 'Starting to fetch all Shopify products');
    
    // Load Shopify configuration
    const shopifyConfig = loadShopifyConfig();
    const shopifyClient = new ShopifyClient(shopifyConfig);
    
    // console.log('🛒 Fetching all Shopify products...');
    
    // Get all products from Shopify
    const allProducts = await shopifyClient.getAllProducts();
    
    // console.log(`✅ Successfully fetched ${allProducts.length} products from Shopify`);
    
    logger.info('SHOPIFY', 'All Shopify products fetched successfully', {
      totalCount: allProducts.length
    });
    
    return {
      products: allProducts,
      client: shopifyClient
    };
    
  } catch (error) {
    logger.error('SHOPIFY', 'Failed to fetch Shopify products', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Main application entry point
 * First gets all Shopify products, then runs CSV parsing and filtering for EET products
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
    
    logger.info('APP', 'Application UI started');
    
    // STEP 1: Get all Shopify products first
    const { products: shopifyProducts, client: shopifyClient } = await getAllShopifyProducts();
    
    // Create filter instance
    const filter = new EETProductFilter();
    logger.info('FILTER', 'Filter instance created');
    
    // STEP 2: Run the filter with the EET prices file and get JSON data
    const jsonData = await filter.run(eetPriceFile);
    
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
    
    // STEP 3: Test the EET to Shopify mapping with first product
    if (jsonData.products.length > 0) {
      const firstEETProduct = jsonData.products[0];
      const mappedProduct = shopifyClient.mapEETToShopifyProduct(firstEETProduct);
      
      logger.info('MAPPING_TEST', 'EET to Shopify mapping test completed', {
        originalEET: {
          varenr: firstEETProduct.varenr,
          beskrivelse: firstEETProduct.beskrivelse,
          maerke_navn: firstEETProduct.maerke_navn,
          pris: firstEETProduct.pris,
          lagerbeholdning: firstEETProduct.lagerbeholdning
        },
        mappedShopify: {
          title: mappedProduct.title,
          vendor: mappedProduct.vendor,
          productType: mappedProduct.productType,
          sku: mappedProduct.variants[0].sku,
          price: mappedProduct.variants[0].price,
          inventoryQuantity: mappedProduct.variants[0].inventoryQuantity,
          metafieldsCount: mappedProduct.metafields.length,
          hasImage: mappedProduct.images.length > 0
        }
      });
    }
    
    // STEP 4: Extract the list of products not registered in Shopify from eetData
    const unregisteredProducts = [];
    const registeredProducts = [];
    
    for (const eetProduct of jsonData.products) {
      const existingProduct = shopifyClient.findProductBySKU(eetProduct.varenr, shopifyProducts);
      
      if (existingProduct) {
        registeredProducts.push({
          eetProduct,
          shopifyProduct: existingProduct
        });
      } else {
        unregisteredProducts.push(eetProduct);
      }
    }
    
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
          varenr: p.varenr,
          beskrivelse: p.beskrivelse,
          maerke_navn: p.maerke_navn,
          pris: p.pris,
          lagerbeholdning: p.lagerbeholdning
        }))
      });
    }
    
    // Log sample of registered products
    if (registeredProducts.length > 0) {
      logger.info('REGISTERED_PRODUCTS', 'Sample of registered products', {
        count: registeredProducts.length,
        sample: registeredProducts.slice(0, 5).map(rp => ({
          varenr: rp.eetProduct.varenr,
          beskrivelse: rp.eetProduct.beskrivelse,
          shopifyId: rp.shopifyProduct.id,
          shopifyTitle: rp.shopifyProduct.title
        }))
      });
    }
    
    // Log application completion
    logger.logAppEnd({
      totalProducts: jsonData.metadata.totalProducts,
      originalCount: jsonData.metadata.originalCount,
      shopifyProductsCount: shopifyProducts.length,
      logFile: logger.getCurrentLogFile()
    });
    
    // Return the JSON data for further processing
    return {
      shopifyProducts,
      eetData: jsonData,
      unregisteredProducts,
      registeredProducts
    };
    
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
main().then(result => {
  console.log("Start!");
}).catch(console.error);

