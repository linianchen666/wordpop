/**
 * 打包环境诊断脚本 — 直接在 Electron 主进程中运行
 * 用于排查：1. 词库路径加载问题  2. 资源解析问题
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  console.log('=== WordPop 打包环境诊断 ===');
  console.log('app.isPackaged:', app.isPackaged);
  console.log('app.getAppPath():', app.getAppPath());
  console.log('process.resourcesPath:', process.resourcesPath);
  console.log('__dirname:', __dirname);
  console.log();

  // 1. 检查所有可能的词库路径
  console.log('--- 词库路径探测 ---');
  const candidates = [
    { label: 'resourcesPath/wordlists', path: path.join(process.resourcesPath || '', 'wordlists') },
    { label: 'appPath/src/data/wordlists', path: path.join(app.getAppPath(), 'src', 'data', 'wordlists') },
    { label: '__dirname/../data/wordlists', path: path.join(__dirname, '..', 'data', 'wordlists') },
    { label: 'resourcesPath/app.asar/src/data/wordlists', path: path.join(process.resourcesPath || '', 'app.asar', 'src', 'data', 'wordlists') },
  ];

  for (const c of candidates) {
    const indexFile = path.join(c.path, 'index.json');
    let exists = false;
    try { exists = fs.existsSync(indexFile); } catch (e) {}
    console.log(`  [${exists ? 'FOUND' : 'MISS'}] ${c.label}`);
    console.log(`         ${indexFile}`);
    if (exists) {
      try {
        const content = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
        const list = Array.isArray(content) ? content : (content.wordlists || []);
        console.log(`         词库数量: ${list.length}, 词库IDs: ${list.map(e => e.id).join(', ')}`);
      } catch (e) {
        console.log(`         解析失败: ${e.message}`);
      }
    }
  }

  // 2. 检查db.js加载情况
  console.log();
  console.log('--- db.js 模块验证 ---');
  try {
    const dbModule = require('./src/main/db');
    console.log('  db.js 加载成功');
    
    const index = dbModule.getWordlistIndex();
    console.log(`  getWordlistIndex() 返回: ${index.length} 个词库`);
    for (const e of index) {
      console.log(`    - ${e.id}: ${e.name} (${e.count} 词, file=${e.file})`);
    }
  } catch (e) {
    console.log('  db.js 加载失败:', e.message);
  }

  // 3. 检查preload路径
  console.log();
  console.log('--- preload 路径验证 ---');
  const preloadCandidates = [
    path.join(process.resourcesPath || '', 'app.asar', 'src', 'preload', 'preload.js'),
    path.join(__dirname, 'src', 'preload', 'preload.js'),
    path.join(__dirname, '..', 'preload', 'preload.js'),
  ];
  for (const p of preloadCandidates) {
    let exists = false;
    try { exists = fs.existsSync(p); } catch (e) {}
    console.log(`  [${exists ? 'FOUND' : 'MISS'}] ${p}`);
  }

  // 4. 检查settings页面路径
  console.log();
  console.log('--- settings 页面路径验证 ---');
  const settingsCandidates = [
    path.join(process.resourcesPath || '', 'app.asar', 'src', 'renderer', 'settings', 'index.html'),
    path.join(__dirname, 'src', 'renderer', 'settings', 'index.html'),
    path.join(__dirname, '..', 'renderer', 'settings', 'index.html'),
  ];
  for (const p of settingsCandidates) {
    let exists = false;
    try { exists = fs.existsSync(p); } catch (e) {}
    console.log(`  [${exists ? 'FOUND' : 'MISS'}] ${p}`);
  }

  console.log();
  console.log('=== 诊断完成 ===');
  app.quit();
});
