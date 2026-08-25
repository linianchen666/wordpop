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

# 2. Latest Release: v1.3.2
- **Features & Fixes Delivered**:
  1. **Dual-Engine Audio Pronunciation (Fix for No Sound Issue)**: Upgraded pronunciation engine with high-fidelity native human audio (supporting both American English / US and British English / UK via Youdao DictVoice). Works out-of-the-box on all Windows systems without requiring Windows OneCore / SAPI5 English voice packs. Automatically falls back to offline Web Speech API if disconnected from the network. Added Chromium `autoplay-policy` switch and interactive phonetic bar.
  2. **One-Click Backup & Restore (Data Migration)**: Added `src/main/backup.js` and settings UI card for exporting and importing all vocabulary learning progress, review stages, daily statistics history, custom wordlists, and user configurations to a portable JSON backup file. Seamlessly restores across computers without requiring an application restart.
  3. **Multi-wordlist Mapping & Cross-wordlist Progress Retention (Migration `v6`)**: Added `word_wordlists` relation table to support multi-to-multi mapping between words and wordlists. Switching between or unchecking wordlists (e.g. from CET-4 to CET-6) retains all existing study progress (`progress` table), while correctly showing the full count of 3,991 words for CET-6.
  4. **Comprehensive ECDICT Translations (Migration `v5`)**: Updated over 13,000 words across CET-4, CET-6, and Kaoyan dictionaries with common, everyday meanings from ECDICT.
  5. **SM-2 Dynamic Scheduling & UI Enhancements**: Stage回退惩罚平滑调整，优先级排队（新词优先、到期复习词按阶段与到期时间排序），界面美化、弹窗尺寸调优（380×440）、新增“今日待复习/今日待新学”实时卡片。

# 3. Release Artifacts
- **Tag**: `v1.3.2`
- **Release URL**: https://github.com/linianchen666/wordpop/releases/tag/v1.3.2
- **Installer Asset**: `WordPop Setup 1.3.2.exe` (NSIS)
