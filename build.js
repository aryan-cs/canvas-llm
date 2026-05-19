const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

/* ── Static file copy lists ── */
const extensionCopyFiles = [
  { from: 'manifest.json', to: 'dist/manifest.json' },
  { from: 'sidepanel.html', to: 'dist/sidepanel.html' },
  { from: 'icons', to: 'dist/icons' },
];

const remoteCopyFiles = [
  { from: 'remote/remote.html', to: 'docs/index.html' },
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyStatic(fileList) {
  for (const { from, to } of fileList) {
    const srcPath = path.resolve(__dirname, from);
    const destPath = path.resolve(__dirname, to);
    if (!fs.existsSync(srcPath)) continue;
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/* ── Extension build (dist/) ── */
const extensionBuild = {
  entryPoints: {
    content: 'src/content.js',
    background: 'src/background.js',
    sidepanel: 'src/sidepanel.js',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  plugins: [{
    name: 'copy-extension-static',
    setup(build) {
      build.onEnd(() => {
        copyStatic(extensionCopyFiles);
        console.log('Extension build complete');
      });
    },
  }],
};

/* ── Remote page build (docs/) ── */
const remoteBuild = {
  entryPoints: {
    remote: 'remote/remote.js',
  },
  bundle: true,
  outdir: 'docs',
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  sourcemap: watch ? 'inline' : false,
  plugins: [{
    name: 'copy-remote-static',
    setup(build) {
      build.onEnd(() => {
        copyStatic(remoteCopyFiles);
        console.log('Remote page build complete');
      });
    },
  }],
};

async function main() {
  if (watch) {
    const extCtx = await esbuild.context(extensionBuild);
    const remoteCtx = await esbuild.context(remoteBuild);
    await extCtx.watch();
    await remoteCtx.watch();
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionBuild),
      esbuild.build(remoteBuild),
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
