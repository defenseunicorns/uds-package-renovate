# 🏭 UDS Renovate Package

[![Latest Release](https://img.shields.io/github/v/release/defenseunicorns/uds-package-renovate)](https://github.com/defenseunicorns/uds-package-renovate/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/defenseunicorns/uds-package-renovate/release.yaml)](https://github.com/defenseunicorns/uds-package-renovate/actions/workflows/release.yaml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/defenseunicorns/uds-package-renovate/badge)](https://api.securityscorecards.dev/projects/github.com/defenseunicorns/uds-package-renovate)

This package is designed for use as part of a [UDS Software Factory](https://github.com/defenseunicorns/uds-software-factory) bundle deployed on [UDS Core](https://github.com/defenseunicorns/uds-core).

## Optional Dependencies

Renovate can be configured to persist it's cache to a Redis/Valkey instance, either in cluster or external. 

For local testing and CI, Renovate is bundled with [uds-package-valkey](ghcr.io/defenseunicorns/packages/uds/uds-package-valkey).

## Flavors

| Flavor | Description | Example Creation |
| ------ | ----------- | ---------------- |
| `upstream` | Uses upstream images within the package | `zarf package create . -f upstream` |
| `registry1` | Uses images from registry1.dso.mil within the package | `zarf package create . -f registry1` |

> **_NOTE:_**  `registry1` flavor only supports the amd64 architecture

## Releases

The released packages can be found in [ghcr](https://github.com/defenseunicorns/uds-package-renovate/pkgs/container/packages%2Fuds%2Frenovate).

## UDS Tasks (for local dev and CI)

*For local dev, this requires you install [uds-cli](https://github.com/defenseunicorns/uds-cli?tab=readme-ov-file#install)

> :white_check_mark: **Tip:** To get a list of tasks to run you can use `uds run --list`!

## Contributing

Please see the [CONTRIBUTING.md](./CONTRIBUTING.md)

## Development

When developing this package it is ideal to utilize the json schemas for UDS Bundles, Zarf Packages and Maru Tasks. This involves configuring your IDE to provide schema validation for the respective files used by each application. For guidance on how to set up this schema validation, please refer to the [guide](https://github.com/defenseunicorns/uds-common/blob/main/docs/development-ide-configuration.md) in uds-common.
