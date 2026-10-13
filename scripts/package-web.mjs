// Package the built web edition (npm run build:web) as a Linux tarball:
//   dist-web/NebuShell-web-<version>-linux.tar.gz
//     nebushell-web/
//       nebushell-web            launcher (needs Node.js >= 22 in PATH)
//       nebushell-web.service    systemd unit
//       README.md                deployment notes (docs/web/README.md)
//       server/index.js          self-contained server bundle
//       client/                  browser bundle
// The server bundle has no native modules, so one tarball serves x64 and arm64 alike.
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

for (const p of ['out/web/server/index.js', 'out/web/client/index.html']) {
  if (!existsSync(join(root, p))) {
    console.error(`Missing ${p}: run "npm run build:web" first.`)
    process.exit(1)
  }
}

const outDir = join(root, 'dist-web')
const stage = join(outDir, 'nebushell-web')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

cpSync(join(root, 'out/web/server'), join(stage, 'server'), {
  recursive: true,
  filter: (src) => !src.endsWith('.map')
})
cpSync(join(root, 'out/web/client'), join(stage, 'client'), { recursive: true })
cpSync(join(root, 'packaging/web/nebushell-web'), join(stage, 'nebushell-web'))
cpSync(join(root, 'packaging/web/nebushell-web.service'), join(stage, 'nebushell-web.service'))
cpSync(join(root, 'docs/web/README.md'), join(stage, 'README.md'))
chmodSync(join(stage, 'nebushell-web'), 0o755)

const tarball = `NebuShell-web-${version}-linux.tar.gz`
// Packed on Windows the launcher loses its exec bit, which is why the unit and the docs
// start it as `sh nebushell-web`.
// Record root ownership, not the packer's uid: a `sudo tar -x` would otherwise chown the
// install to whoever built it. GNU tar and bsdtar spell this differently.
const isBsd = /bsdtar/i.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout ?? '')
const ownerFlags = isBsd
  ? ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root']
  : ['--owner=0', '--group=0', '--numeric-owner']
const r = spawnSync('tar', [...ownerFlags, '-czf', tarball, 'nebushell-web'], {
  cwd: outDir,
  stdio: 'inherit'
})
if (r.status !== 0) process.exit(r.status ?? 1)
rmSync(stage, { recursive: true, force: true })
console.log(`dist-web/${tarball}`)
