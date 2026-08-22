#!/usr/bin/env node
// Zero-dependency build: stitches src/{styles.css,core.js,ui.js} into template.html to
// produce index.html. No bundler/npm dependency — src/core.js and src/ui.js talk to each
// other only via `window.DramSimCore` (already how the sim core was decoupled from the UI),
// so plain string concatenation is enough; there's no import graph to resolve.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/ui.js'), 'utf8');

if (!core.includes('// ==SIM_START==') || !core.includes('// ==SIM_END==')) {
  throw new Error('src/core.js is missing the SIM_START/SIM_END markers required by validate.js');
}

const output = template
  .replace('<!--STYLES-->', () => styles.trimEnd())
  .replace('<!--CORE-->', () => core.trimEnd())
  .replace('<!--UI-->', () => ui.trimEnd());

fs.writeFileSync(path.join(root, 'index.html'), output);
console.log('Built index.html from template.html + src/*');
