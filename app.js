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

const officialAccessLevels = {
  0: 'No access',
  5: 'Minimal access',
  10: 'Guest',
  20: 'Reporter',
  30: 'Developer',
  40: 'Maintainer',
  50: 'Owner',
};

const url = process.env.GITLAB_URL,
  accessToken = process.env.GITLAB_ACCESS_TOKEN,
  defaultBranch = process.env.GITLAB_DEFAULT_BRANCH || 'main',
  configFilePath = process.env.CONFIG_FILE_PATH || 'config.yml',
  port = process.env.LISTEN_PORT || 3002;

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

// Functions

function loadConfig(callback) {
  try {
    const fullConfigPath = path.join(injectiblesFilePath, configFilePath);
    const configFile = fs.readFileSync(fullConfigPath, 'utf8');
    projectConfigs = yaml.load(configFile, { schema: yaml.JSON_SCHEMA });
    projectConfigs.forEach((gic) => {
      if (gic.regex) {
        gic.regex = new RegExp(gic.regex); // Convert the regex string to a regular expression
      }
    });
    console.log('Configuration file loaded successfully.');
    if (typeof callback === 'function') {
      callback(); // Invoke the callback function if provided
    }

    // Perform the sanity check after loading the configuration
    validateAccessLevels();
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
            loadConfig(startWebserver);
          });
        });
      } else {
        // If the server promise does not exist, the server is not running, so simply reload the configuration and start the server
        loadConfig(startWebserver);
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

  webserver.post('/', function (req, res) {
    res.send('Got it.');
    const eventName = req.body['event_name'];
    if (eventName === 'project_create') {
      /*
        Example request:

        {
        "project_id" : 1,
        "owner_email" : "example@gitlabhq.com",
        "owner_name" : "Someone",
        "name" : "Ruby",
        "path" : "ruby",
        "event_name" : "project_create"
        }
      */
      handleProjectCreateEvent(req, res);
    } else {
      console.log(`Unknown event_name: ${eventName}`);
      res.status(400).send({ message: `Unknown event_name: ${eventName}` });
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

// Add error handling for api.Commits.create
async function createCommit(projectId, projectNamespace, defaultBranch, actions) {
  try {

    let commitMessage = '';
      for (const config of projectConfigs) {
        if (config.regex && config.regex.test(projectNamespace)) {
        commitMessage = config.message || 'Placeholder commit message....';
        break;
      }
    }

    await api.Commits.create(projectId, defaultBranch, commitMessage, actions);
    console.log('Commit created successfully.');
  } catch (err) {
    console.log(`Error creating commit: ${err.message}`);
  }
}


// Function to handle project_create event
async function handleProjectCreateEvent(req, res) {
  console.log(`New Project "${req.body['name']}" created.`);
 
  try {
    const projectId = req.body['project_id'];
    const projectName = req.body['path_with_namespace'];
    const projectConfig = projectConfigs.find(
      (gic) => gic.regex && gic.regex.test(projectName)
    );

    if (projectConfig) {
      await addCommitToProject(projectId, projectName, projectConfig);
      await addGroupsToProject(projectId, projectConfig);
    } else {
      console.log('No projectConfig found for the project.');
    }

  } catch (err) {
    console.log(`Something unexpected went wrong! Error: ${err}`);
    res.status(500).send({ message: 'Something unexpected went wrong!' });
  }
}


// Function to add groups to the project with the specified access levels
async function addGroupsToProject(projectId, projectConfig) {
  try {
    // Check if the projectConfig has any groups specified
    if (projectConfig.groups && projectConfig.groups.length > 0) {
      for (const groupInfo of projectConfig.groups) {
        try {
          // Check if the groupInfo object has both name and access properties
          if (!groupInfo.name || !groupInfo.access) {
            console.log('Error: Invalid groupInfo object. It must have both "name" and "access" properties.');
            continue; // Skip this iteration and move to the next groupInfo
          }

          const groupName = groupInfo.name;
          const accessLevel = groupInfo.access;
          // First, get the group details using the name
          const group = await api.Groups.show(groupName);

          // Then, add the group to the project with the specified access level
          await api.Projects.share(projectId, group.id, accessLevel);

          console.log(`Group "${groupName}" added to the project with access level: ${accessLevel}.`);
        } catch (err) {
          console.log(`Error adding group "${groupInfo.name}" to project: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`Error adding groups to project: ${err.message}`);
  }
}

// Function to add groups to the project with the specified access levels
async function addCommitToProject(projectId, projectNamespace, projectConfig) {
  try {
    
    if (projectConfig.paths.length === 0) {
      console.log(`Terminating: No content to inject for files matching regex: ${projectConfig.regex && projectConfig.regex.toString()}`);
      return;
    } else {
      console.log(`Accepting: Content to inject for files matching regex: ${projectConfig.regex && projectConfig.regex.toString()}`);
      // Log all the files included in the projectConfig
      for (const pathConfig of projectConfig.paths) {
        console.log(`Source: ${pathConfig.source}, Target: ${pathConfig.target}`);
      }
    }

    // Read files and create actions using the new function
    const data = await Promise.all(projectConfig.paths.map((p) => readFileAsync(p.source, 'utf8')));
    const actions = await determineActions(projectId, defaultBranch, projectConfig.paths, data);

    console.log('Actions:', actions);

    await createCommit(projectId, projectNamespace, defaultBranch, actions);

  } catch (err) {
    console.log(`Error commits to the project: ${err.message}`);
  }
}



// Function to determine the action based on file existence
async function determineActions(projectId, branch, paths, contentData) {
  const actions = [];
  for (let index = 0; index < contentData.length; index++) {
    const content = contentData[index];
    const targetPath = paths[index].target;
    const fileExists = await getFileExists(projectId, targetPath, branch);
    const action = fileExists ? 'update' : 'create';
    actions.push({
      action,
      file_path: targetPath,
      content,
    });
  }
  return actions;
}

async function readFileAsync(file, encoding) {
  const fullSourcePath = path.join(injectiblesFilePath, file);
  return new Promise((resolve, reject) => {
    fs.readFile(fullSourcePath, encoding, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

async function getFileExists(project_id, file, branch) {
  let fileExists = false;
  try {
    await api.RepositoryFiles.show(project_id, file, branch);
    fileExists = true;
  } catch(e) {
    console.log(`Error reading file: ${e.message}`);
  }
  return fileExists;
}

function validateAccessLevels() {
  if (!projectConfigs) {
    return;
  }

  projectConfigs.forEach((gic) => {
    if (Array.isArray(gic.groups)) {
      for (const groupInfo of gic.groups) {
        const { name, access } = groupInfo;
        if (typeof access !== 'number' || !(access in officialAccessLevels)) {
          console.warn(`Warning: Group "${name}" has an invalid or unsupported access level (${access}).`);
        }
      }
    }
  });
}