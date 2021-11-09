const {app, BrowserWindow, nativeImage, dialog} = require('electron');
const electron = require('electron');

const path = require('path');
const os = require('os');
const {execFile,spawn,execSync} = require('child_process');
const fs = require('fs');
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
    resourceServer.checkUpdate(locale)
        .then(info => {
            appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale, false)));
            if (info) {
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
                    })} : ${info.version}`,
                    // Use 100 spaces to prevent the message box from being collapsed
                    // under windows, making the message box very ugly.
                    detail: `${' '.repeat(100)}\n${info.describe}`
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

                    resourceServer.upgrade(state => {
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


const checkMainUpdate = (alertLatest = true) => {
    let data = '';
		const request = fetch('https://api.github.com/repos/ircbloqcc/ircbloq-link-releases/releases/latest')
		.then(res => res.json())
		.then(json => {
		 if(json.tag_name){
			console.log('New Update: ', json.body);
			const latest = json.tag_name.replace('V', '');
			
			if (latest > version) {
                const rev = dialog.showMessageBoxSync({
                    type: 'question',
                    buttons: [
                        formatMessage({
                            id: 'index.messageBox.upgradeLater',
                            default: 'Upgrade later',
                            description: 'Label in bottom to upgrade later'
                        }),
                        formatMessage({
                            id: 'index.messageBox.downloadNewVersion',
                            default: 'Download New Version',
                            description: 'Label in botton to Download New Version'
                        })
                    ],
                    defaultId: 1,
                    message: `${formatMessage({
                        id: 'index.messageBox.newExternalResource',
                        default: 'New Version IrcBloq-Link detected',
                        description: 'Label for new external resource version detected'
                    })} : ${latest}`,
                    // Use 100 spaces to prevent the message box from being collapsed
                    // under windows, making the message box very ugly.
                    detail: `${' '.repeat(100)}\n${json.body}`
                });
                if (rev === 1) {
					if ((os.platform() === 'win32')) {
                    execSync('start https://ircbloqcc.github.io/wiki/download-software/#ircbloqv4-link');
				    } else if ((os.platform() === 'darwin')) {
					execSync('open https://ircbloqcc.github.io/wiki/download-software/#ircbloqv4-link');
				   }
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
                        id: 'index.messageBox.alreadyLatestVersion',
                        default: 'You have installed latest version.',
                        description: 'Prompt for external source is latest version'
                    })
                });
            } else {
        checkUpdate(alertLatest);
		 }
		 }
		})
        .catch(err => {
            showOperationFailedMessageBox(err);
        });
};

const handleClickCheckUpdate = () => {
    appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale, true)));
    checkUpdate();
};

const handleClickCheckMainUpdate = () => {
    appTray.setContextMenu(Menu.buildFromTemplate(makeTrayMenu(locale, false)));
    checkMainUpdate();
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
        label:  formatMessage({
            id: 'index.menu.checkMainUpdate',
            default: 'check Main update',
            description: 'Menu item to check Main update'
        }),
        click: () => handleClickCheckMainUpdate()
    },
    {
        label: formatMessage({
            id: 'index.menu.clearCacheAndRestart',
            default: 'clear cache and restart',
            description: 'Menu item to clear cache and restart'
        }),
        click: () => {
            del.sync(dataPath, {force: true});
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
            const driverPath = path.join(resourcePath, '../drivers');
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

const createWindow = () => {
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

    mainWindow.loadFile('./src/index.html');
    mainWindow.setMenu(null);

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
                del.sync([dataPath], {force: true});
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
    resourceServer = new IrcbloqResourceServer(dataPath, path.join(resourcePath, 'external-resources'));
    resourceServer.listen();
	const r_Path = path.join(dataPath, 'external-resources');
	const _config= fs.readFileSync(path.resolve(r_Path,"config.json"));
	const r_version = JSON.parse(_config);

    appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.ico')));
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
    webContents.once('dom-ready', () => {
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
        checkMainUpdate(false);
    });
} else {
    app.quit();
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
