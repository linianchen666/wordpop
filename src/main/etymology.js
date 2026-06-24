const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let rootsData = null;

/**
 * 获取词源数据文件路径
 * 打包后 etymology 被复制到 resources/etymology/ (extraResources)
 */
function getEtymologyPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'etymology', 'roots.json');
  }
  return path.join(__dirname, '..', 'data', 'etymology', 'roots.json');
}

/**
 * 加载词根词源数据
 */
function loadRootsData() {
  if (rootsData) return rootsData;

  const rootsPath = getEtymologyPath();

  try {
    const raw = fs.readFileSync(rootsPath, 'utf-8');
    rootsData = JSON.parse(raw);
  } catch (e) {
    console.error('[Etymology] Failed to load roots data:', e.message);
    rootsData = { prefixes: [], roots: [], suffixes: [] };
  }

  return rootsData;
}

/**
 * 分析一个单词的词根词源构成
 * @param {string} word - 要分析的单词
 * @returns {{ parts: Array<{type, pattern, meaning, desc, highlight}>, analysis: string, relatedRoots: Array }}
 */
function analyzeWord(word) {
  const data = loadRootsData();
  const w = word.toLowerCase().trim();
  const parts = [];

  // 1. 检测前缀（从长到短匹配，避免短前缀误匹配）
  const sortedPrefixes = [...data.prefixes].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const prefix of sortedPrefixes) {
    const p = prefix.pattern.toLowerCase();
    if (w.startsWith(p) && w.length > p.length + 2) {
      const rest = w.substring(p.length);
      const minRestLen = p.length <= 2 ? 4 : 2;
      if (rest.length >= minRestLen) {
        if (prefix.strict) {
          const isExactExample = prefix.examples.some(ex => ex.toLowerCase() === w);
          if (!isExactExample) continue;
        }
        const isLikely = prefix.examples.some(ex => ex.toLowerCase() === w) ||
          prefix.examples.some(ex => ex.toLowerCase().startsWith(p) && ex.toLowerCase().substring(p.length) !== rest);
        if (isLikely || p.length >= 3 || (p.length >= 2 && rest.length >= 4)) {
          parts.push({
            type: '前缀',
            pattern: prefix.pattern,
            meaning: prefix.meaning,
            desc: prefix.desc,
            highlight: p
          });
          break;
        }
      }
    }
  }

  // 2. 检测后缀（从长到短匹配）
  const sortedSuffixes = [...data.suffixes].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const suffix of sortedSuffixes) {
    const s = suffix.pattern.toLowerCase();
    const minWordLen = s.length <= 2 ? s.length + 5 : s.length + 3;
    if (w.endsWith(s) && w.length > minWordLen) {
      const rest = w.substring(0, w.length - s.length);
      const minRestLen = s.length <= 2 ? 4 : 2;
      if (rest.length >= minRestLen) {
        parts.push({
          type: '后缀',
          pattern: suffix.pattern,
          meaning: suffix.meaning,
          desc: suffix.desc,
          highlight: s
        });
        break;
      }
    }
  }

  // 3. 检测词根（在去除前缀和后缀后的中间部分查找）
  let searchStart = 0;
  let searchEnd = w.length;
  const matchedPrefix = parts.find(p => p.type === '前缀');
  const matchedSuffix = parts.find(p => p.type === '后缀');
  if (matchedPrefix) searchStart = matchedPrefix.highlight.length;
  if (matchedSuffix) searchEnd = w.length - matchedSuffix.highlight.length;

  const corePart = w.substring(searchStart, searchEnd);

  const sortedRoots = [...data.roots].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const root of sortedRoots) {
    const r = root.pattern.toLowerCase();
    if (corePart.includes(r) && r.length >= 3) {
      const rootIndex = w.indexOf(r, matchedPrefix ? matchedPrefix.highlight.length : 0);
      if (rootIndex >= searchStart && rootIndex < searchEnd) {
        const alreadyMatched = parts.some(p => p.highlight === r);
        if (!alreadyMatched) {
          parts.push({
            type: '词根',
            pattern: root.pattern,
            meaning: root.meaning,
            desc: root.desc,
            highlight: r
          });
          break;
        }
      }
    }
  }

  // 4. 如果没有匹配到任何词根词缀，尝试宽松匹配（在单词任意位置找相关词根）
  let relatedRoots = [];
  if (parts.length === 0) {
    for (const root of sortedRoots) {
      const r = root.pattern.toLowerCase();
      if (w.includes(r) && r.length >= 3) {
        relatedRoots.push({
          pattern: root.pattern,
          meaning: root.meaning,
          desc: root.desc,
          examples: root.examples
        });
        if (relatedRoots.length >= 2) break; // 最多2个相关词根
      }
    }

    // 也尝试在单词任意位置找相关前缀/后缀（不要求位置）
    for (const prefix of data.prefixes) {
      const p = prefix.pattern.toLowerCase();
      if (w.includes(p) && p.length >= 3 && !prefix.strict) {
        relatedRoots.push({
          pattern: prefix.pattern,
          meaning: `前缀：${prefix.meaning}`,
          desc: prefix.desc,
          examples: prefix.examples
        });
        if (relatedRoots.length >= 3) break;
      }
    }
  }

  // 5. 构造分析说明文本
  let analysis = '';
  if (parts.length > 0) {
    const prefixPart = parts.find(p => p.type === '前缀');
    const rootPart = parts.find(p => p.type === '词根');
    const suffixPart = parts.find(p => p.type === '后缀');

    if (prefixPart && rootPart && suffixPart) {
      analysis = `前缀 ${prefixPart.pattern}「${prefixPart.meaning}」 + 词根 ${rootPart.pattern}「${rootPart.meaning}」 + 后缀 ${suffixPart.pattern}「${suffixPart.meaning}」`;
    } else if (prefixPart && rootPart) {
      analysis = `前缀 ${prefixPart.pattern}「${prefixPart.meaning}」 + 词根 ${rootPart.pattern}「${rootPart.meaning}」`;
    } else if (rootPart && suffixPart) {
      analysis = `词根 ${rootPart.pattern}「${rootPart.meaning}」 + 后缀 ${suffixPart.pattern}「${suffixPart.meaning}」`;
    } else if (prefixPart && suffixPart) {
      analysis = `前缀 ${prefixPart.pattern}「${prefixPart.meaning}」 + 后缀 ${suffixPart.pattern}「${suffixPart.meaning}」`;
    } else {
      const p = parts[0];
      analysis = `${p.type} ${p.pattern}「${p.meaning}」`;
    }
  } else if (relatedRoots.length > 0) {
    analysis = `此词无明显词根词缀拆分，但与以下词根相关：`;
  } else {
    analysis = '此词为基础词汇，暂无词源分析';
  }

  return { parts, analysis, relatedRoots };
}

module.exports = { analyzeWord, loadRootsData };
