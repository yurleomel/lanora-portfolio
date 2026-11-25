// Runs the bot's scripts (bot/js/*.js) the way n8n Code nodes did: common.js + the file, with the same globals
// (DateTime, $input, $('Node'), $getWorkflowStaticData, $runIndex). Each script is compiled once.
const fs = require('node:fs');
const path = require('node:path');
const { DateTime } = require('luxon');

const JS = path.join(__dirname, '..', 'bot', 'js');
const common = fs.readFileSync(path.join(JS, 'common.js'), 'utf8');
const compiled = new Map();

function compile(file) {
  if (!compiled.has(file)) {
    const src = `${common}\n${fs.readFileSync(path.join(JS, file), 'utf8')}`.replace('__OWNER_ID__', String(Number(process.env.OWNER_ID)));
    compiled.set(file, new Function('DateTime', '$input', '$', '$getWorkflowStaticData', '$runIndex', src));
  }
  return compiled.get(file);
}

const asItems = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).map((json) => ({ json }));

// nodes: { 'Node name': row | [rows] } — what `$('Node name')` returns; a missing name throws like an
// unexecuted n8n node (rowsOf() and friends catch it).
function runScript(file, input, nodes = {}, staticData = {}, runIndex = 0) {
  const inp = asItems(input);
  const $input = { first: () => inp[0], all: () => inp };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`unexecuted ${name}`);
    const arr = asItems(nodes[name]);
    return { first: () => arr[0], all: () => arr, item: arr[0] };
  };
  const out = compile(file)(DateTime, $input, $, () => staticData, runIndex);
  return (out || []).map((i) => i.json);
}

module.exports = { runScript };
