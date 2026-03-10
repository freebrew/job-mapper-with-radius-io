const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(4000); 
  
  try {
    const searchBtn = await page.$('#btn-search');
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(5000); // Wait for results

    await page.screenshot({ path: '/home/agent-swarm/.gemini/antigravity/brain/dd859f7e-c623-4354-bf26-dc16954718f3/mobile_job_pin.png' });
    
    const pin = await page.$('.jo-collapsed');
    if (pin) {
      await pin.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: '/home/agent-swarm/.gemini/antigravity/brain/dd859f7e-c623-4354-bf26-dc16954718f3/mobile_job_fullscreen.png' });
      
      const routeBtn = await page.$('#btn-route-here');
      if (routeBtn) {
        await routeBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/home/agent-swarm/.gemini/antigravity/brain/dd859f7e-c623-4354-bf26-dc16954718f3/mobile_job_routing.png' });
      }
    } else {
      console.log('No pin found to click.');
    }
  } catch(e) { console.error(e); }

  await browser.close();
})();
