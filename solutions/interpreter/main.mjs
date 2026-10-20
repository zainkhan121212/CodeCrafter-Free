// Reference Lox interpreter used to verify the Interpreter tester. Spoilers!
// It wraps the jlox-compatible implementation in lib/protocols/lox.mjs, which was checked against
// every example in the stage descriptions.
import { readFileSync } from 'node:fs';
import { runLox } from '../../lib/protocols/lox.mjs';

const [command, file] = process.argv.slice(2);
const result = runLox(command, readFileSync(file, 'utf8'));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
