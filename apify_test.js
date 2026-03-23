const { ApifyClient } = require('apify-client');
const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

(async () => {
    console.log("Starting Apify with ONLY startUrls...");
    const input = {
        startUrls: [{ url: "https://ca.indeed.com/jobs?q=mechanic&l=Vancouver%2C+BC" }],
        maxItems: 20
    };
    
    try {
        const run = await client.actor('valig/indeed-jobs-scraper').start(input);
        console.log("Run started:", run.id);
        const finishedRun = await client.run(run.id).waitForFinish({ waitSecs: 180 });
        console.log("Run status:", finishedRun.status);
        const { items } = await client.dataset(finishedRun.defaultDatasetId).listItems();
        console.log("Items returned:", items.length);
        if (items.length > 0) {
            console.log("Top 5 titles:");
            items.slice(0, 5).forEach((j, i) => console.log(i+1, j.title));
        }
    } catch (err) {
        console.error("Deploy err", err);
    }
})();
