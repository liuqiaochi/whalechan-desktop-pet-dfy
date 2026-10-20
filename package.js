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
 *   Windows 直接运行 node package.js 即可（无需额外批处理）
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
let usedFallback = false;   // 本次是否启用了 pkg-out-* 兜底目录（成品就在里面）
// 若默认输出目录被系统占用（如 Defender 持锁、待重启清理），自动改用带时间戳的新目录，
// 保证每次打包都一定能写入，不会被上一次的锁卡住。
if (fs.existsSync(path.join(root, OUT_DIR))) {
  try {
    fs.rmSync(path.join(root, OUT_DIR), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch (e) {
    usedFallback = true;
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

// ---- 收尾：清理打包过程产生的 pkg-out-* 临时目录 ----
// 安全原则（防止误删交付物）：
//   1) 本次成品一定在 OUT_DIR 中。
//   2) 若本次用了 pkg-out-* 兜底目录：优先把成品归位到 release/（让输出归一）；
//      仅当 release/ 仍被占用、归位失败时才【保留】该 pkg-out 并告警（交付物在里面，绝不删）。
//   3) 其余任何 pkg-out-* 都是历史空壳 / 中断残留，可直接删除。
try {
  const entries = fs.readdirSync(root);
  for (const name of entries) {
    if (!name.startsWith('pkg-out')) continue;
    const full = path.join(root, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;

    // 本次产物所在目录
    if (name === OUT_DIR) {
      if (usedFallback) {
        try {
          const releasePath = path.join(root, 'release');
          if (fs.existsSync(releasePath)) {
            fs.rmSync(releasePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          }
          fs.renameSync(full, releasePath);   // 原子归位：成品移入 release/
          console.log(`[clean] 产物已归位到 release/，清理临时目录: ${name}`);
        } catch (e) {
          console.log(`[warn] 无法将产物从 ${name} 归位到 release/（release 可能被占用），交付物保留在: ${full}`);
        }
      }
      // 非兜底场景 OUT_DIR 不会是 pkg-out；兜底且归位成功则该目录已不存在；兜底失败则保留。
      continue;
    }

    // 历史遗留的 pkg-out 目录（空壳 / 中断残留），安全删除
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      console.log(`[clean] 已删除遗留临时目录: ${name}`);
    } catch (e) {
      console.log(`[warn] 删除遗留目录失败（可能被占用）: ${name} -> ${e.message}`);
    }
  }
} catch (e) {
  console.log(`[warn] 收尾清理出错（不影响产物）: ${e.message}`);
}
