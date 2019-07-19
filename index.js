#!/usr/bin/env node

const fs = require('fs');
const child = require('child_process');
const inquirer = require('inquirer');

const fullImageNameRx = /^([a-z0-9]+)\/([a-z0-9-]+)(?::([a-z0-9._-]+))?$/i;

let packageInfo = null;
let releaseInfo = null;

try {
    packageInfo = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
} catch (err) {
    console.error('No package.json found');
    process.exit(1);
}

try {
    releaseInfo = JSON.parse(fs.readFileSync('.docker-release.json', 'utf-8'));
} catch {}

async function run() {
    await checkRepositoryState();

    const updateType = await promptUpdateType();

    let version;

    if (updateType) {
        version = await updateVersion(updateType);
    } else {
        version = packageInfo.version;
    }

    try {
        const imageName = getLocalImageName();
        console.log('Start image building...');
        const imageId = await buildImage(imageName);

        const info = await getDockerHubInfo(version);

        if (info) {
            await tagImage(info, info.version, imageId);
            await pushImage(info, info.version);
        }

        if (updateType) {
            await gitPush(version);
        }
    } catch (err) {
        await asyncExec('git checkout -- package.json');
        throw err;
    }
}

function asyncExec(command) {
    return new Promise((resolve, reject) => {
        child.exec(command, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

function asyncExec2(command, args) {
    return new Promise((resolve, reject) => {
        const proc = child.spawn(command, args, {
            stdio: ['inherit', 'pipe', 'pipe'],
        });

        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);

        const stdoutChunks = [];
        const stderrChunks = [];

        proc.stdout.on('data', data => {
            stdoutChunks.push(data);
        });

        proc.stderr.on('data', data => {
            stderrChunks.push(data);
        });

        proc.on('error', err => {
            err.stdout = stdoutChunks.join('').trim();
            err.stderr = stderrChunks.join('').trim();
            reject(err);
        });

        proc.on('close', code => {
            const stdout = stdoutChunks.join('').trim();
            const stderr = stderrChunks.join('').trim();

            if (code !== 0) {
                const error = new Error('Closed with error');
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

async function checkRepositoryState() {
    const { stdout } = await asyncExec('git status');

    if (!stdout.endsWith('\nnothing to commit, working tree clean')) {
        console.error(
            'Error: Repository working tree is not clean!\n       Please commit changes and try again.\n'
        );
        console.error(stdout);
        process.exit(1);
    }
}

async function updateVersion(updateType) {
    const { stdout } = await asyncExec(
        `npm version --no-git-tag-version ${updateType} -m 'version %s'`
    );

    return stdout.replace(/^v/, '');
}

async function promptUpdateType() {
    const { version } = await inquirer.prompt({
        type: 'list',
        name: 'version',
        message: 'What type of update is it?',
        choices: ['major', 'minor', 'patch', 'no (skip update)'],
        default: 'patch',
    });

    if (version === 'no (skip update)') {
        return null;
    }

    return version;
}

function getLocalImageName() {
    return (
        (releaseInfo && releaseInfo.imageName) ||
        (packageInfo.dockerRelease && packageInfo.dockerRelease.imageName) ||
        packageInfo.name
    );
}

async function getDockerHubInfo(version) {
    const info = {
        user:
            (releaseInfo && releaseInfo.user) ||
            (packageInfo.dockerRelease && packageInfo.dockerRelease.user),
        imageName:
            (releaseInfo && releaseInfo.imageName) ||
            (packageInfo.dockerRelease &&
                packageInfo.dockerRelease.imageName) ||
            packageInfo.name,
    };

    const publishChoices = [];

    if (info.user && info.imageName) {
        publishChoices.push(`As "${info.user}/${info.imageName}:${version}"`);
    }

    publishChoices.push('Enter manually', `No, don't publish`);

    const { publish } = await inquirer.prompt({
        type: 'list',
        name: 'publish',
        message: 'Do you want to publish image to hub.docker.com?',
        choices: publishChoices,
        default: "No, don't publish",
    });

    if (publish === "No, don't publish") {
        return;
    }

    if (publish === 'Enter manually') {
        const { fullImageName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'fullImageName',
                message: `Enter docker hub image (if version won't be specified, ${version} will be used):\n `,
                validate(msg) {
                    if (msg.length === 0) {
                        return 'Required';
                    }

                    if (!fullImageNameRx.test(msg)) {
                        return 'Invalid format. Pattern: "user/image" or "user/image:version"';
                    }

                    return true;
                },
            },
        ]);

        const [, user, imageName, imageVersion] = fullImageName.match(
            fullImageNameRx
        );

        info.user = user;
        info.imageName = imageName;
        info.version = imageVersion;
    }

    return info;
}

async function buildImage(imageName) {
    const { stdout } = await asyncExec2('docker', [
        'build',
        '-t',
        imageName,
        '.',
    ]);

    const match = stdout
        .substr(-100)
        .match(/\nSuccessfully built ([0-9a-f]+)\n/);

    return match[1];
}

async function tagImage({ user, imageName }, version, imageId) {
    await asyncExec(`docker tag ${imageId} ${user}/${imageName}:${version}`);
}

async function pushImage({ user, imageName }, version) {
    await asyncExec2('docker', ['push', `${user}/${imageName}:${version}`]);
}

async function gitPush(version) {
    await asyncExec('git add -- package.json');
    await asyncExec(`git commit -m 'version ${version}'`);
    await asyncExec(`git tag v${version} -m 'version ${version}'`);
    await asyncExec('git push');
    await asyncExec(`git push --tags origin v${version}`);
}

run().catch(err => {
    console.error(err);
});
