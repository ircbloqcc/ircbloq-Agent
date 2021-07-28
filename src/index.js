const {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  dialog
} = require('electron');

const { autoUpdater } = require("electron-updater")
const path = require('path');
const os = require('os');
const electron = require('electron');
const IrcBloqLink = require('ircbloq-link');

//const IrcBloqDevice = require('ircbloq-device');
//const IrcBloqExtension = require('ircbloq-extension');
const IrcbloqResourceServer = require('ircbloq-resource');
const {
  execFile,
  spawn,
  execSync
} = require('child_process');
const fs = require('fs');
const compareVersions = require('compare-versions');
const del = require('del');
const {
  productName,
  version
} = require('../package.json')


const Menu = electron.Menu;
const Tray = electron.Tray;
var appTray = null;
//Dont show app in dock
if (process.platform === 'darwin') {
  app.dock.hide();
}



let mainWindow;
const dispatch = (data) => {
  mainWindow.webContents.send('message', data)
}
function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, './icon/IrcBloq-Link.png'),
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
        del.sync([dataPath], {
          force: true
        });
      }
      fs.writeFileSync(applicationConfig, JSON.stringify({
        version: appVersion
      }));
    }
  } else {
    if (fs.existsSync(dataPath)) {
      del.sync([dataPath], {
        force: true
      });
    }
    fs.writeFileSync(applicationConfig, JSON.stringify({
      version: appVersion
    }));
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
  const r_Path = path.join(dataPath, 'external-resources');
  const _config= fs.readFileSync(path.resolve(r_Path,"config.json"));
  const r_version = JSON.parse(_config);
  console.log(r_Path);

  ipcMain.on('cclear_app',() => {
    del.sync(dataPath, {force: true});
    app.relaunch();
    app.exit();
  })

  ipcMain.on('r_version', (event) => {
    event.sender.send('r_version', { version: r_version.version});
  });

  ipcMain.on('app_version', (event) => {
  event.sender.send('app_version', { version: app.getVersion() });
});

  const trayMenuTemplate = [{
      label: 'Go to Online IrcBloqV4',
      click: function() {
        if ((os.platform() === 'win32')) {
          execSync('start https://ircbloqcc.github.io/ircbloq/');
        } else if ((os.platform() === 'darwin')) {
          execSync('open https://ircbloqcc.github.io/ircbloq/');
        }
      }
    },
    {
      label: 'Check Update',
      click: function() {
        //autoUpdater.checkForUpdatesAndNotify()
        //autoUpdater.checkForUpdates();
        resourceServer.checkUpdate().then(updateInfo => {
    if (updateInfo){
        console.log('updateInfo:', updateInfo);
          mainWindow.webContents.send('update_available');
        resourceServer.upgrade(downloadInfo => {
            console.log(`phase: ${downloadInfo.phase}`);
            mainWindow.webContents.send(`${downloadInfo.phase}`);
        })
            .then(() => {
                console.log('upgrade finish');
                mainWindow.webContents.send('update_downloaded');
            });
    } else {
        console.log('External-resources are the latest version');
        mainWindow.webContents.send('no_update');
    }
})
    .catch(err => {
        console.error('Error while checking for update: ', err);
        mainWindow.webContents.send('err_update');
    });
}
    },
    {
      label: 'Install Driver',
      click: function() {
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
      label: 'Clear Cache',
      click:function(){
        mainWindow.webContents.send('clear_cache');
      }

    },
    {
      label: 'exit',
      click: function() {
        appTray.destroy();
        mainWindow.destroy();
      }
    }
    // TODO: Add a button to clear cthe cache in app path.
  ];
  if (process.platform !== 'darwin') {
  appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.ico')));
  }
  else{
  appTray = new Tray(nativeImage.createFromPath(path.join(__dirname, './icon/IrcBloq-Link.png')));
  }
  const contextMenu = Menu.buildFromTemplate(trayMenuTemplate);
  appTray.setToolTip('IrcBloq Link');
  appTray.setContextMenu(contextMenu);

  appTray.on('click', function() {
    mainWindow.show();
  })

  mainWindow.on('close', (event) => {
    mainWindow.hide();
    event.preventDefault();
  });

  mainWindow.on('closed', function() {
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

app.on('window-all-closed', function() {
  //if (process.platform !== 'darwin') {
  app.quit();
  //}
})

app.on('activate', function() {
  if (mainWindow === null) {
    createWindow();
  }

})

ipcMain.on('restart_app', () => {
  app.relaunch();
  app.exit();
});
