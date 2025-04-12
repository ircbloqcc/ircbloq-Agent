const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const crypto = require('crypto');
const { extractFull } = require('node-7z');

const systemPlatform = os.platform();
const user = 'ircbloqcc';
const repo = 'ircbloq-tools';
const releaseApiUrl = `https://api.github.com/repos/${user}/${repo}/releases/latest`;

let path7za;

const isDev = process.env.NODE_ENV === 'development' || process.defaultApp || /[\\/]electron[\\/]/.test(process.execPath);

if (isDev) {
    // Use node_modules directly in dev mode
     path7za = require("7zip-bin").path7za;
} else {
    const prodBasePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin');
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'win32') {
        path7za = path.join(prodBasePath, 'win', arch === 'x64' ? 'x64' : 'ia32', '7za.exe');
    } else if (platform === 'darwin') {
        path7za = path.join(prodBasePath, 'mac', arch === 'x64' ? 'x64' : 'arm64  ','7za');
    } else {
        path7za = path.join(prodBasePath, 'linux', arch === 'x64' ? 'x64' : 'ia32','7za');
    }
}

if (!fs.existsSync(path7za)) {
    throw new Error(`7-Zip binary not found at resolved path: ${path7za}`);
}

// Make sure it's executable in dev too
if (process.platform !== 'win32') {
    fs.chmodSync(path7za, 0o755);
}

async function downloadToolsWithProgress(mainWindow, userDataPath) {
    const tmpDir = path.join(userDataPath, 'tmp');
    const toolExtractDir = path.join(userDataPath, 'tools');

    try {
        mainWindow.webContents.send('download-status', 'Checking for tool updates...');

        const { data } = await axios.get(releaseApiUrl);
        const assets = data.assets.filter(asset =>
            asset.name.endsWith('.7z') && asset.name.includes(systemPlatform)
        );

        if (!assets.length) {
            throw new Error(`No tools found for platform: ${systemPlatform}`);
        }

        let checksums = {};
        const checksumAsset = data.assets.find(asset =>
            asset.name.endsWith('-checksums-sha256.txt')
        );
        if (checksumAsset) {
            mainWindow.webContents.send('download-status', 'Fetching checksum file...');
            const res = await axios.get(checksumAsset.browser_download_url);
            res.data.split('\n').forEach(line => {
              const [checksum, filename] = line.trim().split(/\s+/);
                if (filename) checksums[filename] = checksum;
            });
        }

        for (const asset of assets) {
          const fileName = asset.name;
          const fileUrl = asset.browser_download_url;
          const filePath = path.join(tmpDir, fileName);
          const expectedChecksum = checksums[fileName] || null;
          const checksumFilePath = path.join(toolExtractDir, 'checksum.txt');
          if (fs.existsSync(toolExtractDir) && fs.existsSync(checksumFilePath)) {
              const existingChecksum = fs.readFileSync(checksumFilePath, 'utf8').trim();
              if (existingChecksum === expectedChecksum) {
                  mainWindow.webContents.send('download-status', `Tools already up-to-date. Skipping download.`);
                  return 'up-to-date';
              }
          }
          if (fs.existsSync(toolExtractDir)){
              const { response } = await dialog.showMessageBox(mainWindow, {
                  type: 'question',
                  buttons: ['Yes', 'No'],
                  defaultId: 0,
                  cancelId: 1,
                  title: 'Confirm Download',
                  message: `New Version of Tools Available: ${fileName}?`,
                  detail: `Proceed to download with New Update?`
              });

              if (response !== 0) {
                  mainWindow.webContents.send('download-status', 'Download aborted by user.');
                  return 'download-aborted';
              }
          }
          // Delete tools folder and old 7z file
          mainWindow.webContents.send('download-progress', {status: 'deleting'});
          fs.rmSync(toolExtractDir, { recursive: true, force: true });
          fs.rmSync(tmpDir, { recursive: true, force: true });
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          mainWindow.webContents.send('download-progress', {
              fileName,
              status: 'starting'
          });

          const { headers } = await axios.head(fileUrl);
          const fileSize = parseInt(headers['content-length'], 10);
          const res = await axios.get(fileUrl, { responseType: 'stream' });
          const writer = fs.createWriteStream(filePath);

          let downloaded = 0;
          res.data.on('data', chunk => {
              downloaded += chunk.length;
              const progress = Math.floor((downloaded / fileSize) * 100);
              mainWindow.webContents.send('download-progress', {
                  fileName,
                  progress,
                  status: 'downloading'
              });
          });

          await new Promise((resolve, reject) => {
              res.data.pipe(writer);
              writer.on('finish', resolve);
              writer.on('error', reject);
          });

          if (expectedChecksum) {
              const isValid = await verifyChecksum(filePath, expectedChecksum);
              if (!isValid) throw new Error(`Checksum mismatch for ${fileName}`);
          }

          await extract7zFile(filePath, fileName, toolExtractDir, mainWindow);

          // Save checksum after extraction
          fs.writeFileSync(checksumFilePath, expectedChecksum, 'utf8');
          mainWindow.webContents.send('download-progress', {
              fileName,
              progress: 100,
              status: 'extracted'
          });
      }

        mainWindow.webContents.send('download-complete');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return 'download-complete';

    } catch (error) {
        mainWindow.webContents.send('download-error', error.message);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        dialog.showMessageBox({
            type: 'error',
            message: 'Tool download failed',
            detail: error.message
        });
        return 'error';
    }
}

// Extraction helper
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

// Checksum helper
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
