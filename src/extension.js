'use strict';
const vscode = require('vscode');
const path = require('node:path');
const backend = require('./git');
const VIEW = 'gitFolderCompare.results';
function activate(context) {
  let state;
  let roots = [];
  let revision = 0;
  let filter = '';
  let status = '';
  const events = new vscode.EventEmitter();
  const guarded = action => async (...args) => {
    try { await action(...args); } catch (error) { vscode.window.showErrorMessage(`Git Compare for Code: ${error.message}`); }
  };
  const provider = {
    onDidChangeTreeData: events.event,
    getChildren: node => node ? node.children || [] : roots,
    getParent: node => node.parent,
    getTreeItem(node) {
      const item = new vscode.TreeItem(node.label, node.children ? (node.kind === 'comparison' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.tooltip = node.tooltip;
      if (node.kind === 'file') {
        item.description = node.file.status;
        item.resourceUri = vscode.Uri.file(path.join(node.snapshot.root, node.file.path));
        item.iconPath = new vscode.ThemeIcon(node.file.status === 'D' ? 'diff-removed' : ['A', '?'].includes(node.file.status) ? 'diff-added' : 'diff-modified');
        item.command = { command: 'gitFolderCompare.open', title: 'Open Diff', arguments: [node] };
      } else {
        item.iconPath = new vscode.ThemeIcon(node.kind === 'comparison' ? 'git-compare' : 'folder');
        if (node.kind === 'comparison') item.description = `${node.count} changes`;
      }
      return item;
    }
  };
  const view = vscode.window.createTreeView(VIEW, { treeDataProvider: provider, showCollapseAll: true });
  view.message = 'Choose Compare Project… to compare a repository with a branch, tag, or commit.';
  function render() {
    roots = [];
    if (state) {
      const files = state.files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase()) && (!status || file.status === status));
      const id = JSON.stringify([state.root, state.scope]);
      const root = { kind: 'comparison', label: `${path.basename(state.scope)} · ${state.target.label} ↔ Working Tree`, id, children: [], count: files.length, tooltip: `${state.scope}\n${state.target.label} (${state.commit.slice(0, 8)}) → Working Tree` };
      const folders = new Map();
      for (const file of files) {
        const relative = path.posix.relative(path.relative(state.root, state.scope).split(path.sep).join('/'), file.path);
        const parts = relative.split('/');
        let parent = root;
        let prefix = '';
        for (const name of parts.slice(0, -1)) {
          prefix += name + '/';
          if (!folders.has(prefix)) {
            const folder = { kind: 'folder', label: name, id: `${id}:folder:${prefix}`, children: [], parent, tooltip: prefix };
            folders.set(prefix, folder);
            parent.children.push(folder);
          }
          parent = folders.get(prefix);
        }
        parent.children.push({ kind: 'file', label: parts.at(-1), id: `${id}:file:${file.path}`, file, snapshot: state, parent, tooltip: `${file.status} · ${file.path}\n${state.target.label} → Working Tree` });
      }
      function sort(node) {
        node.children.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.label.localeCompare(b.label));
        for (const child of node.children) if (child.children) sort(child);
      }
      sort(root);
      roots = [root];
      view.description = `${files.length}/${state.files.length}`;
      view.message = `${state.scope}\n${state.target.label} (${state.commit.slice(0, 8)}) → Working Tree${filter || status ? `\nFilter: ${filter || '*'} · ${status || 'All changes'}` : ''}${!files.length ? state.files.length ? '\nNo matching files.' : '\nNo differences.' : ''}`;
    } else { view.description = undefined; view.message = 'Choose Compare Project… to start a comparison.'; }
    events.fire();
    void vscode.commands.executeCommand('setContext', 'gitFolderCompare.hasComparison', !!state);
  }
  const virtual = (snapshot, file, empty) => vscode.Uri.from({ scheme: 'folder-compare', path: '/' + file.path, query: JSON.stringify({ root: snapshot.root, commit: snapshot.commit, path: file.path, empty }) });
  context.subscriptions.push(events, view, vscode.workspace.registerTextDocumentContentProvider('folder-compare', {
    provideTextDocumentContent(uri) {
      const data = JSON.parse(uri.query);
      return data.empty ? '' : backend.git(data.root, ['show', `${data.commit}:${data.path}`]);
    }
  }));
  async function chooseRepository(source) {
    const uri = source?.rootUri || source;
    if (uri?.fsPath) return backend.repository(uri.fsPath);
    const extension = vscode.extensions.getExtension('vscode.git');
    const api = extension && (await extension.activate()).getAPI(1);
    const repositories = [...new Set((api?.repositories || []).map(repo => repo.rootUri.fsPath))];
    if (!repositories.length) throw new Error('Open a Git repository in this workspace first.');
    if (repositories.length === 1) return repositories[0];
    const selected = await vscode.window.showQuickPick(repositories.map(root => ({ label: path.basename(root), description: root, root })), { title: 'Select Git Project' });
    return selected?.root;
  }
  async function chooseTarget(root) {
    const options = (await backend.refs(root)).map(ref => ({ label: ref.label, description: ref.kind, ref: ref.ref }));
    options.unshift({ label: '$(git-commit) Enter Commit ID…', commit: true });
    const selected = await vscode.window.showQuickPick(options, { title: 'Compare With', placeHolder: 'Search branches / tags, or choose Enter Commit ID…', matchOnDescription: true });
    if (!selected) return;
    if (!selected.commit) return { ref: selected.ref, label: selected.label };
    const ref = await vscode.window.showInputBox({ title: 'Compare with Commit ID', prompt: 'Full or abbreviated commit hash', validateInput: value => /^[a-f\d]{4,64}$/i.test(value.trim()) ? undefined : 'Enter a hexadecimal commit ID (at least 4 characters).' });
    if (ref) return { ref: ref.trim(), label: ref.trim() };
  }
  async function refresh(next, resetFilter = false) {
    if (!next) return;
    const request = ++revision;
    await vscode.window.withProgress({ location: { viewId: VIEW } }, async () => {
      const commit = await backend.resolveCommit(next.root, next.target.ref);
      const files = await backend.changes(next.root, commit, next.scope);
      if (request !== revision) return;
      state = { ...next, commit, files };
      if (resetFilter) { filter = ''; status = ''; }
      render();
    });
    return request === revision;
  }
  async function start(source, folderOnly = false) {
    const root = await chooseRepository(source);
    if (!root) return;
    const target = await chooseTarget(root);
    if (!target) return;
    if (await refresh({ root, scope: folderOnly ? source.fsPath : root, target }, true)) {
      await vscode.commands.executeCommand(`${VIEW}.focus`);
      if (roots[0]) await view.reveal(roots[0], { expand: true, focus: true, select: false });
    }
  }
  const register = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(`gitFolderCompare.${name}`, guarded(action)));
  register('project', source => start(source));
  register('folder', source => start(source, true));
  register('refresh', () => refresh(state));
  register('expandAll', async () => {
    const currentRoots = roots;
    async function expand(node) {
      if (roots !== currentRoots || !node.children?.length) return;
      await view.reveal(node, { expand: true, focus: false, select: false });
      for (const child of node.children) {
        if (roots !== currentRoots) return;
        if (child.children) await expand(child);
      }
    }
    for (const root of currentRoots) await expand(root);
  });
  register('target', async () => {
    const current = state;
    if (!current) return start();
    const target = await chooseTarget(current.root);
    if (target && state === current) await refresh({ ...current, target });
  });
  register('clear', () => { ++revision; state = undefined; filter = ''; status = ''; render(); });
  register('filter', async () => {
    const value = await vscode.window.showInputBox({ title: 'Filter Compared Files', prompt: 'Match repository-relative paths; leave empty to show all files', value: filter });
    if (value !== undefined) { filter = value; render(); }
  });
  register('status', async () => {
    const choice = await vscode.window.showQuickPick([{ label: 'All changes', value: '' }, { label: 'Modified', value: 'M' }, { label: 'Added', value: 'A' }, { label: 'Deleted', value: 'D' }, { label: 'Untracked', value: '?' }], { title: 'Filter Change Status' });
    if (choice) { status = choice.value; render(); }
  });
  register('open', async node => {
    if (node?.kind !== 'file') return;
    const { snapshot, file } = node;
    await vscode.commands.executeCommand('vscode.diff', virtual(snapshot, file, ['A', '?'].includes(file.status)), file.status === 'D' ? virtual(snapshot, file, true) : vscode.Uri.file(path.join(snapshot.root, file.path)), `${file.path} (${snapshot.target.label} ↔ Working Tree)`, { preview: true });
  });
}
module.exports = { activate };
