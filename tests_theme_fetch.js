const https = require('https');

https.get('https://jobradius.agent-swarm.net/', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const scriptTag = body.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
    if (!scriptTag) return console.log("No module script found");
    const scriptUrl = 'https://jobradius.agent-swarm.net' + scriptTag[1];
    https.get(scriptUrl, (sRes) => {
      let sBody = '';
      sRes.on('data', chunk => sBody += chunk);
      sRes.on('end', () => {
        const start = sBody.indexOf('(function');
        const end = sBody.indexOf('})();', start) + 5;
        console.log("Script snippet executing IIFE:\\n" + sBody.substring(start, end));
      });
    });
  });
});
