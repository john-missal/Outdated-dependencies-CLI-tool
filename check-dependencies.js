import fs from 'fs';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import { Command } from 'commander';
import Table from 'cli-table3';
import semver from 'semver';
import pkg from '@yarnpkg/lockfile';

const { parse } = pkg;

const githubToken = process.env.GITHUB_TOKEN;

const program = new Command();

program
  .option('-c, --config <path>', 'Path to the package.json file', 'package.json')
  .option('-l, --lockfile <path>', 'Path to the yarn.lock file', 'yarn.lock')
  .option('--config-file <path>', 'Path to the priority packages config file', 'priority-packages.json')
  .option('-j, --json', 'Output results as JSON');

program.parse(process.argv);

const options = program.opts();

const defaultPriorityPackages = ['react', 'axios', 'express'];

const generateDefaultConfigFile = (configFilePath) => {
  const defaultConfig = {
    priorityPackages: defaultPriorityPackages
  };

  fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2));
  console.log(`Default config file created at ${configFilePath}. You can add more priority packages to this file.`);
};

const loadPriorityPackages = (configFilePath) => {
  if (!fs.existsSync(configFilePath)) {
    generateDefaultConfigFile(configFilePath);
  }

  const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
  return config.priorityPackages || [];
};

const getPackagesFromPackageJson = () => {
  const packageJsonPath = path.resolve(process.cwd(), options.config);

  if (!fs.existsSync(packageJsonPath)) {
    console.error('package.json file not found!');
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return packageJson;
};

const getPackagesFromYarnLock = (packageJsonDependencies) => {
  const yarnLockPath = path.resolve(process.cwd(), options.lockfile);

  if (!fs.existsSync(yarnLockPath)) {
    return null;
  }

  const yarnLock = fs.readFileSync(yarnLockPath, 'utf-8');
  let parsedYarnLock;

  try {
    parsedYarnLock = parse(yarnLock).object;
  } catch (error) {
    console.error(`Failed to parse yarn.lock file: ${error.message}`);
    return null;
  }

  const dependencies = {};
  Object.keys(packageJsonDependencies).forEach((pkg) => {
    const dependencyKey = `${pkg}@${packageJsonDependencies[pkg]}`;
    if (parsedYarnLock[dependencyKey]) {
      dependencies[pkg] = parsedYarnLock[dependencyKey].version;
    } else {
      Object.keys(parsedYarnLock).forEach((key) => {
        const [lockedPkg, version] = key.split('@').filter(Boolean);
        if (pkg === lockedPkg && parsedYarnLock[key]) {
          dependencies[pkg] = parsedYarnLock[key].version;
        }
      });
    }
  });

  return dependencies;
};

const normalizeVersion = (version) => {
  return version.replace(/^[\^~]/, '');
};

const getPackageInfo = async (pkg) => {
  try {
    const response = await axios.get(`https://registry.npmjs.org/${pkg}`);
    const latestVersion = response.data['dist-tags'].latest;
    const repositoryUrl = response.data.repository && response.data.repository.url;
    const homepageUrl = response.data.homepage;
    return { latestVersion, repositoryUrl, homepageUrl };
  } catch (error) {
    console.error(`Failed to fetch info for ${pkg}: ${error.message}`);
    return null;
  }
};

const getDependencyUpdates = async (dependencies) => {
  const updates = await Promise.all(Object.entries(dependencies).map(async ([pkg, currentVersion]) => {
    const normalizedCurrentVersion = normalizeVersion(currentVersion);
    const pkgInfo = await getPackageInfo(pkg);
    if (pkgInfo && pkgInfo.latestVersion !== normalizedCurrentVersion) {
      let docUrl = 'N/A';
      let repoUrl = pkgInfo.repositoryUrl ? convertSshUrlToHttps(pkgInfo.repositoryUrl.replace('git+', '').replace('.git', '')) : '';
      if (repoUrl) {
        try {
          const hasReleases = await checkReleases(repoUrl);
          if (hasReleases) {
            docUrl = `${repoUrl}/releases`;
          } else {
            docUrl = `https://www.npmjs.com/package/${pkg}?activeTab=versions`;
          }
        } catch (error) {
          console.error(`Error checking releases for ${repoUrl}: ${error.message}`);
          docUrl = `https://www.npmjs.com/package/${pkg}?activeTab=versions`;
        }
      } else if (pkgInfo.homepageUrl) {
        docUrl = pkgInfo.homepageUrl;
      } else {
        docUrl = `https://www.npmjs.com/package/${pkg}?activeTab=versions`;
      }
      return {
        pkg,
        currentVersion: normalizedCurrentVersion,
        latestVersion: pkgInfo.latestVersion,
        docUrl,
      };
    }
  }));
  return updates.filter(update => update);
};

const createHyperlink = (text, url) => {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
};

const supportsHyperlinks = () => {
  return process.stdout.isTTY && process.env.TERM_PROGRAM !== 'Apple_Terminal';
};

const convertSshUrlToHttps = (sshUrl) => {
  if (sshUrl.startsWith('ssh://git@github.com/')) {
    return sshUrl.replace('ssh://git@github.com/', 'https://github.com/');
  } else if (sshUrl.startsWith('git@github.com:')) {
    return sshUrl.replace('git@github.com:', 'https://github.com/');
  } else if (sshUrl.startsWith('git://github.com/')) {
    return sshUrl.replace('git://github.com/', 'https://github.com/');
  }
  return sshUrl;
};

const checkReleases = async (repoUrl) => {
  try {
    let httpsUrl = convertSshUrlToHttps(repoUrl);
    const apiUrl = httpsUrl.replace('https://github.com/', 'https://api.github.com/repos/');
    const response = await axios.get(`${apiUrl}/releases`, {
      headers: githubToken ? { Authorization: `token ${githubToken}` } : {}
    });
    return response.data.length > 0;
  } catch (error) {
    console.error(`Failed to check releases for ${repoUrl}: ${error.message}`);
    return false;
  }
};

const calculateVersionDifference = (currentVersion, latestVersion) => {
  const current = semver.parse(currentVersion);
  const latest = semver.parse(latestVersion);
  if (!current || !latest) return 0;

  const majorDiff = latest.major - current.major;
  const minorDiff = latest.minor - current.minor;
  const patchDiff = latest.patch - current.patch;

  return majorDiff * 10000 + minorDiff * 100 + patchDiff;
};

const calculateColumnWidths = (updates) => {
  let packageWidth = 'Package'.length;
  let versionUpdateWidth = 'Current -> Latest'.length;
  let docsWidth = 'Docs'.length;

  updates.forEach((update) => {
    packageWidth = Math.max(packageWidth, update.pkg.length);
    versionUpdateWidth = Math.max(
      versionUpdateWidth,
      `${update.currentVersion} -> ${update.latestVersion}`.length
    );
    const docLinkLength = supportsHyperlinks() ? 'Link'.length : update.docUrl.length;
    docsWidth = Math.max(docsWidth, docLinkLength);
  });

  return [packageWidth + 2, versionUpdateWidth + 2, docsWidth + 2];
};

const sortUpdates = (updates) => {
  return updates.sort((a, b) => {
    const diffA = calculateVersionDifference(a.currentVersion, a.latestVersion);
    const diffB = calculateVersionDifference(b.currentVersion, b.latestVersion);
    return diffB - diffA;
  });
};

const outputJson = (data) => {
  const formattedData = {
    priorityUpdates: data.priorityUpdates.map(({ pkg, currentVersion, latestVersion, docUrl }) => 
      ({ pkg, currentVersion, latestVersion, docUrl })),
    otherUpdates: data.otherUpdates.map(({ pkg, currentVersion, latestVersion, docUrl }) => 
      ({ pkg, currentVersion, latestVersion, docUrl }))
  };
  console.log(JSON.stringify(formattedData, null, 2));
};

const main = async () => {
  const priorityPackages = loadPriorityPackages(options.configFile);

  const packageJson = getPackagesFromPackageJson();
  const packageJsonDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const yarnLockDependencies = getPackagesFromYarnLock(packageJsonDependencies);

  let updatesFromPackageJson = [];
  let updatesFromYarnLock = [];

  if (yarnLockDependencies) {
    updatesFromYarnLock = await getDependencyUpdates(yarnLockDependencies);
  } else {
    updatesFromPackageJson = await getDependencyUpdates(packageJsonDependencies);
  }

  const sortedUpdatesFromPackageJson = sortUpdates(updatesFromPackageJson);
  const sortedUpdatesFromYarnLock = sortUpdates(updatesFromYarnLock);

  const prioritizedUpdatesFromPackageJson = sortedUpdatesFromPackageJson.filter((update) => priorityPackages.includes(update.pkg));
  const otherUpdatesFromPackageJson = sortedUpdatesFromPackageJson.filter((update) => !priorityPackages.includes(update.pkg));

  const prioritizedUpdatesFromYarnLock = sortedUpdatesFromYarnLock.filter((update) => priorityPackages.includes(update.pkg));
  const otherUpdatesFromYarnLock = sortedUpdatesFromYarnLock.filter((update) => !priorityPackages.includes(update.pkg));

  if (options.json) {
    outputJson({
      priorityUpdates: yarnLockDependencies ? prioritizedUpdatesFromYarnLock : prioritizedUpdatesFromPackageJson,
      otherUpdates: yarnLockDependencies ? otherUpdatesFromYarnLock : otherUpdatesFromPackageJson
    });
  } else {
    const allUpdates = [...prioritizedUpdatesFromPackageJson, ...otherUpdatesFromPackageJson, ...prioritizedUpdatesFromYarnLock, ...otherUpdatesFromYarnLock];
    const [packageWidth, versionUpdateWidth, docsWidth] = calculateColumnWidths(allUpdates);

    if (yarnLockDependencies) {
      await displayTable('Priority Updates from yarn.lock', prioritizedUpdatesFromYarnLock, packageWidth, versionUpdateWidth, docsWidth);
      await displayTable('Other Updates from yarn.lock', otherUpdatesFromYarnLock, packageWidth, versionUpdateWidth, docsWidth);
    } else {
      await displayTable('Priority Updates from package.json', prioritizedUpdatesFromPackageJson, packageWidth, versionUpdateWidth, docsWidth);
      await displayTable('Other Updates from package.json', otherUpdatesFromPackageJson, packageWidth, versionUpdateWidth, docsWidth);
    }
  }
};

const displayTable = async (title, updates, packageWidth, versionUpdateWidth, docsWidth) => {
  if (updates.length === 0) {
    return;
  }

  const table = new Table({
    head: [chalk.cyan('Package'), chalk.cyan('Current -> Latest'), chalk.cyan('Docs')],
    colWidths: [packageWidth, versionUpdateWidth, docsWidth],
  });

  updates.forEach(update => {
    const docLink = supportsHyperlinks() ? createHyperlink('Link', update.docUrl) : chalk.blue.underline(update.docUrl);
    table.push([
      update.pkg,
      `${chalk.red(update.currentVersion)} ${chalk.yellow('->')} ${chalk.green(update.latestVersion)}`,
      update.docUrl === 'N/A' ? update.docUrl : docLink,
    ]);
  });

  console.log(chalk.yellow.bold(title));
  console.log(table.toString());
};

main();
