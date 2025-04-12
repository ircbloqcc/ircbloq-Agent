const {app, BrowserWindow, nativeImage, dialog} = require('electron');
const electron = require('electron');

const path = require('path');
const os = require('os');
const {execFile,spawn,execSync} = require('child_process');
const fs = require('fs-extra');

const IrcBloqLink = require('ircbloq-link');

const formatMessage = require('format-message');
const locales = require('ircbloq-l10n/locales/link-desktop-msgs');
const osLocale = require('os-locale');

const fetch = require('node-fetch');
const { autoUpdater } = require('electron-updater');
const axios = require('axios');

const {productName, version} = require('../package.json');

const {JSONStorage} = require('node-localstorage');
const nodeStorage = new JSONStorage(app.getPath('userData'));
const { downloadToolsWithProgress } = require('../scripts/downloadToolsWithProgress');
const Menu = electron.Menu;
const Tray = electron.Tray;

let mainWindow;
let appTray;
let locale = osLocale.sync();
let resourceServer;
let resourcePath;
let dataPath;
let makeTrayMenu = () => {};
//Dont show app in dock
if (process.platform === 'darwin') {
  app.dock.hide();
}

const showOperationFailedMessageBox = err => {
    dialog.showMessageBox({
        type: 'error',
        buttons: ['Ok'],
        message: formatMessage({
            id: 'index.messageBox.operationFailed',
            default: 'Operation failed',
            description: 'Prompt for operation failed'
        }),
        detail: err
    });
};

const handleClickLanguage = l => {
    locale = l;
    formatMessage.setup({
        locale: locale,
        translations: locales
    });

    appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale)));
};

makeTrayMenu = (l, checkingUpdate = false) => [
    {
      label: 'Go to Online IrcBloqV4',
      click: () => {
          const url = 'https://software.irobochakra.com/';
          if (os.platform() === 'win32') {
              execSync(`start ${url}`);
          } else if (os.platform() === 'darwin') {
              execSync(`open ${url}`);
          } else if (os.platform() === 'linux') {
              execSync(`xdg-open ${url}`);
          }
      }
    },
    {
    label: 'Check for Updates',
    enabled: !checkingUpdate,
    click: () => {
        autoUpdater.checkForUpdates()
            .then(result => {
                if (!result?.updateInfo) {
                    dialog.showMessageBox({
                        type: 'info',
                        message: 'No updates available.'
                    });
                }
            })
            .catch(err => {
                dialog.showMessageBox({
                    type: 'error',
                    message: 'Failed to check for updates',
                    detail: err.message
                });
            });
        }
    },
    {
        label: 'Check for Tool Updates',
        enabled: true,
        click: async () => {
          const result = await downloadToolsWithProgress(mainWindow, resourcePath);

          switch (result) {
            case 'up-to-date':
              dialog.showMessageBox({
                type: 'info',
                message: 'Tools are already up-to-date.',
              });
              break;
            case 'error':
              dialog.showMessageBox({
                type: 'error',
                message: 'Tool update failed. Please check logs or try again.',
              });
              break;
          }
        }
      },
    {
        type: 'separator'
    },
    {
        label: formatMessage({
            id: 'index.menu.installDiver',
            default: 'install driver',
            description: 'Menu item to install driver'
        }),
        click: () => {
            const driverPath = path.join(resourcePath, 'drivers');
            if ((os.platform() === 'win32') && (os.arch() === 'x64')) {
                execFile('install_x64.bat', [], { cwd: driverPath });
            } else if ((os.platform() === 'win32') && (os.arch() === 'ia32')) {
                execFile('install_x86.bat', [], { cwd: driverPath });
            } else if ((os.platform() === 'darwin')) {
                spawn('sh', ['install.sh'], { shell: true, cwd: driverPath });
            }
        }
    },
    {
        type: 'separator'
    },
    {
        label: formatMessage({
            id: 'index.menu.exit',
            default: 'exit',
            description: 'Menu item to exit'
        }),
        click: () => {
            appTray.destroy();
            mainWindow.destroy();
        }
    }
];

const devToolKey = ((process.platform === 'darwin') ?
    { // macOS: command+option+i
        alt: true, // option
        control: false,
        meta: true, // command
        shift: false,
        code: 'KeyI'
    } : { // Windows: control+shift+i
        alt: false,
        control: true,
        meta: false, // Windows key
        shift: true,
        code: 'KeyI'
    }
);



const createWindow = async() => {
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, './icon/IrcBloq.Agent.ico'),
        width: 400,
        height: 400,
        center: true,
        resizable: false,
        fullscreenable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false, // Needed for nodeIntegration
          enableRemoteModule: true
        }
    });
    formatMessage.setup({
        locale: locale,
        translations: locales
    });

    const webContents = mainWindow.webContents;
    webContents.on('before-input-event', (event, input) => {
        if (input.code === devToolKey.code &&
            input.alt === devToolKey.alt &&
            input.control === devToolKey.control &&
            input.meta === devToolKey.meta &&
            input.shift === devToolKey.shift &&
            input.type === 'keyDown' &&
            !input.isAutoRepeat &&
            !input.isComposing) {
            event.preventDefault();
            webContents.openDevTools({mode: 'detach', activate: true});
        }
    });

    const userDataPath = electron.app.getPath('userData');
    dataPath = path.join(userDataPath, 'Data');
    const appPath = app.getAppPath();
    const appVersion = app.getVersion();

    if (appPath.search(/app.asar/g) === -1) {
        resourcePath = path.join(appPath);
    } else {
        resourcePath = path.join(appPath, '../');
    }

    // start link server
    const link = new IrcBloqLink(dataPath, path.join(resourcePath, 'tools'));
    link.listen();

    const status = downloadToolsWithProgress(mainWindow, resourcePath);

    if(process.platform !== 'darwin'){
        appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Agent.ico')));
    }
    else{
        appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Agent.png')));
    }

    appTray.setToolTip('Ircbloq Agent');
    appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale)));

    appTray.on('click', () => {
        mainWindow.show();
    });

    mainWindow.on('close', event => {
        mainWindow.hide();
        event.preventDefault();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

	    // generate product information.
    await webContents.once('dom-ready', () => {
        const electronVersion = process.versions['electron'.toLowerCase()];
        const chromeVersion = process.versions['chrome'.toLowerCase()];
        mainWindow.webContents.executeJavaScript(
            `document.getElementById("product-name").innerHTML = "${productName}";
            document.getElementById("product-version").innerHTML = "App Version ${version}";
            document.getElementById("electron-version").innerHTML = "Electron ${electronVersion}";
            document.getElementById("chrome-version").innerHTML = "Chrome ${chromeVersion}";`
        );
    });

    mainWindow.loadFile('./src/index.html');
    mainWindow.setMenu(null);
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: 'A new version is being downloaded...'
          });
    });

    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded. Restart the application to apply the update.',
            buttons: ['Restart', 'Later']
        }).then(({ response }) => {
            if (response === 0) { // 'Restart' button
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (err) => {
      console.error('Update error:', err);
    });

    autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    });

};

const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            mainWindow.show();
        }
    });
    app.on('ready', () => {
        createWindow();
    });
} else {
    app.quit();
}

app.on('window-all-closed', () => {
        app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
