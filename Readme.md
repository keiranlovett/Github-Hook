# Gitlab Webhook: Custom Templates

This project aims to provide a simple webserver companion/receiver to a local Gitlab instance that listens for System Events.

Currently supported:
  - Enforcing `Groups` on newly created projects.
  - Injecting a new `Project` repository with template files (such as `README.md`, `.gitignore`).

This is achieved by using Gitlabs "System Hooks" (not to be confused with server hooks or file hooks) that perform `HTTP POST` requests and are triggered by various Gitlab system events. You can see a complete list on Gitlabs [System Hooks page](https://docs.gitlab.com/ee/administration/system_hooks.html).

#### To create a system hook:

> You must have Administrative access to the Gitlab instance you wish to configure the System Hook.

1. Open the intended Gitlab instance you want to trigger events on.
2. On the left sidebar, expand the top-most chevron.
3. Select **Admin Area**.
4. On the left sidebar, select **System Hooks**.
5. Provide the **URL** and **Secret Token**.
6. Select the checkbox next to each optional **Trigger** you want to enable.
7. Select **Enable SSL verification**, if desired.
8. Select **Add system hook**.

> You can easily debug your system hook receiver by going to **Admin Area -> System Hooks > Edit**, On the bottom of the screen there are “**Recent Deliveries**”. You can go to “View details” on each one of the requests in order to get additional debugging information— you can check the “Request headers” & “Response headers” of your request, the “Response body” that came back from your receiver and the JSON itself.

## Environment Variables
Before running the webhook, you need to set the following environment variables:
* `GITLAB_URL`: Required. The URL of your Gitlab instance (e.g., https://your.gitlab.domain).
* `GITLAB_ACCESS_TOKEN`: Required. Gitlab access token with admin privileges.
* `GITLAB_DEFAULT_BRANCH`: Optional. The default branch to use when creating commits (e.g., "main" or "master"). (Default value: `Main`)
* `CONFIG_FILE_PATH`: Optional. The path to the configuration file (`config.yml`) that defines the injection rules for new projects. (Default value: `'config.yml'`)
* `LISTEN_PORT`: Optional: The port on which the webhook will listen for incoming requests. (Default value: `3002`)

## Configuration
The config.yml file defines the injection rules for new projects. It consists of an array of objects, each representing a specific rule for project injection. Below is an explanation of the properties used in the configuration:

#### `regex` (required)
This property specifies the regular expression pattern to match against the project namespace. If a project's namespace matches this pattern, the corresponding injection rule will be applied. For example, the following rule will match any project with a namespace that starts with "documentation/":

```yaml
- regex: "^documentation/"
  # Rest of the properties...
```

#### `groups` (optional)
This property defines the groups to be added to the project along with their access levels. It should be an array of objects, where each object has a name and an access property. The name specifies the group's name as defined in Gitlab, and the access specifies the access level for the group. Follow Gitlabs documentation for more on [Access Levels](https://docs.gitlab.com/ee/api/access_requests.html). But right now, Access levels can be one of the following values:

```
0: No access
5: Minimal access
10: Guest
20: Reporter
30: Developer
40: Maintainer
50: Owner
```

For example, to add two groups with different access levels to a project:
```yaml
- regex: "example-project"
  groups:
    - name: managers
      access: 40
    - name: developers
      access: 30
  # Rest of the properties...
```

#### `message` (optional)
This property defines the default commit message that will be used when creating commits for new projects. If not specified, a default placeholder commit message will be used. For example:
```yaml
- regex: "example-project"
  message: "Initial commit for example project."
  # Rest of the properties...
```

#### `paths` (required)
This property specifies the files to be injected into the project. It should be an array of objects, where each object has a **source** and a **target** property. The **source** property specifies the path to the file that will be injected, and the **target** property specifies the path where the file will be placed in the new project. For example:
```yaml
- regex: "example-project"
  paths:
    - source: "includes/.gitignore"
      target: ".gitignore"
    - source: "includes/README.md"
      target: "README.md"
  # Rest of the properties...
```

### Complete Example `config.yml`

```yaml
- regex: "^documentation/"
  groups:
    - name: managers
      access: 30
    - name: developers
      access: 10
  message: "This is a commit for documentation repositories..."
  paths: []

- regex: "^game/"
  groups:
    - name: managers
      access: 30
  message: "This is a commit for games repositories..."
  paths:
    - source: "includes/games/.gitignore"
      target: ".gitignore"

- regex: ".*"  # Default regex
  message: "This is a commit for default repositories..."
  paths:
    - source: "includes/default/.gitignore"
      target: ".gitignore"
    - source: "includes/default/.gitlab-ci.yml"
      target: ".gitlab-ci.yml"
    - source: "includes/default/README.md"
      target: "README.md"
```

### GitLab API Tokens
Go to profile/personal_access_tokens on your GitLab instance.

To create a Personal Access Token, give it a name, and check the api box under Scopes. 
Then click the Create personal access token button.

> Note: You may want to do this step with a unique account that doesn't belong to an actual user. This prevents problems if the token holder's user leaves your org and their account has to be deleted.


## Usage with Docker
If you prefer to run the webhook in a Docker container, you can use the following command:

```bash
docker run -d \
    --name gitlab-template-project-hook \
    --restart=always \
    -e GITLAB_URL=https://your.gitlab.domain \
    -e GITLAB_ACCESS_TOKEN=<Personal Access Token> \
    -e DEFAULT_BRANCH=main \
    -e CONFIG_FILE_PATH=config.yml \
    -p 3002:3002 \
    -v /path/to/config:/config \
    ghcr.io/keiranlovett/gitlab-server-hook:main
```

## Usage without Docker
If you want to run the webhook without Docker, follow these steps:

1. Make sure you have [Node.js](https://nodejs.org) installed.
2. Run `npm install` to install the required dependencies.
3. Set the environment variables mentioned above in the `app.js` file.
4. Run `node app.js` to start the webhook server.
5. Add a system hook in Gitlab that points to the webhook's URL to receive project creation events.
6. Create a new project in Gitlab, and it will automatically be shared with the specified default group.



# TODO / Contributing

- [] Support for adding specific `Members` to a project.
- [] Enfore a project naming convention.
- [] Custom logging support???
- Pulling or changing data in LDAP servers.
