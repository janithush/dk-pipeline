// scripts/render-batch.js
// Daily static-render loop for HyperFrames production pipeline.
// Reads compositions/YYYY-MM-DD/batch-manifest.json and renders each post
// as a strict static PNG sequence into renders/YYYY-MM-DD/<slug>/.
//
// Usage:
//   node scripts/render-batch.js                 # renders today's batch (YYYY-MM-DD)
//   node scripts/render-batch.js 2026-10-19      # renders a specific batch date
//
// Requires: every composition must pass `npx hyperframes lint` first.
// Renders with --strict so any lint error aborts that post.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const batchDate = process.argv[2] || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const manifestPath = path.join(ROOT, 'compositions', batchDate, 'batch-manifest.json');
const renderDir = path.join(ROOT, 'renders', batchDate);

if (!fs.existsSync(manifestPath)) {
  console.error(`✗ batch manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(renderDir, { recursive: true });

let passed = 0;
let failed = 0;

console.log(`◆ Rendering daily batch: ${batchDate}`);
console.log(`   posts: ${manifest.posts.length}\n`);

for (const post of manifest.posts) {
  const htmlPath = path.join(ROOT, post.html);
  const outputPath = path.join(ROOT, post.output);

  if (!fs.existsSync(htmlPath)) {
    console.error(`✗ [${post.slug}] composition not found: ${post.html}`);
    failed++;
    continue;
  }

  fs.mkdirSync(outputPath, { recursive: true });

  // Static composition (single frame, data-no-timeline) → png-sequence.
  // --strict aborts on lint errors so bad posts never ship silently.
  const cmd = `npx hyperframes render --composition "${post.html}" ` +
              `--format png-sequence --output "${post.output}" --strict`;

  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    const frame = path.join(outputPath, 'frame-00000.png');
    const size = fs.existsSync(frame) ? fs.statSync(frame).size : 0;
    console.log(`✓ [${post.slug}] rendered → ${post.output}/frame-00000.png (${size} bytes)`);
    passed++;
  } catch (err) {
    console.error(`✗ [${post.slug}] render failed`);
    failed++;
  }
}

console.log(`\n◆ Batch ${batchDate} complete: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
