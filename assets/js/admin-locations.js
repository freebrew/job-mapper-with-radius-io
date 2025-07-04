/**
 * Admin interface JavaScript for User Map Radius plugin
 * Handles Google Places API integration, dynamic form management, and AJAX operations
 */

(function($) {
    'use strict';

    let map, placesService, autocompleteFields = [];

    /**
     * Initialize the admin interface
     */
     function initAdmin() {
        initTabSwitching();
        initLocationManagement();
        initAjaxHandlers();
        initCronControls();
        updateCronStatus();
        
        // Initialize Google Places - will be called by callback or retry mechanism
        initGooglePlaces();
    }

    /**
     * Global callback function for Google Maps API
     * This is called by the Google Maps API when it's loaded
     */
    window.initAdminGooglePlaces = function() {
        console.log('Google Maps API loaded via callback');
        initGooglePlaces();
    };

    /**
     * Initialize Google Places API for address autocomplete
     */
    function initGooglePlaces() {
        console.log('initGooglePlaces called');
        
        if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
            console.warn('Google Maps API or Places library not loaded, will retry in 1 second');
            setTimeout(initGooglePlaces, 1000);
            return;
        }

        console.log('Google Maps API and Places library loaded successfully');

        // Prevent duplicate initialization
        if (map && placesService) {
            console.log('Google Places already initialized, skipping');
            return;
        }

        // Initialize map for Places service
        const mapDiv = document.createElement('div');
        map = new google.maps.Map(mapDiv, {
            center: { lat: 0, lng: 0 },
            zoom: 1
        });
        placesService = new google.maps.places.PlacesService(map);

        // Initialize existing autocomplete fields (avoid duplicates)
        $('.location-address-input').each(function() {
            // Check if this field already has autocomplete initialized
            if (!$(this).data('autocomplete-initialized')) {
                console.log('Initializing autocomplete for existing field:', this);
                initAutocomplete(this);
                $(this).data('autocomplete-initialized', true);
            }
        });
        
        console.log('Google Places initialization complete');
    }

    /**
     * Initialize autocomplete for a specific input field
     */
    function initAutocomplete(input) {
        console.log('Initializing autocomplete for input:', input);
        
        if (!google || !google.maps || !google.maps.places) {
            console.error('Google Maps API not loaded properly');
            console.log('google:', typeof google);
            console.log('google.maps:', typeof google?.maps);
            console.log('google.maps.places:', typeof google?.maps?.places);
            return false;
        }

        // Check if already initialized
        if ($(input).data('autocomplete-initialized')) {
            console.log('Autocomplete already initialized for this input, skipping');
            return true;
        }

        console.log('Google Maps API is available, creating autocomplete');

        try {
            const autocomplete = new google.maps.places.Autocomplete(input, {
                types: ['geocode'],
                fields: ['address_components', 'formatted_address', 'geometry']
            });

            autocomplete.addListener('place_changed', function() {
                console.log('Place changed event triggered');
                const place = autocomplete.getPlace();
                console.log('Selected place:', place);
                
                if (!place.geometry) {
                    console.error('No geometry found for selected place');
                    return;
                }

                const $row = $(input).closest('.location-row');
                console.log('Found location row:', $row.length);
                
                const lat = place.geometry.location.lat();
                const lng = place.geometry.location.lng();
                console.log('Coordinates:', lat, lng);

                const $latInput = $row.find('.location-lat-input');
                const $lngInput = $row.find('.location-lng-input');
                
                console.log('Lat input found:', $latInput.length);
                console.log('Lng input found:', $lngInput.length);

                if ($latInput.length && $lngInput.length) {
                    $latInput.val(lat.toFixed(6));
                    $lngInput.val(lng.toFixed(6));
                    
                    // Update address field with formatted address
                    $(input).val(place.formatted_address);
                    
                    console.log('Coordinates updated - Lat:', $latInput.val(), 'Lng:', $lngInput.val());
                    
                    // Trigger change event to ensure any other handlers are notified
                    $latInput.trigger('change');
                    $lngInput.trigger('change');
                } else {
                    console.error('Could not find lat/lng input fields in the location row');
                }
            });

            autocompleteFields.push(autocomplete);
            $(input).data('autocomplete-initialized', true);
            console.log('Autocomplete field added to array. Total fields:', autocompleteFields.length);
            return true;
            
        } catch (error) {
            console.error('Error initializing autocomplete:', error);
            return false;
        }
    }

    /**
     * Initialize tab switching functionality
     */
    function initTabSwitching() {
        $('.nav-tab').on('click', function(e) {
            e.preventDefault();
            
            const targetTab = $(this).data('tab');
            
            // Update active tab
            $('.nav-tab').removeClass('nav-tab-active');
            $(this).addClass('nav-tab-active');
            
            // Show target tab content
            $('.tab-content').hide();
            $('#' + targetTab).show();
            
            // Save active tab in URL hash
            window.location.hash = targetTab;
        });

        // Restore active tab from URL hash
        if (window.location.hash) {
            const activeTab = window.location.hash.substring(1);
            $('.nav-tab[data-tab="' + activeTab + '"]').click();
        }
    }

    /**
     * Initialize location management (add/remove locations)
     */
    function initLocationManagement() {
        // Add location button
        $('#add-location').on('click', function() {
            console.log('Add location button clicked');
            const template = $('#location-row-template').html();
            console.log('Template HTML:', template);
            
            if (!template) {
                console.error('Location row template not found!');
                return;
            }
            
            const newRow = $(template);
            const index = $('.location-row').length;
            console.log('New location index:', index);
            
            // Update field names and IDs
            newRow.find('input, select').each(function() {
                const name = $(this).attr('name');
                const id = $(this).attr('id');
                
                if (name) {
                    const newName = name.replace('[0]', '[' + index + ']');
                    $(this).attr('name', newName);
                    console.log('Updated name:', name, '->', newName);
                }
                if (id) {
                    const newId = id.replace('_0', '_' + index);
                    $(this).attr('id', newId);
                    console.log('Updated id:', id, '->', newId);
                }
            });
            
            $('#locations-container').append(newRow);
            console.log('New location row added');
            
            // Initialize autocomplete for new address field with enhanced retry mechanism
            const addressInput = newRow.find('.location-address-input')[0];
            if (addressInput) {
                console.log('Attempting to initialize autocomplete for new address field');
                
                                 // Function to try initializing autocomplete
                 function tryInitAutocomplete(retryCount = 0) {
                     if (typeof google !== 'undefined' && google.maps && google.maps.places) {
                         console.log('Google Maps API available, initializing autocomplete (attempt ' + (retryCount + 1) + ')');
                         const success = initAutocomplete(addressInput);
                         if (success) {
                             console.log('Autocomplete successfully initialized for new location');
                             return true;
                         } else if (retryCount < 5) {
                             console.log('Autocomplete initialization failed, retrying...');
                             setTimeout(function() {
                                 tryInitAutocomplete(retryCount + 1);
                             }, 300);
                         } else {
                             console.error('Failed to initialize autocomplete after 5 attempts');
                         }
                     } else if (retryCount < 10) {
                         console.log('Google Maps API not ready, retrying in ' + (retryCount + 1) * 200 + 'ms (attempt ' + (retryCount + 1) + '/10)');
                         setTimeout(function() {
                             tryInitAutocomplete(retryCount + 1);
                         }, (retryCount + 1) * 200);
                     } else {
                         console.error('Failed to initialize autocomplete after 10 attempts - Google Maps API not available');
                     }
                     return false;
                 }
                
                // Try to initialize immediately and with retries
                tryInitAutocomplete();
            } else {
                console.error('Address input not found in new row');
            }
        });

        // Remove location button (delegated event)
        $(document).on('click', '.remove-location', function() {
            if ($('.location-row').length > 1) {
                $(this).closest('.location-row').remove();
                reindexLocationRows();
                console.log('Location removed and rows reindexed');
            } else {
                console.log('Cannot remove last location row');
            }
        });
    }

    /**
     * Reindex location rows after removal
     */
    function reindexLocationRows() {
        $('.location-row').each(function(index) {
            $(this).find('input, select').each(function() {
                const name = $(this).attr('name');
                const id = $(this).attr('id');
                
                if (name) {
                    $(this).attr('name', name.replace(/\[\d+\]/, '[' + index + ']'));
                }
                if (id) {
                    $(this).attr('id', id.replace(/_\d+/, '_' + index));
                }
            });
        });
    }

    /**
     * Initialize AJAX handlers
     */
    function initAjaxHandlers() {
        // Test API connection
        $('#test-apify-connection').on('click', function() {
            const $button = $(this);
            const $status = $('#connection-status');
            
            $button.prop('disabled', true).text('Testing...');
            $status.html('<span class="spinner is-active"></span> Testing connection...');
            
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'usgrm_test_apify_connection',
                    nonce: usgrm_admin.nonce,
                    apify_token: $('#apify_token').val(),
                    apify_actor: $('#apify_actor').val()
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span style="color: green;">✓ ' + response.data.message + '</span>');
                    } else {
                        $status.html('<span style="color: red;">✗ ' + response.data.message + '</span>');
                    }
                },
                error: function(xhr, status, error) {
                    $status.html('<span style="color: red;">✗ Connection failed: ' + error + '</span>');
                },
                complete: function() {
                    $button.prop('disabled', false).text('Test Connection');
                }
            });
        });

        // Manual sync
        $('#manual-sync').on('click', function() {
            const $button = $(this);
            const $status = $('#sync-status');
            
            $button.prop('disabled', true).text('Syncing...');
            $status.html('<span class="spinner is-active"></span> Synchronizing data...');
            
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'usgrm_manual_sync',
                    nonce: usgrm_admin.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="dashicons dashicons-yes-alt" style="color: green;"></span> ' + response.data.message);
                        updateSyncLog();
                    } else {
                        $status.html('<span class="dashicons dashicons-dismiss" style="color: red;"></span> ' + response.data.message);
                    }
                },
                error: function() {
                    $status.html('<span class="dashicons dashicons-dismiss" style="color: red;"></span> Sync failed');
                },
                complete: function() {
                    $button.prop('disabled', false).text('Sync Now');
                }
            });
        });

        // Save cron settings
        $('#save-cron-settings').on('click', function() {
            const $button = $(this);
            
            $button.prop('disabled', true).text('Saving...');
            
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'usgrm_save_cron_settings',
                    nonce: usgrm_admin.nonce,
                    cron_frequency: $('#cron_frequency').val(),
                    cache_hours: $('#cache_hours').val()
                },
                success: function(response) {
                    if (response.success) {
                        showNotice('Cron settings saved successfully', 'success');
                        updateCronStatus();
                    } else {
                        showNotice('Failed to save cron settings: ' + response.data.message, 'error');
                    }
                },
                error: function() {
                    showNotice('Failed to save cron settings', 'error');
                },
                complete: function() {
                    $button.prop('disabled', false).text('Save Cron Settings');
                }
            });
        });
    }

    /**
     * Initialize cron control functionality
     */
    function initCronControls() {
        // Update cron status periodically
        setInterval(updateCronStatus, 30000); // Every 30 seconds
    }

    /**
     * Update cron status display
     */
    function updateCronStatus() {
        $.ajax({
            url: ajaxurl,
            type: 'POST',
            data: {
                action: 'usgrm_get_cron_status',
                nonce: usgrm_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    $('#cron-status').html(response.data.status_html);
                    $('#cache-info').html(response.data.cache_info);
                }
            }
        });
    }

    /**
     * Update sync log display
     */
    function updateSyncLog() {
        $.ajax({
            url: ajaxurl,
            type: 'POST',
            data: {
                action: 'usgrm_get_sync_log',
                nonce: usgrm_admin.nonce
            },
            success: function(response) {
                if (response.success) {
                    $('#sync-log').html(response.data.log_html);
                }
            }
        });
    }

    /**
     * Show admin notice
     */
    function showNotice(message, type) {
        const noticeClass = type === 'success' ? 'notice-success' : 'notice-error';
        const notice = $('<div class="notice ' + noticeClass + ' is-dismissible"><p>' + message + '</p></div>');
        
        $('.wrap h1').after(notice);
        
        // Auto-dismiss after 5 seconds
        setTimeout(function() {
            notice.fadeOut();
        }, 5000);
    }

    /**
     * Mobile responsive adjustments
     */
    function initMobileResponsive() {
        // Handle mobile tab navigation
        if (window.innerWidth < 768) {
            $('.nav-tab-wrapper').addClass('mobile-tabs');
        }

        $(window).on('resize', function() {
            if (window.innerWidth < 768) {
                $('.nav-tab-wrapper').addClass('mobile-tabs');
            } else {
                $('.nav-tab-wrapper').removeClass('mobile-tabs');
            }
        });
    }

    /**
     * Initialize geolocation testing
     */
    function initGeolocationTest() {
        $('#test-geolocation').on('click', function() {
            const $button = $(this);
            const $status = $('#geolocation-status');
            
            if (!navigator.geolocation) {
                $status.html('<span class="dashicons dashicons-dismiss" style="color: red;"></span> Geolocation not supported');
                return;
            }
            
            $button.prop('disabled', true).text('Getting location...');
            $status.html('<span class="spinner is-active"></span> Getting your location...');
            
            navigator.geolocation.getCurrentPosition(
                function(position) {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    $status.html('<span class="dashicons dashicons-yes-alt" style="color: green;"></span> Location: ' + lat.toFixed(6) + ', ' + lng.toFixed(6));
                    $button.prop('disabled', false).text('Test Geolocation');
                },
                function(error) {
                    let message = 'Geolocation failed';
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            message = 'Location access denied by user';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            message = 'Location information unavailable';
                            break;
                        case error.TIMEOUT:
                            message = 'Location request timed out';
                            break;
                    }
                    $status.html('<span class="dashicons dashicons-dismiss" style="color: red;"></span> ' + message);
                    $button.prop('disabled', false).text('Test Geolocation');
                }
            );
        });
    }

    // Initialize when document is ready
    $(document).ready(function() {
        initAdmin();
        initMobileResponsive();
        initGeolocationTest();
        
        // Debug form submission
        $('form').on('submit', function() {
            console.log('Form being submitted');
            const formData = new FormData(this);
            console.log('Form data:');
            for (let [key, value] of formData.entries()) {
                if (key.includes('locations')) {
                    console.log(key, '=', value);
                }
            }
        });
    });

    // Fallback: Try to initialize if Google is already loaded when document is ready
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
        console.log('Google Maps already loaded, initializing immediately');
        setTimeout(initGooglePlaces, 100); // Small delay to ensure DOM is ready
    }

})(jQuery); 