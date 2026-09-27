import { readFileSync } from 'node:fs';

/**
 * @typedef {object} Finding
 * @property {string} file
 * @property {number} line
 * @property {number} [end_line]
 * @property {'correctness'|'security'|'performance'|'maintainability'|'testing'|'conventions'|'spec'} category
 * @property {'blocker'|'suggestion'|'nitpick'} severity
 * @property {string} title
 * @property {string} body
 * @property {string} [suggestion]
 *
 * @typedef {object} Review
 * @property {'approve'|'approve_with_suggestions'|'request_changes'} verdict
 * @property {string} summary
 * @property {Finding[]} findings
 */

const SCHEMA_URL = new URL('../schema/findings.schema.json', import.meta.url);

export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));
}

// A validator for the subset of JSON Schema the findings schema uses. Nuthatch has no
// dependencies, and the model's output has already been checked by the Harness, so this is a
// second line of defense rather than a general-purpose implementation. If the schema starts
// using a keyword not handled here, validate() throws rather than silently passing.
const KNOWN = new Set([
  '$schema', '$id', 'title', 'description',
  'type', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'minimum', 'minLength',
]);

export function validate(value, schema = loadSchema(), at = '$') {
  const errors = [];
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) throw new Error(`schema keyword "${key}" at ${at} is not supported`);
  }

  if (schema.type && !hasType(value, schema.type)) {
    errors.push(`${at} should be ${schema.type}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at} should be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${at} should be at least ${schema.minimum}`);
  }
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push(`${at} should not be empty`);
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}.${key} is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(child, sub, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key} is not allowed`);
    }
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${at}[${i}]`)));
  }
  return errors;
}

function hasType(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return Number.isInteger(value);
    case 'string': return typeof value === 'string';
    default: throw new Error(`schema type "${type}" is not supported`);
  }
}
