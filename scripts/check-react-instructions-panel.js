const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/src/screens/App.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app/src/shared/bridge-client.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'app/src/features/instructions/InstructionsPanel.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'app/src/styles.css'), 'utf8');

assert(app.includes('InstructionsPanel'), 'App must mount InstructionsPanel');
assert(client.includes('listInstructions'), 'bridge client must expose listInstructions');
assert(client.includes('saveInstruction('), 'bridge client must expose saveInstruction');
assert(client.includes('deleteInstruction('), 'bridge client must expose deleteInstruction');
assert(client.includes('saveInstructionSet'), 'bridge client must expose saveInstructionSet');
assert(client.includes('applyInstructionSet'), 'bridge client must expose applyInstructionSet');
assert(client.includes('deleteInstructionSet'), 'bridge client must expose deleteInstructionSet');
assert(panel.includes('toggleInstruction'), 'InstructionsPanel must support active toggles');
assert(panel.includes('savePreset'), 'InstructionsPanel must support preset save');
assert(panel.includes('applyPreset'), 'InstructionsPanel must support preset apply');
assert(panel.includes('removePreset'), 'InstructionsPanel must support preset delete');
assert(panel.includes('지침 저장'), 'InstructionsPanel must expose Korean save copy');
assert(panel.includes('프리셋 저장'), 'InstructionsPanel must expose preset save copy');
assert(styles.includes('.instructions-panel'), 'InstructionsPanel must be styled');
assert(styles.includes('.instruction-set-row'), 'instruction presets must be styled');

console.log('react instructions panel checks passed');
