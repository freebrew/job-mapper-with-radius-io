const http = require('http');

const data = JSON.stringify({
  query: 'labourer',
  location: 'Calgary, AB',
  centerLat: 51.0447,
  centerLng: -114.0719,
  radiuses: [{type: 'inclusive', radiusMeters: 10000, lat: 51.0447, lng: -114.0719}]
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/jobs/search',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);

  res.on('data', d => {
    process.stdout.write(d);
  });
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
