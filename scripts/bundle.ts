/**
 * Builds one self-contained file per Lambda function: build/<name>/index.js.
 * Every dependency is inside, including the AWS SDK, so the code that runs in
 * Lambda is the code the bundle test loaded. CDK zips each folder as it is.
 */
import { rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildSync } from 'esbuild';

const root = path.join(__dirname, '..');
export const FUNCTIONS = ['reader', 'admin'] as const;

rmSync(path.join(root, 'build'), { recursive: true, force: true });
for (const name of FUNCTIONS) {
  const result = buildSync({
    entryPoints: [path.join(root, 'app', 'src', 'handlers', `${name}.ts`)],
    outfile: path.join(root, 'build', name, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    metafile: true,
  });
  // Kept outside the deployed folder. The bundle test reads it.
  writeFileSync(path.join(root, 'build', `${name}.meta.json`), JSON.stringify(result.metafile));
  const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
  console.log(`bundled build/${name}/index.js (${(bytes / 1024).toFixed(0)} KiB with source map)`);
}
