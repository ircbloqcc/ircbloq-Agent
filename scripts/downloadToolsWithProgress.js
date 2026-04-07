const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const crypto = require('crypto');
const { extractFull } = require('node-7z');

const systemPlatform = os.platform();

const platformMap = {
    win32: 'win32',
    darwin: 'darwin',
    linux: 'linux'
};

const platformName = platformMap[systemPlatform];

const user = 'ircbloqcc';
const repo = 'ircbloq-tools';
const releaseApiUrl = `https://api.github.com/repos/${user}/${repo}/releases/latest`;

let path7za;

const isDev = process.env.NODE_ENV === 'development' || process.defaultApp || /[\\/]electron[\\/]/.test(process.execPath);

if (isDev) {
    path7za = require("7zip-bin").path7za;
} else {
    const prodBasePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin');
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') {
        path7za = path.join(prodBasePath, 'win', arch === 'x64' ? 'x64' : 'ia32', '7za.exe');
    } else if (platform === 'darwin') {
        path7za = path.join(prodBasePath, 'mac', arch === 'x64' ? 'x64' : 'arm64', '7za');
    } else {
        path7za = path.join(prodBasePath, 'linux', arch === 'x64' ? 'x64' : 'ia32', '7za');
    }
}

if (!fs.existsSync(path7za)) {
    throw new Error(`7-Zip binary not found at: ${path7za}`);
}

// ---------------- MAIN FUNCTION ----------------

async function downloadToolsWithProgress(mainWindow, userDataPath) {
    const tmpDir = path.join(userDataPath, 'tmp');
    const toolExtractDir = path.join(userDataPath, 'tools');
    const checksumFilePath = path.join(toolExtractDir, 'checksum.txt');
    const versionFilePath = path.join(toolExtractDir, 'version');

    try {
        mainWindow.webContents.send('download-status', 'Checking for tool updates...');

        const { data } = await retryAxiosGet(releaseApiUrl);

        if (!data || !data.assets) {
            throw new Error("Invalid GitHub release response");
        }

        const toolsVersion = data.tag_name;

        console.log("Available assets:", data.assets.map(a => a.name));

        // ---------------- VERSION CHECK (PRIMARY) ----------------
        if (fs.existsSync(versionFilePath)) {
            const existingVersion = fs.readFileSync(versionFilePath, 'utf8').trim();

            if (existingVersion === toolsVersion) {
                mainWindow.webContents.send('download-status', 'Tools already up-to-date.');
                return 'up-to-date';
            }
        }

        // ---------------- SELECT ASSET ----------------
        const assets = data.assets.filter(asset =>
            asset.name.endsWith('.7z') &&
            asset.name.toLowerCase().includes(platformName)
        );

        if (!assets.length) {
            throw new Error(`No tools found for platform: ${platformName}`);
        }

        // ---------------- CHECKSUM ----------------
        let checksums = {};

        const checksumAsset = data.assets.find(asset =>
            asset.name.endsWith('-checksums-sha256.txt')
        );

        if (checksumAsset && checksumAsset.browser_download_url) {
            console.log("Checksum URL:", checksumAsset.browser_download_url);

            const res = await retryAxiosGet(checksumAsset.browser_download_url, {
                responseType: 'text'
            });

            if (!res || !res.data) {
                throw new Error("Checksum download failed");
            }

            res.data.toString().split('\n').forEach(line => {
                line = line.trim();
                if (!line) return;

                const parts = line.split(/\s+/);
                if (parts.length < 2) return;

                const checksum = parts[0].trim();
                const filename = parts[1].trim();

                checksums[filename] = checksum;
            });

            console.log("Parsed checksums:", checksums);
        }

        // ---------------- DOWNLOAD LOOP ----------------
        for (const asset of assets) {
            const fileName = asset.name;
            const fileUrl = asset.browser_download_url;

            const expectedChecksum = (checksums[fileName] || '').trim();

            console.log("Selected file:", fileName);
            console.log("Expected checksum:", expectedChecksum);

            const filePath = path.join(tmpDir, fileName);

            // ---------------- CHECKSUM CHECK (SECONDARY) ----------------
            if (fs.existsSync(checksumFilePath) && expectedChecksum) {
                const existingChecksum = fs.readFileSync(checksumFilePath, 'utf8').trim();

                if (existingChecksum === expectedChecksum) {
                    mainWindow.webContents.send('download-status', 'Tools already up-to-date.');
                    return 'up-to-date';
                }
            }

            // Confirm overwrite
            if (fs.existsSync(toolExtractDir)) {
                const { response } = await dialog.showMessageBox(mainWindow, {
                    type: 'question',
                    buttons: ['Yes', 'No'],
                    defaultId: 0,
                    cancelId: 1,
                    title: 'Update Tools',
                    message: `New Version Available: ${fileName}`,
                    detail: `Proceed to update tools?`
                });

                if (response !== 0) {
                    return 'download-aborted';
                }
            }

            // Cleanup
            fs.rmSync(toolExtractDir, { recursive: true, force: true });
            fs.rmSync(tmpDir, { recursive: true, force: true });
            fs.mkdirSync(tmpDir, { recursive: true });

            // ---------------- DOWNLOAD ----------------
            const { headers } = await retryAxiosHead(fileUrl);
            const fileSize = parseInt(headers['content-length'], 10) || 0;

            const res = await retryAxiosGet(fileUrl, {
                responseType: 'stream'
            });

            if (!res || !res.data) {
                throw new Error("Download failed (empty stream)");
            }

            const writer = fs.createWriteStream(filePath);

            let downloaded = 0;

            res.data.on('data', chunk => {
                downloaded += chunk.length;

                if (fileSize > 0) {
                    const progress = Math.floor((downloaded / fileSize) * 100);
                    mainWindow.webContents.send('download-progress', {
                        fileName,
                        progress,
                        status: 'downloading'
                    });
                }
            });

            await new Promise((resolve, reject) => {
                res.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // ---------------- VERIFY ----------------
            if (expectedChecksum) {
                const isValid = await verifyChecksum(filePath, expectedChecksum);
                if (!isValid) throw new Error("Checksum mismatch");
            }

            // ---------------- EXTRACT ----------------
            await extract7zFile(filePath, fileName, toolExtractDir, mainWindow);

            // Save metadata
            fs.writeFileSync(checksumFilePath, expectedChecksum || '', 'utf8');
            fs.writeFileSync(versionFilePath, toolsVersion, 'utf8');
        }

        fs.rmSync(tmpDir, { recursive: true, force: true });

        mainWindow.webContents.send('download-complete');
        return 'download-complete';

    } catch (error) {
        console.error("ERROR:", error);

        fs.rmSync(tmpDir, { recursive: true, force: true });

        mainWindow.webContents.send('download-error', error.message);

        dialog.showMessageBox({
            type: 'error',
            message: 'Tool download failed',
            detail: error.message
        });

        return 'error';
    }
}

// ---------------- HELPERS ----------------

async function retryAxiosGet(url, config = {}, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'electron-app' },
                ...config
            });
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function retryAxiosHead(url, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.head(url, {
                headers: { 'User-Agent': 'electron-app' }
            });
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function extract7zFile(filePath, fileName, outputDir, mainWindow) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const stream = extractFull(filePath, outputDir, {
            $bin: path7za,
            $progress: true
        });

        stream.on('progress', progress => {
            mainWindow.webContents.send('extract-progress', {
                fileName,
                percent: Math.floor(progress.percent)
            });
        });

        stream.on('end', resolve);
        stream.on('error', reject);
    });
}

function verifyChecksum(filePath, expectedChecksum) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => {
            const actual = hash.digest('hex');
            resolve(actual === expectedChecksum.toLowerCase());
        });
        stream.on('error', reject);
    });
}

module.exports = { downloadToolsWithProgress }; 
