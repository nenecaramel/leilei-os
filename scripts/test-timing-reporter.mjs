import { relative } from 'node:path';

// Metadata only: never retain stdout, diagnostics, test bodies or request data.
export default async function* report(source) {
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && data.file && data.nesting === 0) {
      yield JSON.stringify({ file: relative(process.cwd(), data.file),
        duration_ms: data.details?.duration_ms ?? 0, skipped: Boolean(data.skip),
        failed: type === 'test:fail' }) + '\n';
    }
  }
}
