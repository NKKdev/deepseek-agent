import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import { setDirectoryPicker, startStudio } from "./server.js";

const iconPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../resources/deepseek-icon.png");
let mainWindow = null;

setDirectoryPicker(async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "选择工作目录",
    buttonLabel: "选择",
    properties: ["openDirectory", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

app.setName("DeepSeek Agent");

function localUrl(target, appUrl) {
  try {
    const url = new URL(target);
    const appOrigin = new URL(appUrl);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === appOrigin.port;
  } catch {
    return false;
  }
}

function createWindow(appUrl) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: "DeepSeek Agent",
    icon: iconPath,
    backgroundColor: "#1e1e1e",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!localUrl(url, appUrl)) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    }
  });
  void win.loadURL(appUrl);
  mainWindow = win;
  return win;
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "DeepSeek Agent",
        submenu: [
          { role: "about", label: "关于 DeepSeek Agent" },
          { type: "separator" },
          { role: "hide", label: "隐藏" },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "显示全部" },
          { type: "separator" },
          { role: "quit", label: "退出 DeepSeek Agent" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo", label: "撤销" },
          { role: "redo", label: "重做" },
          { type: "separator" },
          { role: "cut", label: "剪切" },
          { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" },
          { role: "selectAll", label: "全选" },
        ],
      },
      {
        label: "窗口",
        submenu: [
          { role: "minimize", label: "最小化" },
          { role: "zoom", label: "缩放" },
          { role: "front", label: "前置全部窗口" },
          { type: "separator" },
          { role: "close", label: "关闭窗口" },
        ],
      },
    ])
  );
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.setIcon(iconPath);
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd();
  const { url } = await startStudio({ port: 0, root });
  installMenu();
  createWindow(url);
  console.log(`DeepSeek Agent 窗口已打开: ${url}`);
  console.log(`项目目录: ${root}`);
});

app.on("window-all-closed", () => {
  app.quit();
});
