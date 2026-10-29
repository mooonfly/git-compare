'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}
async function repository(folder) {
  return (await git(folder, ['rev-parse', '--show-toplevel'])).trimEnd();
}
async function resolveCommit(root, ref) {
  return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
async function refs(root) {
  const output = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  return output.trim().split('\n').filter(Boolean).map(ref => ({ ref, label: ref.replace(/^refs\/(heads|remotes|tags)\//, ''), kind: ref.startsWith('refs/tags/') ? 'Tag' : ref.startsWith('refs/remotes/') ? 'Remote branch' : 'Branch' }));
}
async function changes(root, commit, scope = root) {
  const relative = path.relative(root, scope).split(path.sep).join('/') || '.';
  const output = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', commit, '--', relative]);
  const fields = output.split('\0');
  const files = [];
  for (let i = 0; i + 1 < fields.length; i += 2) files.push({ status: fields[i], path: fields[i + 1] });
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', relative]);
  const seen = new Set(files.map(file => file.path));
  for (const name of untracked.split('\0').filter(Boolean)) {
    if (!seen.has(name)) files.push({ status: '?', path: name });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
module.exports = { git, repository, resolveCommit, refs, changes };
