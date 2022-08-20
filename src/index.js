const {app, BrowserWindow, nativeImage, dialog} = require('electron');
const electron = require('electron');

const path = require('path');
const os = require('os');
const {execFile,spawn,execSync} = require('child_process');
const fs = require('fs-extra');
const compareVersions = require('compare-versions');
const del = require('del');

const IrcBloqLink = require('ircbloq-link');
const IrcbloqResourceServer = require('ircbloq-resource');
const ProgressBar = require('electron-progressbar');

const formatMessage = require('format-message');
const locales = require('ircbloq-l10n/locales/link-desktop-msgs');
const osLocale = require('os-locale');

const fetch = require('node-fetch');

const {productName, version} = require('../package.json');

const {JSONStorage} = require('node-localstorage');
const nodeStorage = new JSONStorage(app.getPath('userData'));

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


const checkUpdate = (alertLatest = true) => {
    resourceServer.checkUpdate()
        .then(info => {
            appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale, false)));
            if (info.updateble) {
                const rev = dialog.showMessageBoxSync({
                    type: 'question',
                    buttons: [
                        formatMessage({
                            id: 'index.messageBox.upgradeLater',
                            default: 'Upgrade later',
                            description: 'Label in bottom to upgrade later'
                        }),
                        formatMessage({
                            id: 'index.messageBox.upgradeAndRestart',
                            default: 'Upgrade and restart',
                            description: 'Label in bottom to upgrade and restart'
                        })
                    ],
                    defaultId: 1,
                    message: `${formatMessage({
                        id: 'index.messageBox.newExternalResource',
                        default: 'New external resource version detected',
                        description: 'Label for new external resource version detected'
                    })}\n\n\n            Resource New Version: ${info.latestVersion}`,
                    // Use 100 spaces to prevent the message box from being collapsed
                    // under windows, making the message box very ugly.
                    detail: ''//${' '.repeat(100)}\nResource Current Version: ${info.currentVersion}
                    //\nResource New Version: ${info.latestVersion}`
                });
                if (rev === 1) {
                    const progressBarPhase = {
                        idle: 0,
                        downloading: 10,
                        extracting: 80,
                        covering: 90
                    };

                    const progressBar = new ProgressBar({
                        indeterminate: false,
                        title: formatMessage({
                            id: 'index.messageBox.upgrading',
                            default: 'Upgrading',
                            description: 'Tile for upgrade progress bar message box'
                        }),
                        detail: formatMessage({
                            id: 'index.messageBox.upgradingTip',
                            default: 'The upgrade is in progress, please do not close me, ' +
                                'the program will automatically restart after the upgrade is completed.',
                            description: 'Tips during the upgrade process'
                        })
                    });

                    let downloadInterval;

                    progressBar.on('aborted', () => {
                        clearInterval(downloadInterval);
                    });

                    resourceServer.update(state => {
                        if (state.phase === 'downloading') {
                            if (progressBar) {
                                progressBar.value = progressBarPhase.downloading;
                                progressBar.text = formatMessage({
                                    id: 'index.messageBox.downloading',
                                    default: 'Downloading',
                                    description: 'Prompt for in downloading porgress'
                                });

                                downloadInterval = setInterval(() => {
                                    if (progressBar.value < (progressBarPhase.extracting - 1)) {
                                        progressBar.value += 1;
                                    }
                                }, 2000);
                            }
                        } else if (progressBar) {
                            clearInterval(downloadInterval);

                            progressBar.value = progressBarPhase.covering;
                            progressBar.text = formatMessage({
                                id: 'index.messageBox.covering',
                                default: 'Covering',
                                description: 'Prompt for in covering porgress'
                            });
                        }
                    })
                        .then(() => {
                            if (progressBar) {

                                progressBar.setCompleted();
                            }
                            app.relaunch();
                            app.exit();
                        })
                        .catch(err => {
                            showOperationFailedMessageBox(err);
                        });
                }
            } else if (alertLatest) {
                dialog.showMessageBox({
                    type: 'info',
                    buttons: ['Ok'],
                    message: formatMessage({
                        id: 'index.messageBox.alreadyLatest',
                        default: 'Already latest',
                        description: 'Prompt for already latest'
                    }),
                    detail: formatMessage({
                        id: 'index.messageBox.alreadyLatestTips',
                        default: 'External source is already latest.',
                        description: 'Prompt for external source is already latest'
                    })
                });
            }
        })
        .catch(err => {
            showOperationFailedMessageBox(err);
        });
};

const handleClickCheckUpdate = () => {
    appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale, true)));
    checkUpdate(true);
};

makeTrayMenu = (l, checkingUpdate = false) => [
    {
     label: 'Go to Online IrcBloqV4',
      click: () => {
        if ((os.platform() === 'win32')) {
          execSync('start https://ircbloqcc.github.io/ircbloq/');
        } else if ((os.platform() === 'darwin')) {
          execSync('open https://ircbloqcc.github.io/ircbloq/');
        }
	  }
    },
    {
        type: 'separator'
    },
    {
        label: checkingUpdate ? formatMessage({
            id: 'index.menu.checkingUpdate',
            default: 'checking for update...',
            description: 'Menu item to prompt checking for update'
        }) : formatMessage({
            id: 'index.menu.checkUpdate',
            default: 'check update',
            description: 'Menu item to check update'
        }),
        enabled: !checkingUpdate,
        click: () => handleClickCheckUpdate()
    },
    {
        label: formatMessage({
            id: 'index.menu.clearCacheAndRestart',
            default: 'clear cache and restart',
            description: 'Menu item to clear cache and restart'
        }),
        click: () => {
            fs.rmSync(dataPath, {recursive: true, force: true});
            app.relaunch();
            app.exit();
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
          execFile('install_x64.bat', [], {
            cwd: driverPath
          });
        } else if ((os.platform() === 'win32') && (os.arch() === 'ia32')) {
          execFile('install_x86.bat', [], {
            cwd: driverPath
          });
        } else if ((os.platform() === 'darwin')) {
          spawn('sh', ['install.sh'], {
            shell: true,
            cwd: driverPath
          });
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
        icon: path.join(__dirname, './icon/IrcBloq-Link.ico'),
        width: 400,
        height: 400,
        center: true,
        resizable: false,
        fullscreenable: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true
        }
    });

    if (locale === 'zh-CN') {
        locale = 'zh-cn';
    } else if (locale === 'zh-TW') {
        locale = 'zh-tw';
    }
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

    // if current version is newer then cache log, delet the data cache dir and write the
    // new version into the cache file.
    const oldVersion = nodeStorage.getItem('version');
    if (oldVersion) {
        if (compareVersions.compare(appVersion, oldVersion, '>')) {
            if (fs.existsSync(dataPath)) {
                fs.rmSync(dataPath, {recursive: true, force: true});
            }
            nodeStorage.setItem('version', appVersion);
        }
    } else {
        nodeStorage.setItem('version', appVersion);
    }

    if (appPath.search(/app.asar/g) === -1) {
        resourcePath = path.join(appPath);
    } else {
        resourcePath = path.join(appPath, '../');
    }

    // start link server
    const link = new IrcBloqLink(dataPath, path.join(resourcePath, 'tools'));
    link.listen();

    // start resource server
    resourceServer = new IrcbloqResourceServer(dataPath,
        path.join(resourcePath, 'external-resources'),
        app.getLocaleCountryCode());

  await resourceServer.initializeResources();
  await resourceServer.listen();

    const r_Path = path.join(dataPath, 'external-resources');
    const _config= fs.readFileSync(path.resolve(r_Path,"config.json"));
    const r_version = JSON.parse(_config);

    if(process.platform !== 'darwin'){
        appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.ico')));
    }
    else{
        appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.png')));
    }

    appTray.setToolTip('Ircbloq Link');
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
            document.getElementById("resource-version").innerHTML = "Resource Version ${r_version.version}";
            document.getElementById("electron-version").innerHTML = "Electron ${electronVersion}";
            document.getElementById("chrome-version").innerHTML = "Chrome ${chromeVersion}";`
        );
    });

    mainWindow.loadFile('./src/index.html');
    mainWindow.setMenu(null);

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
        checkUpdate(false);
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
