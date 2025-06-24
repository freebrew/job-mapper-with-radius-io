# Job Mapper With Radius In/Out

A WordPress plugin that visualises job listings from an **Apify** actor on a Google Map. Jobs are plotted as coloured pins inside or outside a configurable radius around a chosen point.

Blue pins  ‑ **full-time**
Green pins ‑ **part-time**

## Features

* Plots jobs fetched from the latest successful run of any Apify actor (e.g. `dataset_indeed-jobs-scraper`).
* Top-level WordPress admin menu ("User Map Radius") with intuitive settings panel.
* Per-user visibility control – only selected user IDs can see the map.
* Inside/outside radius toggle and customisable radius size.
* Caching of Apify results for 10 minutes to minimise API calls.
* Strictly typed PHP 7.4+ code following WP coding standards.

## File Structure

```
job-mapper-with-radius-io/
├── google-maps-radius.php   # Main plugin file – all PHP logic lives here
├── user-map-radius.css      # (Optional) CSS overrides for map/layout
└── README.md                # You are here
```

> **Note:** Only `google-maps-radius.php` is required for the plugin to work. The CSS file is optional; create it to add custom styles.

## Quick Start

1. **Clone/fork** this repository and copy the folder into `wp-content/plugins/`.
2. Rename the folder if you wish (WordPress uses the folder name as the plugin slug).
3. Activate **Job Mapper With Radius In/Out** from the WP admin Plugins page.
4. Open **User Map Radius → Settings** in the sidebar and fill in:
   * **Apify API Key** – found in your Apify console.
   * **Apify Actor ID** – e.g. `TrtlecxAsNRbKl1na`.
   * **Google Maps API Key** – edit line `wp_enqueue_script('google-maps-api', ...)` in `google-maps-radius.php`.
   * **Centre Lat/Lng** – coordinates of the circle centre.
   * **Radius (m)** – radius in metres.
   * **Filter Mode** – show jobs *inside* or *outside* the circle.
   * **Allowed Users** – multi-select list of WP users permitted to view the map.
5. Add `[user_map_radius]` to any post/page. Only allowed users will see the map.

## How It Works

```
Apify Actor ─► Latest Run ─► Default Dataset ─► JSON Items ─► Plugin
                                                          │
                           Haversine distance calculation ◄┘
                                       │
                WordPress transient cache (10 minutes)
                                       │
    Google Maps JS API renders pins + circle on the front-end
```

### Key Functions (in `google-maps-radius.php`)

| Function | Purpose |
|----------|---------|
| `enqueue_scripts()` | Loads Google Maps JS & optional CSS. |
| `print_inline_js()` | Passes PHP data to JS and initialises map with pins. |
| `fetch_apify_jobs()` | Calls Apify REST API for the latest run + dataset. |
| `get_filtered_jobs()` | Filters dataset by distance and formats marker data. |
| `haversine()` | Returns distance in metres between two lat/lng pairs. |
| Settings API callbacks | `sanitize_user_ids()`, `sanitize_general_settings()` |

## Customisation Tips

* Change pin colours by editing the hex values in `print_inline_js()`.
* Override default map zoom or styles by tweaking the `google.maps.Map` options.
* Add more job fields to the info window by adjusting `$info_parts` in `get_filtered_jobs()`.
* To support multiple actors, extend the settings array and loops accordingly.

## Development & Contribution

1. Create a feature branch: `git checkout -b feature/my-change`.
2. Make your edits following WP coding standards (`phpcs --standard=WordPress`).
3. Commit with descriptive messages; open a PR to `main`.
4. Ensure no sensitive keys are committed; use environment variables or placeholders.

### Debugging

* Enable WordPress debugging in `wp-config.php` (`WP_DEBUG`, `WP_DEBUG_LOG`).
* View cached dataset via `wp transient get usgrm_jobs_{hash}`.
* Clear the cache by deleting the transient or waiting 10 minutes.

## Security

* All external data is sanitised/escaped before output.
* API keys are stored in the WP options table, not hard-coded.
* Nonces are not required because settings use the WP Settings API.

## License

[MIT](LICENSE) – Feel free to fork, modify and share. Pull requests welcome!
