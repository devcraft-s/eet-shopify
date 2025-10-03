import fs from 'fs';
import { createReadStream } from 'fs';
import csv from 'csv-parser';

/**
 * CSV Parser and Filter for EET pricing file
 * Reads the EET prices file and applies filtering based on product-filter.json
 */
class EETProductFilter {
  constructor() {
    this.filterConfig = this.loadFilterConfig();
    this.products = [];
  }

  /**
   * Load filter configuration from config/product-filter.json
   * @returns {Object} Filter configuration
   */
  loadFilterConfig() {
    try {
      const configData = fs.readFileSync('config/product-filter.json', 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error loading filter config:', error.message);
      return { include: {}, exclude: {} };
    }
  }

  /**
   * Parse the EET prices CSV file
   * @param {string} filePath - Path to the EET prices file
   * @returns {Promise<Array>} Array of parsed products
   */
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const products = [];
      
      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      // console.log(`📁 Reading EET prices file: ${filePath}`);
      
      createReadStream(filePath, { encoding: 'utf8' })
        .pipe(csv({
          separator: ';',
          headers: [
            'varenr',           // Product number (SKU)
            'beskrivelse',      // Description
            'pris',            // Price
            'lagerbeholdning', // Stock quantity
            'maerke_navn',     // Brand name
            'forventet_levering', // Expected delivery
            'web_category_id', // Web category ID
            'web_category_name', // Web category name
            'item_product_link', // Product link
            'web_picture_url', // Picture URL
            'beskrivelse_2',   // Description 2
            'beskrivelse_3',   // Description 3
            'ean_upc',         // EAN/UPC
            'bruttovaegt',     // Gross weight
            'nettovaegt',      // Net weight
            'manufacturer_part_no' // Manufacturer part number
          ]
        }))
        .on('data', (row) => {
          // Clean and validate the data
          const product = this.cleanProductData(row);
          if (product && product.varenr) {
            products.push(product);
          }
        })
        .on('end', () => {
          // console.log(`✅ Parsed ${products.length} products from CSV`);
          this.products = products;
          resolve(products);
        })
        .on('error', (error) => {
          reject(new Error(`Error parsing CSV: ${error.message}`));
        });
    });
  }

  /**
   * Clean and validate product data
   * @param {Object} row - Raw CSV row
   * @returns {Object|null} Cleaned product object or null if invalid
   */
  cleanProductData(row) {
    try {
      // Remove quotes and trim whitespace
      const cleanRow = {};
      for (const [key, value] of Object.entries(row)) {
        cleanRow[key] = typeof value === 'string' ? value.replace(/^"|"$/g, '').trim() : value;
      }

      // Validate required fields
      if (!cleanRow.varenr || !cleanRow.beskrivelse) {
        return null;
      }

      // Parse numeric values
      const price = parseFloat(cleanRow.pris?.replace(',', '.') || '0');
      const stock = parseFloat(cleanRow.lagerbeholdning?.replace(',', '.') || '0');
      const grossWeight = parseFloat(cleanRow.bruttovaegt?.replace(',', '.') || '0');
      const netWeight = parseFloat(cleanRow.nettovaegt?.replace(',', '.') || '0');

      return {
        varenr: cleanRow.varenr,
        beskrivelse: cleanRow.beskrivelse,
        pris: price,
        lagerbeholdning: stock,
        maerke_navn: cleanRow.maerke_navn || '',
        forventet_levering: cleanRow.forventet_levering || '',
        web_category_id: cleanRow.web_category_id || '',
        web_category_name: cleanRow.web_category_name || '',
        item_product_link: cleanRow.item_product_link || '',
        web_picture_url: cleanRow.web_picture_url || '',
        beskrivelse_2: cleanRow.beskrivelse_2 || '',
        beskrivelse_3: cleanRow.beskrivelse_3 || '',
        ean_upc: cleanRow.ean_upc || '',
        bruttovaegt: grossWeight,
        nettovaegt: netWeight,
        manufacturer_part_no: cleanRow.manufacturer_part_no || ''
      };
    } catch (error) {
      console.warn(`⚠️  Error cleaning product data:`, error.message);
      return null;
    }
  }

  /**
   * Apply filtering rules to products
   * @param {Array} products - Array of products to filter
   * @returns {Array} Filtered products
   */
  filterProducts(products) {
    // console.log('🔍 Applying filters...');
    
    let filteredProducts = products;

    // Apply include filters - use OR logic for include filters
    if (this.filterConfig.include) {
      const includeBrands = this.filterConfig.include.brand ? 
        this.filterConfig.include.brand.map(b => b.toLowerCase()) : [];
      const includeSkus = this.filterConfig.include.sku ? 
        this.filterConfig.include.sku.map(s => s.toLowerCase()) : [];

      if (includeBrands.length > 0 || includeSkus.length > 0) {
        filteredProducts = filteredProducts.filter(product => {
          const brandMatch = includeBrands.length === 0 || 
            includeBrands.includes(product.maerke_navn.toLowerCase());
          const skuMatch = includeSkus.length === 0 || 
            includeSkus.includes(product.varenr.toLowerCase());
          
          return brandMatch || skuMatch;
        });
        // console.log(`📦 After include filters: ${filteredProducts.length} products`);
      }
    }

    // Apply exclude filters - use AND logic for exclude filters
    if (this.filterConfig.exclude) {
      if (this.filterConfig.exclude.brand && this.filterConfig.exclude.brand.length > 0) {
        const excludeBrands = this.filterConfig.exclude.brand.map(b => b.toLowerCase());
        filteredProducts = filteredProducts.filter(product => 
          !excludeBrands.includes(product.maerke_navn.toLowerCase())
        );
        // console.log(`📦 After brand exclude filter: ${filteredProducts.length} products`);
      }

      if (this.filterConfig.exclude.sku && this.filterConfig.exclude.sku.length > 0) {
        const excludeSkus = this.filterConfig.exclude.sku.map(s => s.toLowerCase());
        filteredProducts = filteredProducts.filter(product => 
          !excludeSkus.includes(product.varenr.toLowerCase())
        );
        // console.log(`📦 After SKU exclude filter: ${filteredProducts.length} products`);
      }
    }

    // Apply product limit if specified
    if (this.filterConfig.include_products_limit && this.filterConfig.include_products_limit > 0) {
      const limit = this.filterConfig.include_products_limit;
      if (filteredProducts.length > limit) {
        filteredProducts = filteredProducts.slice(0, limit);
        // console.log(`📦 After product limit (${limit}): ${filteredProducts.length} products`);
      }
    }

    return filteredProducts;
  }

  /**
   * Display filtered products in a formatted table
   * @param {Array} products - Products to display
   */
  displayProducts(products) {
    // console.log('\n📋 Filtered Product List:');
    // console.log('═'.repeat(120));
    // console.log(
    //   'SKU'.padEnd(15) + 
    //   'Brand'.padEnd(15) + 
    //   'Description'.padEnd(40) + 
    //   'Price'.padEnd(10) + 
    //   'Stock'.padEnd(8) + 
    //   'Category'.padEnd(20)
    // );
    // console.log('─'.repeat(120));

    products.forEach(product => {
      const description = product.beskrivelse.length > 37 
        ? product.beskrivelse.substring(0, 37) + '...' 
        : product.beskrivelse;
      
      const category = product.web_category_name.length > 17
        ? product.web_category_name.substring(0, 17) + '...'
        : product.web_category_name;

      // console.log(
      //   product.varenr.padEnd(15) +
      //   product.maerke_navn.padEnd(15) +
      //   description.padEnd(40) +
      //   `DKK ${product.pris.toFixed(2)}`.padEnd(10) +
      //   product.lagerbeholdning.toString().padEnd(8) +
      //   category.padEnd(20)
      // );
    });

    // console.log('─'.repeat(120));
    // console.log(`📊 Total filtered products: ${products.length}`);
  }

  /**
   * Save filtered products to a JSON file
   * @param {Array} products - Products to save
   * @param {string} filename - Output filename
   */
  saveToFile(products, filename = 'tmp_data/filtered-products.json') {
    try {
      // Ensure the tmp_data directory exists
      if (!fs.existsSync('tmp_data')) {
        fs.mkdirSync('tmp_data', { recursive: true });
      }

      const output = {
        metadata: {
          totalProducts: products.length,
          filterDate: new Date().toISOString(),
          filterConfig: this.filterConfig
        },
        products: products
      };

      fs.writeFileSync(filename, JSON.stringify(output, null, 2));
      // console.log(`💾 Saved ${products.length} filtered products to ${filename}`);
    } catch (error) {
      console.error('❌ Error saving file:', error.message);
    }
  }

  /**
   * Main method to parse and filter products
   * @param {string} filePath - Path to EET prices file
   * @param {boolean} displayResults - Whether to display results in console
   * @param {boolean} saveToFile - Whether to save results to JSON file
   * @returns {Object} JSON data with metadata and filtered products
   */
  async run(filePath = 'eet_prices.txt', displayResults = true, saveToFile = true) {
    try {
      if (displayResults) {
        // console.log('🚀 Starting EET Product Filter');
        // console.log('═'.repeat(50));
      }

      // Parse CSV
      const products = await this.parseCSV(filePath);
      
      // Apply filters
      const filteredProducts = this.filterProducts(products);
      
      // Create JSON response
      const jsonData = {
        metadata: {
          totalProducts: filteredProducts.length,
          originalCount: products.length,
          filterDate: new Date().toISOString(),
          filterConfig: this.filterConfig,
          filePath: filePath
        },
        products: filteredProducts
      };

      if (displayResults) {
        // Display results
        this.displayProducts(filteredProducts);
        // console.log('\n✅ Filtering completed successfully!');
      }
      
      if (saveToFile) {
        // Save to file
        this.saveToFile(filteredProducts);
      }
      
      return jsonData;
    } catch (error) {
      console.error('❌ Error:', error.message);
      throw error;
    }
  }

  /**
   * Get filtered products as JSON without console output
   * @param {string} filePath - Path to EET prices file
   * @returns {Object} JSON data with metadata and filtered products
   */
  async getFilteredProducts(filePath = 'eet_prices.txt') {
    return await this.run(filePath, false, false);
  }
}

// Run the filter if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const filter = new EETProductFilter();
  filter.run().catch(console.error);
}

export default EETProductFilter;
