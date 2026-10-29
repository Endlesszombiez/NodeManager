# Node Manager 1.0

A focused Windows desktop app for installed Node.js versions, PATH order, official side-by-side downloads, and Chocolatey packages. Built with Electron and plain HTML/CSS/JavaScript; no frontend framework or production npm dependencies.

## Install and run

Run `release/Node-Manager-Setup-1.0.0.exe`. The setup wizard includes an optional, checked-by-default Chocolatey setup step. It skips an existing Chocolatey installation. Uncheck it to use only independent Node.js downloads. The app normally runs without administrator access; use **Run as administrator** for Machine PATH and Chocolatey operations.

The V1 installer targets Windows x64. It bundles Electron, so users need neither Node.js nor a .NET runtime to launch it. A signing certificate is not configured; the generated installer is unsigned.

For development, install Node.js 22.12 or newer:

```powershell
npm ci
npm start
```

If npm's install-script policy skips Electron's binary download, run `node node_modules/electron/install.js`. If your terminal has `ELECTRON_RUN_AS_NODE=1`, remove that variable from the application launch environment before running `npm start`.

## Using the app

- **Installed versions** detects runtimes in saved User/Machine PATH, the app's managed directory, standard Program Files locations, nvm-windows, fnm, Volta, and folders you add manually. It does not scan entire disks. Use **Refresh** after external changes.
- **Install a version** downloads an official Windows ZIP from nodejs.org over HTTPS, verifies its SHA-256 against the official checksum file, checks the executable's version, and stores it independently with npm. It leaves PATH unchanged. Updates are installed alongside the original, so you can switch and verify a project before removing the old version.
- **Check for updates** uses the official full release index. Each installed version is compared numerically with the latest stable release in its own major: v24 compares with v24, v26 with v26. It does not silently migrate between majors. A dated disk cache supports offline use; the app labels cached results.
- **PATH editor** lets you add several Node.js directories, move entries up or down, and remove entries in either scope. Review the native confirmation before saving. Unrelated entries and environment-variable expressions are retained. Windows normally puts Machine PATH before User PATH. A new User entry cannot outrank an existing Machine entry. Open a new terminal after saving. Shell profiles, project managers, and shims may override the saved Windows environment.
- **Undo last PATH save** restores the previous value only when the current value still matches the app's last save. Every save produces a dated JSON backup. You can inspect older backups in app data. A second undo can redo the preceding change because restoring also creates a backup.
- **Uninstall** removes app-managed versions or invokes the registered Windows Installer/Chocolatey owner. Remove that installation from both PATH scopes first. Stop running processes before removing a managed runtime. nvm/fnm/Volta installations must be removed through their original managers. The app never recursively deletes externally managed folders.
- **Chocolatey** offers install, upgrade, exact-version install, and uninstall for `nodejs-lts`, `nodejs.install`, and `nodejs`. It requires administrator access and explicit confirmation. These packages share a system installation and may replace one another; they do not offer independent parallel runtimes. Chocolatey package versions may lag behind official Node.js releases. The app does not uninstall Node.js or Chocolatey merely because you uninstall Node Manager.

## Dates and local data

Managed versions record the actual installation timestamp. Existing Windows Installer records supply their installation date when available. Other installations use executable creation time, visibly marked **estimated**. Date-only records are displayed as local calendar dates.

Historical last use cannot generally be recovered. The app records **last observed use** when a running `node.exe` with a readable executable path is found during refresh. It does not enable Windows auditing, install a background service, alter Node.js executables, or treat filesystem access timestamps as reliable usage. Some other users' processes require elevation to inspect.

Local state lives in Electron's user-data directory (normally `%APPDATA%/node-manager`):

| File/folder | Purpose |
| --- | --- |
| `versions/` | Independent runtimes and installation manifests |
| `state.json` | Added folders and observed usage timestamps |
| `catalog.json` | Dated official release cache |
| `path-backups/` | Exact previous PATH values and the values saved |
| `activity.log` | Operation history and diagnostics |
| `downloads/` | Temporary downloads, removed after each operation |

Open the actual location from **Activity > Open app data**. Back up the `versions` folder if you rely on its runtimes. App data and Chocolatey remain after uninstalling the desktop app; remove runtimes and PATH references before manually deleting app data.

## Build and verify

```powershell
npm test
npm run check
npm run test:desktop
npm run test:install
npm run dist
npm run test:packaged
```

- Unit tests cover version ordering, per-major updates, PATH validation/backups/conflicts, quoting, operation serialization, offline cache, install verification, cleanup, and uninstall boundaries.
- Desktop tests automate the native Electron application with Playwright, exercise preview and live read-only discovery, and save screenshots in `artifacts/`. Each run uses temporary app data. Preview mode is also available with `npm start -- --demo`; sample versions are explicitly labeled and system changes are disabled.
- The opt-in install smoke test downloads a real current LTS ZIP into a temporary folder, verifies it, discovers it, and uninstalls it. It leaves system PATH and existing runtimes unchanged.
- `npm run pack` builds an unpacked executable; `npm run dist` builds the interactive NSIS installer. `npm run test:packaged` launches that executable and checks the desktop flows in preview mode. `scripts/make-icon.ps1` regenerates the Windows icon using System.Drawing.

System-changing UAC, MSI removal, Chocolatey package execution, and the full elevated installation wizard require release testing on a disposable Windows VM. Automated tests do not change the developer's real PATH or install/uninstall system packages. Before distributing publicly, sign the executable/installer with your publisher certificate and complete those VM checks.

## Architecture

`src/main.cjs` owns the native window, user confirmations, and narrowly scoped IPC. `src/preload.cjs` exposes a restricted bridge to the sandboxed renderer in `src/ui/`. `src/core/manager.cjs` owns discovery, downloads, local state, and package operations. `src/core/windows.cjs` owns PowerShell/registry PATH access and process execution; `src/core/model.cjs` holds validation and comparison rules. The renderer cannot access Node.js, navigate to remote content, or make network requests. Installation and PATH mutations are serialized, and closing is blocked while an operation runs.

The initial Graphify graph was refreshed for the empty repository. Per project policy, it can be reused for five hours; inspect source directly for newly added code until the next refresh is due.
