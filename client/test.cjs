const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture console errors
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:5173');
  
  console.log('Page loaded. Waiting for file input...');
  await page.waitForSelector('#home-file-upload');
  
  // Create dummy files to upload
  const fs = require('fs');
  fs.writeFileSync('dummy1.txt', 'hello');
  fs.writeFileSync('dummy2.txt', 'world');
  
  // Select files
  const fileInput = await page.$('#home-file-upload');
  await fileInput.uploadFile('dummy1.txt', 'dummy2.txt');
  
  console.log('Files selected. Waiting 2 seconds...');
  await page.waitForTimeout(2000);
  
  // Check if we are in the waiting room (room code should be visible)
  const isWaiting = await page.evaluate(() => {
    return document.body.innerText.includes('Room Code');
  });
  
  console.log('Is in waiting room?', isWaiting);
  
  // Cleanup
  fs.unlinkSync('dummy1.txt');
  fs.unlinkSync('dummy2.txt');
  await browser.close();
})();
