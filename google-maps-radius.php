<?php
/*
Plugin Name: Job Mapper With Radius In/Out
Description: Displays a Google Map with a km radius circle at given coordinates either inside or outside the boundary, visible only to assigned registered users. Integrates with Apify to plot job listings dynamically.
Version: 2.0
Author: YourName
*/

declare(strict_types=1);

defined('ABSPATH') or die('No script kiddies please!');

class User_Specific_Map_Radius {

    private string $allowed_users_option = 'usgrm_allowed_users';
    private string $general_settings_option = 'usgrm_general_settings'; // stores API key, actor ID, map config

    public function __construct() {
        add_shortcode('user_map_radius', [$this, 'render_map_shortcode']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('wp_footer', [$this, 'print_inline_js']); // print JS after scripts loaded
    }

    public function enqueue_scripts(): void {
        if (is_user_logged_in() && $this->current_user_allowed()) {
            wp_enqueue_script('google-maps-api', 'https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_MAPS_API_KEY', [], null, true);
            wp_enqueue_style('user-map-radius-css', plugin_dir_url(__FILE__) . 'user-map-radius.css');
        }
    }

    // Print config and JS for the map
    public function print_inline_js(): void {
        if (!is_user_logged_in() || !$this->current_user_allowed()) {
            return;
        }

        $settings     = get_option($this->general_settings_option, []);
        $center_lat   = isset($settings['center_lat']) ? (float) $settings['center_lat'] : 0.0;
        $center_lng   = isset($settings['center_lng']) ? (float) $settings['center_lng'] : 0.0;
        $radius       = isset($settings['radius']) ? (int) $settings['radius'] : 5000;
        $markers_data = $this->get_filtered_jobs();

        $map_data = [
            'lat'     => $center_lat,
            'lng'     => $center_lng,
            'radius'  => $radius,
            'markers' => $markers_data,
        ];

        echo '<script>window.userMapData = ' . wp_json_encode($map_data) . ";</script>\n";

        echo "<script>
        function initUserMapRadius() {
            const center = { lat: window.userMapData.lat, lng: window.userMapData.lng };
            const map = new google.maps.Map(document.getElementById('usgrm-map'), {
                zoom: 11,
                center: center,
            });

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

            window.userMapData.markers.forEach(marker => {
                const pinColor = marker.color === 'green' ? '00FF00' : '3366FF';
                const iconUrl = `https://chart.googleapis.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|${pinColor}`;
                const m = new google.maps.Marker({
                    position: { lat: marker.lat, lng: marker.lng },
                    map: map,
                    title: marker.title,
                    icon: { url: iconUrl },
                });
                if (marker.info) {
                    const infowindow = new google.maps.InfoWindow({ content: marker.info });
                    m.addListener('click', () => infowindow.open(map, m));
                }
            });
        }
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

    private function current_user_allowed(): bool {
        $allowed_users     = array_map('intval', get_option($this->allowed_users_option, []));
        return in_array(get_current_user_id(), $allowed_users, true);
    }

    /* -------------------------- Admin & Settings -------------------------- */

    public function add_admin_menu(): void {
        add_menu_page(
            __('User Map Radius', 'user-map-radius'),
            __('User Map Radius', 'user-map-radius'),
            'manage_options',
            'user-map-radius',
            [$this, 'render_settings_page'],
            'dashicons-location-alt',
            56
        );
    }

    public function register_settings(): void {
        register_setting('usgrm_settings_group', $this->allowed_users_option, [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize_user_ids'],
            'default'           => [],
        ]);

        register_setting('usgrm_settings_group', $this->general_settings_option, [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize_general_settings'],
            'default'           => [
                'api_key'        => '',
                'actor_id'       => '',
                'center_lat'     => '',
                'center_lng'     => '',
                'radius'         => 5000,
                'inside_outside' => 'inside',
            ],
        ]);
    }

    public function sanitize_user_ids($input): array {
        if (!is_array($input)) {
            return [];
        }
        return array_map('intval', $input);
    }

    public function sanitize_general_settings($input): array {
        if (!is_array($input)) {
            return [];
        }
        return [
            'api_key'        => isset($input['api_key']) ? sanitize_text_field($input['api_key']) : '',
            'actor_id'       => isset($input['actor_id']) ? sanitize_text_field($input['actor_id']) : '',
            'center_lat'     => isset($input['center_lat']) ? (float) $input['center_lat'] : '',
            'center_lng'     => isset($input['center_lng']) ? (float) $input['center_lng'] : '',
            'radius'         => isset($input['radius']) ? (int) $input['radius'] : 5000,
            'inside_outside' => isset($input['inside_outside']) && $input['inside_outside'] === 'outside' ? 'outside' : 'inside',
        ];
    }

    public function render_settings_page(): void {
        $allowed_users    = get_option($this->allowed_users_option, []);
        $general_settings = get_option($this->general_settings_option, []);
        ?>
        <div class="wrap">
            <h1>User Map Radius Settings</h1>
            <form method="post" action="options.php">
                <?php settings_fields('usgrm_settings_group'); ?>

                <h2><?php _e('General Settings', 'user-map-radius'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="usgrm_api_key"><?php _e('Apify API Key', 'user-map-radius'); ?></label></th>
                        <td><input name="<?php echo esc_attr($this->general_settings_option); ?>[api_key]" type="text" id="usgrm_api_key" value="<?php echo esc_attr($general_settings['api_key'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_actor_id"><?php _e('Apify Actor ID', 'user-map-radius'); ?></label></th>
                        <td><input name="<?php echo esc_attr($this->general_settings_option); ?>[actor_id]" type="text" id="usgrm_actor_id" value="<?php echo esc_attr($general_settings['actor_id'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_center_lat"><?php _e('Center Latitude', 'user-map-radius'); ?></label></th>
                        <td><input name="<?php echo esc_attr($this->general_settings_option); ?>[center_lat]" type="text" id="usgrm_center_lat" value="<?php echo esc_attr($general_settings['center_lat'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_center_lng"><?php _e('Center Longitude', 'user-map-radius'); ?></label></th>
                        <td><input name="<?php echo esc_attr($this->general_settings_option); ?>[center_lng]" type="text" id="usgrm_center_lng" value="<?php echo esc_attr($general_settings['center_lng'] ?? ''); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="usgrm_radius"><?php _e('Radius (meters)', 'user-map-radius'); ?></label></th>
                        <td><input name="<?php echo esc_attr($this->general_settings_option); ?>[radius]" type="number" id="usgrm_radius" value="<?php echo esc_attr($general_settings['radius'] ?? 5000); ?>" class="small-text" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><?php _e('Filter Mode', 'user-map-radius'); ?></th>
                        <td>
                            <fieldset>
                                <label><input name="<?php echo esc_attr($this->general_settings_option); ?>[inside_outside]" type="radio" value="inside" <?php checked(($general_settings['inside_outside'] ?? 'inside'), 'inside'); ?> /> <?php _e('Inside', 'user-map-radius'); ?></label><br />
                                <label><input name="<?php echo esc_attr($this->general_settings_option); ?>[inside_outside]" type="radio" value="outside" <?php checked(($general_settings['inside_outside'] ?? 'inside'), 'outside'); ?> /> <?php _e('Outside', 'user-map-radius'); ?></label>
                            </fieldset>
                        </td>
                    </tr>
                </table>
                <h2 style="margin-top:2em;">Allowed Users</h2>
                <p><?php _e('Select users allowed to view the map', 'user-map-radius'); ?></p>
                <select name="<?php echo esc_attr($this->allowed_users_option); ?>[]" multiple size="10" style="width:300px;">
                    <?php foreach (get_users() as $user) : ?>
                        <option value="<?php echo esc_attr($user->ID); ?>" <?php selected(in_array($user->ID, $allowed_users), true); ?>><?php echo esc_html($user->display_name . ' (' . $user->user_login . ')'); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public function render_map_shortcode(): string {
        if (!is_user_logged_in()) {
            return '<p>You must be logged in to view this map.</p>';
        }
        if (!$this->current_user_allowed()) {
            return '<p>You do not have permission to view this map.</p>';
        }
        return '<div id="usgrm-map" style="width:100%;height:500px;"></div>';
    }

    /* ------------------------------- Data ------------------------------- */

    private function fetch_apify_jobs(): array {
        $settings = get_option($this->general_settings_option, []);
        if (empty($settings['api_key']) || empty($settings['actor_id'])) {
            return [];
        }

        $cache_key = 'usgrm_jobs_' . md5($settings['actor_id']);
        if ($cached = get_transient($cache_key)) {
            return $cached;
        }

        $runs_url = sprintf('https://api.apify.com/v2/acts/%s/runs?limit=1&status=SUCCEEDED&token=%s', rawurlencode($settings['actor_id']), rawurlencode($settings['api_key']));
        $response = wp_remote_get($runs_url, ['timeout' => 15]);
        if (is_wp_error($response)) {
            return [];
        }
        $run_data = json_decode(wp_remote_retrieve_body($response), true);
        if (!isset($run_data['data'][0]['defaultDatasetId'])) {
            return [];
        }
        $dataset_id = $run_data['data'][0]['defaultDatasetId'];

        $dataset_url = sprintf('https://api.apify.com/v2/datasets/%s/items?token=%s&clean=1', rawurlencode($dataset_id), rawurlencode($settings['api_key']));
        $dataset_res = wp_remote_get($dataset_url, ['timeout' => 20]);
        if (is_wp_error($dataset_res)) {
            return [];
        }
        $items = json_decode(wp_remote_retrieve_body($dataset_res), true);
        if (!is_array($items)) {
            return [];
        }
        set_transient($cache_key, $items, 10 * MINUTE_IN_SECONDS);
        return $items;
    }

    private function get_filtered_jobs(): array {
        $settings = get_option($this->general_settings_option, []);
        $center_lat = isset($settings['center_lat']) ? (float) $settings['center_lat'] : 0.0;
        $center_lng = isset($settings['center_lng']) ? (float) $settings['center_lng'] : 0.0;
        $radius_m   = isset($settings['radius']) ? (int) $settings['radius'] : 5000;
        $mode       = $settings['inside_outside'] ?? 'inside';

        $jobs = $this->fetch_apify_jobs();
        $filtered = [];
        foreach ($jobs as $job) {
            if (!isset($job['location']['latitude'], $job['location']['longitude'])) {
                continue;
            }
            $lat      = (float) $job['location']['latitude'];
            $lng      = (float) $job['location']['longitude'];
            $distance = $this->haversine($center_lat, $center_lng, $lat, $lng);
            $include  = $mode === 'inside' ? $distance <= $radius_m : $distance > $radius_m;
            if (!$include) {
                continue;
            }
            $jobtype = strtolower($job['jobtype'] ?? 'full-time');
            $color   = $jobtype === 'part-time' ? 'green' : 'blue';

            $company       = $job['employer']['name'] ?? 'Company';
            $salary_string = '';
            if (isset($job['basesalary']['min'])) {
                $salary_string = $job['basesalary']['min'];
                if (isset($job['basesalary']['max'])) {
                    $salary_string .= ' - ' . $job['basesalary']['max'];
                }
                if (isset($job['basesalary']['currencyCode'])) {
                    $salary_string .= ' ' . $job['basesalary']['currencyCode'];
                }
            }
            $title     = $job['title'] ?? '';
            $marker_title = $company . ($salary_string ? ' - ' . $salary_string : '');

            $info_parts = [
                '<strong>' . esc_html($title) . '</strong>',
                esc_html($company),
                $salary_string,
                $job['location']['city'] ?? '',
                '<a href="' . esc_url($job['joburl'] ?? '#') . '" target="_blank" rel="noopener">View Job</a>',
            ];
            $info = implode('<br>', array_filter($info_parts));

            $filtered[] = [
                'lat'   => $lat,
                'lng'   => $lng,
                'title' => $marker_title,
                'info'  => $info,
                'color' => $color,
            ];
        }
        return $filtered;
    }

    private function haversine(float $lat1, float $lon1, float $lat2, float $lon2): float {
        $earth = 6371000;
        $dLat  = deg2rad($lat2 - $lat1);
        $dLon  = deg2rad($lon2 - $lon1);
        $a     = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 2 * $earth * atan2(sqrt($a), sqrt(1 - $a));
    }
}

new User_Specific_Map_Radius();
?>