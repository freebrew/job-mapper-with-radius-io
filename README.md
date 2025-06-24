# Job Mapper With Radius In/Out

**WordPress plugin** that visualises job postings from an Apify dataset on a Google Map. Jobs are filtered to appear *inside* or *outside* a configurable radius from a set centre point, and visibility can be restricted to specific logged-in users.

## Key Features

- **Google Maps visualisation** – plots each job as an interactive marker and draws a radius circle.
- **Radius filtering** – toggle between showing jobs *inside* or *outside* the circle.
- **Apify integration** – fetches the latest run dataset from a specified Actor (API key required) with optional fallback URLs.
- **Transient caching** – dataset is cached for 10 minutes; manual refresh available in admin.
- **Admin UI**
  - Top-level menu **User Map Radius** with settings page.
  - Configure Apify API key, Actor ID, fallback URLs, centre latitude/longitude, radius (km/mi), inside/outside toggle, and allowed users list.
  - **Jobs Dataset** submenu uses WP_List_Table to list fetched jobs (title, company, type, salary, city, lat, lng, distance).
  - **Refresh Dataset** button clears cache instantly.
- **Smart defaults** – if allowed-users list is empty, any logged-in user may view the map.
- **Responsive map** – full-width, 800 px height container.
- **Security & Standards** – built following WP coding standards, utilises nonces, sanitisation & escaping, uses WordPress transients & hooks.

## Installation

1. Clone or download this repository into your `wp-content/plugins` directory.
2. Ensure the folder is named `google-maps-radius` (or similar).
3. Activate **Job Mapper With Radius In/Out** via *Plugins → Installed Plugins*.
4. Visit **User Map Radius → Settings** to enter your Apify credentials and map parameters.

## Usage

Add the shortcode `[user_map_radius]` anywhere in a post or page to display the map for authorised users.

## Changelog

### 1.1.0 – 2025-06-24
- Moved plugin settings to top-level **User Map Radius** menu.
- Added settings: Apify API key, Actor ID, centre lat/lng, radius, inside/outside toggle, allowed users.
- Implemented Jobs Dataset table with refresh button and 10-minute transient cache.
- Added fallback Run/API URLs with `{DATASET_ID}` placeholder support.
- Improved data retrieval: Accept header, NDJSON parsing.
- Enhanced map: info-window content, salary label, marker filtering logic re-enabled.
- Increased map height to 800 px, removed external marker icon.
- Allowed-users empty list now permits all logged-in users.
- Various bug fixes: mixed-content warnings, missing icon handling, robust error logging.

### 1.0.0 – Initial release
- Basic Google Map with job markers and radius filtering.

## Roadmap

- Gutenberg block for map embedding.
- Multiple radius circles / polygon support.
- Cron task to auto-refresh dataset.
- Pro add-ons for advanced analytics and custom marker icons.

---
© 2025 Job Mapper. Licensed under the GPL-2.0-or-later. 