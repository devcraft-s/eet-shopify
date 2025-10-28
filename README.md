# EET Shopify Sync

Automatically sync your EET products to your Shopify store. Keep prices, inventory, and product information updated automatically.

## 🚀 What Does It Do?

This application helps you:
- **Sync products** from EET to your Shopify store
- **Update prices** automatically from EET
- **Update stock levels** to keep inventory current
- **Add new products** when they appear in EET
- **Hide products** automatically when they're no longer available

## 📋 What You Need

- Shopify store
- EET pricing file (`eet_prices.txt`)
- EET API credentials

## 🛠️ Quick Setup

### 1. Environment Setup

Create a `.env` file in the root directory with your settings:

```env
# Environment
PRODUCTION=development
LANGUAGE=DNK
EET_PRICE=eet_prices.txt

# Shopify Store
SHOPIFY_TEST_STORE_ADMIN_URL=your-store.myshopify.com
SHOPIFY_TEST_STORE_ADMIN_API=shpat_your_access_token
SHOPIFY_PRODUCTION_STORE_ADMIN_URL=your-production-store.myshopify.com
SHOPIFY_PRODUCTION_STORE_ADMIN_API=shpat_your_production_token

# Run Mode
SCHEDULED_MODE=false
LOGGING=true
```

### 2. Add Your EET Pricing File

- Name it `eet_prices.txt`
- Place it in the root directory

### 3. Configure Product Filters (Optional)

Edit `config/product-filter.json` to control which products sync:

```json
{
  "include": {
    "brand": ["Axis", "Hikvision", "Sony"]
  },
  "exclude": {
    "brand": ["Samsung", "LG"]
  },
  "include_products_limit": 50
}
```

## 🎯 How to Use

### Run
```bash
npm start
```

## 🔄 Customer Workflow - What Happens When You Run the Sync

### Step 1: Connect to Your Store
The app connects to your Shopify store and downloads all existing products.

### Step 2: Read Your EET Pricing File
It reads your `eet_prices.txt` file and extracts product information including:
- Product names and descriptions
- Prices
- Stock quantities
- Images
- Brand information

### Step 3: Filter Products (If Configured)
If you've set up filters in `config/product-filter.json`, it will:
- Include only the brands or products you want
- Exclude specific brands or products
- Limit the number of products

### Step 4: Compare with Your Store
The app compares EET products with your Shopify store and determines:
- **New products** to add
- **Existing products** that need updates
- **Missing products** to hide

### Step 5: Add New Products
For new products, the app:
- Creates the product in your Shopify store
- Sets the title, description, and price
- Uploads product images
- Sets stock quantities
- Configures product metadata

### Step 6: Update Existing Products
For products already in your store, the app:
- Updates prices from EET
- Updates stock quantities
- Refreshes product information

### Step 7: Stock Filtering
Products are filtered based on stock availability:
- **If product has stock** (local or remote): Product stays ACTIVE
- **If product has NO stock** available: Product is set to DRAFT (hidden from store)
- Stock levels are checked from EET API in real-time
- Local and remote stock are combined for availability

### Step 8: Hide Missing Products
If products are no longer in your EET file:
- They're automatically set to DRAFT status
- They won't appear on your store front

### Step 9: Get Real-Time Updates
The app connects to EET API to get:
- Latest prices
- Current stock levels (local, remote, incoming)
- Availability status

## 📊 Keeping Track

### Log Files
All sync operations are logged to the `logs/` directory:
- One log file per run
- Timestamped for easy tracking
- Shows success and errors

### What's Logged
- Products created successfully
- Products updated
- Price changes
- Stock updates
- Errors (if any)

## 🔧 Configuration Guide

### Product Filtering

Control which products sync to your store:

**Include only specific brands:**
```json
{
  "include": {
    "brand": ["Axis", "Hikvision"]
  },
  "exclude": {},
  "include_products_limit": 100
}
```

**Exclude specific products:**
```json
{
  "include": {},
  "exclude": {
    "sku": ["OLD001", "TEST001"]
  },
  "include_products_limit": 0
}
```

### Filter Rules Explained

**Include :**
- If a product's brand OR SKU matches your include list, it will be synced
- Leave empty to sync all products

**Exclude :**
- If a product's brand AND SKU both match your exclude list, it won't sync
- Matches only one? It still syncs

**Limit:**
- Set maximum number of products to process
- Set to 0 for no limit

## 📖 Required File Format

Your `eet_prices.txt` needs these columns (separated by semicolons):

| Column | What It Is |
|--------|------------|
| `Varenr.` | Product SKU |
| `Beskrivelse` | Product name |
| `Pris` | Price |
| `Lagerbeholdning` | Stock quantity |
| `Mærke Navn` | Brand name |
| `Web Category Name` | Category |
| `Web Picture URL` | Image URL |
| `Beskrivelse 2` | Additional description |
| `Beskrivelse 3` | More details |
| `EAN/UPC` | Barcode |
| `Bruttovægt` | Weight (kg) |
| `Manufacturer Part No` | Manufacturer part number |

## 📁 File Structure

```
eet-shopify/
├── config/
│   └── product-filter.json   # Your filter settings
├── logs/                      # Log files (auto-created)
├── tmp_data/                  # Temporary data
├── .env                       # Your configuration
├── eet_prices.txt            # EET pricing file
├── index.js                   # Main application
└── README.md                  # This file
```

## 🆘 Need Help?

If you run into issues:
1. Check the troubleshooting section above
2. Look at log files in the `logs/` directory
3. Contact support with:
   - Error messages you're seeing
   - Log file excerpts
   - Your configuration settings

---

**Happy Syncing! 🛒✨**