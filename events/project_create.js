let path = require('path'),
    fs = require('fs');

const officialAccessLevels = {
  0: 'No access',
  5: 'Minimal access',
  10: 'Guest',
  20: 'Reporter',
  30: 'Developer',
  40: 'Maintainer',
  50: 'Owner',
};

const REQUEST_DELAY = 5000;
const injectiblesFilePath = '../config/';

module.exports = function (eventData, projectConfigs, api, defaultBranch, callback) {
  const projectId = eventData.project_id;
  const projectName = eventData.path_with_namespace;
  const projectConfig = projectConfigs.find((gic) => gic.regex && gic.regex.test(projectName));

  console.log(`New Project created: "${eventData.name}" at namespace "${projectName}" with id: "${projectId}"`);

  // Define inner functions that have access to the passed variables
  async function addGroupsToProject() { 
    // Perform the sanity check after loading the configuration
    validateAccessLevels(projectConfig);
  
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

  async function addCommitToProject() {
    try {
      if (!projectConfig) {
        console.log(`No projectConfig found for the project "${projectName}".`);
        return;
      }

      if (projectConfig.commit.paths.length === 0) {
        console.log(`Terminating: No content to inject for files matching regex: ${projectConfig.regex && projectConfig.regex.toString()}`);
        return;
      } else {
        console.log(`Accepting: Content to inject for files matching regex: ${projectConfig.regex && projectConfig.regex.toString()}`);
        // Log all the files included in the projectConfig
        for (const pathConfig of projectConfig.commit.paths) {
          console.log(`Source: ${pathConfig.source}, Target: ${pathConfig.target}`);
        }
      }

      // Read files and create actions using the new function
      const data = await Promise.all(projectConfig.commit.paths.map((p) => readFileAsync(p.source, 'utf8')));
      const actions = await determineActions(projectConfig.commit.paths, data);

      console.log('Actions:', actions);

      setTimeout(() => {
        createCommit(actions, projectConfig);
      }, REQUEST_DELAY)
    } catch (err) {
      console.log(`Error commits to the project: ${err.message}`);
    }
  }

  async function createCommit(actions, projectConfig) {
    try {
      let commitMessage = projectConfig.commit.message || 'Placeholder commit message....';

      await api.Commits.create(projectId, defaultBranch, commitMessage, actions);
      console.log('Commit created successfully.');
    } catch (err) {
      console.log(`Error creating commit: ${err.message}`);
    }
  }

  async function determineActions(paths, contentData) {
    const actions = [];
    for (let index = 0; index < contentData.length; index++) {
      const content = contentData[index];
      const targetPath = paths[index].target;
      const fileExists = await getFileExists(targetPath);
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
          if (err.code === 'EACCES' || err.code === 'EPERM') {
            reject(new Error(`Unauthorized: ${err.message}`));
          } else {
            reject(err);
          }
        } else {
          resolve(data);
        }
      });
    });
  }

  async function getFileExists(file) {
    let fileExists = false;
    try {
      await api.RepositoryFiles.show(projectId, file, defaultBranch);
      fileExists = true;
    } catch(e) {
      console.log(`Checking for file ${file}. Reading file: ${e.body} ${e.message}`);
    }
    return fileExists;
  }

function validateAccessLevels(projectConfig) {
  if (projectConfig.groups && Array.isArray(projectConfig.groups)) {
    projectConfig.groups.forEach((groupInfo) => {
      const { name, access } = groupInfo;
      if (typeof access !== 'number' || !(access in officialAccessLevels)) {
        console.warn(`Warning: Group "${name}" has an invalid or unsupported access level (${access}).`);
      }
    });
  }
}


  // Call the inner functions
  addCommitToProject();
  addGroupsToProject();

  // Call the provided callback at the end of the module
  if (typeof callback === 'function') {
    callback();
  }

};
