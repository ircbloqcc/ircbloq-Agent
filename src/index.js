const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const os =require('os');
const electron = require('electron');
const IrcBloqLink = require('ircbloq-link');

//const IrcBloqDevice = require('ircbloq-device');
//const IrcBloqExtension = require('ircbloq-extension');
const IrcbloqResourceServer =require('ircbloq-resource');
const {execFile, spawn, execSync} = require('child_process');
const fs = require('fs');
const compareVersions = require('compare-versions');
const del = require('del');
const {productName, version} = require('../package.json')

const Menu = electron.Menu;
const Tray = electron.Tray;
var appTray = null;

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, './icon/IrcBloq-Link.ico'),
        width: 400,
        height: 400,
        center: true,
        resizable: false,
        fullscreenable: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
        }
    })

    mainWindow.loadFile('./src/index.html');
    mainWindow.setMenu(null)

    const userDataPath = app.getPath(
        'userData'
    );
    const dataPath = path.join(userDataPath, 'Data');

    const appPath = app.getAppPath();

    const appVersion = app.getVersion();

    // if current version is newer then cache log, delet the data cache dir and write the
    // new version into the cache file.
    const applicationConfig = path.join(userDataPath, 'application.json');
    if (fs.existsSync(applicationConfig)) {
        const oldVersion = JSON.parse(fs.readFileSync(applicationConfig)).version;
        if (compareVersions.compare(appVersion, oldVersion, '>')) {
            if (fs.existsSync(dataPath)) {
                del.sync([dataPath], {force: true});
            }
            fs.writeFileSync(applicationConfig, JSON.stringify({version: appVersion}));
        }
    } else {
        if (fs.existsSync(dataPath)) {
            del.sync([dataPath], {force: true});
        }
        fs.writeFileSync(applicationConfig, JSON.stringify({version: appVersion}));
    }

    let resourcePath;
    if (appPath.search(/app.asar/g) === -1) {
        resourcePath = path.join(appPath, 'external-resources');
    } else { // eslint-disable-line no-negated-condition
        resourcePath = path.join(appPath, '../external-resources');
    }

    let toolsPath;
    if (appPath.search(/app.asar/g) === -1) {
        toolsPath = path.join(appPath, "tools");
    } else {
        toolsPath = path.join(appPath, "../tools");
    }
    const link = new IrcBloqLink(dataPath, toolsPath);
    link.listen();

    // start resource server
    resourceServer = new IrcbloqResourceServer(dataPath, resourcePath);
    resourceServer.listen();

    const trayMenuTemplate = [
        {
            label: 'Go to Online IrcBloqV4',
            click: function () {
              if ((os.platform() === 'win32')) {
                 execSync('start https://ircbloqcc.github.io/ircbloq/');
             } else if ((os.platform() === 'darwin')) {
                 execSync('open https://ircbloqcc.github.io/ircbloq/');
             }
            }
        },
        {
          label: 'Install Driver',
          click: function(){
            const driverPath = path.join(resourcePath, '../drivers');
            if ((os.platform() === 'win32') && (os.arch() === 'x64')) {
                execFile('install_x64.bat', [], {cwd: driverPath});
            } else if ((os.platform() === 'win32') && (os.arch() === 'ia32')) {
                execFile('install_x86.bat', [], {cwd: driverPath});
            } else if ((os.platform() === 'darwin')) {
                spawn('sh', ['install.sh'], {shell: true, cwd: driverPath});
            }
          }
        },
        {
            label: 'exit',
            click: function () {
                appTray.destroy();
                mainWindow.destroy();
            }
        }
        // TODO: Add a button to clear cthe cache in app path.
    ];

    appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.ico')));
    const contextMenu = Menu.buildFromTemplate(trayMenuTemplate);
    appTray.setToolTip('IrcBloq Link');
    appTray.setContextMenu(contextMenu);

    appTray.on('click',function(){
        mainWindow.show();
    })

    mainWindow.on('close', (event) => {
        mainWindow.hide();
        event.preventDefault();
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    })
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.show()
    }
  })

  app.on('ready', createWindow);
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
})

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }

})
