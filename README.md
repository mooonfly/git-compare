[简体中文](README.zh-CN.md)

# Git Compare

Compare your Git project's current working tree with a branch, tag, or commit directly in VS Code. Browse changed files in a directory tree under Source Control, then open them in VS Code's native diff editor.

## Features

- Compare an entire repository or a single folder with a local branch, remote-tracking branch, tag, or commit ID.
- View working-tree differences, including staged, unstaged, and untracked files.
- Browse changes by directory and filter by file path or change status.
- Read the target revision on the left and edit the current file on the right.
- Switch comparison targets while keeping the current folder scope and filters.
- Select among multiple repositories in a workspace, with support for Git worktrees.

Comparisons do not check out branches or change the Git index.

## Requirements

- VS Code 1.85 or later.
- Git available on `PATH`.
- The built-in VS Code Git extension enabled.
- A trusted workspace containing a Git repository.

## Installation

To build and install from source, run the following in the repository root with Node.js and npm available:

```sh
npx @vscode/vsce package --allow-missing-repository
```

In VS Code, run **Extensions: Install from VSIX…** from the Command Palette and select the generated `.vsix` file.

## Usage

### Compare a project

1. Open a Git repository in VS Code.
2. Run **Git: Compare Project…** from the Command Palette, or use the compare button in the **Git Compare** view under **Source Control**.
3. If the workspace contains multiple repositories, select one.
4. Choose a branch or tag, or select **Enter Commit ID…** and enter a full or abbreviated commit hash.
5. Browse the results in **Git Compare** and click a file to open its diff.

The left side shows the selected revision; the right side shows the current working-tree file and is editable when that file exists. Added and untracked files have an empty left side; deleted files have an empty right side.

Only the latest comparison appears in the view. Starting a new project or folder comparison replaces the previous results and resets both filters.

### Compare a folder

Right-click a folder in the Explorer and choose **Compare This Folder…**, then select a target revision. Results are limited to that folder. The full comparison scope is displayed at the top of the Git Compare view.

### Manage the results

| Action | Behavior |
| --- | --- |
| **Compare Project…** | Start a new repository comparison and reset filters. |
| **Change Target…** | Select another revision while preserving the repository, folder scope, and filters. |
| **Refresh** | Resolve the target reference again and reload differences from saved files. |
| **Filter Files…** | Match a case-insensitive substring of the repository-relative path. Enter an empty value to clear the path filter. |
| **Filter Status…** | Show all changes or only modified (`M`), added (`A`), deleted (`D`), or untracked (`?`) files. |
| **Expand All** | Expand all directories in the results. |
| **Clear** | Remove the current comparison and reset filters. |

Use the view toolbar and its **…** menu to access these actions. Path and status filters apply together. **No differences** means the comparison found no changed files; **No matching files** means the filters hide all results.

## Comparison behavior and limitations

- The comparison shows the saved working tree relative to the selected revision, including staged and unstaged changes as a combined result. Ignored untracked files are excluded.
- Save files and use **Refresh** to update the file list. Unsaved edits do not affect that list; the working-tree side of an open diff follows VS Code's normal editor-buffer behavior.
- Remote branches use locally available remote-tracking references. Run `git fetch` yourself when you need updated references.
- Refreshing resolves the target reference again, so a branch or tag that has moved can produce new results. Already-open historical diffs remain pinned to the commit used when they were opened. Click a file again after refreshing or changing targets to open the updated comparison.
- Renames appear as a deletion and an addition.
- Historical content is read as UTF-8 text. Binary files, other encodings, and changes inside submodules are not fully supported.

## Development

The extension uses JavaScript, the VS Code extension API, and the Git CLI. It has no declared npm dependencies.

Open this repository in VS Code and press **F5** to launch an Extension Development Host using the included launch configuration. Open a Git project in the new window to try the extension.

Run the tests and syntax checks from the repository root:

```sh
npm test
npm run check
```

Tests use Node.js's built-in test runner. Backend tests create temporary Git repositories; extension tests use a mocked VS Code API.

## License

[MIT](LICENSE)
