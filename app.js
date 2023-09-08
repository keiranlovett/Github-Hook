'use strict';

let express = require('express'),
  bodyParser = require('body-parser'),
  errorhandler = require('errorhandler'),
  morgan = require('morgan'),
  compression = require('compression'),
  fs = require('fs'),
  path = require('path'),
  yaml = require('js-yaml');

const injectiblesFilePath = '../config/';

// Import the plugin functions
const projectCreateEvent = require("./events/project_create");

const url = process.env.GITLAB_URL,
  accessToken = process.env.GITLAB_ACCESS_TOKEN,
  defaultBranch = process.env.GITLAB_DEFAULT_BRANCH || 'main',
  configFilePath = process.env.CONFIG_FILE_PATH || 'config.yml',
  port = process.env.LISTEN_PORT || 3002;


// Map event names to corresponding plugin functions
const eventPlugins = {
  project_create: projectCreateEvent
};



const { Gitlab } = require('@gitbeaker/rest');

const api = new Gitlab({
  host: url,
  token: accessToken
});

let projectConfigs,
    webserver,
    server,
    serverPromise; // Add a variable to keep track of the server promise

verifyEnvironment();
watchConfigFile();

// Export a function to get the loaded project configurations
module.exports.getProjectConfigs = function () {
  return projectConfigs;
};

// Functions

function loadConfig() {
  try {
    const fullConfigPath = path.join(injectiblesFilePath, configFilePath);
    const configFile = fs.readFileSync(fullConfigPath, 'utf8');
    const loadedConfigs = yaml.load(configFile, { schema: yaml.JSON_SCHEMA });
    loadedConfigs.forEach((gic) => {
      if (gic.regex) {
        gic.regex = new RegExp(gic.regex); // Convert the regex string to a regular expression
      }
    });

    // Update the projectConfigs with the new loaded configurations
    projectConfigs = loadedConfigs;

    console.log('Configuration file loaded successfully.');
  } catch (err) {
    console.error('Error loading configuration file:', err);
  }
}


function watchConfigFile() {
  fs.watchFile(configFilePath, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      console.log('Configuration file has changed. Reloading...');
      if (serverPromise) {
        // If the server promise exists, it means the server is running, so stop it and reload the configuration
        serverPromise.then(() => {
          stopWebserver(() => {
            loadConfig(); // Simply reload the configuration without checking the return value
            startWebserver();
          });
        });
      } else {
        // If the server promise does not exist, the server is not running, so simply reload the configuration and start the server
        loadConfig(); // Simply reload the configuration without checking the return value
        startWebserver();
      }
    }
  });
}


function verifyEnvironment() {
  if (typeof url == 'undefined') {
    console.log('GITLAB_URL not set. Please provide the url of the instance you wish to connect to.');
    process.exit(1);
  }

  if (typeof accessToken == 'undefined') {
    console.log('GITLAB_ACCESS_TOKEN not set. Please generate a Personal Access Token for the account you wish to connect.');
    process.exit(1);
  }

  if (typeof process.env.GITLAB_DEFAULT_BRANCH == 'undefined') {
    console.log('GITLAB_DEFAULT_BRANCH not set, defaulting to Main.');
  }

  if (typeof process.env.LISTEN_PORT == 'undefined') {
    console.log('LISTEN_PORT not set, defaulting to 3002.');
  }

  console.log('Environment verification successful.');
}

process.on('SIGINT', () => {
  console.log('Received SIGINT signal. Stopping the web server...');
  stopWebserver();
  process.exit(0);
});


function startWebserver() {
  webserver = express();

  webserver.use(
    errorhandler({
      dumpExceptions: true,
      showStack: true,
    })
  );

  webserver.use(morgan('combined'));
  webserver.use(compression());
  // parse various different custom JSON types as JSON
  webserver.use(bodyParser.json({ type: 'application/json' }));

  webserver.get('/', function (req, res) {
    res.send('Hello, please give me a POST!\n');
  });

  // Route to handle the '/config' endpoint
  webserver.get('/config', function (req, res) {
    // Generate the human-friendly output
    const formattedOutput = projectConfigs.map((config, index) => {
      return `
        Project Config ${index + 1}:
          Regex: ${config.regex}
          Commit Message: ${config.commit.message}
          Groups: ${JSON.stringify(config.groups)}
          Commit Paths: ${JSON.stringify(config.commit.paths)}
        `;
    }).join('\n');

    // Send the formatted output back to the client
    res.send(`<pre>${formattedOutput}</pre>`);
  });

  webserver.post('/', function (req, res) {
    const eventName = req.body['event_name'];
    const eventData = req.body;

    // Check if the event has a corresponding plugin
    if (eventPlugins[eventName]) {
      const pluginFunction = eventPlugins[eventName];
      if (typeof pluginFunction === 'function') {
         pluginFunction(eventData, projectConfigs, api, defaultBranch, () => {
          res.send('Project Create Event handled successfully.');
        });
      }
    } else {
      console.log(`No plugin found for event: ${eventName}`);
    }
  });

  // Start the server and save the promise
  serverPromise = new Promise((resolve) => {
    server = webserver.listen(port, () => {
      console.log('Webserver is listening on ' + port);
      resolve(server); // Resolve the promise with the server instance
    });
  });
}

// Function to stop the web server
function stopWebserver(callback) {
  if (serverPromise) {
    serverPromise.then((server) => {
      server.close(() => {
        console.log('Web server has been stopped.');
        if (callback) {
          callback();
        }
      });
    });
  }
}

// Functions for handling project_create event
function getProjectConfig(projectName) {
  // Load and return the project configuration based on the projectName
  const projectConfig = projectConfigs.find(
    (gic) => gic.regex && gic.regex.test(projectName)
  );
  return projectConfig;
}
