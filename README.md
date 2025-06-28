# Job Mapper With Radius In/Out

**Version 1.2.1** - A comprehensive WordPress plugin that visualizes location-based data from Apify datasets on Google Maps with advanced filtering, caching, and automation capabilities.

## Overview

This WordPress plugin integrates with Apify.com to fetch location data (originally designed for job postings, but adaptable for any location-based data) and displays it on an interactive Google Map. Users can configure multiple radius zones to filter data points as either inside or outside specific geographic boundaries.

## Key Features

### 🗺️ **Interactive Google Maps Integration**
- Full-width responsive map display (400-800px height)
- Interactive markers with detailed popup information
- Configurable radius circles with inside/outside filtering
- Mobile-responsive design with collapsible side panel
- Real-time marker filtering based on location criteria

### 🔄 **Advanced Data Synchronization**
- **Apify API Integration**: Direct connection to Apify actors and datasets
- **Automated Cron Jobs**: Configurable sync frequencies (hourly, twice daily, daily, weekly)
- **SQLite Local Caching**: Persistent local storage with WordPress transients fallback
- **Manual Sync Controls**: Admin interface for immediate data refresh
- **Comprehensive Logging**: Detailed sync activity tracking with status indicators

### 🎯 **Flexible Location Filtering**
- **Multiple Location Support**: Configure unlimited center points
- **Radius Zones**: Individual radius settings for each location (in meters)
- **Inside/Outside Logic**: Show data points within or outside radius boundaries
- **Distance Calculations**: Accurate distance measurements using Haversine formula
- **Real-time Filtering**: Dynamic marker visibility based on criteria

### 👥 **User Management & Personalization**
- **User-Specific Access Control**: Restrict map visibility to specific users
- **Personal Preferences**: User-specific location memory and zoom levels
- **Geolocation Support**: Optional browser-based location detection
- **Ignored Items**: Users can hide specific data points
- **Session Persistence**: Maintains user preferences across sessions

### ⚙️ **Streamlined Admin Interface**
- **Tabbed Settings Page**: Organized configuration interface
  - **Locations Tab**: **Compact single-row location management** with inline editing
  - **API Keys & URLs Tab**: Apify token and Google Maps API configuration
  - **Sync & Cron Tab**: Automation settings and activity monitoring
- **Space-Efficient Design**: Each location displays in a single horizontal row
- **Inline Field Layout**: Address, coordinates, radius, and mode in one compact line
- **Quick Access Controls**: Streamlined add/remove location functionality
- **Dataset Management**: View and manage fetched data with sortable tables
- **Real-time Status**: Live cron status and cache information
- **Connection Testing**: Built-in API connectivity verification

## Recent Updates (Version 1.2.1)

### 🎨 **Enhanced Admin Interface**
- **Compact Location Rows**: Transformed large table-based location settings into space-efficient single rows
- **Horizontal Field Layout**: Address (flexible width), Lat/Lng (80px each), Radius (70px), Mode dropdown (80px)
- **Improved Labeling**: Shortened labels for better space utilization ("Latitude" → "Lat", "Longitude" → "Lng", "Radius (meters)" → "Radius (m)")
- **Dropdown Mode Selection**: Replaced radio buttons with compact dropdown for Inside/Outside selection
- **Mobile-Optimized**: Responsive design that stacks fields vertically on smaller screens
- **Visual Enhancements**: Improved hover effects and visual feedback for better user experience

### 🔧 **Technical Improvements**
- **Flexbox Layout**: Modern CSS flexbox implementation for consistent alignment
- **Reduced Vertical Space**: Each location now takes ~60% less vertical space
- **Better Mobile Experience**: Optimized layout for tablets and mobile devices
- **Maintained Functionality**: All existing features preserved while improving usability

## Technical Architecture

### Core Plugin Class: `User_Specific_Map_Radius`

**Database Integration:**
- SQLite database for local caching (`wp-uploads/usgrm_cache.db`)
- WordPress transients fallback when SQLite is unavailable
- Two main tables: `apify_cache` (data storage) and `sync_log` (activity tracking)
- PDO-based database operations with error handling

**WordPress Integration:**
- WordPress transients for temporary caching
- Native WordPress cron system integration
- WordPress Settings API implementation
- Proper nonce verification and capability checks

**AJAX Handlers:**
- `ajax_test_apify_connection()` - API connectivity testing
- `ajax_manual_sync()` - Force immediate data synchronization
- `ajax_save_cron_settings()` - Cron configuration management
- `ajax_get_cron_status()` - Retrieve cron and cache status
- `ajax_get_sync_log()` - Fetch synchronization logs
- `ajax_ignore_job()` - User-specific item hiding
- `ajax_save_location_preference()` - User preference storage
- `ajax_get_user_preferences()` - User preference retrieval

### JavaScript Components

**File: `assets/js/admin-locations.js`** (484 lines)
- Google Places API integration for address autocomplete
- Dynamic form field management (add/remove location rows)
- AJAX-powered admin interface interactions
- Real-time feedback for user actions
- Mobile-responsive interface controls
- Tab switching functionality
- Cron controls and status updates
- **Enhanced**: Support for compact location row management

**File: `assets/css/admin.css`** (450+ lines)
- Comprehensive admin interface styling
- **New**: Compact location row styling with flexbox layout
- **Enhanced**: Mobile-responsive design for location management
- Tabbed interface design
- Status indicators and feedback
- Accessibility features
- **Improved**: Space-efficient form layouts

**File: `user-map-radius.css`** (102 lines)
- User-facing map interface styling
- Mobile-responsive layout with collapsible side panel
- Fixed positioning for mobile toggle button

## Installation & Setup

### Prerequisites
- WordPress 5.0+ (recommended: latest version)
- PHP 7.4+ (PDO SQLite support optional but recommended)
- Active Apify.com account with API access
- Google Maps JavaScript API key with Places API enabled

### Installation Steps

1. **Download & Install**
   ```bash
   cd wp-content/plugins/
   git clone [repository-url] google-maps-radius
   ```

2. **Activate Plugin**
   - Navigate to WordPress Admin → Plugins
   - Activate "Job Mapper With Radius In/Out"

3. **Configure API Keys**
   - Go to WordPress Admin → User Map Radius → Settings
   - Navigate to "API Keys & URLs" tab
   - Enter your Apify API token
   - Enter your Google Maps JavaScript API key
   - Configure Apify actor ID (default: `compass~crawler-google-places`)

4. **Set Up Locations** *(Now with Improved Interface)*
   - Switch to "Locations" tab
   - Experience the new compact, single-row location management
   - Add center points using address autocomplete
   - Configure radius (in meters) and inside/outside filtering for each location
   - Set allowed users (leave empty to allow all logged-in users)
   - Enjoy the streamlined interface that takes up significantly less screen space

5. **Configure Automation**
   - Navigate to "Sync & Cron" tab
   - Set sync frequency and cache duration
   - Test API connection and perform initial manual sync

## Usage

### Display Map
Add the shortcode anywhere in posts or pages:
```php
[user_map_radius]
```

### Access Control
- **Logged-in Users Only**: Map is only visible to authenticated users
- **User Restrictions**: Optionally limit access to specific user IDs
- **Empty User List**: If no users specified, all logged-in users can access

### Data Management
- **Automatic Sync**: Configured cron jobs fetch fresh data automatically
- **Manual Refresh**: Admin can trigger immediate data synchronization
- **Cache Control**: Configurable cache duration (1-168 hours)
- **Data Persistence**: SQLite database or WordPress transients ensure data availability

## Configuration Options

### General Settings (`usgrm_general_settings`)
```php
[
    'apify_token'         => 'your_apify_api_token',
    'apify_actor'         => 'compass~crawler-google-places',
    'google_maps_key'     => 'your_google_maps_api_key',
    'locations'           => [
        [
            'address' => 'City Center, Your City',
            'lat'     => 40.7128,
            'lng'     => -74.0060,
            'radius'  => 25000,  // in meters
            'mode'    => 'inside'
        ]
    ],
    'default_geolocation' => false,
    'cron_frequency'      => 'hourly',
    'cache_hours'         => 24,
]
```

### User Preferences (`usgrm_user_preferences`)
```php
[
    'user_id' => [
        'ignored_jobs'        => ['job_id_1', 'job_id_2'],
        'last_location'       => ['lat' => 40.7128, 'lng' => -74.0060],
        'preferred_zoom'      => 11,
        'geolocation_enabled' => true
    ]
]
```

## API Integration

### Apify Integration
- **Simplified Configuration**: Only requires API token and actor ID
- **Automatic URL Building**: Constructs API URLs programmatically
- **Multiple Data Formats**: Supports both JSON and NDJSON responses
- **Error Handling**: Comprehensive error logging and user feedback
- **Timeout Management**: Configurable request timeouts
- **Legacy Support**: Backward compatibility with old API URL format

### Google Maps API
- **Places API**: Address autocomplete in admin interface
- **Maps JavaScript API**: Interactive map display
- **Geolocation API**: Optional user location detection

## Database Schema

### SQLite Tables (with WordPress Transients Fallback)

**apify_cache**
```sql
CREATE TABLE apify_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT UNIQUE,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    user_session TEXT
);
```

**sync_log**
```sql
CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT,
    status TEXT,
    message TEXT,
    items_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Features

- **Nonce Verification**: All AJAX requests protected with WordPress nonces
- **Capability Checks**: Admin functions restricted to users with `manage_options`
- **Data Sanitization**: All user inputs sanitized using WordPress functions
- **SQL Injection Protection**: PDO prepared statements for all database operations
- **XSS Prevention**: Proper escaping of all output data

## Performance Optimizations

- **SQLite Caching**: Local database storage reduces API calls
- **Transient Fallback**: WordPress transients when SQLite unavailable
- **Conditional Loading**: Google Maps API only loaded when needed
- **Efficient Queries**: Optimized database queries with proper indexing
- **Background Processing**: Cron jobs handle data synchronization without blocking UI
- **Compact Admin Interface**: Reduced DOM complexity and improved rendering performance

## Troubleshooting

### Common Issues

**Map Not Displaying:**
- Verify Google Maps API key is valid and has JavaScript API enabled
- Check browser console for JavaScript errors
- Ensure user has proper access permissions

**Data Not Syncing:**
- Verify Apify API token and actor ID are correct
- Check sync logs in admin interface for error details
- Test API connection using built-in testing tools

**Cron Not Running:**
- Verify WordPress cron is functioning (wp-cron.php accessible)
- Check cron status in Sync & Cron tab
- Consider using server-level cron for high-traffic sites

**SQLite Issues:**
- Plugin automatically falls back to WordPress transients
- Check admin notice for SQLite availability status
- Contact hosting provider to enable SQLite PDO extension for better performance

### Debug Mode
Enable WordPress debug mode for detailed logging:
```php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
```

## Changelog

### Version 1.2.1 (Current)
- **Enhanced**: Compact single-row location management interface
- **Improved**: Space-efficient admin design reducing vertical footprint by ~60%
- **Added**: Flexbox-based responsive layout for location settings
- **Enhanced**: Mobile-optimized location management with stacked field layout
- **Improved**: Shortened field labels for better space utilization
- **Added**: Dropdown mode selection replacing radio buttons
- **Enhanced**: Visual feedback and hover effects for better UX
- **Maintained**: Full backward compatibility with existing configurations

### Version 1.2.0
- **Added**: SQLite-based local caching system with WordPress transients fallback
- **Added**: Comprehensive cron job management
- **Added**: User preference storage and management
- **Added**: Advanced admin interface with tabbed settings
- **Added**: Real-time sync status and logging
- **Enhanced**: API integration with improved error handling
- **Enhanced**: Mobile-responsive design
- **Enhanced**: Security with proper nonce verification
- **Fixed**: Hosting compatibility issues with SQLite fallback

### Version 1.1.0
- **Added**: Top-level admin menu structure
- **Added**: Apify API integration
- **Added**: Dataset management interface
- **Enhanced**: Map visualization and filtering

### Version 1.0.0
- **Initial**: Basic Google Maps integration
- **Initial**: Radius-based filtering
- **Initial**: User access control

## Development & Customization

### Extending the Plugin

**Custom Data Sources:**
Modify the `fetch_apify_jobs()` method to integrate with different APIs or data sources.

**Additional Map Features:**
Extend the JavaScript map initialization to add custom controls or overlays.

**Custom User Interfaces:**
Create additional admin tabs by extending the `render_settings_page()` method.

**Admin Interface Customization:**
The new compact location row design can be further customized by modifying the CSS classes:
- `.location-row` - Main container for each location
- `.location-fields` - Flexbox container for form fields
- `.location-field` - Individual field containers

### Hooks & Filters

**Actions:**
- `usgrm_sync_apify_data` - Triggered during cron synchronization

**Filters:**
- Custom filters can be added for extending functionality

## File Structure

```
google-maps-radius/
├── google-maps-radius.php          # Main plugin file (2,305+ lines)
├── assets/
│   ├── js/
│   │   └── admin-locations.js      # Admin interface JavaScript (484 lines)
│   └── css/
│       └── admin.css               # Admin interface styles (450+ lines)
├── user-map-radius.css             # User-facing styles (102 lines)
├── README.md                       # This documentation
├── APIFY_INTEGRATION_GUIDE.md      # Apify setup guide
├── SQLITE_FALLBACK_GUIDE.md        # SQLite compatibility guide
└── .gitignore                      # Git ignore patterns
```

## Requirements

- **WordPress**: 5.0+
- **PHP**: 7.4+ (PDO SQLite extension optional but recommended)
- **APIs**: Apify.com account, Google Maps JavaScript API key with Places API
- **Browser Support**: Modern browsers with JavaScript enabled and CSS flexbox support

---

**License**: GPL-2.0-or-later  
**Author**: WordPress Development Team  
**Plugin URI**: [Repository URL]  
**Last Updated**: January 2025 