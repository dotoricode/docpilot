const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./shared/core/atomic-file');

class Store {
  constructor() {
    this.path = path.join(app.getPath('userData'), 'config.json');
    try { this.data = JSON.parse(fs.readFileSync(this.path, 'utf8')); }
    catch { this.data = {}; }
  }
  get(key) { return this.data[key]; }
  set(key, value) {
    this.data[key] = value;
    writeJsonAtomic(this.path, this.data);
  }
}

module.exports = Store;
