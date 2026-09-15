/**
 * Standalone diary_digest runner: prints the digest for a diary folder.
 *   node tests/digest-one.ts /path/to/diary-folder
 */

import ext from "../extensions/japanese-diary-review.ts";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node tests/digest-one.ts <diary-folder>");
	process.exit(1);
}

const tools: Record<string, any> = {};
ext({ registerTool: (d: any) => (tools[d.name] = d) } as any);

const res = await tools.diary_digest.execute("cli", {}, undefined, undefined, { cwd: dir });
console.log(res.content[0].text);
if (res.isError) process.exit(1);
