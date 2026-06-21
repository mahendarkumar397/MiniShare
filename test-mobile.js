const { spawn } = require('child_process');
const fs = require('fs');

console.log("Starting backend server...");
const backend = spawn('npm.cmd', ['start'], { cwd: './server', shell: true });
backend.stdout.on('data', d => console.log('[Backend]', d.toString().trim()));
backend.stderr.on('data', d => console.log('[Backend Error]', d.toString().trim()));

console.log("Starting backend tunnel on port 3001...");
const backendTunnel = spawn('npx.cmd', ['--yes', 'localtunnel', '--port', '3001'], { cwd: './server', shell: true });

let frontend;
let frontendTunnel;

backendTunnel.stdout.on('data', (data) => {
    const output = data.toString();
    if (output.includes('your url is:')) {
        const url = output.split('your url is:')[1].trim();
        console.log(`\n---> Extracted Backend Tunnel URL: ${url}`);
        
        console.log("Writing to client/.env...");
        fs.writeFileSync('./client/.env', `VITE_SOCKET_URL=${url}\n`);
        
        console.log("Starting frontend server...");
        frontend = spawn('npm.cmd', ['run', 'dev'], { cwd: './client', shell: true });
        
        console.log("Starting frontend tunnel on port 5173...");
        frontendTunnel = spawn('npx.cmd', ['--yes', 'localtunnel', '--port', '5173'], { cwd: './client', shell: true });
        
        frontendTunnel.stdout.on('data', (data2) => {
            const output2 = data2.toString();
            if (output2.includes('your url is:')) {
                const f_url = output2.split('your url is:')[1].trim();
                console.log('\n=============================================================');
                console.log('✅ ALL SET! OPEN THIS URL ON YOUR IPHONE AND DESKTOP:');
                console.log('   ' + f_url);
                console.log('   (Note: Click "Continue to Website" on the initial screen)');
                console.log('=============================================================\n');
                console.log('Press Ctrl+C to stop all servers when you are done testing.');
            }
        });
        
        frontendTunnel.stderr.on('data', d => console.log('[Frontend Tunnel Error]', d.toString().trim()));
    }
});

backendTunnel.stderr.on('data', d => console.log('[Backend Tunnel Error]', d.toString().trim()));

process.on('SIGINT', () => {
    console.log("\nShutting down servers...");
    if (backend) backend.kill();
    if (frontend) frontend.kill();
    if (backendTunnel) backendTunnel.kill();
    if (frontendTunnel) frontendTunnel.kill();
    process.exit();
});
