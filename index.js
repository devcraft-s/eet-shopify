import EETProductFilter from './module/csvParseAndFilter.js';

/**
 * Main application entry point
 * Runs CSV parsing and filtering for EET products
 */
async function main() {
  try {
    console.log('🚀 Starting EET Product Filter Application');
    console.log('═'.repeat(60));
    
    // Create filter instance
    const filter = new EETProductFilter();
    
    // Run the filter with the EET prices file and get JSON data
    const jsonData = await filter.run('eet_prices.txt');
    
    console.log('\n🎉 Application completed successfully!');
    console.log(`📊 Found ${jsonData.metadata.totalProducts} products matching your criteria`);
    console.log(`📈 Original products: ${jsonData.metadata.originalCount}`);
    console.log(`🔍 Filter applied: ${jsonData.metadata.filterDate}`);
    
    // Example: Access the JSON data
    console.log('\n📋 Sample of filtered products (first 3):');
    jsonData.products.slice(0, 3).forEach((product, index) => {
      console.log(`${index + 1}. ${product.varenr} - ${product.beskrivelse} (${product.maerke_navn}) - DKK ${product.pris}`);
    });
    
    // Return the JSON data for further processing
    return jsonData;
    
  } catch (error) {
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

