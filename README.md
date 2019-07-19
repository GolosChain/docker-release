# Docker release

Interactive CLI utility for easy docker hub release process.

## Usage:

```
npx docker-release
```

## Pre-configuration

You can create special configuration file ".docker-release.json" in project root:

```json
{
    "user": "my-docker-hub-account",
    "imageName": "my-image-name"
}
```

or add section "dockerRelease" with same fields directly in _package.json_:

```json
{
    "name": "my-package-name",
    "dependencies": {
        ...
    },
    ...
    "dockerRelease": {
        "user": "my-docker-hub-account",
        "imageName": "my-image-name"
    }
}
```
