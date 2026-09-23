'use strict';
function activate(context) {
  require('./native-hover').activate(context);
  require('./panel-extension').activate(context);
}
module.exports = { activate };
