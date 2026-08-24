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

# 2. Latest Release: v1.3.0
- **Features & Fixes Delivered**:
  1. **Multi-wordlist Mapping & Cross-wordlist Progress Retention (Migration `v6`)**: Added `word_wordlists` relation table to support multi-to-multi mapping between words and wordlists. Switching between or unchecking wordlists (e.g. from CET-4 to CET-6) retains all existing study progress (`progress` table), while correctly showing the full count of 3,991 words for CET-6.
  2. **Comprehensive ECDICT Translations (Migration `v5`)**: Updated over 13,000 words across CET-4, CET-6, and Kaoyan dictionaries with common, everyday meanings from ECDICT.
  3. **SM-2 Dynamic Scheduling**: Stage回退惩罚平滑调整，优先级排队（新词优先、到期复习词按阶段与到期时间排序）。
  4. **Modern UI & Statistics Cards**: 界面美化、弹窗尺寸调优（380×440）、新增“今日待复习/今日待新学”实时卡片。

# 3. Release Artifacts
- **Tag**: `v1.3.0`
- **Release URL**: https://github.com/linianchen666/wordpop/releases/tag/v1.3.0
- **Installer Asset**: `WordPop Setup 1.3.0.exe` (NSIS)
