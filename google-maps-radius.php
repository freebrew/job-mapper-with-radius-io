<?php
/*
Plugin Name: Job Mapper With Radius In/Out
Description: Displays a Google Map with a km radius circle at given coordinates either inside or outside the boundry, visible only to assigned registered users.
Version: 1.2.0
Author: WordPress Development Team
*/

defined('ABSPATH') or die('No script kiddies please!');

class User_Specific_Map_Radius {

    private $allowed_users_option = 'usgrm_allowed_users';
    private $general_settings_option = 'usgrm_general_settings'; // stores API key, actor ID, map config
    private $user_preferences_option = 'usgrm_user_preferences'; // stores user-specific preferences
    private $db_path;
    private $pdo;

    public function __construct() {
        // Initialize database path only if SQLite is available
        if (extension_loaded('pdo_sqlite')) {
            $upload_dir = wp_upload_dir();
            $this->db_path = $upload_dir['basedir'] . '/usgrm_cache.db';
        }
        
        // WordPress hooks
        add_shortcode('user_map_radius', [$this, 'render_map_shortcode']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_scripts']);
        add_action('wp_footer', [$this, 'print_inline_js']); // print JS after scripts loaded
        
        // AJAX hooks
        add_action('wp_ajax_usgrm_test_apify_connection', [$this, 'ajax_test_apify_connection']);
        add_action('wp_ajax_usgrm_manual_sync', [$this, 'ajax_manual_sync']);
        add_action('wp_ajax_usgrm_save_cron_settings', [$this, 'ajax_save_cron_settings']);
        add_action('wp_ajax_usgrm_get_cron_status', [$this, 'ajax_get_cron_status']);
        add_action('wp_ajax_usgrm_get_sync_log', [$this, 'ajax_get_sync_log']);
        add_action('wp_ajax_usgrm_ignore_job', [$this, 'ajax_ignore_job']);
        add_action('wp_ajax_usgrm_save_location_preference', [$this, 'ajax_save_location_preference']);
        add_action('wp_ajax_usgrm_get_user_preferences', [$this, 'ajax_get_user_preferences']);
        
        // Cron hooks
        add_action('usgrm_sync_apify_data', [$this, 'sync_apify_data']);
        
        // Plugin activation/deactivation
        register_activation_hook(__FILE__, [$this, 'activate_plugin']);
        register_deactivation_hook(__FILE__, [$this, 'deactivate_plugin']);
        
        // Initialize database
        $this->init_database();
        
        // Setup cron if not already scheduled
        $this->setup_cron();
    }

    /**
     * Plugin activation hook
     */
    public function activate_plugin() {
        $this->init_database();
        $this->setup_cron();
        $this->migrate_old_settings();
    }

    /**
     * Plugin deactivation hook
     */
    public function deactivate_plugin() {
        $this->clear_cron();
    }

    /**
     * Initialize SQLite database
     */
    private function init_database() {
        // Check if SQLite PDO driver is available
        if (!extension_loaded('pdo_sqlite')) {
            error_log('USGRM: SQLite PDO driver not available, using WordPress transients for caching');
            $this->pdo = null;
            return;
        }
        
        try {
            $this->pdo = new PDO('sqlite:' . $this->db_path);
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            
            // Create tables
            $this->create_tables();
        } catch (PDOException $e) {
            error_log('USGRM Database Error: ' . $e->getMessage());
            $this->pdo = null;
        }
    }

    /**
     * Create database tables
     */
    private function create_tables() {
        $sql_cache = "CREATE TABLE IF NOT EXISTS apify_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id TEXT UNIQUE,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            user_session TEXT
        )";
        
        $sql_log = "CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT,
            status TEXT,
            message TEXT,
            items_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )";
        
        $this->pdo->exec($sql_cache);
        $this->pdo->exec($sql_log);
    }

    /**
     * Migrate old settings to new structure
     */
    private function migrate_old_settings() {
        $old_settings = get_option($this->general_settings_option, []);
        
        // Check if migration is needed
        if (!isset($old_settings['migrated_to_v12'])) {
            $new_settings = [
                'apify_token' => '',
                'apify_actor' => 'compass~crawler-google-places',
                'google_maps_key' => '',
                'locations' => [],
                'default_geolocation' => false,
                'cron_frequency' => 'hourly',
                'cache_hours' => 24,
                'migrated_to_v12' => true
            ];
            
            // Migrate existing single location if present
            if (isset($old_settings['center_lat'], $old_settings['center_lng'])) {
                $new_settings['locations'][] = [
                    'address' => 'Migrated Location',
                    'lat' => $old_settings['center_lat'],
                    'lng' => $old_settings['center_lng'],
                    'radius' => $old_settings['radius'] ?? 5000,
                    'mode' => $old_settings['inside_outside'] ?? 'inside'
                ];
            }
            
            // Preserve any existing API URLs for backward compatibility
            if (isset($old_settings['run_api_url'])) {
                $new_settings['run_api_url'] = $old_settings['run_api_url'];
            }
            if (isset($old_settings['dataset_api_url'])) {
                $new_settings['dataset_api_url'] = $old_settings['dataset_api_url'];
            }
            
            update_option($this->general_settings_option, $new_settings);
        }
    }

    /**
     * Setup WordPress cron
     */
    private function setup_cron() {
        if (!wp_next_scheduled('usgrm_sync_apify_data')) {
            $settings = get_option($this->general_settings_option, []);
            $frequency = $settings['cron_frequency'] ?? 'hourly';
            wp_schedule_event(time(), $frequency, 'usgrm_sync_apify_data');
        }
    }

    /**
     * Clear WordPress cron
     */
    private function clear_cron() {
        $timestamp = wp_next_scheduled('usgrm_sync_apify_data');
        if ($timestamp) {
            wp_unschedule_event($timestamp, 'usgrm_sync_apify_data');
        }
    }

    public function enqueue_scripts() {
        if (is_user_logged_in() && $this->current_user_allowed()) {
            // Enqueue Google Maps JS without callback param
            $settings = get_option($this->general_settings_option, []);
            $google_maps_key = $settings['google_maps_key'] ?? '';
            if ($google_maps_key) {
                wp_enqueue_script('google-maps-api', 'https://maps.googleapis.com/maps/api/js?key=' . $google_maps_key, [], null, true);
            }
            wp_enqueue_style('user-map-radius-css', plugin_dir_url(__FILE__) . 'user-map-radius.css');
        }
    }

    /**
     * Enqueue admin scripts and styles
     */
    public function enqueue_admin_scripts($hook) {
        if (strpos($hook, 'user-map-radius') === false) {
            return;
        }
        
        $settings = get_option($this->general_settings_option, []);
        $google_maps_key = $settings['google_maps_key'] ?? '';
        
        // Enqueue Google Maps API with Places library for admin
        if ($google_maps_key) {
            wp_enqueue_script('google-maps-places', 'https://maps.googleapis.com/maps/api/js?key=' . $google_maps_key . '&libraries=places&callback=initAdminGooglePlaces', [], null, true);
        }
        
        // Enqueue admin JavaScript
        wp_enqueue_script('usgrm-admin-js', plugin_dir_url(__FILE__) . 'assets/js/admin-locations.js', ['jquery'], '1.2.0', true);
        
        // Localize script with AJAX data
        wp_localize_script('usgrm-admin-js', 'usgrm_admin', [
            'nonce' => wp_create_nonce('usgrm_admin_nonce'),
            'ajax_url' => admin_url('admin-ajax.php')
        ]);
        
        // Enqueue admin styles
        wp_enqueue_style('usgrm-admin-css', plugin_dir_url(__FILE__) . 'assets/css/admin.css', [], '1.2.0');
    }

    // This will output userMapData after scripts so it's available in JS
    public function print_inline_js() {
        if (!is_user_logged_in() || !$this->current_user_allowed()) {
            return;
        }

        $settings = get_option($this->general_settings_option, []);
        $locations = $settings['locations'] ?? [];
        
        // Fallback to old single location format for backward compatibility
        if (empty($locations) && isset($settings['center_lat'], $settings['center_lng'])) {
            $locations = [[
                'lat' => floatval($settings['center_lat']),
                'lng' => floatval($settings['center_lng']),
                'radius' => intval($settings['radius'] ?? 5000),
                'mode' => $settings['inside_outside'] ?? 'inside'
            ]];
        }
        
        // Get user preferences
        $user_id = get_current_user_id();
        $user_preferences = get_option($this->user_preferences_option, []);
        $user_prefs = $user_preferences[$user_id] ?? [];
        
        // Determine initial center point
        $default_center = ['lat' => 0, 'lng' => 0];
        if (!empty($user_prefs['last_location'])) {
            $default_center = $user_prefs['last_location'];
        } elseif (!empty($locations)) {
            $default_center = ['lat' => $locations[0]['lat'], 'lng' => $locations[0]['lng']];
        }

        $markers = $this->get_filtered_jobs();

        $data = [
            'locations' => $locations,
            'center' => $default_center,
            'markers' => $markers,
            'user_prefs' => $user_prefs,
            'geolocation_enabled' => $settings['default_geolocation'] ?? false,
            'nonce' => wp_create_nonce('usgrm_admin_nonce')
        ];

        echo '<script>window.userMapData = ' . wp_json_encode($data) . ";</script>\n";

        echo "<script>
            function initUserMapRadius() {
                if (!window.userMapData) {
                    console.error('User map data not available');
                    return;
                }
                
                var center = window.userMapData.center || { lat: 0, lng: 0 };
                var map = new google.maps.Map(document.getElementById('usgrm-map'), {
                    zoom: window.userMapData.user_prefs.preferred_zoom || 11,
                    center: center,
                });

                // Draw radius circles for each location
                if (window.userMapData.locations && window.userMapData.locations.length > 0) {
                    console.log('Drawing circles for locations:', window.userMapData.locations);
                    window.userMapData.locations.forEach(function(location, index) {
                        console.log('Circle ' + index + ': center=(' + location.lat + ',' + location.lng + '), radius=' + location.radius + 'm, mode=' + location.mode);
                        new google.maps.Circle({
                            strokeColor: location.mode === 'outside' ? '#FF6600' : '#FF0000',
                            strokeOpacity: 0.8,
                            strokeWeight: 2,
                            fillColor: location.mode === 'outside' ? '#FF6600' : '#FF0000',
                            fillOpacity: 0.15,
                            map: map,
                            center: { lat: location.lat, lng: location.lng },
                            radius: location.radius,
                        });
                    });
                }

                var ignoredJobs = JSON.parse(localStorage.getItem('usgrm_ignored') || '[]');

                var markerMap = {};
                var infoMap = {};

                function renderSidePanel() {
                    var ignored = JSON.parse(localStorage.getItem('usgrm_ignored') || '[]');
                    var list = window.userMapData.markers.filter(function(m){ return !ignored.includes(m.id) && m.salary_val; });
                    list.sort(function(a,b){ return b.salary_val - a.salary_val; });
                    var top = list.slice(0,10);
                    var html = '<h3>Top 10 Highest Hourly</h3><ol style=\"margin-left:18px\">';
                    top.forEach(function(m){
                        html += '<li data-job=\"'+m.id+'\"><strong>'+m.salary_val+'</strong> – '+m.title+'</li>';
                    });
                    html += '</ol>';
                    document.getElementById('usgrm-sidepanel').innerHTML = html;

                    // click handler to open info window
                    document.querySelectorAll('#usgrm-sidepanel li').forEach(function(li){
                        li.addEventListener('click', function(){
                            var id = li.getAttribute('data-job');
                            if (markerMap[id] && infoMap[id]) {
                                infoMap[id].open(map, markerMap[id]);
                            }
                        });
                    });
                }

                window.userMapData.markers.forEach(function(marker) {
                    if (ignoredJobs.includes(marker.id)) return; // skip ignored

                    // Create marker with appropriate color based on marker.color
                    var markerIcon = null;
                    if (marker.color === 'green') {
                        markerIcon = 'http://maps.google.com/mapfiles/ms/icons/green-dot.png';
                    } else if (marker.color === 'blue') {
                        markerIcon = 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png';
                    } else {
                        markerIcon = 'http://maps.google.com/mapfiles/ms/icons/red-dot.png';
                    }
                    
                    var gmMarker = new google.maps.Marker({
                        position: { lat: marker.lat, lng: marker.lng },
                        map: map,
                        title: marker.title,
                        icon: markerIcon
                    });

                    markerMap[marker.id] = gmMarker;
                    infoMap[marker.id]   = new google.maps.InfoWindow({ content: marker.info });

                    if (marker.info) {
                        gmMarker.addListener('click', function() {
                            infoMap[marker.id].open(map, gmMarker);
                            renderSidePanel();
                        });

                        // Attach ignore handling once the DOM for the info window is ready
                        google.maps.event.addListener(infoMap[marker.id], 'domready', function() {
                            var links = document.querySelectorAll('.usgrm-ignore[data-job=\"' + marker.id + '\"]');
                            links.forEach(function(link) {
                                link.addEventListener('click', function(ev) {
                                    ev.preventDefault();
                                    var list = JSON.parse(localStorage.getItem('usgrm_ignored') || '[]');
                                    if (!list.includes(marker.id)) {
                                        list.push(marker.id);
                                        localStorage.setItem('usgrm_ignored', JSON.stringify(list));
                                    }
                                    if (markerMap[marker.id]) {
                                        markerMap[marker.id].setMap(null);
                                    }
                                    infoMap[marker.id].close();
                                    renderSidePanel();
                                });
                            });
                        });
                    }
                });

                renderSidePanel();

                // Save user location preference when map is moved
                map.addListener('center_changed', function() {
                    var center = map.getCenter();
                    var zoom = map.getZoom();
                    
                    // Debounce the save operation
                    clearTimeout(window.saveLocationTimeout);
                    window.saveLocationTimeout = setTimeout(function() {
                        if (window.userMapData.nonce) {
                            jQuery.post(ajaxurl || '/wp-admin/admin-ajax.php', {
                                action: 'usgrm_save_location_preference',
                                nonce: window.userMapData.nonce,
                                lat: center.lat(),
                                lng: center.lng(),
                                zoom: zoom
                            });
                        }
                    }, 2000);
                });

                // Handle geolocation if enabled
                if (window.userMapData.geolocation_enabled && navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(function(position) {
                        var userLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };
                        
                        // Add user location marker
                        new google.maps.Marker({
                            position: userLocation,
                            map: map,
                            title: 'Your Location',
                            icon: {
                                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                                    '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 20 20\"><circle cx=\"10\" cy=\"10\" r=\"8\" fill=\"#4285F4\" stroke=\"white\" stroke-width=\"2\"/></svg>'
                                ),
                                scaledSize: new google.maps.Size(20, 20)
                            }
                        });
                        
                        // Center map on user location if no preference saved
                        if (!window.userMapData.user_prefs.last_location || 
                            (window.userMapData.user_prefs.last_location.lat === 0 && 
                             window.userMapData.user_prefs.last_location.lng === 0)) {
                            map.setCenter(userLocation);
                        }
                    });
                }

                // Detect mobile via user-agent and add class for styling
                var wrap = document.querySelector('.usgrm-wrapper');
                if (wrap && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    wrap.classList.add('mobile');

                    // create toggle button
                    var btn = document.createElement('button');
                    btn.className='usgrm-toggle-btn';
                    btn.textContent='Top 10';
                    btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:1000;padding:8px 12px;background:#0073aa;color:white;border:none;border-radius:4px;';
                    document.body.appendChild(btn);

                    btn.addEventListener('click',function(){
                        wrap.classList.toggle('panel-open');
                    });

                    // add close X inside panel
                    var close=document.createElement('a');
                    close.href='#'; close.className='close'; close.innerHTML='&times;';
                    close.style.cssText = 'position:absolute;top:5px;right:10px;font-size:20px;text-decoration:none;color:#666;';
                    document.getElementById('usgrm-sidepanel').prepend(close);
                    close.addEventListener('click',function(e){
                        e.preventDefault(); wrap.classList.remove('panel-open');
                    });
                }
            }
            // Wait for Google Maps API script to load before init
            function waitForGMaps() {
                if (typeof google !== 'undefined' && google.maps && typeof google.maps.Map === 'function') {
                    initUserMapRadius();
                } else {
                    setTimeout(waitForGMaps, 100);
                }
            }
            waitForGMaps();
        </script>";
    }

    public function current_user_allowed() {
        $allowed_users = get_option($this->allowed_users_option, []);
        // If no users explicitly selected, allow all logged-in users
        if (empty($allowed_users)) {
            return true;
        }
        $allowed_users = array_map('intval', $allowed_users);
        $current_user_id = get_current_user_id();
        return in_array($current_user_id, $allowed_users, true);
    }

    /**
     * Convert actor identifier to API URL format
     * Converts username/actorname to username~actorname for API URLs
     */
    private function format_actor_for_api($actor_id) {
        // If it contains a slash, convert to tilde format for API
        if (strpos($actor_id, '/') !== false) {
            return str_replace('/', '~', $actor_id);
        }
        // Otherwise return as-is (already in correct format or is an actor ID)
        return $actor_id;
    }

    public function sync_apify_data() {
        $settings = get_option($this->general_settings_option, []);
        $apify_token = $settings['apify_token'] ?? '';
        $apify_actor = $settings['apify_actor'] ?? '';
        
        if (empty($apify_token) || empty($apify_actor)) {
            $this->log_sync('manual', 'error', 'Missing API token or actor ID', 0);
            return ['success' => false, 'message' => 'Missing API configuration'];
        }
        
        // Format actor ID for API URL
        $actor_api_format = $this->format_actor_for_api($apify_actor);
        
        try {
            // Use the direct endpoint to get the latest dataset items
            $dataset_url = "https://api.apify.com/v2/acts/{$actor_api_format}/runs/last/dataset/items?token={$apify_token}&clean=1";
            $dataset_response = wp_remote_get($dataset_url, [
                'timeout' => 30,
                'headers' => ['Accept' => 'application/json']
            ]);
            
            if (is_wp_error($dataset_response)) {
                $this->log_sync('manual', 'error', 'Failed to fetch dataset: ' . $dataset_response->get_error_message(), 0);
                return ['success' => false, 'message' => 'Failed to fetch dataset: ' . $dataset_response->get_error_message()];
            }
            
            $response_code = wp_remote_retrieve_response_code($dataset_response);
            if ($response_code === 404) {
                $this->log_sync('manual', 'error', 'Actor not found or no runs available. Please check the actor ID: ' . $apify_actor, 0);
                return ['success' => false, 'message' => 'Actor not found or no runs available. Please check the actor ID: ' . $apify_actor];
            }
            
            $body_raw = wp_remote_retrieve_body($dataset_response);
            $items = json_decode($body_raw, true);
            
            // If JSON decode fails, try NDJSON format
            if (!is_array($items)) {
                $items = [];
                $lines = preg_split('/\r?\n/', trim($body_raw));
                foreach ($lines as $line) {
                    if ($line === '') continue;
                    $row = json_decode($line, true);
                    if (is_array($row)) {
                        $items[] = $row;
                    }
                }
            }
            
            if (empty($items)) {
                $this->log_sync('manual', 'error', 'Dataset is empty or no data returned', 0);
                return ['success' => false, 'message' => 'Dataset is empty or no data returned. Please ensure the actor has been run and contains data.'];
            }
            
            // Clear old cache and store new data
            $this->clear_all_cache();
            
            // Use a generic dataset ID since we're getting the latest
            $dataset_id = 'latest_' . md5($actor_api_format);
            $this->cache_dataset($dataset_id, $items);
            
            $this->log_sync('manual', 'success', 'Dataset fetched successfully', count($items));
            return ['success' => true, 'message' => 'Successfully fetched ' . count($items) . ' items from dataset'];
            
        } catch (Exception $e) {
            $this->log_sync('manual', 'error', 'Sync failed: ' . $e->getMessage(), 0);
            return ['success' => false, 'message' => 'Sync failed: ' . $e->getMessage()];
        }
    }

    /**
     * Fetch latest dataset items from cache or API
     *
     * @return array
     */
    private function fetch_apify_jobs() {
        // Try to get from cache first
        $cached_data = $this->get_cached_dataset();
        if (!empty($cached_data)) {
            return $cached_data;
        }
        
        // Fallback to old API method for backward compatibility
        $settings = get_option($this->general_settings_option, []);
        $run_api_url = $settings['run_api_url'] ?? '';
        
        // If old-style run_api_url is configured, use the legacy method
        if (!empty($run_api_url)) {
            return $this->fetch_apify_jobs_legacy($settings, $run_api_url);
        }
        
        // Use actor dataset method
        $apify_token = $settings['apify_token'] ?? '';
        $apify_actor = $settings['apify_actor'] ?? '';
        
        if (empty($apify_token) || empty($apify_actor)) {
            return [];
        }
        
        // Format actor ID for API URL
        $actor_api_format = $this->format_actor_for_api($apify_actor);
        
        try {
            // Use the direct endpoint to get the latest dataset items
            $dataset_url = "https://api.apify.com/v2/acts/{$actor_api_format}/runs/last/dataset/items?token={$apify_token}&clean=1";
            $dataset_response = wp_remote_get($dataset_url, [
                'timeout' => 30,
                'headers' => ['Accept' => 'application/json']
            ]);
            
            if (is_wp_error($dataset_response)) {
                error_log('USGRM Dataset Fetch Error: ' . $dataset_response->get_error_message());
                return [];
            }
            
            $body_raw = wp_remote_retrieve_body($dataset_response);
            $items = json_decode($body_raw, true);
            
            if (!is_array($items)) {
                // Try NDJSON format
                $items = [];
                $lines = preg_split('/\r?\n/', trim($body_raw));
                foreach ($lines as $line) {
                    if ($line === '') continue;
                    $row = json_decode($line, true);
                    if (is_array($row)) {
                        $items[] = $row;
                    }
                }
            }
            
            if (!empty($items)) {
                // Cache the results using a generic dataset ID
                $dataset_id = 'latest_' . md5($actor_api_format);
                $this->cache_dataset($dataset_id, $items);
            }
            
            return $items;
            
        } catch (Exception $e) {
            error_log('USGRM Fetch Error: ' . $e->getMessage());
            // Return empty array but log the specific error
            $this->log_sync('fetch', 'error', 'Exception during fetch: ' . $e->getMessage(), 0);
            return [];
        }
    }
    
    /**
     * Legacy method for fetching jobs using old run_api_url approach
     */
    private function fetch_apify_jobs_legacy($settings, $run_api_url) {
        // Always query the run endpoint to discover the dataset ID (each run creates a new dataset)
        $run_res = wp_remote_get($run_api_url, ['timeout' => 15]);
        if (is_wp_error($run_res)) {
            return [];
        }
        $run_body = json_decode(wp_remote_retrieve_body($run_res), true);
        $dataset_id = $run_body['data']['defaultDatasetId'] ?? '';
        if (!$dataset_id) {
            return [];
        }

        // Cache keyed by dataset ID so a new run busts the cache automatically
        $cache_key = 'usgrm_jobs_' . md5($dataset_id);
        if (($cached = get_transient($cache_key)) !== false) {
            return $cached;
        }

        // Build dataset URL
        $dataset_api_tpl = $settings['dataset_api_url'] ?? '';
        $dataset_url = $dataset_api_tpl ? str_replace('{DATASET_ID}', rawurlencode($dataset_id), $dataset_api_tpl) : sprintf('https://api.apify.com/v2/datasets/%s/items?clean=1', rawurlencode($dataset_id));

        $dataset_res = wp_remote_get($dataset_url, [
            'timeout' => 20,
            'headers' => [
                'Accept' => 'application/json',
            ],
        ]);
        if (is_wp_error($dataset_res)) {
            return [];
        }

        $body_raw = wp_remote_retrieve_body($dataset_res);

        // Attempt to decode as regular JSON array first
        $items = json_decode($body_raw, true);
        if (!is_array($items)) {
            // Fallback for NDJSON format – split by lines and decode each
            $items   = [];
            $lines = preg_split('/\r?\n/', trim($body_raw));
            foreach ($lines as $line) {
                if ($line === '') {
                    continue;
                }
                $row = json_decode($line, true);
                if (is_array($row)) {
                    $items[] = $row;
                }
            }
        }

        if (empty($items)) {
            return [];
        }

        // Cache for 10 minutes
        set_transient($cache_key, $items, 10 * MINUTE_IN_SECONDS);

        return $items;
    }

    /**
     * Check if dataset is already cached
     */
    private function is_dataset_cached($dataset_id) {
        if (!$this->pdo) {
            // Fallback to WordPress transients
            $cache_key = 'usgrm_dataset_' . md5($dataset_id);
            return get_transient($cache_key) !== false;
        }
        
        try {
            $stmt = $this->pdo->prepare("SELECT expires_at FROM apify_cache WHERE dataset_id = ?");
            $stmt->execute([$dataset_id]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($result && strtotime($result['expires_at']) > time()) {
                return true;
            }
        } catch (PDOException $e) {
            error_log('USGRM Cache Check Error: ' . $e->getMessage());
        }
        
        return false;
    }

    /**
     * Cache dataset in SQLite or WordPress transients
     */
    private function cache_dataset($dataset_id, $data) {
        if (!$this->pdo) {
            // Fallback to WordPress transients
            $settings = get_option($this->general_settings_option, []);
            $cache_hours = $settings['cache_hours'] ?? 24;
            $cache_key = 'usgrm_dataset_' . md5($dataset_id);
            set_transient($cache_key, $data, $cache_hours * HOUR_IN_SECONDS);
            return;
        }
        
        try {
            $settings = get_option($this->general_settings_option, []);
            $cache_hours = $settings['cache_hours'] ?? 24;
            $expires_at = date('Y-m-d H:i:s', time() + ($cache_hours * 3600));
            
            $stmt = $this->pdo->prepare("INSERT OR REPLACE INTO apify_cache (dataset_id, data, expires_at) VALUES (?, ?, ?)");
            $stmt->execute([$dataset_id, json_encode($data), $expires_at]);
        } catch (PDOException $e) {
            error_log('USGRM Cache Store Error: ' . $e->getMessage());
        }
    }

    /**
     * Get cached dataset
     */
    private function get_cached_dataset() {
        if (!$this->pdo) {
            // Fallback to WordPress transients - get the most recent one
            global $wpdb;
            $option_names = $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '_transient_usgrm_dataset_%' ORDER BY option_id DESC LIMIT 1");
            
            if (!empty($option_names)) {
                $cache_key = str_replace('_transient_', '', $option_names[0]);
                $cached_data = get_transient($cache_key);
                if ($cached_data !== false) {
                    return $cached_data;
                }
            }
            
            return [];
        }
        
        try {
            $stmt = $this->pdo->prepare("SELECT data FROM apify_cache WHERE expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1");
            $stmt->execute();
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($result) {
                return json_decode($result['data'], true);
            }
        } catch (PDOException $e) {
            error_log('USGRM Cache Retrieve Error: ' . $e->getMessage());
        }
        
        return [];
    }

    /**
     * Clear all cached data (both SQLite and WordPress transients)
     */
    private function clear_all_cache() {
        if (!$this->pdo) {
            // Clear WordPress transients
            global $wpdb;
            
            // Count existing transients before clearing
            $count_before = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '_transient_usgrm_dataset_%'");
            
            // Delete all usgrm dataset transients
            $deleted = $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_usgrm_dataset_%' OR option_name LIKE '_transient_timeout_usgrm_dataset_%'");
            
            // Also clear legacy cache keys for backward compatibility
            $settings = get_option($this->general_settings_option, []);
            if (!empty($settings['apify_actor'])) {
                $legacy_key = 'usgrm_jobs_' . md5(str_replace('/', '~', $settings['apify_actor']));
                delete_transient($legacy_key);
            }
            if (!empty($settings['run_api_url'])) {
                $legacy_key = 'usgrm_jobs_' . md5($settings['run_api_url']);
                delete_transient($legacy_key);
            }
        } else {
            // Clear SQLite cache
            try {
                $this->pdo->exec("DELETE FROM apify_cache");
            } catch (PDOException $e) {
                error_log('USGRM Cache Clear Error: ' . $e->getMessage());
            }
        }
    }

    /**
     * Log sync activity
     */
    private function log_sync($type, $status, $message, $items_count) {
        if (!$this->pdo) {
            // Fallback to WordPress options for logging
            $log_entry = [
                'type' => $type,
                'status' => $status,
                'message' => $message,
                'items_count' => $items_count,
                'timestamp' => current_time('mysql')
            ];
            
            $existing_logs = get_option('usgrm_sync_logs', []);
            array_unshift($existing_logs, $log_entry);
            
            // Keep only last 50 log entries
            $existing_logs = array_slice($existing_logs, 0, 50);
            update_option('usgrm_sync_logs', $existing_logs);
            return;
        }
        
        try {
            $stmt = $this->pdo->prepare("INSERT INTO sync_log (sync_type, status, message, items_count) VALUES (?, ?, ?, ?)");
            $stmt->execute([$type, $status, $message, $items_count]);
        } catch (PDOException $e) {
            error_log('USGRM Log Error: ' . $e->getMessage());
        }
    }

    /**
     * Return jobs filtered by radius condition and user preferences.
     *
     * @return array
     */
    private function get_filtered_jobs() {
        $settings = get_option($this->general_settings_option, []);
        $locations = $settings['locations'] ?? [];
        
        // Fallback to old single location format for backward compatibility
        if (empty($locations) && isset($settings['center_lat'], $settings['center_lng'])) {
            $locations = [[
                'lat' => floatval($settings['center_lat']),
                'lng' => floatval($settings['center_lng']),
                'radius' => intval($settings['radius'] ?? 5000),
                'mode' => $settings['inside_outside'] ?? 'inside'
            ]];
        }
        
        if (empty($locations)) {
            return [];
        }

        // Get user preferences for ignored jobs
        $user_id = get_current_user_id();
        $user_preferences = get_option($this->user_preferences_option, []);
        $ignored_jobs = $user_preferences[$user_id]['ignored_jobs'] ?? [];

        // Fetch data
        $jobs_raw = $this->fetch_apify_jobs();
        if (empty($jobs_raw)) {
            return [];
        }

        // First pass: Extract all jobs with salary data and find the single newest job
        $jobs_with_salary = [];
        $newest_job_candidate = null;
        $newest_timestamp = 0;
        
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            
            // Skip ignored jobs
            $job_id = $job['key'] ?? '';
            if (in_array($job_id, $ignored_jobs)) {
                continue;
            }
            
            // Extract salary value for sorting
            $salary_value = 0;
            if (isset($job['baseSalary']) && is_array($job['baseSalary'])) {
                $bs = $job['baseSalary'];
                if (isset($bs['max']) && $bs['max'] !== '') {
                    $salary_value = floatval($bs['max']);
                } elseif (isset($bs['min']) && $bs['min'] !== '') {
                    $salary_value = floatval($bs['min']);
                }
            }
            
            if ($salary_value > 0) {
                $jobs_with_salary[] = [
                    'job' => $job,
                    'salary_value' => $salary_value
                ];
            }
            
            // Find the single newest job by date (down to the minute precision)
            $published_ts = 0;
            if (!empty($job['datePublished'])) {
                $published_ts = strtotime($job['datePublished']);
            } elseif (!empty($job['dateOnIndeed'])) {
                $published_ts = strtotime($job['dateOnIndeed']);
            }
            
            if ($published_ts > 0) {
                // Round down to minute precision for comparison
                $published_minute = floor($published_ts / 60) * 60;
                $current_newest_minute = floor($newest_timestamp / 60) * 60;
                
                // If this job is newer by minute, or same minute but newer by second, update newest
                if ($published_minute > $current_newest_minute || 
                    ($published_minute === $current_newest_minute && $published_ts > $newest_timestamp)) {
                    $newest_timestamp = $published_ts;
                    $newest_job_candidate = $job;
                }
            }
        }
        
        // Sort by salary descending and get top 10 highest paid
        usort($jobs_with_salary, function($a, $b) {
            return $b['salary_value'] <=> $a['salary_value'];
        });
        
        $top_paid_job_ids = [];
        $top_10_paid = array_slice($jobs_with_salary, 0, 10);
        foreach ($top_10_paid as $job_data) {
            $top_paid_job_ids[] = $job_data['job']['key'] ?? '';
        }
        
        // Get the single newest job ID (will be checked against location criteria)
        $newest_job_id = $newest_job_candidate ? ($newest_job_candidate['key'] ?? '') : '';
        
        // Debug logging for newest job identification
        if ($newest_job_candidate) {
            error_log("USGRM DEBUG: Found newest job candidate: " . ($newest_job_candidate['title'] ?? 'No title') . " (ID: $newest_job_id) published: " . date('Y-m-d H:i:s', $newest_timestamp));
        } else {
            error_log("USGRM DEBUG: No newest job candidate found - no jobs have valid dates");
        }

        $filtered = [];
        $total_jobs = 0;
        
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            
            // Skip ignored jobs
            $job_id = $job['key'] ?? '';
            if (in_array($job_id, $ignored_jobs)) {
                continue;
            }
            
            $total_jobs++;
            $lat = floatval($job['location']['latitude']);
            $lng = floatval($job['location']['longitude']);
            
            // Check if this is a top paid job (green marker, bypasses location) or the single newest job (blue marker, must match location)
            $is_top_paid = in_array($job_id, $top_paid_job_ids);
            $is_newest = ($job_id === $newest_job_id && $newest_job_id !== '');
            
            // Debug logging for newest job processing
            if ($is_newest) {
                error_log("USGRM DEBUG: Processing newest job: " . ($job['title'] ?? 'No title') . " (ID: $job_id)");
            }
            
            // For all jobs except top paid and newest, check if job matches ALL location criteria (AND logic)
            // TEMPORARY: Let newest job bypass location filtering to test
            $matches_all_locations = true;
            if (!$is_top_paid && !$is_newest) {
                foreach ($locations as $location) {
                    $center_lat = floatval($location['lat'] ?? 0);
                    $center_lng = floatval($location['lng'] ?? 0);
                    $radius_m = intval($location['radius'] ?? 5000);
                    $mode = $location['mode'] ?? 'inside';
                    
                    $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);
                    $is_inside = ($distance <= $radius_m);
                    
                    // Check if this job satisfies THIS location's criteria
                    $satisfies_this_location = false;
                    if ($mode === 'inside' && $is_inside) {
                        $satisfies_this_location = true;
                    } elseif ($mode === 'outside' && !$is_inside) {
                        $satisfies_this_location = true;
                    }
                    
                    // If job doesn't satisfy this location's criteria, it fails overall
                    if (!$satisfies_this_location) {
                        $matches_all_locations = false;
                        break; // No need to check other locations
                    }
                }
                
                if (!$matches_all_locations) {
                    // Debug logging for newest job that fails location criteria
                    if ($is_newest) {
                        error_log("USGRM DEBUG: Newest job FAILED location criteria - skipping");
                    }
                    continue; // skip this job
                }
            }
            
            // Build salary label (e.g., "59 - 60 CAD / hr")
            $salary_label = '';
            if (isset($job['baseSalary']) && is_array($job['baseSalary'])) {
                $bs = $job['baseSalary'];
                $range = [];
                if (isset($bs['min']) && $bs['min'] !== '') {
                    $range[] = $bs['min'];
                }
                if (isset($bs['max']) && $bs['max'] !== '' && $bs['max'] !== ($bs['min'] ?? '')) {
                    $range[] = $bs['max'];
                }
                if (!empty($range)) {
                    $salary_label .= implode(' - ', $range);
                }
                if (isset($bs['currencyCode']) && $bs['currencyCode'] !== '') {
                    $salary_label .= ' ' . $bs['currencyCode'];
                }
                if (isset($bs['unitOfWork']) && $bs['unitOfWork'] !== '') {
                    $salary_label .= ' / ' . strtolower($bs['unitOfWork']);
                }

                // numeric salary value for gradient
                if(isset($bs['max']) && $bs['max']!=='') $salary_value=floatval($bs['max']);
                elseif(isset($bs['min']) && $bs['min']!=='') $salary_value=floatval($bs['min']);
                else $salary_value=0;
            }

            // Determine marker color: green for top paid, blue for newest, red for all others
            $color = 'red'; // default red for all jobs
            if ($is_top_paid) {
                $color = 'green'; // Top 10 highest paid jobs get green markers
            } elseif ($is_newest) {
                $color = 'blue'; // Single newest job gets blue marker
                error_log("USGRM DEBUG: Newest job PASSED location criteria - setting blue marker");
            }

            $company = $job['employer']['name'] ?? 'Company';
            $title   = $job['title'] ?? '';

            // published timestamp
            $published_ts=0;
            if(!empty($job['datePublished'])) $published_ts=strtotime($job['datePublished']);
            elseif(!empty($job['dateOnIndeed'])) $published_ts=strtotime($job['dateOnIndeed']);

            $marker_title = $company . ($salary_label ? ' - ' . $salary_label : '');

            $info_parts = [
                '<a href="' . esc_url($job['jobUrl'] ?? '#') . '" target="_blank" rel="noopener"><strong>' . esc_html($title) . '</strong></a>',
                esc_html($company),
                $salary_label ? esc_html($salary_label) : '',
                '<a href="' . esc_url($job['jobUrl'] ?? '#') . '" target="_blank" rel="noopener">View Job</a>',
                '<a href="#" class="usgrm-ignore" data-job="' . esc_attr($job['key'] ?? '') . '">Ignore</a>',
            ];
            $info_parts = array_filter($info_parts);

            $filtered[] = [
                'lat'     => $lat,
                'lng'     => $lng,
                'title'   => $marker_title,
                'info'    => implode('<br>', $info_parts),
                'color'   => $color,
                'salary_val' => $salary_value,
                'published'  => $published_ts,
                'id'         => $job['key'] ?? '',
            ];
        }

        // If filter removed everything, return all jobs unfiltered as fallback
        if (empty($filtered) && $total_jobs > 0 && !empty($locations)) {
            // Use first location for fallback filtering
            $fallback_location = $locations[0];
            $center_lat = floatval($fallback_location['lat'] ?? 0);
            $center_lng = floatval($fallback_location['lng'] ?? 0);
            $radius_m = intval($fallback_location['radius'] ?? 5000);
            $inside_outside = $fallback_location['mode'] ?? 'inside';
            
            foreach ($jobs_raw as $job) {
                if (!isset($job['location']['latitude'], $job['location']['longitude'])) continue;
                $lat = floatval($job['location']['latitude']);
                $lng = floatval($job['location']['longitude']);
                $distance = $this->haversine($center_lat,$center_lng,$lat,$lng);

                // Apply radius filtering in fallback as well
                $is_inside = ($distance <= $radius_m);
                if ((($inside_outside === 'inside') && !$is_inside) || (($inside_outside === 'outside') && $is_inside)) {
                    continue;
                }

                // Build salary label once
                $salary_label='';
                $salary_value=0;
                if(isset($job['baseSalary']) && is_array($job['baseSalary'])) {
                    $bs=$job['baseSalary'];
                    $range=[];
                    if(isset($bs['min']) && $bs['min']!=='') $range[]=$bs['min'];
                    if(isset($bs['max']) && $bs['max']!=='' && $bs['max']!==($bs['min']??'')) $range[]=$bs['max'];
                    if(!empty($range)) $salary_label.=implode(' - ',$range);
                    if(isset($bs['currencyCode']) && $bs['currencyCode']!=='') $salary_label.=' '.$bs['currencyCode'];
                    if(isset($bs['unitOfWork']) && $bs['unitOfWork']!=='') $salary_label.=' / '.strtolower($bs['unitOfWork']);

                    // numeric salary value for gradient
                    if(isset($bs['max']) && $bs['max']!=='') $salary_value=floatval($bs['max']);
                    elseif(isset($bs['min']) && $bs['min']!=='') $salary_value=floatval($bs['min']);
                }

                // published timestamp
                $published_ts=0;
                if(!empty($job['datePublished'])) $published_ts=strtotime($job['datePublished']);
                elseif(!empty($job['dateOnIndeed'])) $published_ts=strtotime($job['dateOnIndeed']);

                // Check if this is a top paid or newest job for fallback section too
                $job_id_fallback = $job['key'] ?? '';
                $is_top_paid_fallback = in_array($job_id_fallback, $top_paid_job_ids);
                $is_newest_fallback = ($job_id_fallback === $newest_job_id && $newest_job_id !== '');
                
                $color = 'red'; // default red for all jobs
                if ($is_top_paid_fallback) {
                    $color = 'green'; // Top 10 highest paid jobs get green markers
                } elseif ($is_newest_fallback) {
                    $color = 'blue'; // Top 10 newest jobs get blue markers
                }
                $company=$job['employer']['name']??'Company';
                $title=$job['title']??'';
                $marker_title=$company.($salary_label?' - '.$salary_label:'');
                $info_parts=[
                    '<a href="'.esc_url($job['jobUrl']??'#').'" target="_blank" rel="noopener"><strong>'.esc_html($title).'</strong></a>',
                    esc_html($company),
                    $salary_label?esc_html($salary_label):'',
                    '<a href="'.esc_url($job['jobUrl']??'#').'" target="_blank" rel="noopener">View Job</a>',
                    '<a href="#" class="usgrm-ignore" data-job="' . esc_attr($job['key'] ?? '') . '">Ignore</a>',
                ];
                $filtered[]=[
                    'lat'=>$lat,
                    'lng'=>$lng,
                    'title'=>$marker_title,
                    'info'=>implode('<br>',array_filter($info_parts)),
                    'color'=>$color,
                    'salary_val' => $salary_value,
                    'published'  => $published_ts,
                    'id'         => $job['key'] ?? '',
                ];
            }
        }

        return $filtered;
    }

    /**
     * Calculate Haversine distance between two lat/lon points in meters.
     */
    private function haversine($lat1, $lon1, $lat2, $lon2) {
        $earth_radius = 6371000; // meters
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) * sin($dLat / 2) + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) * sin($dLon / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earth_radius * $c;
    }

    public function render_map_shortcode() {
        if (!is_user_logged_in()) {
            return '<p>You must be logged in to view this map.</p>';
        }
        if (!$this->current_user_allowed()) {
            return '<p>You do not have permission to view this map.</p>';
        }
        return '<div class="usgrm-wrapper" style="display:flex;gap:10px;"><div id="usgrm-sidepanel" style="width:320px;max-height:800px;overflow:auto;border:1px solid #ccc;padding:8px;font-size:14px;"></div><div id="usgrm-map" style="flex:1 1 0%;height:800px;"></div></div>';
    }

    public function add_admin_menu() {
        // Add a primary top-level admin menu instead of a Settings submenu.
        $hook = add_menu_page(
            __('User Map Radius', 'user-map-radius'),
            __('User Map Radius', 'user-map-radius'),
            'manage_options',
            'user-map-radius',
            [$this, 'render_settings_page'],
            'dashicons-location-alt',
            56
        );

        // Dataset table submenu
        add_submenu_page(
            'user-map-radius',
            __('Jobs Dataset', 'user-map-radius'),
            __('Jobs Dataset', 'user-map-radius'),
            'manage_options',
            'user-map-radius-dataset',
            [$this, 'render_jobs_page']
        );
    }

    public function register_settings() {
        // Allowed users setting
        register_setting('usgrm_settings_group', $this->allowed_users_option, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_user_ids'],
            'default' => [],
        ]);

        // General plugin settings (API keys, locations, cron settings)
        register_setting('usgrm_settings_group', $this->general_settings_option, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_general_settings'],
            'default' => [
                'apify_token' => '',
                'apify_actor' => 'compass~crawler-google-places',
                'google_maps_key' => '',
                'locations' => [],
                'default_geolocation' => false,
                'cron_frequency' => 'hourly',
                'cache_hours' => 24,
                'migrated_to_v12' => true,
            ],
        ]);

        // User preferences
        register_setting('usgrm_settings_group', $this->user_preferences_option, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_user_preferences'],
            'default' => [],
        ]);
    }

    public function sanitize_user_ids($input) {
        if (!is_array($input)) return [];
        return array_map('intval', $input);
    }

    public function sanitize_general_settings($input) {
        $sanitized = [];
        
        // API Configuration
        $sanitized['apify_token'] = sanitize_text_field($input['apify_token'] ?? '');
        $sanitized['apify_actor'] = sanitize_text_field($input['apify_actor'] ?? '');
        $sanitized['google_maps_key'] = sanitize_text_field($input['google_maps_key'] ?? '');
        
        // Legacy API URLs (backward compatibility)
        $sanitized['run_api_url'] = esc_url_raw($input['run_api_url'] ?? '');
        $sanitized['dataset_api_url'] = esc_url_raw($input['dataset_api_url'] ?? '');
        
        // Sync & Cron Settings
        $sanitized['cron_frequency'] = sanitize_text_field($input['cron_frequency'] ?? 'hourly');
        $sanitized['cache_hours'] = absint($input['cache_hours'] ?? 24);
        
        // Ensure cache_hours is within valid range
        if ($sanitized['cache_hours'] < 1) $sanitized['cache_hours'] = 1;
        if ($sanitized['cache_hours'] > 168) $sanitized['cache_hours'] = 168;
        
        // Location preferences
        if (isset($input['locations']) && is_array($input['locations'])) {
            $sanitized['locations'] = [];
            foreach ($input['locations'] as $key => $location) {
                if (is_array($location)) {
                    $sanitized['locations'][$key] = [
                        'address' => sanitize_text_field($location['address'] ?? ''),
                        'lat' => floatval($location['lat'] ?? 0),
                        'lng' => floatval($location['lng'] ?? 0),
                        'radius' => absint($location['radius'] ?? 5000),
                        'mode' => in_array($location['mode'] ?? 'inside', ['inside', 'outside']) ? $location['mode'] : 'inside'
                    ];
                }
            }
        }
        
        return $sanitized;
    }

    public function sanitize_user_preferences($input) {
        if (!is_array($input)) {
            return [];
        }
        
        $sanitized = [];
        foreach ($input as $user_id => $prefs) {
            $user_id = intval($user_id);
            if ($user_id > 0 && is_array($prefs)) {
                $sanitized[$user_id] = [
                    'ignored_jobs' => isset($prefs['ignored_jobs']) && is_array($prefs['ignored_jobs']) ? 
                        array_map('sanitize_text_field', $prefs['ignored_jobs']) : [],
                    'last_location' => isset($prefs['last_location']) && is_array($prefs['last_location']) ? [
                        'lat' => floatval($prefs['last_location']['lat'] ?? 0),
                        'lng' => floatval($prefs['last_location']['lng'] ?? 0)
                    ] : [],
                    'preferred_zoom' => isset($prefs['preferred_zoom']) ? intval($prefs['preferred_zoom']) : 11,
                    'geolocation_enabled' => isset($prefs['geolocation_enabled']) ? (bool) $prefs['geolocation_enabled'] : false
                ];
            }
        }
        
        return $sanitized;
    }

    public function render_settings_page() {
        $allowed_users = get_option($this->allowed_users_option, []);
        $general_settings = get_option($this->general_settings_option, []);
        ?>
        <div class="wrap">
            <h1><?php _e('User Map Radius Settings', 'user-map-radius'); ?></h1>
            
            <?php if (!extension_loaded('pdo_sqlite')): ?>
            <div class="notice notice-warning">
                <p><strong><?php _e('SQLite Not Available', 'user-map-radius'); ?></strong></p>
                <p><?php _e('SQLite PDO driver is not installed on this server. The plugin is using WordPress transients for caching instead. For better performance, consider asking your hosting provider to enable the SQLite PDO extension.', 'user-map-radius'); ?></p>
            </div>
            <?php endif; ?>
            
            <nav class="nav-tab-wrapper">
                <a href="#locations" class="nav-tab nav-tab-active" data-tab="locations"><?php _e('Locations', 'user-map-radius'); ?></a>
                <a href="#api-keys" class="nav-tab" data-tab="api-keys"><?php _e('API Keys & URLs', 'user-map-radius'); ?></a>
                <a href="#sync-cron" class="nav-tab" data-tab="sync-cron"><?php _e('Sync & Cron', 'user-map-radius'); ?></a>
            </nav>

            <form method="post" action="options.php">
                <?php settings_fields('usgrm_settings_group'); ?>
                
                <!-- Locations Tab -->
                <div id="locations" class="tab-content">
                    <h2><?php _e('Location Settings', 'user-map-radius'); ?></h2>
                    <p><?php _e('Configure center points and radius settings for filtering map data.', 'user-map-radius'); ?></p>
                    
                    <div id="locations-container">
                        <?php
                        $locations = $general_settings['locations'] ?? [];
                        if (empty($locations)) {
                            $locations = [['address' => '', 'lat' => '', 'lng' => '', 'radius' => 5000, 'mode' => 'inside']];
                        }
                        
                        foreach ($locations as $index => $location) {
                            $this->render_location_row($index, $location);
                        }
                        ?>
                    </div>
                    
                    <p>
                        <button type="button" id="add-location" class="button"><?php _e('Add Location', 'user-map-radius'); ?></button>
                    </p>
                    
                    <h3><?php _e('Geolocation Settings', 'user-map-radius'); ?></h3>
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Default Geolocation', 'user-map-radius'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="<?php echo esc_attr($this->general_settings_option); ?>[default_geolocation]" value="1" <?php checked($general_settings['default_geolocation'] ?? false); ?> />
                                    <?php _e('Enable automatic geolocation for users', 'user-map-radius'); ?>
                                </label>
                                <p class="description"><?php _e('When enabled, the map will attempt to center on the user\'s location.', 'user-map-radius'); ?></p>
                                <button type="button" id="test-geolocation" class="button"><?php _e('Test Geolocation', 'user-map-radius'); ?></button>
                                <span id="geolocation-status"></span>
                            </td>
                        </tr>
                    </table>
                    
                    <h3><?php _e('User Access Control', 'user-map-radius'); ?></h3>
                    <table class="form-table">
                        <tr>
                            <th scope="row"><label for="allowed_users"><?php _e('Allowed Users', 'user-map-radius'); ?></label></th>
                            <td>
                                <select name="<?php echo esc_attr($this->allowed_users_option); ?>[]" id="allowed_users" multiple size="10" style="width:400px;">
                                    <?php
                                    $users = get_users();
                                    foreach ($users as $user) {
                                        $selected = in_array($user->ID, $allowed_users) ? 'selected' : '';
                                        echo "<option value='{$user->ID}' $selected>" . esc_html($user->display_name . ' (' . $user->user_login . ')') . "</option>";
                                    }
                                    ?>
                                </select>
                                <p class="description"><?php _e('Leave empty to allow all logged-in users. Hold Ctrl/Cmd to select multiple users.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- API Keys Tab -->
                <div id="api-keys" class="tab-content" style="display: none;">
                    <h2><?php _e('API Configuration', 'user-map-radius'); ?></h2>
                    <p><?php _e('Configure your API keys and endpoints for data synchronization.', 'user-map-radius'); ?></p>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row"><label for="apify_token"><?php _e('Apify API Token', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="password" id="apify_token" name="<?php echo esc_attr($this->general_settings_option); ?>[apify_token]" value="<?php echo esc_attr($general_settings['apify_token'] ?? ''); ?>" class="regular-text" />
                                <p class="description"><?php _e('Your Apify API token for accessing datasets.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="apify_actor"><?php _e('Apify Actor ID or Name', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="text" id="apify_actor" name="<?php echo esc_attr($this->general_settings_option); ?>[apify_actor]" value="<?php echo esc_attr($general_settings['apify_actor'] ?? 'valig/indeed-jobs-scraper'); ?>" class="regular-text" />
                                <p class="description"><?php _e('The Apify actor ID (e.g., TrtlecxAsNRbKl1na) or actor name (e.g., valig/indeed-jobs-scraper). You can use either format.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="google_maps_key"><?php _e('Google Maps API Key', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="password" id="google_maps_key" name="<?php echo esc_attr($this->general_settings_option); ?>[google_maps_key]" value="<?php echo esc_attr($general_settings['google_maps_key'] ?? ''); ?>" class="regular-text" />
                                <p class="description"><?php _e('Your Google Maps JavaScript API key with Places library enabled.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                    </table>

                    
                    <h3><?php _e('API Connection Test', 'user-map-radius'); ?></h3>
                    <p>
                        <button type="button" id="test-apify-connection" class="button"><?php _e('Test Connection', 'user-map-radius'); ?></button>
                        <span id="connection-status"></span>
                    </p>
                    
                    <?php if (!empty($general_settings['run_api_url']) || !empty($general_settings['dataset_api_url'])): ?>
                    <h3><?php _e('Legacy API URLs (Backward Compatibility)', 'user-map-radius'); ?></h3>
                    <table class="form-table">
                        <tr>
                            <th scope="row"><label for="run_api_url"><?php _e('Run API URL', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="url" id="run_api_url" name="<?php echo esc_attr($this->general_settings_option); ?>[run_api_url]" value="<?php echo esc_attr($general_settings['run_api_url'] ?? ''); ?>" class="regular-text" />
                                <p class="description"><?php _e('Legacy: Direct API URL for fetching run information.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="dataset_api_url"><?php _e('Dataset API URL Template', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="url" id="dataset_api_url" name="<?php echo esc_attr($this->general_settings_option); ?>[dataset_api_url]" value="<?php echo esc_attr($general_settings['dataset_api_url'] ?? ''); ?>" class="regular-text" />
                                <p class="description"><?php _e('Legacy: URL template with {DATASET_ID} placeholder.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                    </table>
                    <?php endif; ?>
                </div>

                <!-- Sync & Cron Tab -->
                <div id="sync-cron" class="tab-content" style="display: none;">
                    <h2><?php _e('Synchronization & Cron Settings', 'user-map-radius'); ?></h2>
                    <p><?php _e('Configure automatic data synchronization and caching behavior.', 'user-map-radius'); ?></p>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row"><label for="cron_frequency"><?php _e('Sync Frequency', 'user-map-radius'); ?></label></th>
                            <td>
                                <select id="cron_frequency" name="<?php echo esc_attr($this->general_settings_option); ?>[cron_frequency]">
                                    <option value="hourly" <?php selected($general_settings['cron_frequency'] ?? 'hourly', 'hourly'); ?>><?php _e('Hourly', 'user-map-radius'); ?></option>
                                    <option value="twicedaily" <?php selected($general_settings['cron_frequency'] ?? 'hourly', 'twicedaily'); ?>><?php _e('Twice Daily', 'user-map-radius'); ?></option>
                                    <option value="daily" <?php selected($general_settings['cron_frequency'] ?? 'hourly', 'daily'); ?>><?php _e('Daily', 'user-map-radius'); ?></option>
                                    <option value="weekly" <?php selected($general_settings['cron_frequency'] ?? 'hourly', 'weekly'); ?>><?php _e('Weekly', 'user-map-radius'); ?></option>
                                </select>
                                <p class="description"><?php _e('How often to automatically sync data from Apify.', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="cache_hours"><?php _e('Cache Duration (Hours)', 'user-map-radius'); ?></label></th>
                            <td>
                                <input type="number" id="cache_hours" name="<?php echo esc_attr($this->general_settings_option); ?>[cache_hours]" value="<?php echo esc_attr($general_settings['cache_hours'] ?? 24); ?>" min="1" max="168" class="small-text" />
                                <p class="description"><?php _e('How long to keep cached data (1-168 hours).', 'user-map-radius'); ?></p>
                            </td>
                        </tr>
                    </table>
                    
                    <h3><?php _e('Manual Sync', 'user-map-radius'); ?></h3>
                    <p>
                        <button type="button" id="manual-sync" class="button button-primary"><?php _e('Sync Now', 'user-map-radius'); ?></button>
                        <span id="sync-status"></span>
                    </p>
                    
                    <h3><?php _e('Cron Status', 'user-map-radius'); ?></h3>
                    <div id="cron-status"></div>
                    <div id="cache-info"></div>
                    
                    <p>
                        <button type="button" id="save-cron-settings" class="button"><?php _e('Save Cron Settings', 'user-map-radius'); ?></button>
                    </p>
                    
                    <h3><?php _e('Recent Sync Activity', 'user-map-radius'); ?></h3>
                    <div id="sync-log"></div>
                </div>

                <?php submit_button(); ?>
            </form>
        </div>

        <!-- Location Row Template -->
        <script type="text/template" id="location-row-template">
            <?php $this->render_location_row(0, ['address' => '', 'lat' => '', 'lng' => '', 'radius' => 5000, 'mode' => 'inside'], true); ?>
        </script>

        <style>
            .nav-tab-wrapper { margin-bottom: 20px; }
            .tab-content { background: #fff; padding: 20px; border: 1px solid #ccd0d4; border-top: none; }
            @media (max-width: 768px) {
                .mobile-tabs .nav-tab { display: block; margin: 0 0 -1px 0; }
            }
        </style>
        <?php
    }

    /**
     * Render a single location row
     */
    private function render_location_row($index, $location, $is_template = false) {
        $prefix = $this->general_settings_option;  // Always use the proper prefix
        $index_str = $is_template ? '0' : $index;
        ?>
        <div class="location-row location-row-compact">
            <div class="location-header">
                <span class="location-title">
                    <?php if (!$is_template): ?>
                        <?php printf(__('Location %d', 'user-map-radius'), $index + 1); ?>
                    <?php else: ?>
                        <?php _e('New Location', 'user-map-radius'); ?>
                    <?php endif; ?>
                </span>
                <a href="#" class="remove-location"><?php _e('Remove', 'user-map-radius'); ?></a>
            </div>
            
            <div class="location-fields">
                <div class="location-field location-field-address">
                    <label><?php _e('Address', 'user-map-radius'); ?></label>
                    <input type="text" 
                           name="<?php echo $prefix; ?>[locations][<?php echo $index_str; ?>][address]" 
                           id="location_address_<?php echo $index_str; ?>"
                           value="<?php echo esc_attr($location['address'] ?? ''); ?>" 
                           class="location-address-input" 
                           placeholder="<?php _e('Enter address or place name', 'user-map-radius'); ?>" />
                </div>
                
                <div class="location-field location-field-coords">
                    <label><?php _e('Lat', 'user-map-radius'); ?></label>
                    <input type="number" 
                           name="<?php echo $prefix; ?>[locations][<?php echo $index_str; ?>][lat]" 
                           id="location_lat_<?php echo $index_str; ?>"
                           value="<?php echo esc_attr($location['lat'] ?? ''); ?>" 
                           step="any" 
                           class="location-lat-input" 
                           placeholder="0.0000" />
                </div>
                
                <div class="location-field location-field-coords">
                    <label><?php _e('Lng', 'user-map-radius'); ?></label>
                    <input type="number" 
                           name="<?php echo $prefix; ?>[locations][<?php echo $index_str; ?>][lng]" 
                           id="location_lng_<?php echo $index_str; ?>"
                           value="<?php echo esc_attr($location['lng'] ?? ''); ?>" 
                           step="any" 
                           class="location-lng-input" 
                           placeholder="0.0000" />
                </div>
                
                <div class="location-field location-field-radius">
                    <label><?php _e('Radius (m)', 'user-map-radius'); ?></label>
                    <input type="number" 
                           name="<?php echo $prefix; ?>[locations][<?php echo $index_str; ?>][radius]" 
                           id="location_radius_<?php echo $index_str; ?>"
                           value="<?php echo esc_attr($location['radius'] ?? 5000); ?>" 
                           min="100" 
                           max="100000" 
                           placeholder="5000" />
                </div>
                
                <div class="location-field location-field-mode">
                    <label><?php _e('Mode', 'user-map-radius'); ?></label>
                    <select name="<?php echo $prefix; ?>[locations][<?php echo $index_str; ?>][mode]">
                        <option value="inside" <?php selected(($location['mode'] ?? 'inside'), 'inside'); ?>>
                            <?php _e('Inside', 'user-map-radius'); ?>
                        </option>
                        <option value="outside" <?php selected(($location['mode'] ?? 'inside'), 'outside'); ?>>
                            <?php _e('Outside', 'user-map-radius'); ?>
                        </option>
                    </select>
                </div>
            </div>
        </div>
        <?php
    }

    /**
     * Renders the Jobs Dataset table using WP_List_Table
     */
    public function render_jobs_page() {
        if (!class_exists('WP_List_Table')) {
            require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
        }

        // Fetch data
        $jobs_raw  = $this->fetch_apify_jobs();
        $total_records = is_array($jobs_raw) ? count($jobs_raw) : 0;
        
        // Force a test sync if no data and settings are configured
        if ($total_records === 0) {
            $settings = get_option($this->general_settings_option, []);
            if (!empty($settings['apify_token']) && !empty($settings['apify_actor'])) {
                // Try a quick sync to see if we can get data
                $sync_result = $this->sync_apify_data();
                if ($sync_result['success']) {
                    $jobs_raw = $this->fetch_apify_jobs();
                    $total_records = is_array($jobs_raw) ? count($jobs_raw) : 0;
                    if ($total_records > 0) {
                        echo '<div class="notice notice-success is-dismissible"><p><strong>✓ Auto-sync successful!</strong> Found ' . $total_records . ' records. Data was automatically fetched since cache was empty.</p></div>';
                    }
                }
            }
        }

        $settings  = get_option($this->general_settings_option, []);
        $locations = $settings['locations'] ?? [];
        
        // Fallback to old single location format for backward compatibility
        if (empty($locations) && isset($settings['center_lat'], $settings['center_lng'])) {
            $locations = [[
                'lat' => floatval($settings['center_lat']),
                'lng' => floatval($settings['center_lng']),
                'radius' => intval($settings['radius'] ?? 5000),
                'mode' => $settings['inside_outside'] ?? 'inside'
            ]];
        }

        // First pass: Extract all jobs with salary data and find the single newest job
        $jobs_with_salary = [];
        $newest_job_candidate = null;
        $newest_timestamp = 0;
        
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            
            // Extract salary value for sorting
            $salary_value = 0;
            if (isset($job['baseSalary']) && is_array($job['baseSalary'])) {
                $bs = $job['baseSalary'];
                if (isset($bs['max']) && $bs['max'] !== '') {
                    $salary_value = floatval($bs['max']);
                } elseif (isset($bs['min']) && $bs['min'] !== '') {
                    $salary_value = floatval($bs['min']);
                }
            }
            
            if ($salary_value > 0) {
                $jobs_with_salary[] = [
                    'job' => $job,
                    'salary_value' => $salary_value
                ];
            }
            
            // Find the single newest job by date (down to the minute precision)
            $published_ts = 0;
            if (!empty($job['datePublished'])) {
                $published_ts = strtotime($job['datePublished']);
            } elseif (!empty($job['dateOnIndeed'])) {
                $published_ts = strtotime($job['dateOnIndeed']);
            }
            
            if ($published_ts > 0) {
                // Round down to minute precision for comparison
                $published_minute = floor($published_ts / 60) * 60;
                $current_newest_minute = floor($newest_timestamp / 60) * 60;
                
                // If this job is newer by minute, or same minute but newer by second, update newest
                if ($published_minute > $current_newest_minute || 
                    ($published_minute === $current_newest_minute && $published_ts > $newest_timestamp)) {
                    $newest_timestamp = $published_ts;
                    $newest_job_candidate = $job;
                }
            }
        }
        
        // Sort by salary descending and get top 10 highest paid
        usort($jobs_with_salary, function($a, $b) {
            return $b['salary_value'] <=> $a['salary_value'];
        });
        
        $top_paid_job_ids = [];
        $top_10_paid = array_slice($jobs_with_salary, 0, 10);
        foreach ($top_10_paid as $job_data) {
            $top_paid_job_ids[] = $job_data['job']['key'] ?? '';
        }
        
        // Get the single newest job ID (will be checked against location criteria)
        $newest_job_id = $newest_job_candidate ? ($newest_job_candidate['key'] ?? '') : '';

        $jobs_table_data = [];
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            $lat = (float) $job['location']['latitude'];
            $lng = (float) $job['location']['longitude'];
            
            // Check if this is a top paid job (bypasses location) or the single newest job (must match location)
            $job_id = $job['key'] ?? '';
            $is_top_paid = in_array($job_id, $top_paid_job_ids);
            $is_newest = ($job_id === $newest_job_id && $newest_job_id !== '');
            
            // Calculate distance to closest location for display and check location criteria
            $min_distance = PHP_FLOAT_MAX;
            $matches_all_locations = true;
            
            // For all jobs except top paid, check if job matches ALL location criteria (AND logic)
            // Note: newest job must also satisfy location criteria, unlike top paid jobs
            if (!$is_top_paid) {
                foreach ($locations as $location) {
                    $center_lat = floatval($location['lat'] ?? 0);
                    $center_lng = floatval($location['lng'] ?? 0);
                    $radius_m = intval($location['radius'] ?? 5000);
                    $mode = $location['mode'] ?? 'inside';
                    
                    $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);
                    $min_distance = min($min_distance, $distance);
                    
                    $is_inside = ($distance <= $radius_m);
                    
                    // Check if this job satisfies THIS location's criteria
                    $satisfies_this_location = false;
                    if ($mode === 'inside' && $is_inside) {
                        $satisfies_this_location = true;
                    } elseif ($mode === 'outside' && !$is_inside) {
                        $satisfies_this_location = true;
                    }
                    
                    // If job doesn't satisfy this location's criteria, it fails overall
                    if (!$satisfies_this_location) {
                        $matches_all_locations = false;
                        break; // No need to check other locations
                    }
                }
            } else {
                // For top paid jobs only, calculate distance but always match
                foreach ($locations as $location) {
                    $center_lat = floatval($location['lat'] ?? 0);
                    $center_lng = floatval($location['lng'] ?? 0);
                    $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);
                    $min_distance = min($min_distance, $distance);
                }
                $matches_all_locations = true; // Top paid jobs always match
            }
            
            if ($min_distance === PHP_FLOAT_MAX) {
                $min_distance = 0;
            }

            // Determine job type
            $jobtype = '';
            if (!empty($job['jobTypes'])) {
                $jobtype = implode(', ', array_values($job['jobTypes']));
            }

            // Salary text
            $salary_text = '';
            if (!empty($job['baseSalary']['min'])) {
                $salary_text = $job['baseSalary']['min'];
                if (!empty($job['baseSalary']['max'])) {
                    $salary_text .= ' - ' . $job['baseSalary']['max'];
                }
                if (!empty($job['baseSalary']['currencyCode'])) {
                    $salary_text .= ' ' . $job['baseSalary']['currencyCode'];
                }
            }

            // Add visual indicators for special jobs
            $salary_indicator = '';
            $title_indicator = '';
            if ($is_top_paid) {
                $salary_indicator = ' 🟢'; // Green circle for top paid
            } elseif ($is_newest) {
                $title_indicator = ' 🔵'; // Blue circle for newest
            }
            
            $jobs_table_data[] = [
                'title'    => esc_html($job['title'] ?? '') . $title_indicator,
                'company'  => esc_html($job['employer']['name'] ?? ''),
                'type'     => esc_html($jobtype),
                'salary'   => esc_html($salary_text) . $salary_indicator,
                'city'     => esc_html($job['location']['city'] ?? ''),
                'lat'      => $lat,
                'lng'      => $lng,
                'distance' => round($min_distance / 1000, 2),
                'match'    => $matches_all_locations ? 1 : 0,
                'is_top_paid' => $is_top_paid,
                'is_newest' => $is_newest,
            ];
        }

        // Sort: Top paid jobs first, then single newest job, then matching jobs, then by distance
        usort($jobs_table_data, function($a, $b) {
            // Top paid jobs always come first
            if ($a['is_top_paid'] !== $b['is_top_paid']) {
                return $a['is_top_paid'] ? -1 : 1;
            }
            
            // Among non-top-paid jobs, the single newest job comes second
            if ($a['is_newest'] !== $b['is_newest']) {
                return $a['is_newest'] ? -1 : 1;
            }
            
            // Among remaining jobs, matching jobs come next
            if ($a['match'] !== $b['match']) {
                return $a['match'] ? -1 : 1;
            }
            
            // Finally sort by distance
            return $a['distance'] <=> $b['distance'];
        });

        $table = new USGRM_Jobs_Table($jobs_table_data);
        echo '<div class="wrap"><h1>' . esc_html__('Jobs Dataset', 'user-map-radius') . '</h1>';
        echo '<p>' . sprintf( esc_html__('Latest dataset retrieved from Apify actor. (%d records)', 'user-map-radius'), $total_records ) . '</p>';
        
        // Debug info for troubleshooting
        if ($total_records === 0) {
            $settings = get_option($this->general_settings_option, []);
            echo '<div class="notice notice-warning"><p><strong>⚠ No Job Data Found</strong><br>';
            echo 'Configuration Status:<br>';
            echo '• API Token: ' . (!empty($settings['apify_token']) ? '✅ Configured (' . strlen($settings['apify_token']) . ' chars)' : '❌ Missing') . '<br>';
            echo '• Actor ID: ' . (!empty($settings['apify_actor']) ? '✅ ' . esc_html($settings['apify_actor']) : '❌ Not set') . '<br>';
            echo '• Cache System: ' . (!$this->pdo ? 'WordPress Transients (SQLite not available)' : 'SQLite Database') . '<br>';
            
            // Check if there are any cached entries
            if (!$this->pdo) {
                global $wpdb;
                $cache_count = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '_transient_usgrm_dataset_%'");
                echo '• Cached Datasets: ' . ($cache_count > 0 ? $cache_count . ' found' : 'None') . '<br>';
            }
            echo '<br>';
            
            if (empty($settings['apify_token']) || empty($settings['apify_actor'])) {
                echo '<strong>🔧 Setup Required:</strong><br>';
                echo '1. <a href="?page=user-map-radius" class="button button-small">Configure API Settings</a><br>';
                echo '2. Set your Apify API Token and Actor ID<br>';
                echo '3. Test the connection<br>';
                echo '4. Return here and click "Refresh Dataset"<br>';
            } else {
                echo '<strong>🔄 Next Steps:</strong><br>';
                echo '1. <a href="?page=user-map-radius" class="button button-small">Go to Sync & Cron Tab</a><br>';
                echo '2. Click "Sync Now" to fetch data immediately<br>';
                echo '3. Or click "Refresh Dataset" above<br>';
                echo '4. Verify your Apify actor has successful runs with data<br>';
                echo '<br><em>If the actor is <code>' . esc_html($settings['apify_actor']) . '</code>, make sure it has been run recently and contains job data.</em><br>';
            }
            echo '</p></div>';
        }
        
        // AJAX Refresh button (same as Sync Now button)
        echo '<div style="margin-bottom: 20px;">';
        echo '<button type="button" id="refresh-dataset-btn" class="button button-primary">Refresh Dataset</button>';
        echo '<span id="refresh-status" style="margin-left: 10px;"></span>';
        echo '</div>';
        
        // Display table
        $table->prepare_items();
        $table->display();
        echo '</div>';
        
        // Add JavaScript for AJAX refresh functionality
        ?>
        <script type="text/javascript">
        jQuery(document).ready(function($) {
            $('#refresh-dataset-btn').on('click', function() {
                const $button = $(this);
                const $status = $('#refresh-status');
                
                $button.prop('disabled', true).text('Refreshing...');
                $status.html('<span class="spinner is-active"></span> Fetching data...');
                
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    data: {
                        action: 'usgrm_manual_sync',
                        nonce: '<?php echo wp_create_nonce('usgrm_admin_nonce'); ?>'
                    },
                    success: function(response) {
                        if (response.success) {
                            $status.html('<span style="color: #46b450;">✓ ' + response.data.message + '</span>');
                            // Reload the page to show the new data
                            setTimeout(function() {
                                location.reload();
                            }, 1000);
                        } else {
                            $status.html('<span style="color: #dc3232;">✗ ' + response.data.message + '</span>');
                        }
                    },
                    error: function() {
                        $status.html('<span style="color: #dc3232;">✗ Request failed</span>');
                    },
                    complete: function() {
                        $button.prop('disabled', false).text('Refresh Dataset');
                    }
                });
            });
        });
        </script>
        <?php
    }

    /**
     * AJAX handler for testing Apify API connection
     */
    public function ajax_test_apify_connection() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $apify_token = sanitize_text_field($_POST['apify_token'] ?? '');
        $apify_actor = sanitize_text_field($_POST['apify_actor'] ?? '');
        
        if (empty($apify_token) || empty($apify_actor)) {
            wp_send_json_error(['message' => 'API token and actor ID are required']);
        }
        
        // Format actor ID for API URL
        $actor_api_format = $this->format_actor_for_api($apify_actor);
        
        // Test API connection by trying to fetch the actual dataset
        $test_url = "https://api.apify.com/v2/acts/{$actor_api_format}/runs/last/dataset/items?token={$apify_token}&clean=1&limit=1";
        $response = wp_remote_get($test_url, [
            'timeout' => 15,
            'headers' => ['Accept' => 'application/json']
        ]);
        
        if (is_wp_error($response)) {
            wp_send_json_error(['message' => 'Connection failed: ' . $response->get_error_message()]);
        }
        
        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        
        if ($response_code === 404) {
            wp_send_json_error(['message' => 'Actor not found or no runs available. Please check the actor ID: ' . $apify_actor]);
        }
        
        if ($response_code !== 200) {
            wp_send_json_error(['message' => 'API request failed with status: ' . $response_code]);
        }
        
        // Try to parse the response
        $data = json_decode($body, true);
        if (!is_array($data)) {
            // Try NDJSON format
            $data = [];
            $lines = preg_split('/\r?\n/', trim($body));
            foreach ($lines as $line) {
                if ($line === '') continue;
                $row = json_decode($line, true);
                if (is_array($row)) {
                    $data[] = $row;
                    break; // We only need to check if we can parse one item
                }
            }
        }
        
        if (empty($data)) {
            wp_send_json_error(['message' => 'Connection successful but no data found. Please ensure the actor has been run and contains data.']);
        }
        
        // Get some info about the dataset for the success message
        $dataset_info = '';
        if (isset($data[0])) {
            $first_item = $data[0];
            if (isset($first_item['title'])) {
                $dataset_info = 'Sample job: "' . substr($first_item['title'], 0, 50) . '..."';
            } elseif (isset($first_item['name'])) {
                $dataset_info = 'Sample item: "' . substr($first_item['name'], 0, 50) . '..."';
            } else {
                $dataset_info = 'Found dataset with ID: ' . (isset($first_item['id']) ? $first_item['id'] : 'unknown');
            }
        }
        
        wp_send_json_success(['message' => 'Connection successful! Found dataset with data. ' . $dataset_info]);
    }

    /**
     * AJAX handler for manual sync
     */
    public function ajax_manual_sync() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $result = $this->sync_apify_data();
        
        if ($result['success']) {
            wp_send_json_success(['message' => $result['message']]);
        } else {
            wp_send_json_error(['message' => $result['message']]);
        }
    }

    /**
     * AJAX handler for saving cron settings
     */
    public function ajax_save_cron_settings() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $cron_frequency = sanitize_text_field($_POST['cron_frequency'] ?? 'hourly');
        $cache_hours = intval($_POST['cache_hours'] ?? 24);
        
        $settings = get_option($this->general_settings_option, []);
        $settings['cron_frequency'] = $cron_frequency;
        $settings['cache_hours'] = $cache_hours;
        
        update_option($this->general_settings_option, $settings);
        
        // Reschedule cron
        $this->clear_cron();
        $this->setup_cron();
        
        wp_send_json_success(['message' => 'Cron settings saved successfully']);
    }

    /**
     * AJAX handler for getting cron status
     */
    public function ajax_get_cron_status() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $next_run = wp_next_scheduled('usgrm_sync_apify_data');
        $status_html = '';
        $cache_info = '';
        
        if ($next_run) {
            $time_diff = $next_run - time();
            $status_html = '<span class="dashicons dashicons-clock" style="color: green;"></span> Next sync in ' . human_time_diff(time(), $next_run);
        } else {
            $status_html = '<span class="dashicons dashicons-dismiss" style="color: red;"></span> Cron not scheduled';
        }
        
        // Get cache info
        if (!$this->pdo) {
            // Fallback to WordPress transients
            global $wpdb;
            $transient_count = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '_transient_usgrm_dataset_%'");
            if ($transient_count > 0) {
                $cache_info = "Cache: {$transient_count} datasets (WordPress transients)";
            } else {
                $cache_info = "Cache: No data (using WordPress transients)";
            }
        } else {
            try {
                $stmt = $this->pdo->query("SELECT COUNT(*) as count, MAX(created_at) as last_update FROM apify_cache");
                $cache_data = $stmt->fetch(PDO::FETCH_ASSOC);
                
                if ($cache_data['count'] > 0) {
                    $cache_info = "Cache: {$cache_data['count']} datasets, last updated " . human_time_diff(strtotime($cache_data['last_update']), time()) . " ago";
                } else {
                    $cache_info = "Cache: No data";
                }
            } catch (PDOException $e) {
                $cache_info = "Cache: Error reading data";
            }
        }
        
        wp_send_json_success([
            'status_html' => $status_html,
            'cache_info' => $cache_info
        ]);
    }

    /**
     * AJAX handler for getting sync log
     */
    public function ajax_get_sync_log() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        if (!$this->pdo) {
            // Fallback to WordPress options
            $logs = get_option('usgrm_sync_logs', []);
            $logs = array_slice($logs, 0, 10); // Get last 10 entries
        } else {
            try {
                $stmt = $this->pdo->query("SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 10");
                $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (PDOException $e) {
                wp_send_json_error(['message' => 'Error reading sync log']);
                return;
            }
        }
        
        $log_html = '<table class="wp-list-table widefat fixed striped">';
        $log_html .= '<thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Message</th><th>Items</th></tr></thead><tbody>';
        
        foreach ($logs as $log) {
            $status_icon = $log['status'] === 'success' ? 
                '<span class="dashicons dashicons-yes-alt" style="color: green;"></span>' : 
                '<span class="dashicons dashicons-dismiss" style="color: red;"></span>';
            
            $timestamp = isset($log['created_at']) ? $log['created_at'] : ($log['timestamp'] ?? '');
            $time_ago = $timestamp ? human_time_diff(strtotime($timestamp), time()) . ' ago' : 'Unknown';
            
            $log_html .= sprintf(
                '<tr><td>%s</td><td>%s</td><td>%s %s</td><td>%s</td><td>%s</td></tr>',
                $time_ago,
                esc_html($log['sync_type'] ?? $log['type'] ?? 'Unknown'),
                $status_icon,
                esc_html($log['status']),
                esc_html($log['message']),
                esc_html($log['items_count'] ?? 'N/A')
            );
        }
        
        $log_html .= '</tbody></table>';
        
        wp_send_json_success(['log_html' => $log_html]);
    }

    /**
     * AJAX handler for ignoring jobs
     */
    public function ajax_ignore_job() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!is_user_logged_in()) {
            wp_die('Unauthorized');
        }
        
        $job_id = sanitize_text_field($_POST['job_id'] ?? '');
        $user_id = get_current_user_id();
        
        $preferences = get_option($this->user_preferences_option, []);
        if (!isset($preferences[$user_id])) {
            $preferences[$user_id] = [];
        }
        if (!isset($preferences[$user_id]['ignored_jobs'])) {
            $preferences[$user_id]['ignored_jobs'] = [];
        }
        
        if (!in_array($job_id, $preferences[$user_id]['ignored_jobs'])) {
            $preferences[$user_id]['ignored_jobs'][] = $job_id;
            update_option($this->user_preferences_option, $preferences);
        }
        
        wp_send_json_success(['message' => 'Job ignored']);
    }

    /**
     * AJAX handler for saving location preferences
     */
    public function ajax_save_location_preference() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!is_user_logged_in()) {
            wp_die('Unauthorized');
        }
        
        $lat = floatval($_POST['lat'] ?? 0);
        $lng = floatval($_POST['lng'] ?? 0);
        $zoom = intval($_POST['zoom'] ?? 11);
        $user_id = get_current_user_id();
        
        $preferences = get_option($this->user_preferences_option, []);
        if (!isset($preferences[$user_id])) {
            $preferences[$user_id] = [];
        }
        
        $preferences[$user_id]['last_location'] = ['lat' => $lat, 'lng' => $lng];
        $preferences[$user_id]['preferred_zoom'] = $zoom;
        
        update_option($this->user_preferences_option, $preferences);
        
        wp_send_json_success(['message' => 'Location preference saved']);
    }

    /**
     * AJAX handler for getting user preferences
     */
    public function ajax_get_user_preferences() {
        check_ajax_referer('usgrm_admin_nonce', 'nonce');
        
        if (!is_user_logged_in()) {
            wp_die('Unauthorized');
        }
        
        $user_id = get_current_user_id();
        $preferences = get_option($this->user_preferences_option, []);
        $user_prefs = $preferences[$user_id] ?? [];
        
        wp_send_json_success(['preferences' => $user_prefs]);
    }
}

// --------------------------- List Table Class ---------------------------
if (!class_exists('USGRM_Jobs_Table')) {
    if (!class_exists('WP_List_Table')) {
        require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
    }
    class USGRM_Jobs_Table extends WP_List_Table {
        private array $items_data;

        public function __construct(array $jobs_data) {
            parent::__construct([
                'plural'   => 'jobs',
                'singular' => 'job',
                'ajax'     => false,
            ]);
            $this->items_data = $jobs_data;
        }

        public function get_columns(): array {
            return [
                'title'    => __('Title', 'user-map-radius'),
                'company'  => __('Company', 'user-map-radius'),
                'type'     => __('Type', 'user-map-radius'),
                'salary'   => __('Salary', 'user-map-radius'),
                'city'     => __('City', 'user-map-radius'),
                'lat'      => __('Lat', 'user-map-radius'),
                'lng'      => __('Lng', 'user-map-radius'),
                'distance' => __('Distance (km)', 'user-map-radius'),
            ];
        }

        protected function get_sortable_columns(): array {
            return [
                'distance' => ['distance', false],
            ];
        }

        public function prepare_items(): void {
            $columns  = $this->get_columns();
            $hidden   = [];
            $sortable = $this->get_sortable_columns();
            $this->_column_headers = [$columns, $hidden, $sortable];

            $orderby = $_GET['orderby'] ?? 'distance';
            $order   = ($_GET['order'] ?? 'asc') === 'desc' ? 'desc' : 'asc';

            usort($this->items_data, function($a, $b) use ($orderby, $order) {
                $result = $a[$orderby] <=> $b[$orderby];
                return $order === 'asc' ? $result : -$result;
            });

            $this->items = $this->items_data;
        }

        public function column_default($item, $column_name) {
            return $item[$column_name] ?? '';
        }
    }
}

new User_Specific_Map_Radius();
