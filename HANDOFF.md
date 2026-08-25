# 1. Project Overview
- **Project Goal**: "WordPop" is a Windows desktop application for vocabulary learning. It utilizes the Ebbinghaus forgetting curve and SM-2 spaced repetition to schedule words, displaying them via non-intrusive desktop popup reminders.
- **Tech Stack**: Electron 28, Node.js, vanilla JavaScript/HTML/CSS (no frontend frameworks like React/Vue), `better-sqlite3` for local storage (WAL mode), `electron-builder` for packaging.
- **Main Directory Structure**:
  - `src/main/`: Electron main process files (`index.js`, `db.js`, `scheduler.js`, `popup-manager.js`, `ipc-handlers.js`, etc.).
  - `src/renderer/`: Frontend UI files (`popup/`, `settings/`, `stats/`, `shared/`).
  - `src/data/wordlists/`: Source JSON dictionaries (`cet4.json`, `cet6.json`, `kaoyan.json`, `frequency.json`).
  - `test/`: Automated test suites (`wordlist-mapping.test.js`, `edge-cases.test.js`).
  - `build/`: Target directory for `electron-builder` output executables.
- **Environment**: Windows OS.

# 2. Latest Release: v1.4.0
- **Features & Fixes Delivered**:
  1. **🎯 智能目标规划模式（自适应每日新词）**: 设定目标完成日期后，系统每天根据 `剩余词量 ÷ 剩余天数` 自动计算当天最佳新词量，无需用户反复手动修改每日词量配置。
  2. **🧠 智能复习负荷平衡 (Auto Load Balancing)**: 当待复习单词出现中度压力（≥40词）时，自动将今日新词配额减半；当出现严重积压（≥80词）时，自动熔断暂停今日推新（新词 = 0），优先全力消化旧词，彻底杜绝“旧债未清又添新词”的认知过载。
  3. **💆‍♂️ 逾期积压一键平摊 (Overdue Backlog Smoothing)**: 在设置面板中提供一键平摊减负功能，用户可一键将当前所有逾期单词智能均匀分散在接下来的 3、5 或 7 天（记忆稳固词适当后移、生疏词保持在近处），秒级消除单日复习扎堆压力。
  4. **Dual-Engine Audio Pronunciation (Fix for No Sound Issue)**: Upgraded pronunciation engine with high-fidelity native human audio (supporting both American English / US and British English / UK via Youdao DictVoice). Works out-of-the-box on all Windows systems without requiring Windows OneCore / SAPI5 English voice packs. Automatically falls back to offline Web Speech API if disconnected from the network. Added Chromium `autoplay-policy` switch and interactive phonetic bar.
  5. **One-Click Backup & Restore (Data Migration)**: Added `src/main/backup.js` and settings UI card for exporting and importing all vocabulary learning progress, review stages, daily statistics history, custom wordlists, and user configurations to a portable JSON backup file. Seamlessly restores across computers without requiring an application restart.
  6. **Multi-wordlist Mapping & Cross-wordlist Progress Retention (Migration `v6`)**: Added `word_wordlists` relation table to support multi-to-multi mapping between words and wordlists. Switching between or unchecking wordlists (e.g. from CET-4 to CET-6) retains all existing study progress (`progress` table), while correctly showing the full count of 3,991 words for CET-6.
  7. **Comprehensive ECDICT Translations (Migration `v5`)**: Updated over 13,000 words across CET-4, CET-6, and Kaoyan dictionaries with common, everyday meanings from ECDICT.

# 3. Release Artifacts
- **Tag**: `v1.4.0`
- **Release URL**: https://github.com/linianchen666/wordpop/releases/tag/v1.4.0
- **Installer Asset**: `WordPop Setup 1.4.0.exe` (NSIS)
