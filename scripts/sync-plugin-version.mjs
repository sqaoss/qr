#!/usr/bin/env node
// Copies the version in package.json into .claude-plugin/plugin.json.
//
// Runs as the npm `version` lifecycle script: semantic-release calls
// `npm version <next>` while preparing a release, npm rewrites package.json and
// then runs this, and @semantic-release/git commits both files.
//
// It matters because Claude Code keeps a plugin's users on its `version` until
// that changes: a manifest left at 1.0.0 would pin them to the 1.0.0 skill.
//
// Usage: node scripts/sync-plugin-version.mjs [project root, default: cwd]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const manifestPath = join(root, '.claude-plugin', 'plugin.json')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = readFileSync(manifestPath, 'utf8')

// One line is replaced rather than the file re-serialised, so the manifest
// keeps the formatting the lint gate checks.
const VERSION_LINE = /^(\s*"version":\s*")[^"]*(")/m
if (!VERSION_LINE.test(manifest)) {
  console.error(`${manifestPath} has no "version" field to update`)
  process.exit(1)
}

writeFileSync(manifestPath, manifest.replace(VERSION_LINE, `$1${version}$2`))
console.log(`${manifestPath}: version ${version}`)
