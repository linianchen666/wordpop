const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let rootsData = null;

function getEtymologyPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'etymology', 'roots.json');
  }
  return path.join(__dirname, '..', 'data', 'etymology', 'roots.json');
}

function loadRootsData() {
  if (rootsData) return rootsData;
  try {
    rootsData = JSON.parse(fs.readFileSync(getEtymologyPath(), 'utf-8'));
  } catch (e) {
    console.error('[Etymology] Failed to load roots data:', e.message);
    rootsData = { prefixes: [], roots: [], suffixes: [] };
  }
  return rootsData;
}

/**
 * 分析单词，生成叙事性助记解释
 */
function analyzeWord(word) {
  const data = loadRootsData();
  const w = word.toLowerCase().trim();
  const parts = [];

  // 1. 检测前缀
  const sortedPrefixes = [...data.prefixes].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const prefix of sortedPrefixes) {
    const p = prefix.pattern.toLowerCase();
    if (w.startsWith(p) && w.length > p.length + 2) {
      const rest = w.substring(p.length);
      const minRestLen = p.length <= 2 ? 4 : 2;
      if (rest.length >= minRestLen) {
        if (prefix.strict) {
          if (!prefix.examples.some(ex => ex.toLowerCase() === w)) continue;
        }
        const isLikely = prefix.examples.some(ex => ex.toLowerCase() === w) ||
          prefix.examples.some(ex => ex.toLowerCase().startsWith(p) && ex.toLowerCase().substring(p.length) !== rest);
        if (isLikely || p.length >= 3 || (p.length >= 2 && rest.length >= 4)) {
          parts.push({ type: '前缀', pattern: prefix.pattern, meaning: prefix.meaning, desc: prefix.desc, highlight: p });
          break;
        }
      }
    }
  }

  // 2. 检测词根（在去除前缀后的部分查找，优先于后缀）
  const matchedPrefix = parts.find(p => p.type === '前缀');
  const prefixLen = matchedPrefix ? matchedPrefix.highlight.length : 0;
  const afterPrefix = w.substring(prefixLen);

  const sortedRoots = [...data.roots].sort((a, b) => b.pattern.length - a.pattern.length);
  let matchedRoot = null;
  for (const root of sortedRoots) {
    const r = root.pattern.toLowerCase();
    if (r.length < 3) continue;
    const idx = afterPrefix.indexOf(r);
    if (idx >= 0 && idx + r.length <= afterPrefix.length) {
      // 词根可以占满剩余部分（后面可能没有后缀）
      matchedRoot = { type: '词根', pattern: root.pattern, meaning: root.meaning, desc: root.desc, highlight: r, index: idx };
      parts.push(matchedRoot);
      break;
    }
  }

  // 3. 检测后缀（在去除前缀+词根后的剩余部分末尾查找）
  const rootEndInAfter = matchedRoot ? matchedRoot.index + matchedRoot.highlight.length : 0;
  const beforeSuffix = afterPrefix.substring(rootEndInAfter);

  if (beforeSuffix.length >= 2) {
    const sortedSuffixes = [...data.suffixes].sort((a, b) => b.pattern.length - a.pattern.length);
    for (const suffix of sortedSuffixes) {
      const s = suffix.pattern.toLowerCase();
      if (beforeSuffix.endsWith(s) && beforeSuffix.length > s.length) {
        const rest = beforeSuffix.substring(0, beforeSuffix.length - s.length);
        if (rest.length >= 1) {
          parts.push({ type: '后缀', pattern: suffix.pattern, meaning: suffix.meaning, desc: suffix.desc, highlight: s });
          break;
        }
      }
    }
  }

  // 4. 如果词根没匹配到，且也没有后缀，尝试在去前缀后的整个剩余部分找后缀
  if (!matchedRoot && !parts.find(p => p.type === '后缀')) {
    const sortedSuffixes = [...data.suffixes].sort((a, b) => b.pattern.length - a.pattern.length);
    for (const suffix of sortedSuffixes) {
      const s = suffix.pattern.toLowerCase();
      if (afterPrefix.endsWith(s) && afterPrefix.length > s.length + 2) {
        parts.push({ type: '后缀', pattern: suffix.pattern, meaning: suffix.meaning, desc: suffix.desc, highlight: s });
        break;
      }
    }
  }

  // 5. 宽松匹配相关词根（无精确拆分时）
  let relatedRoots = [];
  const hasStructParts = parts.length >= 2 || (parts.length === 1 && parts[0].type === '词根');
  if (!hasStructParts) {
    for (const root of sortedRoots) {
      if (w.includes(root.pattern.toLowerCase()) && root.pattern.length >= 3) {
        relatedRoots.push({ pattern: root.pattern, meaning: root.meaning, desc: root.desc, examples: root.examples });
        if (relatedRoots.length >= 2) break;
      }
    }
    for (const prefix of data.prefixes) {
      const p = prefix.pattern.toLowerCase();
      if (w.includes(p) && p.length >= 3 && !prefix.strict) {
        relatedRoots.push({ pattern: prefix.pattern, meaning: '前缀：' + prefix.meaning, desc: prefix.desc, examples: prefix.examples });
        if (relatedRoots.length >= 3) break;
      }
    }
  }

  // 6. 生成叙事性助记文本
  const mnemonic = buildMnemonic(word, w, parts, relatedRoots, data);

  return { parts, mnemonic, relatedRoots };
}

/**
 * 构建叙事性助记解释
 */
function buildMnemonic(word, w, parts, relatedRoots, data) {
  const prefixPart = parts.find(p => p.type === '前缀');
  const rootPart = parts.find(p => p.type === '词根');
  const suffixPart = parts.find(p => p.type === '后缀');

  // 有词根 + 至少一个其他成分 → 讲构词逻辑
  if (rootPart && (prefixPart || suffixPart)) {
    return buildStructuralMnemonic(word, prefixPart, rootPart, suffixPart);
  }

  // 只有词根（无前后缀）
  if (rootPart && !prefixPart && !suffixPart) {
    const siblings = findSiblings(rootPart.pattern, word);
    return `核心词根：${rootPart.pattern}「${rootPart.meaning}」\n记住这个意思，所有包含该词根的词都与之相关。${siblings ? '\n同根词：' + siblings : ''}`;
  }

  // 只有前缀+后缀（无词根），但前缀和后缀本身就能解释
  if (prefixPart && suffixPart && !rootPart) {
    return `${prefixPart.pattern}「${prefixPart.meaning}」 + ${suffixPart.pattern}「${suffixPart.meaning}」\n理解为：${prefixPart.meaning}的某种状态或属性，组合起来就是"${word}"的意思。`;
  }

  // 只有一个成分
  if (parts.length === 1) {
    return buildSinglePartMnemonic(word, parts[0], data);
  }

  // 有相关词根
  if (relatedRoots.length > 0) {
    return buildRelatedRootsMnemonic(word, w, relatedRoots);
  }

  // 尝试相似字母匹配
  return buildSimilarWordMnemonic(word, w, data);
}

function buildStructuralMnemonic(word, prefixPart, rootPart, suffixPart) {
  let story = '';

  if (prefixPart && rootPart && suffixPart) {
    story = `${prefixPart.pattern}「${prefixPart.meaning}」 + ${rootPart.pattern}「${rootPart.meaning}」 + ${suffixPart.pattern}「${suffixPart.meaning}」\n`;
    story += `理解为：核心是"${rootPart.meaning}"，前缀${prefixPart.pattern}修饰方向/否定，后缀${suffixPart.pattern}确定词性，合起来就是"${word}"的意思。`;
  } else if (prefixPart && rootPart) {
    story = `${prefixPart.pattern}「${prefixPart.meaning}」 + ${rootPart.pattern}「${rootPart.meaning}」\n`;
    story += `理解为：核心是"${rootPart.meaning}"，前缀${prefixPart.pattern}表示"${prefixPart.meaning}"，组合起来就是"${word}"。`;
    const sibs = findSiblings(rootPart.pattern, word);
    if (sibs) story += `\n同根词：${sibs}`;
  } else if (rootPart && suffixPart) {
    story = `${rootPart.pattern}「${rootPart.meaning}」 + ${suffixPart.pattern}「${suffixPart.meaning}」\n`;
    story += `理解为：核心是"${rootPart.meaning}"，后缀${suffixPart.pattern}表示"${suffixPart.meaning}"，合起来就是"${word}"的意思。`;
    const sibs = findSiblings(rootPart.pattern, word);
    if (sibs) story += `\n同根词：${sibs}`;
  }

  return story;
}

function buildSinglePartMnemonic(word, part, data) {
  let story = `包含${part.type}「${part.pattern}」(${part.meaning})。\n`;

  if (part.type === '词根') {
    const sibs = findSiblings(part.pattern, word);
    if (sibs) story += `同根词：${sibs}\n`;
    story += `记住"${part.meaning}"这个核心含义，同类词就能触类旁通。`;
  } else {
    story += `记住这个${part.type}，同类单词都能举一反三。`;
  }

  return story;
}

function buildRelatedRootsMnemonic(word, w, relatedRoots) {
  let story = `此词与以下词根有关联：\n`;
  for (const r of relatedRoots) {
    story += `• ${r.pattern}「${r.meaning}」 — 如 ${(r.examples || []).slice(0, 2).join('、')}\n`;
  }
  story += `从这些熟悉的词入手，帮你记住"${word}"。`;
  return story;
}

function buildSimilarWordMnemonic(word, w, data) {
  for (const root of data.roots) {
    const r = root.pattern.toLowerCase();
    if (r.length >= 3) {
      for (let i = 0; i <= w.length - 3; i++) {
        const sub = w.substring(i, Math.min(i + 4, w.length));
        if (sub === r || (sub.length >= 3 && r.includes(sub))) {
          return `注意"${sub}"部分，与词根 ${r}「${root.meaning}」相关。\n同根词：${(root.examples || []).join('、')}，结合起来理解更容易记住。`;
        }
      }
    }
  }
  return `建议通过读音和例句来记忆"${word}"。试着把它拆成你熟悉的小片段，建立个人化的记忆锚点。`;
}

function findSiblings(rootPattern, currentWord) {
  const data = loadRootsData();
  const root = data.roots.find(r => r.pattern.toLowerCase() === rootPattern.toLowerCase());
  if (root && root.examples) {
    const siblings = root.examples.filter(ex => ex.toLowerCase() !== currentWord.toLowerCase());
    if (siblings.length > 0) return siblings.join('、');
  }
  return null;
}

module.exports = { analyzeWord, loadRootsData };
