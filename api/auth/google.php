<?php
// Proxy /api/auth/google to the new Express server on port 3001
// This bypasses the global Apache ProxyPass to port 3000 for this specific endpoint

$input = file_get_contents('php://input');
$headers = ['Content-Type: application/json'];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'http://127.0.0.1:3001/api/auth/google',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $input,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 30,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

http_response_code($httpCode);
header('Content-Type: ' . ($contentType ?: 'application/json'));
header('Access-Control-Allow-Origin: https://jobradius.agent-swarm.net');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

echo $response;
