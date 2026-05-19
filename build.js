const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const copyFiles = [
  { from: 'manifest.json', to: 'dist/manifest.json' },
  { from: 'sidepanel.html', to: 'dist/sidepanel.html' },
  { from: 'icons', to: 'dist/icons' },
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

function copyStatic() {
  for (const { from, to } of copyFiles) {
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

const buildOptions = {
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
    name: 'copy-static',
    setup(build) {
      build.onEnd(() => {
        copyStatic();
        console.log('Build complete');
      });
    },
  }],
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
