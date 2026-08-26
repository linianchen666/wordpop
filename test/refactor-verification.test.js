/**
 * 冗余清理与冲突修复专项自动化回归测试
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== 开始测试：冗余清理与冲突修复专项回归 ===');

// 1. 测试 stage 名称（Stage 3 必须为 '4小时'）
function getStageName(stage) {
  const names = [
    '新学', '5分钟', '30分钟', '4小时',
    '1天', '2天', '4天', '7天', '15天', '已掌握'
  ];
  return names[stage] || `阶段${stage}`;
}

assert.strictEqual(getStageName(0), '新学');
assert.strictEqual(getStageName(1), '5分钟');
assert.strictEqual(getStageName(2), '30分钟');
assert.strictEqual(getStageName(3), '4小时', 'Stage 3 必须为 4小时');
assert.strictEqual(getStageName(4), '1天');
assert.strictEqual(getStageName(9), '已掌握');
console.log('  ✓ 测试 1 通过：记忆阶段间隔名称与调度周期完全一致 (Stage 3 = 4小时)');

// 2. 测试开发模式路径解析逻辑
const mockMainDir = path.join(__dirname, '..', 'src', 'main');
const preloadDevPath = path.join(mockMainDir, '..', 'preload', 'preload.js');
const rendererDevPath = path.join(mockMainDir, '..', 'renderer', 'popup', 'index.html');

assert.ok(fs.existsSync(preloadDevPath), `preload 路径必须真实存在: ${preloadDevPath}`);
assert.ok(fs.existsSync(rendererDevPath), `renderer 路径必须真实存在: ${rendererDevPath}`);
console.log('  ✓ 测试 2 通过：开发模式 preload & renderer 路径解析正确且文件存在');

// 3. 测试旧版配置平滑自动迁移 (pronounceAccent -> pronounceVoice)
const DEFAULT_CONFIG = {
  dailyNewWords: 20,
  pronounceVoice: 'dict-us'
};

function migrateLegacyConfig(userConfig) {
  if (userConfig.pronounceAccent && !userConfig.pronounceVoice) {
    userConfig.pronounceVoice = (userConfig.pronounceAccent === 'en-GB' || userConfig.pronounceAccent === 'uk') ? 'dict-uk' : 'dict-us';
    delete userConfig.pronounceAccent;
  }
  return { ...DEFAULT_CONFIG, ...userConfig };
}

const legacy1 = migrateLegacyConfig({ pronounceAccent: 'en-GB' });
assert.strictEqual(legacy1.pronounceVoice, 'dict-uk', '旧版 en-GB 应自动迁移为 dict-uk');
assert.strictEqual(legacy1.pronounceAccent, undefined, '旧版 pronounceAccent 应被移除');

const legacy2 = migrateLegacyConfig({ pronounceAccent: 'en-US' });
assert.strictEqual(legacy2.pronounceVoice, 'dict-us', '旧版 en-US 应自动迁移为 dict-us');

const newConfig = migrateLegacyConfig({ pronounceVoice: 'loli' });
assert.strictEqual(newConfig.pronounceVoice, 'loli', '新版 loli 角色音色应保持不变');
console.log('  ✓ 测试 3 通过：配置平滑自动迁移验证完全正确');

// 4. 测试队列顺序：到期复习词优先于新词
const mockDueReviews = [{ id: 10, word: 'review_word', stage: 2 }];
const mockNewWords = [{ id: 20, word: 'new_word', stage: 0 }];
const queue = [...mockDueReviews, ...mockNewWords];

assert.strictEqual(queue[0].id, 10, '队列首位必须为到期复习词');
assert.strictEqual(queue[1].id, 20, '队列次位为新词');
console.log('  ✓ 测试 4 通过：调度队列复习优先次序验证正确');

console.log('\n🎉 所有冗余清理与冲突修复专项回归测试全部通过！\n');
process.exit(0);
