const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  console.log('Navigating to live site...');
  await page.goto('https://jobradius.agent-swarm.net/');
  
  console.log('Setting theme to light (784c8b99db731157518b28d2) and reloading...');
  await page.evaluate(() => {
    localStorage.setItem('jobradius_map_theme', '784c8b99db731157518b28d2');
  });

  await page.reload(); // Soft refresh
  await page.waitForTimeout(2000); // Wait for scripts

  const htmlClasses = await page.evaluate(() => document.documentElement.className);
  const bodyClasses = await page.evaluate(() => document.body.className);
  console.log('- HTML Classes:', htmlClasses);
  console.log('- BODY Classes:', bodyClasses);

  const themeValue = await page.evaluate(() => localStorage.getItem('jobradius_map_theme'));
  console.log('- LocalStorage Theme:', themeValue);

  await browser.close();
})();
