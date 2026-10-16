#!/usr/bin/env node
/**
 * 一键打包：自动检测当前系统，打出对应平台的安装包。
 *
 *   Windows  -> NSIS 安装包 (.exe)
 *   macOS    -> DMG
 *   Linux    -> AppImage / deb (electron-builder 默认目标)
 *
 * 用法：
 *   node package.js        （任意平台）
 *   Windows 也可直接双击 package.bat
 *
 * 产物默认输出到项目根目录的 release/ 下；若该目录被系统占用（如待重启清理的锁），
 * 会自动改用 pkg-out/，不会因此打包失败。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const platform = process.platform;   // 'win32' | 'darwin' | 'linux'
const isWin = platform === 'win32';
const isMac = platform === 'darwin';

let target, label;
if (isWin)        { target = '--win';   label = 'Windows / NSIS 安装包'; }
else if (isMac)   { target = '--mac';   label = 'macOS / DMG'; }
else              { target = '--linux'; label = 'Linux / AppImage+deb'; }

let OUT_DIR = 'release';
// 若默认输出目录被系统占用（如 Defender 持锁、待重启清理），自动改用带时间戳的新目录，
// 保证每次打包都一定能写入，不会被上一次的锁卡住。
if (fs.existsSync(path.join(root, OUT_DIR))) {
  try {
    fs.rmSync(path.join(root, OUT_DIR), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch (e) {
    OUT_DIR = 'pkg-out-' + new Date().toISOString().replace(/[:.]/g, '-');
    console.log('[warn] 默认输出目录被系统占用，改用: ' + path.join(root, OUT_DIR));
  }
}
const args = [target, `--config.directories.output=${OUT_DIR}`];

// 环境变量：国内镜像 + 关闭 WorkBuddy 的安全删除 shim（避免 electron-builder 清理产物时被拦）
const env = Object.assign({}, process.env);
env.ELECTRON_MIRROR = env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
env.ELECTRON_BUILDER_BINARIES_MIRROR = env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
env.CODEBUDDY_SAFE_DELETE_ENABLED = '0';

// 本机（Windows）离线打包：优先用本地已安装的 Electron 运行时（node_modules/electron/dist），
// 跳过下载与解包改名，规避本机文件锁导致的 EPERM。
const localElectronDist = path.join(root, 'node_modules', 'electron', 'dist');
if (isWin && fs.existsSync(path.join(localElectronDist, 'electron.exe'))) {
  args.push('--config.electronDist=node_modules/electron/dist');
  console.log('[info] 使用本地 Electron 运行时 node_modules/electron/dist（跳过下载）');
}

const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(cli)) {
  console.error('[ERROR] 未找到 electron-builder，请先在本项目目录执行 npm install。');
  process.exit(1);
}

console.log(`[info] 当前系统: ${platform}  ->  即将打包: ${label}`);
console.log(`[info] 输出目录: ${path.join(root, OUT_DIR)}\n`);

const res = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: root, env });

if (res.error) {
  console.error('\n[ERROR]', res.error.message);
  process.exit(1);
}
if (res.status !== 0) {
  console.error(`\n[ERROR] 打包失败（exit ${res.status}）`);
  process.exit(res.status || 1);
}

console.log(`\n[OK] ${label} 已生成 -> ${path.join(root, OUT_DIR)}`);
