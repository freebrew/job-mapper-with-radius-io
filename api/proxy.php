<?php
/**
 * JobRadius API Reverse Proxy
 * Forwards /api/* requests to the Node.js backend on port 3001.
 * Handles GET, POST, PUT, PATCH, DELETE, OPTIONS.
 *
 * For /api/jobs/search: streams the response in real-time (NDJSON).
 * For all other endpoints: buffers and forwards as before.
 */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// CORS preflight — return immediately
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

// Build target URL from the current request URI (preserve path + query string)
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$targetUrl  = 'http://127.0.0.1:3000' . $requestUri;

// Read the raw request body (works for POST/PUT/PATCH with any content-type)
$inputBody = file_get_contents('php://input');

// Forward headers that Node needs
$forwardHeaders = [];
$rawHeaders = getallheaders();
foreach ($rawHeaders as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, ['authorization', 'content-type', 'accept', 'x-requested-with', 'stripe-signature'])) {
        $forwardHeaders[] = "$name: $value";
    }
}

// Always declare content-length to prevent chunked-encoding mismatches
if ($inputBody !== '') {
    $forwardHeaders[] = 'Content-Length: ' . strlen($inputBody);
}

// ── Detect if this is a streaming endpoint ──
$isStreaming = (strpos($requestUri, '/api/jobs/search') !== false && $method === 'POST');

if ($isStreaming) {
    // ────────────────────────────────────────────────────────────────
    // STREAMING MODE: Forward chunks in real-time using CURLOPT_WRITEFUNCTION
    // ────────────────────────────────────────────────────────────────

    // CORS + streaming headers
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Content-Type: application/x-ndjson');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no'); // Disable nginx/proxy buffering if present

    // Disable PHP output buffering
    while (ob_get_level()) { ob_end_flush(); }
    if (function_exists('apache_setenv')) {
        apache_setenv('no-gzip', '1');
    }
    ini_set('zlib.output_compression', 'Off');

    $headersParsed = false;
    $httpCode = 200;

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $targetUrl,
        CURLOPT_RETURNTRANSFER => false,  // Don't buffer!
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_POSTFIELDS     => ($inputBody !== '') ? $inputBody : null,
        CURLOPT_HTTPHEADER     => $forwardHeaders,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 330,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADER         => false,
        CURLOPT_HEADERFUNCTION => function($ch, $headerLine) use (&$httpCode) {
            // Capture status code from response headers
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $headerLine, $m)) {
                $httpCode = (int)$m[1];
                http_response_code($httpCode);
            }
            return strlen($headerLine);
        },
        CURLOPT_WRITEFUNCTION  => function($ch, $data) {
            echo $data;
            flush();
            return strlen($data);
        },
    ]);

    $result = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlErrno !== 0) {
        // Connection failure — Node is down
        echo json_encode(['type' => 'error', 'message' => 'Backend unavailable: ' . $curlError]) . "\n";
    }

    exit;
}

// ────────────────────────────────────────────────────────────────
// STANDARD MODE: Buffer entire response (non-streaming endpoints)
// ────────────────────────────────────────────────────────────────
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_POSTFIELDS     => ($inputBody !== '') ? $inputBody : null,
    CURLOPT_HTTPHEADER     => $forwardHeaders,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT        => 30,    // Normal endpoints don't need long timeouts
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_HEADER         => true,  // Include response headers in return value
]);

$rawResponse = curl_exec($ch);
$httpCode    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize  = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlErrno   = curl_errno($ch);
$curlError   = curl_error($ch);
curl_close($ch);

// Connection failure — Node is down
if ($rawResponse === false || $curlErrno !== 0) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode([
        'error'  => 'Backend service unavailable',
        'detail' => $curlError ?: 'curl errno ' . $curlErrno,
        'port'   => 3000,
    ]);
    exit;
}

// Split headers and body from the curl response
$responseHeaders = substr($rawResponse, 0, $headerSize);
$responseBody    = substr($rawResponse, $headerSize);

// Forward safe response headers from Node
$skipHeaders = ['transfer-encoding', 'connection', 'keep-alive', 'server'];
foreach (explode("\r\n", $responseHeaders) as $line) {
    if (!preg_match('/^([^:]+):\s*(.+)$/', $line, $m)) continue;
    $hName  = $m[1];
    $hValue = $m[2];
    $hLower = strtolower($hName);
    if (!in_array($hLower, $skipHeaders)) {
        if (in_array($hLower, ['content-type', 'cache-control', 'set-cookie', 'www-authenticate',
                                'x-ratelimit-limit', 'x-ratelimit-remaining'])) {
            header("$hName: $hValue", false);
        }
    }
}

// CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Ensure content-type is always set (use Node's or fallback to JSON)
if (!$contentType) {
    header('Content-Type: application/json');
}

http_response_code($httpCode);
echo $responseBody;
