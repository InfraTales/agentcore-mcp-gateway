/** The tool definitions must fit what AgentCore Gateway accepts for Lambda targets. */
import { ADMIN_TOOLS, READ_TOOLS, type SchemaDefinition } from '../../app/src/tools/definitions';
import { adminTools } from '../../app/src/handlers/admin';
import { readerTools } from '../../app/src/handlers/reader';

const ALL = [...READ_TOOLS, ...ADMIN_TOOLS];
// The SchemaDefinition fields in the AgentCore control-plane API. Anything else
// (enum, pattern, minimum...) is not part of the gateway's tool schema.
const ALLOWED_KEYS = new Set(['type', 'description', 'properties', 'required', 'items']);
const TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

function walk(schema: SchemaDefinition, at: string, problems: string[]): void {
  for (const key of Object.keys(schema)) if (!ALLOWED_KEYS.has(key)) problems.push(`${at}: ${key} is not supported`);
  if (!TYPES.has(schema.type)) problems.push(`${at}: type ${String(schema.type)}`);
  for (const r of schema.required ?? []) if (!schema.properties?.[r]) problems.push(`${at}: required ${r} has no property`);
  for (const [k, v] of Object.entries(schema.properties ?? {})) walk(v, `${at}.${k}`, problems);
  if (schema.items) walk(schema.items, `${at}[]`, problems);
}

test('every input schema uses only the gateway schema subset', () => {
  const problems: string[] = [];
  for (const t of ALL) {
    expect(t.inputSchema.type).toBe('object');
    walk(t.inputSchema, t.name, problems);
  }
  expect(problems).toEqual([]);
});

test('tool names are unique, short and safe to join with the target name', () => {
  const names = ALL.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const n of names) {
    expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(n).not.toContain('___');
  }
});

test('every defined tool has a handler and every handler has a definition', () => {
  expect(Object.keys(readerTools).sort()).toEqual(READ_TOOLS.map((t) => t.name).sort());
  expect(Object.keys(adminTools).sort()).toEqual(ADMIN_TOOLS.map((t) => t.name).sort());
});

test('every tool has a description the model can choose by', () => {
  for (const t of ALL) expect(t.description.length).toBeGreaterThan(20);
});
