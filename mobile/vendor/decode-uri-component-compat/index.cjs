// Keep the CommonJS function API expected by query-string 7 while using the fixed upstream decoder.
const decoder = require('decode-uri-component-fixed');
module.exports = decoder.default || decoder;
