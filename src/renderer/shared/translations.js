// Display-only previews: original dictionary strings and learning data stay intact.
(function (root) {
  const POS = /(?:^|[；;\n]\s*|\s+)(aux|vt|vi|adv|adj|prep|pron|conj|interj|abbr|num|art|det|int|n|v|a)\.\s*/gi;
  const TECHNICAL = /[\[【［](?:计|医|化|经|法|生|物|数|电|机|地|农|军|航|建|商|纺|冶|药|解|动|植|矿|工|计算机|医学|化学|法律)[\]】］]/;
  const aliases = { vt: 'v', vi: 'v', a: 'adj', int: 'interj' };

  function splitSenses(text) {
    const parts = [];
    let start = 0, depth = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if ('(（[【［'.includes(char)) depth++;
      else if (')）]】］'.includes(char)) depth = Math.max(0, depth - 1);
      else if (!depth && ',，;；\n'.includes(char)) {
        parts.push(text.slice(start, i)); start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function summarize(value, options = {}) {
    const full = typeof value === 'string' ? value : String(value ?? '');
    const original = full.trim();
    if (!original) return { summary: '', full, shortened: false };
    const { maxGroups = 3, maxSenses = 2, maxLength = 64 } = options;
    const matches = [...original.matchAll(POS)];
    const chunks = [];
    if (!matches.length) chunks.push({ pos: '', body: original });
    else {
      if (matches[0].index > 0) chunks.push({ pos: '', body: original.slice(0, matches[0].index) });
      matches.forEach((match, index) => chunks.push({
        pos: match[1].toLowerCase(),
        body: original.slice(match.index + match[0].length, matches[index + 1]?.index ?? original.length)
      }));
    }
    const groups = [];
    let removedTechnical = false;
    for (const chunk of chunks) {
      const technical = chunk.body.search(TECHNICAL);
      if (technical >= 0) removedTechnical = true;
      const body = technical >= 0 ? chunk.body.slice(0, technical) : chunk.body;
      const senses = splitSenses(body);
      if (!senses.length) continue;
      const pos = aliases[chunk.pos] || chunk.pos;
      let group = groups.find(g => g.pos === pos);
      if (!group) { group = { pos, senses: [] }; groups.push(group); }
      for (const sense of senses) if (!group.senses.includes(sense)) group.senses.push(sense);
    }
    // Keep a definition consisting solely of a specialist sense readable.
    if (!groups.length) groups.push({ pos: '', senses: [original] });
    const overflow = groups.length > maxGroups || groups.some(g => g.senses.length > maxSenses);
    if (!removedTechnical && !overflow && Array.from(original).length <= maxLength) {
      return { summary: original, full, shortened: false };
    }
    // Modal meanings must not be lost behind rare noun/transitive entries (can).
    groups.sort((a, b) => Number(b.pos === 'aux') - Number(a.pos === 'aux'));
    let summary = groups.slice(0, maxGroups).map(group =>
      (group.pos ? group.pos + '. ' : '') + group.senses.slice(0, maxSenses).join('、')
    ).join('；');
    if (Array.from(summary).length > maxLength) summary = Array.from(summary).slice(0, maxLength - 1).join('') + '…';
    return { summary, full, shortened: summary !== original };
  }

  function render(summaryElement, detailsElement, fullElement, value) {
    const result = summarize(value);
    summaryElement.textContent = result.summary;
    fullElement.textContent = result.full;
    detailsElement.hidden = !result.shortened;
    detailsElement.open = false;
    return result;
  }

  const api = { summarize, render };
  if (root) root.wordpopTranslations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? null : window);
