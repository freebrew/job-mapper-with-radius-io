<?php
/*
Plugin Name: Job Mapper With Radius In/Out
Description: Displays a Google Map with a km radius circle at given coordinates either inside or outside the boundry, visible only to assigned registered users.
Version: 1.2
Author: YourName
*/

defined('ABSPATH') or die('No script kiddies please!');

class User_Specific_Map_Radius {

    private $allowed_users_option = 'usgrm_allowed_users';
    private $general_settings_option = 'usgrm_general_settings'; // stores API key, actor ID, map config

    public function __construct() {
        add_shortcode('user_map_radius', [$this, 'render_map_shortcode']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('wp_footer', [$this, 'print_inline_js']); // print JS after scripts loaded
    }

    public function enqueue_scripts() {
        if (is_user_logged_in() && $this->current_user_allowed()) {
            // Enqueue Google Maps JS without callback param
            wp_enqueue_script('google-maps-api', 'https://maps.googleapis.com/maps/api/js?key=AIzaSyAr0PrcxV1K9_jGn-i_9ayI2qk_Mjvvcv8', [], null, true);
            wp_enqueue_style('user-map-radius-css', plugin_dir_url(__FILE__) . 'user-map-radius.css');
        }
    }

    // This will output userMapData after scripts so it's available in JS
    public function print_inline_js() {
        if (!is_user_logged_in() || !$this->current_user_allowed()) {
            return;
        }

        $settings = get_option($this->general_settings_option, []);
        $center_lat = isset($settings['center_lat']) ? floatval($settings['center_lat']) : 0;
        $center_lng = isset($settings['center_lng']) ? floatval($settings['center_lng']) : 0;
        $radius     = isset($settings['radius']) ? intval($settings['radius']) : 5000;

        $markers = $this->get_filtered_jobs();

        $data = [
            'lat'     => $center_lat,
            'lng'     => $center_lng,
            'radius'  => $radius,
            'markers' => $markers,
        ];

        echo '<script>window.userMapData = ' . wp_json_encode($data) . ";</script>\n";

        echo "<script>
            function initUserMapRadius() {
                var center = { lat: window.userMapData.lat, lng: window.userMapData.lng };
                var map = new google.maps.Map(document.getElementById('usgrm-map'), {
                    zoom: 11,
                    center: center,
                });

                // Draw radius circle
                new google.maps.Circle({
                    strokeColor: '#FF0000',
                    strokeOpacity: 0.5,
                    strokeWeight: 2,
                    fillColor: '#FF0000',
                    fillOpacity: 0.1,
                    map: map,
                    center: center,
                    radius: window.userMapData.radius,
                });

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

                    var gmMarker = new google.maps.Marker({
                        position: { lat: marker.lat, lng: marker.lng },
                        map: map,
                        title: marker.title,
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

                // Detect mobile via user-agent and add class for styling
                var wrap = document.querySelector('.usgrm-wrapper');
                if (wrap && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    wrap.classList.add('mobile');

                    // create toggle button
                    var btn = document.createElement('button');
                    btn.className='usgrm-toggle-btn';
                    btn.textContent='Top 10';
                    document.body.appendChild(btn);

                    btn.addEventListener('click',function(){
                        wrap.classList.toggle('panel-open');
                    });

                    // add close X inside panel
                    var close=document.createElement('a');
                    close.href='#'; close.className='close'; close.innerHTML='&times;';
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
     * Fetch latest dataset items from Apify for the configured actor.
     * Caches the results in a transient for 10 minutes to avoid hitting the API too often.
     *
     * @return array
     */
    private function fetch_apify_jobs() {
        $settings = get_option($this->general_settings_option, []);
        $run_api_url = $settings['run_api_url'] ?? '';
        if (!$run_api_url) {
            return [];
        }

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
     * Return jobs filtered by radius condition.
     *
     * @return array
     */
    private function get_filtered_jobs() {
        $settings = get_option($this->general_settings_option, []);
        $center_lat = isset($settings['center_lat']) ? floatval($settings['center_lat']) : 0;
        $center_lng = isset($settings['center_lng']) ? floatval($settings['center_lng']) : 0;
        $radius_m   = isset($settings['radius']) ? intval($settings['radius']) : 5000;
        $inside_outside = $settings['inside_outside'] ?? 'inside';

        // Fetch data
        $jobs_raw  = $this->fetch_apify_jobs();
        if (empty($jobs_raw)) {
            return [];
        }

        $filtered = [];
        $total_jobs = 0;
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            $total_jobs++;
            $lat = floatval($job['location']['latitude']);
            $lng = floatval($job['location']['longitude']);
            $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);

            // Radius filtering: skip markers based on inside/outside selection
            $is_inside = ($distance <= $radius_m);
            if ((($inside_outside === 'inside') && !$is_inside) || (($inside_outside === 'outside') && $is_inside)) {
                continue; // skip this job
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

            // Determine job type (part-time/full-time) from jobTypes array if present.
            $jobtype_text = '';
            if (!empty($job['jobTypes']) && is_array($job['jobTypes'])) {
                $jobtype_text = strtolower(implode(' ', array_values($job['jobTypes'])));
            }
            $color   = (strpos($jobtype_text, 'part-time') !== false) ? 'green' : 'blue';

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
        if (empty($filtered) && $total_jobs > 0) {
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
                if(isset($job['baseSalary']) && is_array($job['baseSalary'])) {
                    $bs=$job['baseSalary'];
                    $range=[];
                    if(isset($bs['min']) && $bs['min']!=='') $range[]=$bs['min'];
                    if(isset($bs['max']) && $bs['max']!=='' && $bs['max']!==($bs['min']??'')) $range[]=$bs['max'];
                    if(!empty($range)) $salary_label.=implode(' - ',$range);
                    if(isset($bs['currencyCode']) && $bs['currencyCode']!=='') $salary_label.=' '.$bs['currencyCode'];
                    if(isset($bs['unitOfWork']) && $bs['unitOfWork']!=='') $salary_label.=' / '.strtolower($bs['unitOfWork']);
                }

                // numeric salary value for gradient
                if(isset($bs['max']) && $bs['max']!=='') $salary_value=floatval($bs['max']);
                elseif(isset($bs['min']) && $bs['min']!=='') $salary_value=floatval($bs['min']);
                else $salary_value=0;

                // published timestamp
                $published_ts=0;
                if(!empty($job['datePublished'])) $published_ts=strtotime($job['datePublished']);
                elseif(!empty($job['dateOnIndeed'])) $published_ts=strtotime($job['dateOnIndeed']);

                $jobtype_text='';
                if(!empty($job['jobTypes'])&&is_array($job['jobTypes'])) $jobtype_text=strtolower(implode(' ',array_values($job['jobTypes'])));
                $color=(strpos($jobtype_text,'part-time')!==false)?'green':'blue';
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

        // General plugin settings (API key, actor, map parameters)
        register_setting('usgrm_settings_group', $this->general_settings_option, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_general_settings'],
            'default' => [
                'run_api_url'      => '',
                'dataset_api_url'  => '',
                'center_lat'       => '',
                'center_lng'       => '',
                'radius'           => 5000,
                'inside_outside'   => 'inside',
            ],
        ]);
    }

    public function sanitize_user_ids($input) {
        if (!is_array($input)) return [];
        return array_map('intval', $input);
    }

    public function sanitize_general_settings($input) {
        if (!is_array($input)) {
            return [];
        }

        return [
            'run_api_url'    => isset($input['run_api_url']) ? sanitize_text_field($input['run_api_url']) : '',
            'dataset_api_url'=> isset($input['dataset_api_url']) ? sanitize_text_field($input['dataset_api_url']) : '',
            'center_lat'     => isset($input['center_lat']) ? floatval($input['center_lat']) : '',
            'center_lng'     => isset($input['center_lng']) ? floatval($input['center_lng']) : '',
            'radius'         => isset($input['radius']) ? intval($input['radius']) : 5000,
            'inside_outside' => isset($input['inside_outside']) && $input['inside_outside'] === 'outside' ? 'outside' : 'inside',
        ];
    }

    public function render_settings_page() {
        ?>
        <div class="wrap">
            <h1>User Map Radius Settings</h1>
            <form method="post" action="options.php">
                <?php
                settings_fields('usgrm_settings_group');
                $allowed_users = get_option($this->allowed_users_option, []);
                $general_settings = get_option($this->general_settings_option, []);
                ?>
                <h2><?php _e('General Settings', 'user-map-radius'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="usgrm_center_lat"><?php _e('Center Latitude', 'user-map-radius'); ?></label></th>
                        <td><input type="text" id="usgrm_center_lat" name="<?php echo esc_attr($this->general_settings_option); ?>[center_lat]" value="<?php echo esc_attr($general_settings['center_lat'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_center_lng"><?php _e('Center Longitude', 'user-map-radius'); ?></label></th>
                        <td><input type="text" id="usgrm_center_lng" name="<?php echo esc_attr($this->general_settings_option); ?>[center_lng]" value="<?php echo esc_attr($general_settings['center_lng'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_radius"><?php _e('Radius (meters)', 'user-map-radius'); ?></label></th>
                        <td><input type="number" id="usgrm_radius" name="<?php echo esc_attr($this->general_settings_option); ?>[radius]" value="<?php echo esc_attr($general_settings['radius'] ?? 5000); ?>" class="small-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label><?php _e('Filter Mode', 'user-map-radius'); ?></label></th>
                        <td>
                            <fieldset>
                                <label><input type="radio" name="<?php echo esc_attr($this->general_settings_option); ?>[inside_outside]" value="inside" <?php checked(($general_settings['inside_outside'] ?? 'inside'), 'inside'); ?> /> <?php _e('Inside', 'user-map-radius'); ?></label><br />
                                <label><input type="radio" name="<?php echo esc_attr($this->general_settings_option); ?>[inside_outside]" value="outside" <?php checked(($general_settings['inside_outside'] ?? 'inside'), 'outside'); ?> /> <?php _e('Outside', 'user-map-radius'); ?></label>
                            </fieldset>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_run_api_url"><?php _e('Get Run API URL', 'user-map-radius'); ?></label></th>
                        <td><input type="text" id="usgrm_run_api_url" name="<?php echo esc_attr($this->general_settings_option); ?>[run_api_url]" value="<?php echo esc_attr($general_settings['run_api_url'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_dataset_api_url"><?php _e('Get Dataset API URL', 'user-map-radius'); ?></label></th>
                        <td><input type="text" id="usgrm_dataset_api_url" name="<?php echo esc_attr($this->general_settings_option); ?>[dataset_api_url]" value="<?php echo esc_attr($general_settings['dataset_api_url'] ?? 'https://api.apify.com/v2/datasets/{DATASET_ID}/items?token='); ?>" class="regular-text" /></td>
                    </tr>
                </table>
                <hr />
                <h2><?php _e('Allowed Users', 'user-map-radius'); ?></h2>
                <select name="<?php echo esc_attr($this->allowed_users_option); ?>[]" multiple size="10" style="width:300px;">
                    <?php
                    $users = get_users();
                    foreach ($users as $user) {
                        $selected = in_array($user->ID, $allowed_users) ? 'selected' : '';
                        echo "<option value='{$user->ID}' $selected>" . esc_html($user->display_name . ' (' . $user->user_login . ')') . "</option>";
                    }
                    ?>
                </select>
                <?php submit_button(); ?>
            </form>
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

        // Process dataset refresh request
        if (!empty($_POST['usgrm_refresh_dataset']) && isset($_POST['_wpnonce']) && wp_verify_nonce($_POST['_wpnonce'], 'usgrm_refresh_dataset_action')) {
            $gs = get_option($this->general_settings_option, []);
            if (!empty($gs['actor_id'])) {
                $transient_key = 'usgrm_jobs_' . md5(str_replace('/', '~', $gs['actor_id']));
                delete_transient($transient_key);
            }

            // New cache key scheme based on Run API URL
            if (!empty($gs['run_api_url'])) {
                $transient_key = 'usgrm_jobs_' . md5($gs['run_api_url']);
                delete_transient($transient_key);
            }
        }

        // Fetch data
        $jobs_raw  = $this->fetch_apify_jobs();
        $total_records = is_array($jobs_raw) ? count($jobs_raw) : 0;
        $settings  = get_option($this->general_settings_option, []);
        $center_lat = isset($settings['center_lat']) ? (float) $settings['center_lat'] : 0.0;
        $center_lng = isset($settings['center_lng']) ? (float) $settings['center_lng'] : 0.0;
        $radius_m   = isset($settings['radius']) ? (int) $settings['radius'] : 5000;
        $mode       = $settings['inside_outside'] ?? 'inside';

        $jobs_table_data = [];
        foreach ($jobs_raw as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            $lat = (float) $job['location']['latitude'];
            $lng = (float) $job['location']['longitude'];
            $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);
            $in_condition = ($mode === 'inside') ? ($distance <= $radius_m) : ($distance > $radius_m);

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

            $jobs_table_data[] = [
                'title'    => esc_html($job['title'] ?? ''),
                'company'  => esc_html($job['employer']['name'] ?? ''),
                'type'     => esc_html($jobtype),
                'salary'   => esc_html($salary_text),
                'city'     => esc_html($job['location']['city'] ?? ''),
                'lat'      => $lat,
                'lng'      => $lng,
                'distance' => round($distance / 1000, 2),
                'match'    => 1,
            ];
        }

        // Place matching rows first
        usort($jobs_table_data, function($a, $b) {
            if ($a['match'] === $b['match']) {
                return $a['distance'] <=> $b['distance'];
            }
            return $a['match'] ? -1 : 1; // matching at top
        });

        $table = new USGRM_Jobs_Table($jobs_table_data);
        echo '<div class="wrap"><h1>' . esc_html__('Jobs Dataset', 'user-map-radius') . '</h1>';
        echo '<p>' . sprintf( esc_html__('Latest dataset retrieved from Apify actor. (%d records)', 'user-map-radius'), $total_records ) . '</p>';
        echo '<form method="post">';
        wp_nonce_field('usgrm_refresh_dataset_action');
        echo '<p><input type="submit" name="usgrm_refresh_dataset" class="button" value="' . esc_attr__('Refresh Dataset', 'user-map-radius') . '" /></p>';
        $table->prepare_items();
        $table->display();
        echo '</form></div>';
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
