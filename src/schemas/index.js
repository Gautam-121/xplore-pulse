const { loadFilesSync } = require('@graphql-tools/load-files');
const { mergeTypeDefs } = require('@graphql-tools/merge');
const path = require('path');

const typesArray = loadFilesSync(path.join(__dirname, './**/*.graphql'));

module.exports = mergeTypeDefs(typesArray); 