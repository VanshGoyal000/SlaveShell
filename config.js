const Configstore = require('configstore');
const readline = require('readline-sync');

const config = new Configstore('SlaveShell');

function getApiKey() {
    let apiKey = config.get('gemini-api-key');
    
    if (!apiKey) {
        console.log('🔑 Welcome to SlaveShell!');
        console.log('You need to provide your Gemini API key once.');
        console.log('Get it from: https://makersuite.google.com/app/apikey\n');
        
        apiKey = readline.question('Please enter your Gemini API key: ');
        config.set('gemini-api-key', apiKey);
    }
    
    return apiKey;
}

module.exports = { getApiKey };