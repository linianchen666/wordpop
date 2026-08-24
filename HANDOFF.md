# 1. Project Overview
- **Project Goal**: "WordPop" is a Windows desktop application for vocabulary learning. It utilizes the Ebbinghaus forgetting curve to schedule words and displays them via non-intrusive desktop popup reminders.
- **Tech Stack**: Electron, Node.js, vanilla JavaScript/HTML/CSS (no frontend frameworks like React/Vue), `better-sqlite3` for local storage, `electron-builder` for packaging.
- **Main Directory Structure**:
  - `src/main/`: Electron main process files (`index.js`, `db.js`, `scheduler.js`, etc.).
  - `src/renderer/`: Frontend UI files (HTML/CSS/JS).
  - `src/data/wordlists/`: Source JSON dictionaries (`cet4.json`, `cet6.json`, `kaoyan.json`).
  - `scratch/` (or agent artifact dir): Temporary scripts for generating/updating data.
  - `build/`: Target directory for `electron-builder` output executables.
- **Environment**: Windows OS.

# 2. Current Goal
- **Problem being solved**: The most recent session tackled an issue where the built-in dictionary JSON files (CET4, CET6, Kaoyan) had overly literal, uncommon, or limited Chinese translations (e.g., `refer` was mapped only to `使求助于；谈到`). The user requested to display the most common and comprehensive meanings.
- **Task Completion Standard**: All existing JSON dictionaries needed to be updated with better translations, and a mechanism had to be built to retroactively update the local SQLite databases of existing users without losing their learning progress.

# 3. Important Decisions
- **New Words First & Importance Sorting**: (From previous session) The queue loading logic (`scheduler.js`) was updated to insert `newWords` at the beginning of the queue, followed by `dueWords` sorted by `stage ASC` (newer memories), `efactor ASC` (harder words), and `next_review_at ASC`.
- **"Unknown" Button Penalty**: Clicking the "Unknown" (不认识) button no longer resets a word's progress to `stage = 0`. Instead, it decrements `stage - 1` (and `repetitions - 1`), adjusting the interval back dynamically. This preserves partial memory retention.
- **Dictionary Data Source**: Adopted the open-source **ECDICT** database to overwrite the translation fields in `cet4.json`, `cet6.json`, and `kaoyan.json`. ECDICT was chosen because it contains comprehensive, highly common Chinese meanings, solving the user's literal-translation complaint. 
- **Database Migration Strategy**: Implemented **Migration `v5`** inside `src/main/db.js`. Instead of forcing users to repair/wipe their databases to get the new definitions (which would delete `progress`), migration `v5` runs an `UPDATE words SET translation = ?` script during app initialization, updating existing records seamlessly.

# 4. Work Completed
- **`src/main/scheduler.js`**: Modified `reloadQueue` and `_updateProgress` to implement priority sorting and the new stage-decrement penalty.
- **`scratch/update-dict.js`**: Wrote and executed a Node.js script that streamed `ecdict.csv`, extracted translations, formatted multi-line definitions with semicolons (`；`), and bulk-updated `cet4.json`, `cet6.json`, and `kaoyan.json` (affecting ~13,000 words).
- **`src/main/db.js`**: Inserted Migration `v5` logic.
- **`package.json`**: Bumped version to `1.2.9`.
- **Build execution**: Ran `npm run build` and successfully generated `build\WordPop Setup 1.2.9.exe`.

# 5. Current State
- **Available Features**: Queue sorting, the revised "Unknown" logic, and the new comprehensive dictionary translations are all fully functional and tested locally.
- **Partially Completed**: The release process for `v1.2.9`.
- **Not Started**: Any subsequent UI tweaks.
- **Known Bugs / Errors**: Local execution of `gh release create` is failing due to a consistent `EOF` network timeout when connecting to `api.github.com`. The executable exists locally in `build/` but has not reached the GitHub Releases page.

# 6. Files Changed
- `src/main/scheduler.js`: Updated queue prioritization and review penalty logic.
- `src/main/db.js`: Appended migration `v5` to update database word definitions.
- `src/data/wordlists/cet4.json` / `cet6.json` / `kaoyan.json`: The `translation` field for thousands of words was overwritten with ECDICT data.
- `package.json`: Updated `version` to `1.2.9`.
- `scratch/update-dict.js` *(New)*: The one-off script used to parse ECDICT and overwrite the JSON wordlists.

# 7. Commands / Environment
- **Start/Dev Command**: `npm run start` or `npm run dev`
- **Build Command**: `npm run build`
- **GitHub Release Command**: `gh release create v1.2.9 "build\WordPop Setup 1.2.9.exe" --title "v1.2.9 - Comprehensive Dictionary Translations" --notes "..."`
- **Dependencies**: Uses `electron`, `electron-builder`, `better-sqlite3`.

# 8. Problems Encountered
- **Error**: `error checking for existing release: Head "https://api.github.com/repos/linianchen666/wordpop/releases/tags/v1.2.9": EOF`
- **Root Cause**: Network instability or proxy issues disrupting the connection between the terminal and the GitHub API during the release upload.
- **Attempted**: Ran the command twice as a background task. Both failed with the exact same `EOF` error.
- **Current Workaround**: Instructed the user to manually run the `gh release create` command in their own terminal or test the local build directly.
- **Unresolved**: The actual `1.2.9` release is still not uploaded to GitHub.

# 9. Remaining Tasks
- **P0**: Successfully push the codebase changes (`git add/commit/push`) and upload the `WordPop Setup 1.2.9.exe` to GitHub Releases (either automatically or by assisting the user).
- **P1**: Confirm with the user if they find the new ECDICT translations satisfactory across random word samplings.
- **P2**: Add a fallback or retry mechanism for `gh release create` in future automated deployments.

# 10. Recommended Next Action
**First Step**: Run a `git status` and `git diff` to review the modifications to `db.js` and the `json` wordlists. Then, attempt to assist the user in deploying `v1.2.9` to GitHub (via `gh release` or a manual upload).

# 11. Conversation-specific Context
- **Translation specificity**: The user explicitly cited the word `refer`. Previously it showed `使求助于；谈到`. Now, thanks to the ECDICT update, it shows `vt. 提交, 归诸于...；vi. 提到, 涉及, 查阅, 查询, 咨询`. Ensure that any future dictionary modifications maintain these highly common, everyday meanings.
- **Agent Environment**: Background tasks (`manage_task`, `run_command`) running `gh release upload` have been consistently timing out or getting cancelled during this session. If network operations fail, immediately provide the exact terminal commands for the user to copy-paste.
