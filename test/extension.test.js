'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  const commands = new Map(), errors = [], changes = [], executions = [], reveals = [], picks = [], inputs = [];
  let provider, contentProvider;
  let files = [{ path: 'src/test.js', status: 'M' }, { path: 'added.js', status: 'A' }, { path: 'gone.js', status: 'D' }, { path: 'new.js', status: '?' }];
  let fail = false;
  const uri = fsPath => ({ fsPath });
  const disposable = { dispose() {} };
  const backend = {
    repository: async folder => folder.startsWith('/repo-b') ? '/repo-b' : '/repo-a',
    refs: async () => [{ label: 'main', kind: 'Branch', ref: 'refs/heads/main' }, { label: 'release', kind: 'Tag', ref: 'refs/tags/release' }],
    resolveCommit: async (_, ref) => { if (fail) throw Error('Missing commit'); return ref === 'refs/heads/main' ? 'a'.repeat(40) : 'b'.repeat(40); },
    changes: async (...args) => { changes.push(args); return files; },
    git: async () => 'before'
  };
  const view = { ...disposable, reveal: async (node, options) => { reveals.push({ node, options }); } };
  const vscode = {
    EventEmitter: class { constructor() { this.event = () => disposable; } fire() {} dispose() {} },
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    Uri: { from: data => data, file: uri },
    workspace: { registerTextDocumentContentProvider: (_, p) => { contentProvider = p; return disposable; } },
    extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => ({ repositories: [{ rootUri: uri('/repo-a') }, { rootUri: uri('/repo-b') }] }) }) }) },
    commands: {
      registerCommand: (name, handler) => { commands.set(name, handler); return disposable; },
      executeCommand: async (...args) => executions.push(args)
    },
    window: {
      createTreeView: (_, options) => { provider = options.treeDataProvider; return view; },
      withProgress: async (_, action) => action(),
      showErrorMessage: message => errors.push(message),
      showInputBox: async () => inputs.shift(),
      showQuickPick: async options => { const pick = picks.shift(); return pick === 'cancel' ? undefined : options[pick ?? 1]; }
    }
  };
  const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : name === './git' ? backend : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate({ subscriptions: [] });
  return { run: (name, ...args) => commands.get('gitFolderCompare.' + name)(...args), provider, contentProvider, view, errors, changes, executions, reveals, picks, inputs, uri, setFiles: value => { files = value; }, fail: () => { fail = true; } };
}
function leaves(node) { return node.children ? node.children.flatMap(leaves) : [node]; }
test('SCM tree groups files and opens immutable historical content in native Diff Editor', async () => {
  const app = setup();
  await app.run('project', { rootUri: app.uri('/repo-b') });
  assert.deepEqual(app.changes[0], ['/repo-b', 'a'.repeat(40), '/repo-b']);
  const root = app.provider.getChildren()[0];
  assert.match(root.label, /repo-b · main/);
  assert.equal(root.children[0].kind, 'folder');
  assert.equal(app.provider.getParent(root.children[0]), root);
  const nodes = leaves(root);
  const modified = nodes.find(node => node.file.status === 'M');
  assert.equal(app.provider.getTreeItem(modified).command.command, 'gitFolderCompare.open');
  await app.run('open', modified);
  let diff = app.executions.filter(call => call[0] === 'vscode.diff').at(-1);
  assert.equal(diff[2].fsPath, '/repo-b/src/test.js');
  assert.equal(JSON.parse(diff[1].query).commit, 'a'.repeat(40));
  assert.equal(await app.contentProvider.provideTextDocumentContent(diff[1]), 'before');
  for (const node of nodes.filter(node => ['A', '?', 'D'].includes(node.file.status))) {
    await app.run('open', node);
    diff = app.executions.filter(call => call[0] === 'vscode.diff').at(-1);
    assert.equal(await app.contentProvider.provideTextDocumentContent(node.file.status === 'D' ? diff[2] : diff[1]), '');
  }
  app.picks.push(2);
  await app.run('target');
  const next = leaves(app.provider.getChildren()[0])[0];
  assert.equal(next.snapshot.commit, 'b'.repeat(40));
  assert.equal(modified.snapshot.commit, 'a'.repeat(40));
  await app.run('refresh');
  assert.equal(app.changes.length, 3);
  app.fail(); await app.run('refresh');
  assert.equal(leaves(app.provider.getChildren()[0])[0].snapshot.commit, 'b'.repeat(40));
  assert.match(app.errors[0], /Missing commit/);
});
test('repository selection, folder scope, filters, empty states and clear', async () => {
  const app = setup();
  app.picks.push(1, 1);
  await app.run('project');
  assert.equal(app.changes[0][0], '/repo-b');
  app.inputs.push('src/'); await app.run('filter');
  assert.equal(leaves(app.provider.getChildren()[0]).length, 1);
  app.picks.push(3); await app.run('status');
  assert.match(app.view.message, /No matching files/);
  app.inputs.push(''); await app.run('filter');
  assert.equal(leaves(app.provider.getChildren()[0])[0].file.status, 'D');
  app.picks.push('cancel'); await app.run('project', { rootUri: app.uri('/repo-a') });
  assert.equal(app.changes.length, 1);
  app.setFiles([{ path: 'src/test.js', status: 'M' }]);
  await app.run('folder', app.uri('/repo-a/src'));
  assert.equal(app.changes[1][2], '/repo-a/src');
  assert.equal(app.provider.getChildren()[0].children[0].label, 'test.js');
  app.setFiles([]); await app.run('refresh');
  assert.match(app.view.message, /No differences/);
  await app.run('clear');
  assert.equal(app.provider.getChildren().length, 0);
  assert.equal(app.executions.filter(call => call[0] === 'setContext').at(-1)[2], false);
  assert.deepEqual(app.errors, []);
});

test('expand all reaches nested directories without opening files or moving selection', async () => {
  const app = setup();
  app.setFiles([{ path: 'a/b/c/d/e/file.js', status: 'M' }, { path: 'other/file.js', status: 'A' }]);
  await app.run('project', { rootUri: app.uri('/repo-a') });
  app.reveals.length = 0;
  await app.run('expandAll');
  assert.deepEqual(app.reveals.map(call => call.node.label), ['repo-a · main ↔ Working Tree', 'a', 'b', 'c', 'd', 'e', 'other']);
  assert.ok(app.reveals.every(call => call.options.expand && !call.options.focus && !call.options.select));
  assert.ok(!app.executions.some(call => call[0] === 'vscode.diff'));
  await app.run('clear');
  app.reveals.length = 0;
  await app.run('expandAll');
  assert.equal(app.reveals.length, 0);
  assert.deepEqual(app.errors, []);
});
