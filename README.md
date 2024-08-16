# Dependency Checker Script

## Overview

This script helps you check for outdated dependencies in your `package.json` and `yarn.lock` files. It compares the current versions of your dependencies with the latest versions available on the npm registry. It first checks if there is a yarn.lock file and uses that to extract the data if not the fall back is the package.json file.

## Features

- **Identify Outdated Dependencies:** Compares the current versions of dependencies against the latest versions on npm.
- **Priority Packages:** Highlights specific priority packages for easier tracking. Users can customize their list of priority packages.
- **Release Notes Check:** Provides links to the latest release notes if available on GitHub. If not, it falls back to the npm package page.
- **Hyperlinks in Terminals:** Supports hyperlinks in terminals that support them; otherwise, displays full URLs in a visually distinctive format.
- **Formatted Output:** Displays results in a well-organized table format.
- **Custom Configuration File:** Creates a default configuration file (`priority-packages.json`) for users to customize their priority packages.

## Requirements

- Node.js (v12 or higher)
- npm or yarn

## Installation

### Node.js

Make sure you have Node.js installed. If not, you can download and install it from the [Node.js website](https://nodejs.org/).

### Setting the script up:

##### Install the necessary Node.js packages by running:

npm install fs path axios chalk commander cli-table3 semver @yarnpkg/lockfile

OR

yarn add axios chalk commander cli-table3 semver @yarnpkg/lockfile

##### In the package.json file add:   

"type": "module",


##### In the terminal to access github release page without a limit restriction paste the line below with you personal token:

export GITHUB_TOKEN=your_token_here


### Running the Script

To run the script, use the following command:

node check-dependencies.js


### Configuration File
On the first run, the script will create a default configuration file (priority-packages.json) with the following content:

{
  "priorityPackages": ["react", "axios", "express"]
}

You can edit this file to add or remove priority packages as needed.


